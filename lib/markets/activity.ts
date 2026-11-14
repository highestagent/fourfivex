import { clearinghouseState, userFills, userNonFundingLedgerUpdates } from '@nktkas/hyperliquid/api/info';
import { transport, type Position, type TradingAddress } from './trade';

const info = { transport };
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const small = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumSignificantDigits: 4 });
const price = { format: (value: number) => (value >= 1 ? usd : small).format(value) };
const NAMES: Record<string, string> = { BTC: 'bitcoin', ETH: 'ether', SOL: 'sol' };
const HISTORY_DAYS = 90;

/** A finished trading event, worded like the wallet's own activity. */
export type TradingEvent = { id: string; at: number; text: string; url?: string };
type Fill = Awaited<ReturnType<typeof userFills>>[number];
type LedgerUpdate = Awaited<ReturnType<typeof userNonFundingLedgerUpdates>>[number];

/** Plain names for the coins the wallet already names; anything else keeps its ticker. */
export const coinName = (coin: string) => NAMES[coin] ?? coin;

export function explorerLink(hash: string) {
  return /^0x0*$/.test(hash) ? undefined : `https://app.hyperliquid.xyz/explorer/tx/${hash}`;
}

const sideOf = (text: string) => (/short/i.test(text) ? 'short' : 'long');
const signed = (value: number) => `${value < 0 ? '−' : '+'}${usd.format(Math.abs(value))}`;
const title = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** One event per order: an order that fills in several pieces is still one thing the person did. */
export function fillEvents(fills: readonly Fill[]): TradingEvent[] {
  const orders = new Map<number, Fill[]>();
  for (const fill of fills) {
    if (fill.coin.startsWith('@') || fill.coin.includes('/')) continue;
    orders.set(fill.oid, [...(orders.get(fill.oid) ?? []), fill]);
  }
  return [...orders].map(([oid, parts]) => {
    const [first] = parts;
    const name = coinName(first.coin);
    const side = sideOf(first.dir);
    const notional = parts.reduce((sum, part) => sum + Number(part.px) * Number(part.sz), 0);
    const net = parts.reduce((sum, part) => sum + Number(part.closedPnl) - Number(part.fee), 0);
    const at = Math.max(...parts.map(part => part.time));
    const text = parts.some(part => part.liquidation) ? `${title(name)} ${side} liquidated`
      : first.dir.startsWith('Open') ? `Opened ${usd.format(notional)} ${name} ${side}`
      : first.dir.startsWith('Close') ? `Closed ${usd.format(notional)} ${name} ${side} · ${signed(net)}`
      : first.dir.includes('>') ? `${title(name)} flipped to ${sideOf(first.dir.split('>')[1])}`
      : `Traded ${usd.format(notional)} of ${name}`;
    return { id: `fill:${oid}`, at, text, url: explorerLink(first.hash) };
  });
}

function amount(token: string, value: string) {
  return token === 'USDC' ? usd.format(Math.abs(Number(value))) : `${Math.abs(Number(value))} ${token}`;
}

/** Money moving in and out of the trading balance. Moves inside it, such as spot to perps, are left out. */
export function ledgerEvents(updates: readonly LedgerUpdate[], address: TradingAddress): TradingEvent[] {
  const self = address.toLowerCase();
  return updates.flatMap((update, index): TradingEvent[] => {
    const { delta } = update;
    const base = { id: `ledger:${update.hash}:${index}`, at: update.time, url: explorerLink(update.hash) };
    if (delta.type === 'deposit') return [{ ...base, text: `Added ${amount('USDC', delta.usdc)} to trading` }];
    if (delta.type === 'withdraw') return [{ ...base, text: `Withdrew ${amount('USDC', delta.usdc)} from trading` }];
    if (delta.type !== 'send' && delta.type !== 'spotTransfer' && delta.type !== 'internalTransfer') return [];
    const value = delta.type === 'internalTransfer' ? amount('USDC', delta.usdc) : amount(delta.token, delta.amount);
    const incoming = delta.destination.toLowerCase() === self;
    const outgoing = delta.user.toLowerCase() === self;
    if (incoming === outgoing) return [];
    return [{ ...base, text: incoming ? `Received ${value} in trading` : `Sent ${value} from trading` }];
  });
}

export async function readTradingHistory(address: TradingAddress, signal?: AbortSignal) {
  const [fills, updates] = await Promise.all([
    userFills(info, { user: address }, signal),
    userNonFundingLedgerUpdates(info, { user: address, startTime: Date.now() - HISTORY_DAYS * 86_400_000 }, signal),
  ]);
  return [...fillEvents(fills), ...ledgerEvents(updates, address)].sort((a, b) => b.at - a.at);
}

export async function readOpenPositions(address: TradingAddress, signal?: AbortSignal) {
  const state = await clearinghouseState(info, { user: address }, signal);
  return state.assetPositions.map(({ position }) => position).filter(position => Number(position.szi) !== 0);
}

/** A position as a standing sentence, with the figures someone checks first. */
export function describePosition(position: Position) {
  const side = Number(position.szi) > 0 ? 'long' : 'short';
  return {
    text: `${title(coinName(position.coin))} ${side} · ${usd.format(Number(position.positionValue))}`,
    detail: [
      signed(Number(position.unrealizedPnl)),
      `${position.leverage.value}×`,
      position.liquidationPx ? `auto-closes at ${price.format(Number(position.liquidationPx))}` : undefined,
    ].filter(Boolean).join(' · '),
  };
}
