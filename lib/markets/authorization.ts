import { createL1ActionHash, canonicalize } from '@nktkas/hyperliquid/signing';
import {
  OrderRequest, UpdateLeverageRequest, UserSetAbstractionRequest, Withdraw3Request,
  type OrderRequest as OrderWire, type UpdateLeverageRequest as LeverageWire,
  type UserSetAbstractionRequest as AbstractionWire, type Withdraw3Request as WithdrawWire,
} from '@nktkas/hyperliquid/api/exchange';
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

export type TradeAction = OrderWire['action'] | LeverageWire['action'] | WithdrawWire['action'] | AbstractionWire['action'];
export type ExchangeRequest = { action: TradeAction; nonce: number; expiresAfter?: number };
export type TradeAuthorization = {
  contract: string; nonce: string; deadline: number; exchangeNonce: number; expiresAfter: number; id: `0x${string}`; changeLeverage: boolean;
  /** Set when this order first turns the trading address into one balance shared by every USDC market. */
  unify?: `0x${string}`;
};

export function tradeDigest(request: ExchangeRequest) {
  if (request.action.type === 'withdraw3') return withdrawalDigest(request.action);
  if (request.action.type === 'userSetAbstraction') return abstractionDigest(request.action);
  const actionHash = hex.decode(createL1ActionHash(request).slice(2));
  const message = keccak_256(concat(agent, hash('a'), actionHash));
  return keccak_256(concat(Uint8Array.of(25, 1), domain, message));
}

/**
 * Turns on Hyperliquid's unified account: one USDC balance backs every market that settles in USDC,
 * including stocks, commodities and FX, instead of a separate balance per exchange.
 */
export function abstractionRequest(user: `0x${string}`, nonce: number): ExchangeRequest {
  const action = canonicalize(UserSetAbstractionRequest.entries.action, {
    type: 'userSetAbstraction', signatureChainId: '0xa4b1', hyperliquidChain: 'Mainnet', user, abstraction: 'unifiedAccount', nonce,
  } satisfies AbstractionWire['action']);
  return { action, nonce };
}

/** The switch to one balance, then leverage when it changes, then the order: the order Hyperliquid receives them in. */
export function tradeActions(quote: OrderQuote, authorization: TradeAuthorization): ExchangeRequest[] {
  const { exchangeNonce, expiresAfter, id, changeLeverage, unify } = authorization;
  const first = unify ? [abstractionRequest(unify, exchangeNonce - 2)] : [];
  const action = canonicalize(OrderRequest.entries.action, { type: 'order', grouping: 'na', orders: [{
    a: quote.market.asset, b: quote.buy, p: quote.limit, s: quote.size, r: quote.closing,
    t: { limit: { tif: 'Ioc' } }, c: id,
  }] } satisfies OrderWire['action']);
  const entry = { action, nonce: exchangeNonce, expiresAfter };
  if (!changeLeverage) return [...first, entry];
  const leverage = canonicalize(UpdateLeverageRequest.entries.action, {
    type: 'updateLeverage', asset: quote.market.asset, isCross: false, leverage: quote.leverage,
  } satisfies LeverageWire['action']);
  return [...first, { action: leverage, nonce: exchangeNonce - 1, expiresAfter }, entry];
}

export function tradeIntent(requests: ExchangeRequest[], contract: string): AuthCall {
  return {
    intent: 'auth_call', contract_id: contract, min_gas: '100000000000000',
    msg: JSON.stringify({ digests: requests.map(request => Array.from(tradeDigest(request))) }),
  };
}

/** The signer signs at most two digests per call, so a third (the switch to one balance) gets its own call in the same approval. */
export function tradeIntents(requests: ExchangeRequest[], contract: string): AuthCall[] {
  if (requests.length <= 2) return [tradeIntent(requests, contract)];
  return [tradeIntent(requests.slice(0, -2), contract), tradeIntent(requests.slice(-2), contract)];
}

export const signingPath = (accountId: string) => `fourfivex:hyperliquid:v1:${accountId}`;

export type Withdrawal = { destination: `0x${string}`; amount: string; time: number };

export function withdrawalRequest({ destination, amount, time }: Withdrawal): ExchangeRequest {
  const action = canonicalize(Withdraw3Request.entries.action, {
    type: 'withdraw3', signatureChainId: '0xa4b1', hyperliquidChain: 'Mainnet', destination, amount, time,
  } satisfies WithdrawWire['action']);
  return { action, nonce: time };
}

const uint64 = (value: number) => {
  const word = new Uint8Array(32);
  new DataView(word.buffer).setBigUint64(24, BigInt(value));
  return word;
};
const address = (value: `0x${string}`) => concat(new Uint8Array(12), hex.decode(value.slice(2).toLowerCase()));

/** EIP-712 for actions the trading address signs as itself, on Arbitrum's chain ID like Hyperliquid's own app. */
function userSignedDigest(type: string, fields: Uint8Array[]) {
  const chain = new Uint8Array(32);
  new DataView(chain.buffer).setUint32(28, 42161);
  const domain = keccak_256(concat(
    hash('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'),
    hash('HyperliquidSignTransaction'), hash('1'), chain, new Uint8Array(32),
  ));
  const message = keccak_256(concat(hash(type), ...fields));
  return keccak_256(concat(Uint8Array.of(25, 1), domain, message));
}

function withdrawalDigest(action: WithdrawWire['action']) {
  return userSignedDigest(
    'HyperliquidTransaction:Withdraw(string hyperliquidChain,string destination,string amount,uint64 time)',
    [hash(action.hyperliquidChain), hash(action.destination), hash(action.amount), uint64(action.time)],
  );
}

function abstractionDigest(action: AbstractionWire['action']) {
  return userSignedDigest(
    'HyperliquidTransaction:UserSetAbstraction(string hyperliquidChain,address user,string abstraction,uint64 nonce)',
    [hash(action.hyperliquidChain), address(action.user), hash(action.abstraction), uint64(action.nonce)],
  );
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
    intents: tradeIntents(tradeActions(quote, authorization), authorization.contract),
  });
}
