import { describe, expect, it } from "vitest";
import type { Group, Holdings, Part } from "../lib/account/holdings";
import { pickSource } from "../lib/send/source";

const part = (group: Group, usd: number, assetId = `${group}-${usd}`): Part => ({
  assetId,
  decimals: 6,
  units: String(usd * 1e6),
  symbol: group.toUpperCase(),
  network: "x",
  amount: usd,
  usd,
  group,
});
const hold = (...parts: Part[]): Holdings => ({
  total: parts.reduce((n, p) => n + p.usd, 0),
  groups: {} as Holdings["groups"],
  parts,
});

describe("pickSource", () => {
  it("picks the biggest token in the group when it covers the amount", () => {
    const r = pickSource(hold(part("usd", 30), part("usd", 80), part("btc", 500)), "usd", 50);
    expect(r).toEqual({ kind: "ok", part: expect.objectContaining({ usd: 80 }) });
  });

  it("is short when no single token covers it, even if together they would", () => {
    expect(pickSource(hold(part("usd", 30), part("usd", 30)), "usd", 50)).toEqual({ kind: "short", most: 30 });
  });

  it("is empty when the group holds nothing", () => {
    expect(pickSource(hold(part("btc", 100)), "usd", 5)).toEqual({ kind: "empty" });
  });

  it("never adds balances together", () => {
    expect(pickSource(hold(part("eth", 20), part("eth", 20), part("eth", 20)), "eth", 40).kind).toBe("short");
  });
});
