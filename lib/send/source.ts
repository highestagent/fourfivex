import type { Holdings, Part } from "../account/holdings";
import { MAX_TRANSFERS } from "./guard";

/** One part of a send: how many dollars of it come from one holding. */
export type Draw = { part: Part; usd: number };
export type Sources = { kind: "ok"; draws: Draw[] } | { kind: "short"; most: number } | { kind: "empty" };

/** No part of a split send is smaller than this: 1Click won't quote tiny amounts. */
export const MIN_DRAW_CENTS = 100;

/**
 * Where a send's money comes from. The biggest holding alone when it covers the send; otherwise the
 * biggest holdings in turn, signed once as one send.
 *
 * `ratio` is what leaves per dollar delivered (1 for a change, a little over 1 for a pay, from its quote).
 * `margin` is kept back on each holding of a split send, whose parts each pay their own costs.
 */
export function pickSources(holdings: Holdings, group: Part["group"], usd: number, ratio = 1, margin = 0): Sources {
  const parts = holdings.parts.filter((p) => p.group === group && p.usd > 0).sort((a, b) => b.usd - a.usd);
  if (!parts.length) return { kind: "empty" };
  if (parts[0].usd >= usd * ratio) return { kind: "ok", draws: [{ part: parts[0], usd }] };

  // Holdings too small for a part of their own stay out, so any part can be raised to the minimum.
  const capacity = parts
    .map((part) => ({ part, cents: Math.floor((part.usd / (ratio * (1 + margin))) * 100) }))
    .filter(({ cents }) => cents >= MIN_DRAW_CENTS)
    .slice(0, MAX_TRANSFERS);
  if (!capacity.length) return { kind: "short", most: 0 };
  const want = Math.round(usd * 100);
  const draws: { part: Part; cents: number }[] = [];
  let left = want;
  for (const { part, cents } of capacity) {
    if (left <= 0) break;
    const take = Math.min(left, cents);
    if (take > 0) draws.push({ part, cents: take });
    left -= take;
  }
  const most = capacity.reduce((sum, { cents }) => sum + cents, 0) / 100;
  if (left > 0) return { kind: "short", most };

  // A last part too small to quote borrows from the first, which has the most room.
  const last = draws[draws.length - 1];
  if (last.cents < MIN_DRAW_CENTS) {
    const need = MIN_DRAW_CENTS - last.cents;
    if (draws[0].cents - need < MIN_DRAW_CENTS) return { kind: "short", most };
    draws[0].cents -= need;
    last.cents += need;
  }
  return { kind: "ok", draws: draws.map(({ part, cents }) => ({ part, usd: cents / 100 })) };
}

/** "Base and Arbitrum", "Base, Arbitrum and Solana". */
export function joinNames(names: readonly string[]) {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
