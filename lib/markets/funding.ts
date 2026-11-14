import { simulate, balancesOf } from '../account/chain';
import type { SignedIntent } from '../account/intents';
import { findToken, generateIntent, requestRealQuote, submitIntent, swapStatus } from '../oneclick';
import { payloadProblem } from '../send/guard';
import { tradingAddress } from './signer';

const hyperliquidUsdc = '1cs_v1:hypercore:hip1:0x6d1e7cde53ba9467b783cb7c530ce054';

export function fundingConfigured() {
  return process.env.TRADING_1CLICK_FUNDING === 'enabled';
}

export type FundingQuote = {
  deposit: string;
  asset: string;
  symbol: string;
  maxUnits: string;
  from: string;
  to: string;
  address: string;
  payload: string;
  expires: number;
};

export async function prepareFunding(accountId: string, asset: string, amount: number): Promise<FundingQuote> {
  if (!fundingConfigured()) throw new Error('1Click trading funding is unavailable.');
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(amount * 100 - cents) > 0.00001 || cents < 100 || cents > 10_000_000) {
    throw new Error('Choose a USDC amount from 1 to 100,000 with up to two decimal places.');
  }
  const [token, address] = await Promise.all([findToken(asset), tradingAddress(accountId)]);
  if (!token || asset === hyperliquidUsdc) throw new Error('Choose a supported balance in your fourfivex account.');
  const quote = await requestRealQuote({
    dry: false, swapType: 'EXACT_OUTPUT', slippageTolerance: 100,
    originAsset: asset, depositType: 'INTENTS', refundTo: accountId, refundType: 'INTENTS',
    destinationAsset: hyperliquidUsdc, recipient: address, recipientType: 'DESTINATION_CHAIN',
    amount: String(BigInt(cents) * BigInt(1_000_000)), deadline: new Date(Date.now() + 15 * 60_000).toISOString(),
  });
  const [available, payload] = await Promise.all([balancesOf(accountId, [asset]), generateIntent(quote.depositAddress, accountId)]);
  const problem = payloadProblem(payload, { accountId, depositAddress: quote.depositAddress, assetId: asset, maxUnits: quote.amountIn });
  if (problem) throw new Error(problem);
  if (BigInt(available[0]) < BigInt(quote.amountIn)) throw new Error('Your fourfivex balance cannot cover this quote.');
  return {
    deposit: quote.depositAddress, asset, symbol: token.symbol, maxUnits: quote.amountIn,
    from: quote.amountInFormatted, to: quote.amountOutFormatted, address, payload, expires: Date.parse(quote.deadline),
  };
}

export async function submitFunding(accountId: string, depositAddress: string, signed: SignedIntent) {
  if (!fundingConfigured() || !/^[a-z0-9._-]{2,128}$/i.test(depositAddress)) throw new Error('Invalid funding request.');
  const [swap, address] = await Promise.all([swapStatus(depositAddress), tradingAddress(accountId)]);
  const request = swap.quoteResponse?.quoteRequest;
  const quote = swap.quoteResponse?.quote;
  if (swap.status !== 'PENDING_DEPOSIT' || request?.depositType !== 'INTENTS' || request.refundTo !== accountId ||
    request.refundType !== 'INTENTS' || request.destinationAsset !== hyperliquidUsdc || request.recipientType !== 'DESTINATION_CHAIN' ||
    request.recipient !== address || typeof request.originAsset !== 'string' || typeof quote?.amountIn !== 'string') {
    throw new Error('The transfer no longer matches your trading account.');
  }
  const problem = payloadProblem(signed.payload, { accountId, depositAddress, assetId: request.originAsset, maxUnits: quote.amountIn });
  if (problem) throw new Error(problem);
  await simulate([signed]);
  try {
    return { intentHash: await submitIntent(signed) };
  } catch {
    return { state: 'unknown' };
  }
}
