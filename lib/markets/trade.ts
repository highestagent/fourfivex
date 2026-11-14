import { HttpTransport } from '@nktkas/hyperliquid';
import { clearinghouseState, l2Book, metaAndAssetCtxs, orderStatus, perpDexs, spotClearinghouseState, spotMeta, userAbstraction, userNonFundingLedgerUpdates } from '@nktkas/hyperliquid/api/info';
import { formatSize } from '@nktkas/hyperliquid/utils';
import { hyperliquidMarket, type Market } from '@fourfivex/markets-protocol/markets';
import type { TradingBalance } from '../account/portfolio';

export type Side = 'long' | 'short';
export const transport = new HttpTransport({ isTestnet: false });
const info = { transport };
const quoteLifetime = 20_000;

export type Perpetual = {
  market: Market;
  coin: string;
  dex: string;
  asset: number;
  mark: number;
  collateral: string;
  decimals: number;
  maxLeverage: number;
  feeMultiplier?: number;
};

export async function readPerpetual(market: Market, signal?: AbortSignal): Promise<Perpetual> {
  const listing = hyperliquidMarket(market);
  if (listing?.type !== 'perp') throw new Error('Choose a perpetual market.');
  const { coin } = listing;
  const dex = coin.includes(':') ? coin.split(':')[0] : '';
  const [[meta, contexts], dexes] = await Promise.all([
    metaAndAssetCtxs(info, { dex }, signal), dex ? perpDexs(info, signal) : undefined,
  ]);
  const index = meta.universe.findIndex(asset => asset.name === coin);
  const metadata = meta.universe[index] as (typeof meta.universe)[number] & { deployerFeeScale?: string } | undefined;
  const mark = Number(contexts[index]?.markPx);
  const dexIndex = dexes?.findIndex(entry => entry?.name === dex) ?? 0;
  if (!metadata || metadata.isDelisted || !(mark > 0) || !Number.isFinite(mark) || (dex && dexIndex < 1)) {
    throw new Error('This perpetual market is unavailable.');
  }
  const collateral = meta.collateralToken === 0 ? 'USDC'
    : (await spotMeta(info, signal)).tokens.find(token => token.index === meta.collateralToken)?.name;
  if (!collateral) throw new Error('The collateral for this market is unavailable.');
  const scale = Number(metadata.deployerFeeScale);
  const feeMultiplier = !dex ? 1 : Number.isFinite(scale) && scale >= 0
    ? (Math.max(1, scale) + scale) * (metadata.growthMode === 'enabled' ? 0.1 : 1)
    : undefined;
  return {
    market, coin, dex, asset: dex ? 100_000 + dexIndex * 10_000 + index : index,
    mark, collateral, decimals: metadata.szDecimals, maxLeverage: metadata.maxLeverage, feeMultiplier,
  };
}

export type OrderDraft = { side: Side; margin: number; leverage: number };
export type OrderQuote = {
  market: Perpetual;
  buy: boolean;
  closing: boolean;
  leverage: number;
  margin: number;
  size: string;
  limit: string;
  value: number;
  fee?: number;
  expires: number;
};

export function fillLimit(reference: number, buy: boolean, decimals: number) {
  const bound = reference * (buy ? 1.005 : 0.995);
  const precision = Math.max(0, Math.min(6 - decimals, 4 - Math.floor(Math.log10(bound))));
  const units = 10 ** precision;
  const ticks = buy ? Math.floor(bound * units) : Math.ceil(bound * units);
  return (ticks / units).toFixed(precision).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
}

export type TradingAddress = `0x${string}`;
export type Position = Awaited<ReturnType<typeof clearinghouseState>>['assetPositions'][number]['position'];

export async function readPosition(market: Perpetual, user: TradingAddress, signal?: AbortSignal) {
  const state = await clearinghouseState(info, { user, dex: market.dex }, signal);
  return state.assetPositions.find(({ position }) => position.coin === market.coin && Number(position.szi) !== 0)?.position;
}

export const readOrderStatus = (user: TradingAddress, id: TradingAddress) => orderStatus(info, { user, oid: id });

/** Hyperliquid modes in which one USDC balance backs every market that settles in USDC. */
export const sharesBalance = (mode: string) => mode === 'unifiedAccount' || mode === 'portfolioMargin';

export const readAbstraction = (user: TradingAddress, signal?: AbortSignal) => userAbstraction(info, { user }, signal);

export type TradingFunds = TradingBalance & { shared: boolean };

/**
 * The trading balance in either mode. With one balance, Hyperliquid reports it all as spot USDC:
 * `total` already counts open positions' margin and profit, and `hold` is the margin they use.
 * Otherwise the balance is the main exchange's perp account, as it was before the switch.
 */
export async function readFunds(user: TradingAddress, signal?: AbortSignal): Promise<TradingFunds> {
  const [mode, spot, perp] = await Promise.all([
    readAbstraction(user, signal), spotClearinghouseState(info, { user }, signal), clearinghouseState(info, { user }, signal),
  ]);
  return fundsFrom(mode, spot, perp);
}

type SpotState = Awaited<ReturnType<typeof spotClearinghouseState>>;
type PerpState = Awaited<ReturnType<typeof clearinghouseState>>;

export function fundsFrom(mode: string, spot: Pick<SpotState, 'balances'>, perp: Pick<PerpState, 'marginSummary' | 'withdrawable'>): TradingFunds {
  if (sharesBalance(mode)) {
    const usdc = spot.balances.find(balance => balance.coin === 'USDC');
    const total = Number(usdc?.total ?? 0);
    const hold = Number(usdc?.hold ?? 0);
    if (!Number.isFinite(total) || !Number.isFinite(hold)) throw new Error('Hyperliquid returned an invalid balance.');
    return { shared: true, equity: total, withdrawable: Math.max(0, total - hold) };
  }
  const equity = Number(perp.marginSummary.accountValue);
  const withdrawable = Number(perp.withdrawable);
  if (!perp.marginSummary.accountValue || !perp.withdrawable || !Number.isFinite(equity) || !Number.isFinite(withdrawable)) {
    throw new Error('Hyperliquid returned an invalid balance.');
  }
  return { shared: false, equity, withdrawable };
}

export async function readWithdrawable(user: TradingAddress, signal?: AbortSignal) {
  return String((await readFunds(user, signal)).withdrawable);
}

export async function readTradingBalance(user: TradingAddress, signal?: AbortSignal): Promise<TradingBalance> {
  const { equity, withdrawable } = await readFunds(user, signal);
  return { equity, withdrawable };
}

export async function readWithdrawal(user: TradingAddress, nonce: number, signal?: AbortSignal) {
  const updates = await userNonFundingLedgerUpdates(info, { user, startTime: nonce - 120_000 }, signal);
  return updates.find(({ delta }) => delta.type === 'withdraw' && delta.nonce === nonce);
}

export async function prepareOrder(market: Market, draft: OrderDraft, signal?: AbortSignal, position?: Position): Promise<OrderQuote> {
  if (!position && (!Number.isFinite(draft.margin) || draft.margin <= 0)) throw new Error('Enter a margin greater than zero.');
  const listing = hyperliquidMarket(market);
  if (listing?.type !== 'perp') throw new Error('Choose a perpetual market.');
  const [instrument, book] = await Promise.all([
    readPerpetual(market, signal), l2Book(info, { coin: listing.coin }, signal),
  ]);
  if (!position && (!Number.isInteger(draft.leverage) || draft.leverage < 1 || draft.leverage > instrument.maxLeverage)) {
    throw new Error(`Choose leverage from 1× to ${instrument.maxLeverage}×.`);
  }
  const buy = position ? Number(position.szi) < 0 : draft.side === 'long';
  const reference = Number(book?.levels[buy ? 1 : 0][0]?.px);
  if (!book || !Number.isFinite(book.time) || Date.now() - book.time >= quoteLifetime || !Number.isFinite(reference) || reference <= 0) {
    throw new Error('No current price is available on this side of the order book.');
  }
  const limit = fillLimit(reference, buy, instrument.decimals);
  const requested = draft.margin * draft.leverage / Math.max(reference, Number(limit));
  if (!position && requested < 10 ** -instrument.decimals) throw new Error('Increase the margin to reach the minimum order size.');
  const size = position ? position.szi.replace(/^-/, '') : formatSize(requested, instrument.decimals);
  const value = Number(size) * reference;
  if (!position && value < 10) throw new Error('Increase the margin to reach the $10 minimum order value.');
  const multiplier = instrument.feeMultiplier;
  return {
    market: instrument, buy, size, limit, value, closing: Boolean(position),
    leverage: position?.leverage.value ?? draft.leverage, margin: draft.margin,
    fee: multiplier === undefined ? undefined : value * 0.00045 * multiplier,
    expires: Math.min(Date.now() + quoteLifetime, book.time + quoteLifetime),
  };
}
