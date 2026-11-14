import { fillMarket, recordRule, type FeedFill, type TrackRecord } from '@fourfivex/markets-protocol/sessions';
import type { Env } from './env';
import { HttpError, upstream } from './http';

/** A fill as Hyperliquid's info API returns it. Every address's fills are public there. */
export type Fill = {
  coin: string; px: string; sz: string; side: 'B' | 'A'; time: number; dir: string;
  closedPnl: string; fee: string; feeToken: string; builderFee?: string; tid: number; oid: number; hash: string; cloid?: string;
};
type FundingEntry = { time: number; delta: { type: string; usdc?: string } };

const DAY = 24 * 3600_000;
const fillPage = 2000;
/** Hyperliquid serves only an address's most recent 10,000 fills. */
const fillCap = 10_000;
const fundingPage = 500;

async function info<T>(env: Env, body: object): Promise<T> {
  const response = await upstream((env.HYPERLIQUID_API ?? 'https://api.hyperliquid.xyz') + '/info', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = response.ok ? await response.json().catch(() => null) : null;
  if (!Array.isArray(data)) throw new HttpError(503, 'Hyperliquid is unavailable. Try again.');
  return data as T;
}

/** Reads pages of time-ordered rows from `from` to `to`, keeping each row once. */
async function pages<T extends { time: number }>(read: (start: number) => Promise<T[]>, size: number, cap: number, from: number, key: (row: T) => string) {
  const rows = new Map<string, T>();
  let start = from;
  while (rows.size < cap) {
    const page = await read(start);
    for (const row of page) rows.set(key(row), row);
    if (page.length < size) break;
    const last = Math.max(...page.map(row => row.time));
    // A full page that ends where it began can't move forward. Step past that millisecond.
    start = last > start ? last : start + 1;
  }
  return [...rows.values()].sort((a, b) => a.time - b.time);
}

export async function fillsBetween(env: Env, user: string, from: number, to: number) {
  const fills = await pages<Fill>(start => info<Fill[]>(env, { type: 'userFillsByTime', user, startTime: start, endTime: to }),
    fillPage, fillCap, from, fill => `${fill.tid}:${fill.hash}`);
  return { fills: fills.filter(fill => fill.time >= from && fill.time <= to), capped: fills.length >= fillCap };
}

async function fundingBetween(env: Env, user: string, from: number, to: number) {
  return pages<FundingEntry>(start => info<FundingEntry[]>(env, { type: 'userFunding', user, startTime: start, endTime: to }),
    fundingPage, fundingPage * 40, from, entry => `${entry.time}:${JSON.stringify(entry.delta)}`);
}

const cents = (value: number) => Math.round(value * 100) / 100;
const isPerp = (fill: Fill) => !fill.coin.startsWith('@') && !fill.coin.includes('/');

/**
 * The host's record over the stated window, from Hyperliquid's own fills and funding for their address.
 * Net P&L is closed P&L, less trading and builder fees, plus funding, for perpetuals that settle in USDC.
 */
export async function trackRecord(env: Env, address: `0x${string}`, now = Date.now()): Promise<TrackRecord> {
  const from = now - recordRule.windowDays * DAY;
  const [{ fills, capped }, funding] = await Promise.all([fillsBetween(env, address, from, now), fundingBetween(env, address, from, now)]);
  const counted = fills.filter(fill => isPerp(fill) && fill.feeToken === 'USDC');
  const sum = (values: (string | undefined)[]) => values.reduce((total, value) => total + (Number(value) || 0), 0);
  const realized = sum(counted.map(fill => fill.closedPnl));
  const fees = sum(counted.flatMap(fill => [fill.fee, fill.builderFee]));
  const funded = sum(funding.filter(entry => entry.delta.type === 'funding').map(entry => entry.delta.usdc));
  const net = realized - fees + funded;
  const activeDays = new Set(counted.map(fill => Math.floor(fill.time / DAY))).size;
  const coverageFrom = capped && counted.length ? counted[0].time : from;
  const reasons = [
    capped && `Hyperliquid shows only part of the last ${recordRule.windowDays} days for this account.`,
    counted.length < recordRule.minFills && `Needs at least ${recordRule.minFills} trades in the last ${recordRule.windowDays} days.`,
    activeDays < recordRule.minActiveDays && `Needs trades on at least ${recordRule.minActiveDays} different days.`,
    !(net > 0) && `Net P&L over the last ${recordRule.windowDays} days isn't positive.`,
  ].filter((reason): reason is string => Boolean(reason));
  return {
    address,
    window: { from, to: now, days: recordRule.windowDays },
    coverage: { from: coverageFrom, to: now, days: Math.round((now - coverageFrom) / DAY), complete: !capped },
    fills: counted.length, activeDays,
    realized: cents(realized), fees: cents(fees), funding: cents(funded), net: cents(net),
    eligible: reasons.length === 0, reasons, checkedAt: now,
  };
}

export function feedFill(fill: Fill): FeedFill {
  const long = fill.dir.includes('Long') || (!fill.dir.includes('Short') && fill.side === 'B');
  return {
    id: String(fill.tid), market: fillMarket(fill.coin), coin: fill.coin, side: long ? 'long' : 'short',
    dir: fill.dir, opening: fill.dir.startsWith('Open'), price: fill.px, size: fill.sz, time: fill.time,
  };
}
