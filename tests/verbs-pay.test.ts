import { describe, expect, it } from "vitest";
import { FALLBACK_PRICES } from "../lib/assets";
import type { Group, Holdings, Part } from "../lib/account/holdings";
import type { QuoteOk } from "../lib/oneclick";
import type { Person } from "../lib/send/people";
import type { Prepared } from "../lib/send/types";
import { label, plain, VERBS, type Ctx } from "../lib/verbs";

const verb = VERBS.pay;
const real = verb.real!;

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

const MAYA: Person = { id: "p1", name: "Maya", address: "0x8ba1f109551bD432803012645Ac136ddd64DBA72", network: "base" };
const DAD: Person = { id: "p2", name: "Dad", address: "dad.near", network: "near" };
const BTC = part("btc", 80, "nep141:btc.omft.near");
const USD = part("usd", 30, "nep141:usdc");
const quoteOk: QuoteOk = { ok: true, amountIn: 0.0005, amountInUsd: 10.1, amountOut: 10, amountOutUsd: 10, seconds: 20 };

const ctx = (over: Partial<Ctx> = {}): Ctx => ({
  prices: FALLBACK_PRICES,
  pricesLive: true,
  quote: { status: "live", data: quoteOk },
  holdings: hold(BTC, USD),
  people: [MAYA, DAD],
  accountId: "0xabc",
  moved: null,
  ...over,
});

const vals = (over = {}) => ({ who: "p1", amt: 10, from: "btc", ...over });
const slotCtx = (over = {}) => ({ prices: FALLBACK_PRICES, holdings: hold(BTC, USD), people: [MAYA, DAD], ...over });

const moved = {
  kind: "pay",
  depositAddress: "d",
  leaves: { assetId: BTC.assetId, symbol: "BTC", network: "btc", decimals: 8, units: "1", amount: 0.0006, usd: 10.5 },
  arrives: { assetId: "u", symbol: "USDC", network: "base", decimals: 6, units: "1", amount: 10, usd: 10 },
  seconds: 20,
  deadline: "",
} as Prepared;

describe("pay, for a real account", () => {
  it("starts with the first saved person and the group holding the most", () => {
    expect(real.def(slotCtx())).toEqual({ who: "p1", amt: 10, from: "btc" });
    expect(real.def(slotCtx({ people: [] }))).toEqual({ who: "__new", amt: 10, from: "btc" });
    expect(real.def(slotCtx({ holdings: hold(USD) })).from).toBe("usd");
  });

  it("offers the saved people, then someone new", () => {
    expect(real.slots.who.kind).toBe("person");
    expect(real.slots.who.opts(slotCtx())).toEqual([
      { v: "p1", label: "Maya" },
      { v: "p2", label: "Dad" },
      { v: "__new", label: "someone new" },
    ]);
    expect(real.slots.who.opts(slotCtx({ people: [] })).map((o) => o.label)).toEqual(["someone new"]);
  });

  it("names the person, and falls back to someone", () => {
    const c = slotCtx();
    const v = { ...verb, parts: real.parts, slots: real.slots };
    expect(label(v, "who", vals(), c)).toBe("Maya");
    expect(label(v, "who", vals({ who: "__new" }), c)).toBe("someone new");
    expect(label(v, "who", vals({ who: "" }), c)).toBe("someone");
    expect(label(v, "who", vals({ who: "gone" }), c)).toBe("someone");
    expect(plain(v, vals({ who: "gone" }), c)).toBe("Pay someone $10 from my bitcoin.");
  });

  it("explains why it is blocked, in order", () => {
    const min = "Type an amount of at least $1.";
    expect(real.out(vals({ amt: 0 }), ctx({ holdings: null })).blocked).toBe(min);
    expect(real.out(vals(), ctx({ holdings: null })).blocked).toBe("Reading your account…");
    expect(real.out(vals({ who: "__new" }), ctx()).blocked).toBe("Add their details above first.");
    expect(real.out(vals({ who: "" }), ctx()).blocked).toBe("Choose who to pay.");
    expect(real.out(vals({ who: "gone" }), ctx()).blocked).toBe("Choose who to pay.");
    expect(real.out(vals({ from: "eth" }), ctx()).blocked).toBe("You don’t hold any ether yet.");
    // Everything it could draw on, after costs, falls short.
    expect(real.out(vals({ amt: 100 }), ctx()).blocked).toBe("You can use up to $78.19 of your bitcoin.");
    // The price for this amount asks for more than the one holding has.
    const dear: QuoteOk = { ...quoteOk, amountOut: 79, amountInUsd: 81 };
    expect(real.out(vals({ amt: 79 }), ctx({ quote: { status: "live", data: dear } })).blocked).toBe(
      "You can use up to $77.25 of your bitcoin.",
    );
    expect(real.out(vals(), ctx({ quote: { status: "no-offer" } })).blocked).toMatch(/No one is offering/);
    expect(real.out(vals(), ctx({ quote: { status: "loading" } })).blocked).toBe("Getting a price…");
    expect(real.out(vals(), ctx()).blocked).toBeUndefined();
  });

  it("shows what will happen", () => {
    const o = real.out(vals(), ctx());
    expect(o.rows.map((r) => r.k)).toEqual(["Maya gets", "Leaves you", "Arrives", "Sent to", "If it fails", "Once it arrives"]);
    expect(o.rows[0]).toMatchObject({ v: "$10.00 exactly, as dollars", sub: "USDC on Base", tone: "ok" });
    expect(o.rows[3]).toMatchObject({ v: "0x8ba1…BA72", sub: "on Base · check it with them", tone: "warn" });
    expect(o.rows[5]).toMatchObject({ v: "only Maya can send it back", tone: "stop" });
    expect(real.out(vals({ who: "p2" }), ctx()).rows[0].sub).toBe("USDC on NEAR");
    expect(JSON.stringify(real.out(vals({ amt: 0 }), ctx()))).not.toMatch(/NaN|Infinity/);
  });

  it("words what happened", () => {
    const o = real.out(vals({ amt: 40 }), ctx({ holdings: hold(part("btc", 80, "b")) }));
    expect(o.doneLabel).toBe("Paid Maya $40.00");
    expect(o.past).toBe("You paid Maya $40.00.");
    expect(o.waiting).toBe("Paying Maya $40.00.");
    expect(o.fail).toBe("Maya was not paid. Your money is back in your account.");
  });

  it("has no plan when blocked", () => {
    expect(real.plan!(vals({ amt: 0 }), ctx())).toBeNull();
    expect(real.plan!(vals({ who: "__new" }), ctx())).toBeNull();
    expect(real.plan!(vals({ amt: 100 }), ctx())).toBeNull();
    expect(real.plan!(vals(), ctx({ quote: { status: "loading" } }))).toBeNull();
    expect(real.plan!(vals(), ctx({ accountId: null }))).toBeNull();
  });

  it("plans to the person's address and network from the token held", () => {
    const plan = real.plan!(vals(), ctx())!;
    expect(plan.legs).toHaveLength(1);
    expect(plan.legs[0].ask).toEqual({
      kind: "pay",
      accountId: "0xabc",
      fromAssetId: BTC.assetId,
      usd: 10,
      to: { address: MAYA.address, network: "base" },
    });
    expect(plan.legs[0].source).toBe(BTC);
    expect(plan.shown).toBe(0.0005);
    expect(plan.shownUsd).toBe(10.1);
  });

  it("plans from what leaves in the final price once it moved", () => {
    const c = ctx({ moved });
    expect(real.plan!(vals(), c)!.shown).toBe(0.0006);
    expect(real.out(vals(), c).status).toEqual({ label: "Final price", tone: "live" });
  });

  it("asks for a dry quote of the token held, on their network", () => {
    expect(real.ask(vals({ who: "p2" }), ctx())).toEqual({
      kind: "pay",
      from: "btc",
      usd: 10,
      fromAssetId: BTC.assetId,
      toNetwork: "near",
    });
    expect(real.ask(vals({ amt: 0 }), ctx())).toBeNull();
    expect(real.ask(vals({ who: "" }), ctx())).toBeNull();
    expect(real.ask(vals({ who: "__new" }), ctx())).toBeNull();
    expect(real.ask(vals({ amt: 100 }), ctx())).toBeNull();
  });
});

describe("dry pay quotes", () => {
  it("accept a known network only", async () => {
    const { parseAsk } = await import("../lib/oneclick");
    expect(parseAsk({ kind: "pay", from: "usd", usd: 5, toNetwork: "sol" })).toEqual({ kind: "pay", from: "usd", usd: 5, toNetwork: "sol" });
    expect(parseAsk({ kind: "pay", from: "usd", usd: 5, toNetwork: "doge" })).toBeNull();
    expect(parseAsk({ kind: "pay", from: "usd", usd: 5 })).toEqual({ kind: "pay", from: "usd", usd: 5 });
  });
});
