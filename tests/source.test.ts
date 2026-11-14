import { describe, expect, it } from "vitest";
import type { Holdings, Part } from "../lib/account/holdings";
import { joinNames, pickSources } from "../lib/send/source";

let n = 0;
function part(group: Part["group"], usd: number, network = `net${++n}`): Part {
  return { assetId: `nep141:${group}-${n}`, decimals: 6, units: String(Math.round(usd * 1e6)), symbol: group.toUpperCase(), network, amount: usd, usd, group };
}
function hold(...parts: Part[]): Holdings {
  return { total: parts.reduce((s, p) => s + p.usd, 0), groups: {} as Holdings["groups"], parts };
}
const usd = (draws: { usd: number }[]) => draws.map((d) => d.usd);

describe("pickSources", () => {
  it("uses the biggest holding alone when it covers the send", () => {
    const big = part("usd", 80);
    const r = pickSources(hold(part("usd", 30), big, part("btc", 500)), "usd", 50);
    expect(r).toEqual({ kind: "ok", draws: [{ part: big, usd: 50 }] });
  });

  it("splits across holdings, biggest first, when none covers it alone", () => {
    const r = pickSources(hold(part("usd", 30), part("usd", 30)), "usd", 50);
    expect(r.kind === "ok" && usd(r.draws)).toEqual([30, 20]);
  });

  it("leaves room for costs on each part of a split pay", () => {
    const r = pickSources(hold(part("usd", 30), part("usd", 30)), "usd", 50, 1.02, 0.01);
    expect(r.kind === "ok" && usd(r.draws)).toEqual([29.12, 20.88]);
  });

  it("keeps a single holding when costs still fit, and splits when they don't", () => {
    expect(pickSources(hold(part("usd", 50), part("usd", 20)), "usd", 49, 1.013).kind === "ok").toBe(true);
    const r = pickSources(hold(part("usd", 50), part("usd", 20)), "usd", 50, 1.013);
    expect(r.kind === "ok" && r.draws.length).toBe(2);
  });

  it("raises a last part to the $1 minimum by taking from the first", () => {
    const r = pickSources(hold(part("usd", 49.7), part("usd", 30)), "usd", 50);
    expect(r.kind === "ok" && usd(r.draws)).toEqual([49, 1]);
  });

  it("leaves holdings under $1 out of a split", () => {
    const r = pickSources(hold(part("usd", 30), part("usd", 0.5), part("usd", 25)), "usd", 50);
    expect(r.kind === "ok" && r.draws.map((d) => d.part.usd)).toEqual([30, 25]);
  });

  it("says how much it could use when everything together falls short", () => {
    expect(pickSources(hold(part("usd", 30), part("usd", 15)), "usd", 50)).toEqual({ kind: "short", most: 45 });
  });

  it("uses at most four holdings", () => {
    const r = pickSources(hold(...[10, 10, 10, 10, 10].map((v) => part("usd", v))), "usd", 45);
    expect(r).toEqual({ kind: "short", most: 40 });
  });

  it("knows an account with none of that kind", () => {
    expect(pickSources(hold(part("btc", 100)), "usd", 5)).toEqual({ kind: "empty" });
  });
});

describe("joinNames", () => {
  it("joins network names for a sentence", () => {
    expect(joinNames(["Base"])).toBe("Base");
    expect(joinNames(["Base", "Arbitrum"])).toBe("Base and Arbitrum");
    expect(joinNames(["Base", "Arbitrum", "Solana"])).toBe("Base, Arbitrum and Solana");
  });
});
