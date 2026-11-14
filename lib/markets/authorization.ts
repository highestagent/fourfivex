import { createL1ActionHash, canonicalize } from '@nktkas/hyperliquid/signing';
import { OrderRequest, UpdateLeverageRequest, Withdraw3Request, type OrderRequest as OrderWire, type UpdateLeverageRequest as LeverageWire, type Withdraw3Request as WithdrawWire } from '@nktkas/hyperliquid/api/exchange';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { hex } from '@scure/base';
import { concat, utf8 } from '../account/encoding';
import { buildPayload, type AuthCall } from '../account/intents';
import type { OrderQuote } from './trade';

const hash = (text: string) => keccak_256(utf8(text));
const chain = new Uint8Array(32);
new DataView(chain.buffer).setUint32(28, 1337);
const domain = keccak_256(concat(
  hash('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'),
  hash('Exchange'), hash('1'), chain, new Uint8Array(32),
));
const agent = hash('Agent(string source,bytes32 connectionId)');

export type TradeAction = OrderWire['action'] | LeverageWire['action'] | WithdrawWire['action'];
export type ExchangeRequest = { action: TradeAction; nonce: number; expiresAfter?: number };
export type TradeAuthorization = { contract: string; nonce: string; deadline: number; exchangeNonce: number; expiresAfter: number; id: `0x${string}`; changeLeverage: boolean };

export function tradeDigest(request: ExchangeRequest) {
  if (request.action.type === 'withdraw3') return withdrawalDigest(request.action);
  const actionHash = hex.decode(createL1ActionHash(request).slice(2));
  const message = keccak_256(concat(agent, hash('a'), actionHash));
  return keccak_256(concat(Uint8Array.of(25, 1), domain, message));
}

export function tradeActions(quote: OrderQuote, authorization: TradeAuthorization): ExchangeRequest[] {
  const { exchangeNonce, expiresAfter, id, changeLeverage } = authorization;
  const action = canonicalize(OrderRequest.entries.action, { type: 'order', grouping: 'na', orders: [{
    a: quote.market.asset, b: quote.buy, p: quote.limit, s: quote.size, r: quote.closing,
    t: { limit: { tif: 'Ioc' } }, c: id,
  }] } satisfies OrderWire['action']);
  const entry = { action, nonce: exchangeNonce, expiresAfter };
  if (!changeLeverage) return [entry];
  const leverage = canonicalize(UpdateLeverageRequest.entries.action, {
    type: 'updateLeverage', asset: quote.market.asset, isCross: false, leverage: quote.leverage,
  } satisfies LeverageWire['action']);
  return [{ action: leverage, nonce: exchangeNonce - 1, expiresAfter }, entry];
}

export function tradeIntent(requests: ExchangeRequest[], contract: string): AuthCall {
  return {
    intent: 'auth_call', contract_id: contract, min_gas: '100000000000000',
    msg: JSON.stringify({ digests: requests.map(request => Array.from(tradeDigest(request))) }),
  };
}

export const signingPath = (accountId: string) => `fourfivex:hyperliquid:v1:${accountId}`;

export type Withdrawal = { destination: `0x${string}`; amount: string; time: number };

export function withdrawalRequest({ destination, amount, time }: Withdrawal): ExchangeRequest {
  const action = canonicalize(Withdraw3Request.entries.action, {
    type: 'withdraw3', signatureChainId: '0xa4b1', hyperliquidChain: 'Mainnet', destination, amount, time,
  } satisfies WithdrawWire['action']);
  return { action, nonce: time };
}

function withdrawalDigest(action: WithdrawWire['action']) {
  const chain = new Uint8Array(32);
  new DataView(chain.buffer).setUint32(28, 42161);
  const domain = keccak_256(concat(
    hash('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'),
    hash('HyperliquidSignTransaction'), hash('1'), chain, new Uint8Array(32),
  ));
  const time = new Uint8Array(32);
  new DataView(time.buffer).setBigUint64(24, BigInt(action.time));
  const message = keccak_256(concat(
    hash('HyperliquidTransaction:Withdraw(string hyperliquidChain,string destination,string amount,uint64 time)'),
    hash(action.hyperliquidChain), hash(action.destination), hash(action.amount), time,
  ));
  return keccak_256(concat(Uint8Array.of(25, 1), domain, message));
}

export function withdrawalPayload(accountId: string, withdrawal: Withdrawal, authorization: Pick<TradeAuthorization, 'contract' | 'deadline' | 'nonce'>) {
  return buildPayload({
    signerId: accountId, deadline: new Date(authorization.deadline), nonce: authorization.nonce,
    intents: [tradeIntent([withdrawalRequest(withdrawal)], authorization.contract)],
  });
}

export function tradePayload(accountId: string, quote: OrderQuote, authorization: TradeAuthorization) {
  return buildPayload({
    signerId: accountId, deadline: new Date(authorization.deadline), nonce: authorization.nonce,
    intents: [tradeIntent(tradeActions(quote, authorization), authorization.contract)],
  });
}
