import { createHmac, hkdfSync, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { activeAssetData, frontendOpenOrders } from '@nktkas/hyperliquid/api/info';
import type { OrderResponse } from '@nktkas/hyperliquid/api/exchange';
import { b64u, utf8 } from '../account/encoding';
import { makeNonce, type SignedIntent } from '../account/intents';
import { currentSalt, simulate } from '../account/chain';
import { tradeActions, tradeDigest, tradePayload, withdrawalPayload, withdrawalRequest, type TradeAuthorization, type Withdrawal } from './authorization';
import { requestSignatures, signerContract, tradingAddress, tradingConfigured } from './signer';
import { prepareOrder, readPerpetual, readPosition, readWithdrawable, transport, type OrderDraft, type OrderQuote, type TradingAddress } from './trade';
import type { Market } from '@fourfivex/markets-protocol/markets';

export type PreparedTrade = { quote: OrderQuote; authorization: TradeAuthorization; ticket: string };
type Ticket = Omit<PreparedTrade, 'ticket'> & { accountId: string; address: TradingAddress; kind: 'trade' };
type WithdrawalTicket = { kind: 'withdrawal'; accountId: string; address: TradingAddress; withdrawal: Withdrawal; authorization: Pick<TradeAuthorization, 'contract' | 'deadline' | 'nonce'> };
export type TradeResult = { state: 'filled' | 'partial'; size: string; average: string }
  | { state: 'rejected' | 'unknown' | 'reconciled'; message: string };

export class CollateralRequired extends Error {}

export function executionConfigured() {
  return tradingConfigured();
}

function ticketMac(data: string) {
  const secret = process.env.TRADING_TICKET_SECRET;
  const key = secret && secret.length >= 32 ? secret : Buffer.from(hkdfSync(
    'sha256', process.env.TRADING_RELAYER_KEY!, '', 'fourfivex:trading-review:v1', 32,
  ));
  return createHmac('sha256', key).update(data).digest('base64url');
}

function seal(ticket: Ticket | WithdrawalTicket) {
  const data = b64u.encode(utf8(JSON.stringify(ticket)));
  return `${data}.${ticketMac(data)}`;
}

function unseal(value: string): Ticket | WithdrawalTicket {
  const [data, mac, extra] = value.split('.');
  if (!data || !mac || extra || !/^[a-z0-9_-]{43}$/i.test(mac)) throw new Error('Invalid order review.');
  const expected = ticketMac(data);
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) throw new Error('Invalid order review.');
  return JSON.parse(new TextDecoder().decode(b64u.decode(data))) as Ticket | WithdrawalTicket;
}

async function needsLeverage(quote: OrderQuote, user: TradingAddress) {
  const { market, closing, buy, size, leverage } = quote;
  const position = await readPosition(market, user);
  if (closing) {
    if (!position || (Number(position.szi) < 0) !== buy || Math.abs(Number(position.szi)) !== Number(size)) {
      throw new Error('The position changed. Review a fresh quote.');
    }
    return false;
  }
  if (position) throw new Error('A position is already open in this market.');
  const [asset, orders] = await Promise.all([
    activeAssetData({ transport }, { user, coin: market.coin }),
    frontendOpenOrders({ transport }, { user, dex: market.dex }),
  ]);
  if (orders.some(order => order.coin === market.coin)) throw new Error('Cancel existing orders on this market before opening a position.');
  const available = Number(asset.availableToTrade[buy ? 0 : 1]);
  if (!Number.isFinite(available) || available < quote.margin + (quote.fee ?? 0)) {
    throw new CollateralRequired(`Your trading account needs more ${market.collateral} for this order.`);
  }
  const update = asset.leverage.type !== 'isolated' || asset.leverage.value !== leverage;
  if (!update && Number(asset.maxTradeSzs[buy ? 0 : 1]) < Number(size)) {
    throw new Error('This order exceeds the available position size.');
  }
  return update;
}

export async function prepareTrade(accountId: string, market: Market, draft: OrderDraft, closing: boolean): Promise<PreparedTrade> {
  if (!executionConfigured()) throw new Error('Trading signer is unavailable.');
  const [address, salt, instrument] = await Promise.all([tradingAddress(accountId), currentSalt(), closing ? readPerpetual(market) : undefined]);
  const position = instrument ? await readPosition(instrument, address) : undefined;
  if (closing && !position) throw new Error('This position is already closed.');
  const quote = await prepareOrder(market, draft, undefined, position);
  if (!closing && quote.market.dex) throw new Error('Choose a Hyperliquid USDC perpetual to place an order.');
  const changeLeverage = await needsLeverage(quote, address);
  if (Date.now() >= quote.expires) throw new Error('This quote expired. Review a fresh quote.');
  const exchangeNonce = Date.now() + randomInt(60_000);
  const deadline = quote.expires;
  const authorization: TradeAuthorization = {
    contract: signerContract()!, nonce: makeNonce(salt, new Date(deadline), crypto.getRandomValues(new Uint8Array(15))),
    deadline, exchangeNonce, expiresAfter: exchangeNonce + 120_000,
    id: `0x${randomUUID().replaceAll('-', '')}`, changeLeverage,
  };
  return { quote, authorization, ticket: seal({ kind: 'trade', quote, authorization, accountId, address }) };
}

export async function executeTrade(account: string, ticket: string, signed: SignedIntent): Promise<TradeResult> {
  if (!executionConfigured()) throw new Error('Trading signer is unavailable.');
  const prepared = unseal(ticket);
  if (prepared.kind !== 'trade' || prepared.accountId !== account) throw new Error('Invalid order review.');
  const { accountId, address, quote, authorization } = prepared;
  if (authorization.contract !== signerContract() || signed.payload !== tradePayload(accountId, quote, authorization)) {
    throw new Error('The passkey signature does not match this order review.');
  }
  if (Date.now() >= authorization.deadline) throw new Error('This quote expired. Review a fresh quote.');
  const requests = tradeActions(quote, authorization);
  await simulate([signed]);
  const signatures = await requestSignatures(signed, requests.map(tradeDigest), address);
  if (Date.now() >= authorization.expiresAfter) throw new Error('Signing took too long. Review a fresh quote.');
  const stillNeedsLeverage = await needsLeverage(quote, address);
  if (stillNeedsLeverage && !authorization.changeLeverage) throw new Error('Leverage changed. Review a fresh quote.');

  if (authorization.changeLeverage && stillNeedsLeverage) {
    const leverage = await transport.request<{ status: string }>('exchange', { ...requests[0], signature: signatures[0] });
    if (leverage.status !== 'ok' || await needsLeverage(quote, address)) throw new Error('Hyperliquid could not confirm isolated leverage.');
  }
  try {
    const result = await transport.request<OrderResponse | { status: 'err'; response: string }>('exchange', { ...requests.at(-1)!, signature: signatures.at(-1)! });
    if (result.status === 'err') return { state: 'rejected', message: result.response };
    const status = result.response.data.statuses[0];
    if (typeof status === 'object' && 'error' in status) return { state: 'rejected', message: status.error };
    if (typeof status === 'object' && 'filled' in status && Number(status.filled.totalSz) > 0) {
      return {
        state: Number(status.filled.totalSz) < Number(quote.size) ? 'partial' : 'filled',
        size: status.filled.totalSz, average: status.filled.avgPx,
      };
    }
  } catch {}
  return { state: 'unknown', message: 'Check the order status before trying again.' };
}

export async function prepareWithdrawal(accountId: string, destination: TradingAddress, amount: string) {
  if (!executionConfigured()) throw new Error('Trading signer is unavailable.');
  if (!/^0x[\da-f]{40}$/.test(destination) || /^0x0{40}$/.test(destination)
    || !/^\d{1,7}(\.\d{1,2})?$/.test(amount) || Number(amount) <= 1) throw new Error('Enter a valid Arbitrum address and more than 1 USDC.');
  const [address, salt] = await Promise.all([tradingAddress(accountId), currentSalt()]);
  if (destination === address) throw new Error('Choose an Arbitrum wallet address you control.');
  const withdrawable = await readWithdrawable(address);
  if (!(Number(withdrawable) >= Number(amount))) throw new Error('This exceeds your withdrawable Hyperliquid balance.');
  const now = Date.now();
  const deadline = now + 60_000;
  const withdrawal = { destination, amount: String(Number(amount)), time: now + randomInt(60_000) };
  const authorization = {
    contract: signerContract()!, deadline, nonce: makeNonce(salt, new Date(deadline), crypto.getRandomValues(new Uint8Array(15))),
  };
  return { withdrawal, authorization, ticket: seal({ kind: 'withdrawal', accountId, address, withdrawal, authorization }) };
}

export async function executeWithdrawal(account: string, ticket: string, signed: SignedIntent) {
  if (!executionConfigured()) throw new Error('Trading signer is unavailable.');
  const prepared = unseal(ticket);
  if (prepared.kind !== 'withdrawal' || prepared.accountId !== account) throw new Error('Invalid withdrawal review.');
  const { accountId, address, withdrawal, authorization } = prepared;
  if (authorization.contract !== signerContract() || signed.payload !== withdrawalPayload(accountId, withdrawal, authorization)
    || Date.now() >= authorization.deadline) throw new Error('Review a fresh withdrawal before signing.');
  if (!(Number(await readWithdrawable(address)) >= Number(withdrawal.amount))) throw new Error('Your withdrawable balance changed. Review a fresh withdrawal.');
  await simulate([signed]);
  const request = withdrawalRequest(withdrawal);
  const [signature] = await requestSignatures(signed, [tradeDigest(request)], address);
  if (Date.now() >= authorization.deadline + 120_000) throw new Error('Signing took too long. Review a fresh withdrawal.');
  const result = await transport.request<{ status: 'ok' } | { status: 'err'; response: string }>('exchange', { ...request, signature }).catch(() => null);
  if (!result) return { state: 'unknown' };
  return result.status === 'ok' ? { state: 'submitted' } : { state: 'rejected', message: result.response };
}
