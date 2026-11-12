import type { Holdings, Part } from "../account/holdings";

export type Source = { kind: "ok"; part: Part } | { kind: "short"; most: number } | { kind: "empty" };

/** A send draws from one token: the biggest one in the group, which must cover the amount on its own. */
export function pickSource(holdings: Holdings, group: "usd" | "btc" | "eth" | "sol", usd: number): Source {
  const best = holdings.parts
    .filter((p) => p.group === group)
    .reduce<Part | null>((top, p) => (!top || p.usd > top.usd ? p : top), null);
  if (!best) return { kind: "empty" };
  return best.usd >= usd ? { kind: "ok", part: best } : { kind: "short", most: best.usd };
}
