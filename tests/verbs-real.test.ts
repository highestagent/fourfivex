import { describe, expect, it } from "vitest";
import { FALLBACK_PRICES } from "../lib/assets";
import type { Group, Holdings, Part } from "../lib/account/holdings";
import type { QuoteOk } from "../lib/oneclick";
import type { Prepared } from "../lib/send/types";
import { VERBS, type Ctx } from "../lib/verbs";

const real = VERBS.change.real!;

const part = (group: Group, usd: number, assetId: string): Part => ({
  assetId,
  decimals: 8,
  units: String(usd * 1000),
  symbol: group.toUpperCase(),
  network: "x",
  amount: usd / 100,
  usd,
  group,
});

function hold(...parts: Part[]): Holdings {
  const groups = { usd: 0, btc: 0, eth: 0, sol: 0, other: 0 };
  for (const p of parts) groups[p.group] += p.usd;
  return {
    total: parts.reduce((n, p) => n + p.usd, 0),
    groups: Object.fromEntries(Object.entries(groups).map(([k, usd]) => [k, { amount: usd, usd }])) as Holdings["groups"],
    parts,
  };
}

const BTC = part("btc", 80, "nep141:btc.omft.near");
const USD = part("usd", 30, "nep141:usdc");
const quoteOk: QuoteOk = { ok: true, amountIn: 0.001, amountInUsd: 10, amountOut: 9.9, amountOutUsd: 9.9, seconds: 20 };

const ctx = (over: Partial<Ctx> = {}): Ctx => ({
  prices: FALLBACK_PRICES,
  pricesLive: true,
  quote: { status: "live", data: quoteOk },
  holdings: hold(BTC, USD),
  people: [],
  accountId: "0xabc",
  moved: null,
  ...over,
});

const vals = (over = {}) => ({ amt: 10, from: "btc", to: "usd", ...over });

const moved = {
  kind: "change",
  depositAddress: "d",
  leaves: { assetId: BTC.assetId, symbol: "BTC", network: "btc", decimals: 8, units: "1", amount: 0.001, usd: 10 },
  arrives: { assetId: "u", symbol: "USDC", network: "near", decimals: 6, units: "1", amount: 9.5, usd: 9.5 },
  seconds: 20,
  deadline: "",
} as Prepared;

describe("change, for a real account", () => {
  it("starts from the group that holds the most", () => {
    expect(real.def({ prices: FALLBACK_PRICES, holdings: hold(BTC, USD), people: [] })).toEqual({ amt: 10, from: "btc", to: "usd" });
    expect(real.def({ prices: FALLBACK_PRICES, holdings: hold(USD), people: [] })).toEqual({ amt: 10, from: "usd", to: "btc" });
    expect(real.def({ prices: FALLBACK_PRICES, holdings: null, people: [] }).from).toBe("usd");
  });

  it("offers only what the account holds", () => {
    const c = { prices: FALLBACK_PRICES, holdings: hold(BTC), people: [] };
    expect(real.slots.from.opts(c).map((o) => o.label)).toEqual(["my bitcoin"]);
    expect(real.slots.from.opts({ ...c, holdings: null }).map((o) => o.label)).toEqual(["my dollars"]);
  });

  it("explains why it is blocked, in order", () => {
    expect(real.out(vals({ amt: 0 }), ctx({ holdings: null })).blocked).toBe("Type an amount of at least $1.");
    expect(real.out(vals({ amt: NaN }), ctx()).blocked).toBe("Type an amount of at least $1.");
    expect(real.out(vals(), ctx({ holdings: null })).blocked).toBe("Reading your account…");
    expect(real.out(vals({ from: "eth", to: "usd" }), ctx()).blocked).toBe("You don’t hold any ether yet.");
    // Held in one place: the person simply has less than they typed.
    expect(real.out(vals({ amt: 100 }), ctx()).blocked).toBe(
      "You hold $80.00 of bitcoin. That is the most this sentence can use.",
    );
    // Held in two places that would cover it together: the one-source limit is the real reason.
    const split = hold(part("usd", 30, "nep141:usdc-a"), part("usd", 25, "nep141:usdc-b"));
    expect(real.out(vals({ amt: 50, from: "usd", to: "btc" }), ctx({ holdings: split })).blocked).toBe(
      "Your dollars are spread across networks. The most one sentence can use is $30.00.",
    );
    expect(real.out(vals(), ctx({ quote: { status: "no-offer" } })).blocked).toMatch(/No one is offering/);
    expect(real.out(vals(), ctx({ quote: { status: "loading" } })).blocked).toBe("Getting a price…");
    expect(real.out(vals(), ctx()).blocked).toBeUndefined();
  });

  it("never prints NaN for a bad amount", () => {
    const o = real.out(vals({ amt: 0 }), ctx());
    expect(JSON.stringify(o)).not.toMatch(/NaN|Infinity/);
  });

  it("has no plan when blocked", () => {
    expect(real.plan!(vals({ amt: 0 }), ctx())).toBeNull();
    expect(real.plan!(vals({ amt: 100 }), ctx())).toBeNull();
    expect(real.plan!(vals(), ctx({ quote: { status: "loading" } }))).toBeNull();
    expect(real.plan!(vals(), ctx({ accountId: null }))).toBeNull();
  });

  it("does not quote or approve a swap when both assets match", () => {
    const sameAsset = vals({ to: "btc" });
    expect(real.ask(sameAsset, ctx())).toBeNull();
    expect(real.out(sameAsset, ctx()).blocked).toBe("Choose a different asset to receive.");
    expect(real.plan!(sameAsset, ctx())).toBeNull();
  });

  it("plans from the source token and the quote on screen", () => {
    const plan = real.plan!(vals(), ctx())!;
    expect(plan.ask).toEqual({ kind: "change", accountId: "0xabc", fromAssetId: BTC.assetId, to: "usd", usd: 10 });
    expect(plan.source).toBe(BTC);
    expect(plan.shown).toBe(9.9);
  });

  it("plans from the final price once it moved", () => {
    const c = ctx({ moved });
    expect(real.plan!(vals(), c)!.shown).toBe(9.5);
    const o = real.out(vals(), c);
    expect(o.status).toEqual({ label: "Final price", tone: "live" });
    expect(o.rows[0].v).toContain("9.50");
  });

  it("asks for a dry quote of the exact token held", () => {
    expect(real.ask(vals(), ctx())).toEqual({ kind: "change", from: "btc", to: "usd", usd: 10, fromAssetId: BTC.assetId });
    expect(real.ask(vals({ amt: 0 }), ctx())).toBeNull();
    expect(real.ask(vals({ amt: 100 }), ctx())).toBeNull();
  });

  it("words what happened", () => {
    const o = real.out(vals(), ctx());
    expect(o.past).toBe("You changed $10.00 of your bitcoin into dollars.");
    expect(o.waiting).toBe("Changing $10.00 of your bitcoin into dollars.");
    expect(o.fail).toBe("Nothing was changed. Your bitcoin is where it was.");
    expect(o.doneLabel).toBe("Changed into dollars");
  });
});
