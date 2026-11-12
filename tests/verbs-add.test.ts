import { describe, expect, it } from "vitest";
import { FALLBACK_PRICES } from "../lib/assets";
import { parseAsk, type QuoteOk } from "../lib/oneclick";
import { PAY_IN } from "../lib/send/payin";
import { VERBS, type Ctx } from "../lib/verbs";

const real = VERBS.getpaid.real!;

const quoteOk: QuoteOk = { ok: true, amountIn: 0.00966, amountInUsd: 20.24, amountOut: 20, amountOutUsd: 20, seconds: 45 };
const ctx = (over: Partial<Ctx> = {}): Ctx => ({
  prices: FALLBACK_PRICES,
  pricesLive: true,
  quote: { status: "live", data: quoteOk },
  holdings: null,
  people: [],
  accountId: "0xabc",
  moved: null,
  ...over,
});
const EVM = "0x8ba1f109551bD432803012645Ac136ddd64DBA72";
const BTC = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const vals = (over = {}) => ({ amt: 20, with: "eth-eth", refund: EVM, ...over });

describe("add money, for a real account", () => {
  it("starts at $20 paid with dollars on Base, with no refund address", () => {
    expect(real.def({ prices: FALLBACK_PRICES, holdings: null, people: [] })).toEqual({ amt: 20, with: PAY_IN[0].id, refund: "" });
  });

  it("offers the eight ways to pay", () => {
    const opts = real.slots.with.opts({ prices: FALLBACK_PRICES, holdings: null, people: [] });
    expect(opts.map((o) => o.v)).toEqual(PAY_IN.map((p) => p.id));
    expect(opts.map((o) => o.label)).toEqual(PAY_IN.map((p) => p.label));
    expect(real.title).toBe("Add money to your account");
    expect(real.plan).toBeUndefined();
  });

  it("blocks in order: amount, address, address shape, no offer, no price yet", () => {
    expect(real.out(vals({ amt: 0.5, refund: "" }), ctx()).blocked).toBe("Type an amount of at least $1.");
    expect(real.out(vals({ refund: "  " }), ctx()).blocked).toBe("Add the address you are sending from.");
    expect(real.out(vals({ with: "btc-btc", refund: EVM }), ctx()).blocked).toBe("That doesn’t look like a Bitcoin address.".replace("’", "'"));
    expect(real.out(vals(), ctx({ quote: { status: "no-offer" } })).blocked).toMatch(/No one is offering/);
    expect(real.out(vals(), ctx({ quote: { status: "loading" } })).blocked).toBe("Getting a price…");
    expect(real.out(vals(), ctx({ quote: { status: "unavailable" } })).blocked).toBe("Getting a price…");
    expect(real.out(vals(), ctx()).blocked).toBeUndefined();
    expect(real.out(vals({ with: "btc-btc", refund: BTC }), ctx()).blocked).toBeUndefined();
  });

  it("describes what happens, from the live quote", () => {
    const o = real.out(vals(), ctx());
    expect(o.rows.map((r) => r.k)).toEqual(["You get", "You send", "Reaches you", "Sent back if", "Signing"]);
    expect(o.rows[0].v).toBe("$20.00 exactly, as dollars");
    expect(o.rows[1].v).toBe("about 0.00966 ether");
    expect(o.rows[1].sub).toBe("about $20.24 · ETH on Ethereum · cost 24¢");
    expect(o.rows[2].v).toBe("about 45 seconds after you send it");
    expect(o.hold).toBe(0);
    expect(o.cta).toBe("Get my address");
    expect(o.past).toBe("You added $20.00.");
    expect(o.waiting).toBe("Waiting for ether to add $20.00.");
  });

  it("asks for a dry quote naming the token", () => {
    expect(real.ask(vals(), ctx())).toEqual({ kind: "getpaid", payer: "eth", usd: 20, payAssetId: PAY_IN[4].assetId });
    expect(real.ask(vals({ with: "usd-sol" }), ctx())).toMatchObject({ payer: "eth", payAssetId: PAY_IN[3].assetId });
    expect(real.ask(vals({ with: "sol-sol" }), ctx())).toMatchObject({ payer: "sol" });
    expect(real.ask(vals({ with: "btc-btc" }), ctx())).toMatchObject({ payer: "btc" });
    expect(real.ask(vals({ amt: 0 }), ctx())).toBeNull();
  });

  it("requests an address only when nothing blocks it", () => {
    expect(real.request!(vals({ refund: "" }), ctx())).toBeNull();
    expect(real.request!(vals(), ctx({ quote: { status: "loading" } }))).toBeNull();
    expect(real.request!(vals(), ctx({ accountId: null }))).toBeNull();
    expect(real.request!(vals({ refund: `${EVM}` }), ctx())).toEqual({
      kind: "add",
      accountId: "0xabc",
      payAssetId: PAY_IN[4].assetId,
      usd: 20,
      refundTo: EVM,
    });
  });

  it("leaves the demo sentence alone", () => {
    expect(VERBS.getpaid.def).toEqual({ who: "any", amt: 120, payer: "eth" });
    expect(VERBS.getpaid.ask!({ who: "any", amt: 120, payer: "eth" })).toEqual({ kind: "getpaid", payer: "eth", usd: 120 });
  });
});

describe("a dry add quote", () => {
  it("accepts a named token and refuses anything odd", () => {
    expect(parseAsk({ kind: "getpaid", payer: "eth", usd: 20, payAssetId: "nep141:eth.omft.near" })).toEqual({
      kind: "getpaid",
      payer: "eth",
      usd: 20,
      payAssetId: "nep141:eth.omft.near",
    });
    expect(parseAsk({ kind: "getpaid", payer: "eth", usd: 20, payAssetId: 5 })).toBeNull();
    expect(parseAsk({ kind: "getpaid", payer: "eth", usd: 20, payAssetId: "x".repeat(121) })).toBeNull();
    expect(parseAsk({ kind: "getpaid", payer: "usd", usd: 20 })).toBeNull();
    expect(parseAsk({ kind: "getpaid", payer: "btc", usd: 20 })).toEqual({ kind: "getpaid", payer: "btc", usd: 20 });
  });
});
