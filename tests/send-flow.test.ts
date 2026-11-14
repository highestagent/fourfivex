// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { Part } from "../lib/account/holdings";
import { challengeFor, signedIntent } from "../lib/account/intents";
import { accountIdOf } from "../lib/account/keys";
import { displayUnits, withdrawalUnits } from "../lib/send/amount";
import { PriceMoved, send, sendMany, type SendDeps } from "../lib/send/flow";
import type { Leg, Prepared, SendAsk, SendStatus } from "../lib/send/types";
import { makeAuthenticator } from "./virtual-authenticator";

const passkey = makeAuthenticator();
const accountId = accountIdOf(passkey.publicKey);
const BTC = "nep141:btc.omft.near";
const USD = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const DEPOSIT = "4f72ca933f12df9abfcc1a086ccd0b8b7b227ad9341250ad635016a0ad58e9a6";

const leg = (assetId: string, units: string, amount: number, usd: number): Leg => ({
  assetId,
  symbol: "X",
  network: "x",
  decimals: 8,
  units,
  amount,
  usd,
});

function payloadFor(over: { receiver?: string; units?: string } = {}) {
  return JSON.stringify({
    verifying_contract: "intents.near",
    signer_id: accountId,
    deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
    nonce: "AAAA",
    intents: [{ intent: "transfer", receiver_id: over.receiver ?? DEPOSIT, tokens: { [BTC]: over.units ?? "70000" } }],
  });
}

const prepared = (over: Partial<Prepared> = {}): Prepared => ({
  kind: "change",
  depositAddress: DEPOSIT,
  leaves: leg(BTC, "70000", 0.0007, 50),
  arrives: leg(USD, "50000000", 50, 50),
  seconds: 20,
  deadline: new Date(Date.now() + 600_000).toISOString(),
  payload: payloadFor(),
  ...over,
});

const source = (units = "100000"): Part => ({
  assetId: BTC,
  decimals: 8,
  units,
  symbol: "BTC",
  network: "btc",
  amount: 0.001,
  usd: 70,
  group: "btc",
});

const change = { kind: "change", accountId, fromAssetId: BTC, to: "usd", usd: 50 } as const;
const pay = {
  kind: "pay",
  accountId,
  fromAssetId: BTC,
  usd: 50,
  to: { address: "0x8ba1f109551bD432803012645Ac136ddd64DBA72", network: "base" },
} as const;

function deps(p: Prepared, statuses: (SendStatus | Error)[] = [{ state: "done", arrived: { amount: 50, usd: 50 }, links: [] }]) {
  let i = 0;
  const d = {
    prepare: vi.fn<(ask: SendAsk) => Promise<Prepared>>(async () => p),
    signPayload: vi.fn(async (_id: string, payload: string) =>
      signedIntent(payload, passkey.publicKey, passkey.assert(challengeFor(payload))),
    ),
    submit: vi.fn(async () => "hash123"),
    combine: vi.fn(async () => ""),
    submitMany: vi.fn(async () => "tx123"),
    status: vi.fn<(address: string) => Promise<SendStatus>>(async () => {
      const s = statuses[Math.min(i++, statuses.length - 1)];
      if (s instanceof Error) throw s;
      return s;
    }),
    sleep: vi.fn(async () => {}),
  };
  return d satisfies SendDeps;
}

const run = (ask: typeof change | typeof pay, d: ReturnType<typeof deps>, shown = 50, over = {}) => {
  const steps: string[] = [];
  const result = send(ask, { shown, source: source(), onStep: (s) => steps.push(s), ...over }, d);
  return { result, steps };
};

describe("send", () => {
  it("completes a change", async () => {
    const d = deps(prepared(), [
      { state: "waiting", links: [] },
      { state: "working", links: [] },
      { state: "done", arrived: { amount: 50, usd: 50 }, links: [{ hash: "h", url: "u" }] },
    ]);
    const { result, steps } = run(change, d);
    const r = await result;
    expect(r.state).toBe("done");
    expect(r.intentHash).toBe("hash123");
    expect(r.arrived).toEqual({ amount: 50, usd: 50 });
    expect(r.links).toHaveLength(1);
    expect(steps).toEqual([
      "Getting the final price",
      "Waiting for your passkey",
      "Sending",
      "Waiting for the network",
      "Delivering",
    ]);
  });

  it("completes a pay", async () => {
    const d = deps(prepared({ kind: "pay" }));
    const r = await run(pay, d, 50).result;
    expect(r.state).toBe("done");
    expect(d.submit).toHaveBeenCalledOnce();
  });

  it("reports the send once it is accepted, before following it", async () => {
    const d = deps(prepared());
    const seen: string[] = [];
    const onSubmitted = vi.fn(() => seen.push(`submitted after ${d.status.mock.calls.length} polls`));
    await send(change, { shown: 50, source: source(), onStep: () => {}, onSubmitted }, d);
    expect(onSubmitted).toHaveBeenCalledOnce();
    expect(onSubmitted).toHaveBeenCalledWith({ depositAddress: DEPOSIT, intentHash: "hash123", prepared: expect.anything() });
    expect(seen).toEqual(["submitted after 0 polls"]);
  });

  it("stops when a change arrives 1% lower than shown", async () => {
    const d = deps(prepared({ arrives: leg(USD, "49500000", 49.5, 49.5) }));
    await expect(run(change, d).result).rejects.toBeInstanceOf(PriceMoved);
    expect(d.signPayload).not.toHaveBeenCalled();
  });

  it("stops when a pay leaves 1% higher than shown", async () => {
    const d = deps(prepared({ kind: "pay", leaves: leg(BTC, "70000", 0.0007, 50.5) }));
    await expect(run(pay, d, 0.0007 * 0.99).result).rejects.toBeInstanceOf(PriceMoved);
    expect(d.signPayload).not.toHaveBeenCalled();
  });

  it("refuses a payload that goes somewhere else", async () => {
    const d = deps(prepared({ payload: payloadFor({ receiver: "attacker.near" }) }));
    await expect(run(change, d).result).rejects.toThrow(/stopped this before anything was signed/);
    expect(d.signPayload).not.toHaveBeenCalled();
  });

  it("refuses a missing payload", async () => {
    const d = deps(prepared({ payload: undefined }));
    await expect(run(change, d).result).rejects.toThrow(/stopped this/);
    expect(d.signPayload).not.toHaveBeenCalled();
  });

  it("refuses a source that is too small", async () => {
    const d = deps(prepared());
    const steps: string[] = [];
    await expect(send(change, { shown: 50, source: source("69999"), onStep: (s) => steps.push(s) }, d)).rejects.toThrow(
      "Your account doesn't hold enough for this.",
    );
    expect(d.signPayload).not.toHaveBeenCalled();
  });

  it("surfaces a refused submit", async () => {
    const d = deps(prepared());
    d.submit.mockRejectedValue(new Error("The network refused it: nope"));
    await expect(run(change, d).result).rejects.toThrow("The network refused it: nope");
  });

  it("returns a refunded receipt", async () => {
    const d = deps(prepared(), [
      { state: "waiting", links: [] },
      { state: "working", links: [] },
      { state: "refunded", refunded: { amount: 0.0007, reason: "PARTIAL_DEPOSIT" }, links: [] },
    ]);
    const r = await run(change, d).result;
    expect(r.state).toBe("refunded");
    expect(r.refunded).toEqual({ amount: 0.0007, reason: "PARTIAL_DEPOSIT" });
  });

  it("returns the last state when the polls run out", async () => {
    const d = deps(prepared(), [{ state: "working", links: [] }]);
    const r = await run(change, d, 50, { maxPolls: 3 }).result;
    expect(r.state).toBe("working");
    expect(d.status).toHaveBeenCalledTimes(3);
  });

  it("survives a status call that throws once", async () => {
    const d = deps(prepared(), [new Error("down"), { state: "done", links: [] }]);
    const r = await run(change, d).result;
    expect(r.state).toBe("done");
  });
});
describe("wallet withdrawal amounts", () => {
  it("preserves exact units for both the quote and its review", () => {
    const input = "987654321098.012345678901234567890123";
    const units = withdrawalUnits(input, 24);
    expect(units).toBe("987654321098012345678901234567890123");
    expect(displayUnits(units!, 24)).toBe(input);
    expect(displayUnits("30000", 8)).toBe("0.0003");
  });

  it.each(["0", "-1", "1e2", "1.0000001"])("rejects %s for a six-decimal token", input => {
    expect(withdrawalUnits(input, 6)).toBeUndefined();
  });
});

describe("sendMany", () => {
  const BASE = "nep141:base-usdc";
  const ARB = "nep141:arb-usdc";
  const DEPOSITS = ["a".repeat(64), "b".repeat(64)];
  const holding = (assetId: string, units: string): Part => ({ ...source(units), assetId, group: "usd" });
  const legs = [
    { ask: { ...change, fromAssetId: BASE, usd: 30 }, source: holding(BASE, "40000000") },
    { ask: { ...change, fromAssetId: ARB, usd: 20 }, source: holding(ARB, "40000000") },
  ];
  const quote = (i: number, units = String((30 - 10 * i) * 1e6)): Prepared => prepared({
    depositAddress: DEPOSITS[i],
    leaves: { ...leg([BASE, ARB][i], units, 30 - 10 * i, 30 - 10 * i), decimals: 6 },
    arrives: leg(BTC, String((30 - 10 * i) * 1000), (30 - 10 * i) / 100000, 30 - 10 * i),
  });
  const combined = (over: { units?: string[]; receivers?: string[] } = {}) => JSON.stringify({
    verifying_contract: "intents.near",
    signer_id: accountId,
    deadline: new Date(Date.now() + 3 * 60_000).toISOString(),
    nonce: "AAAA",
    intents: [0, 1].map((i) => ({
      intent: "transfer",
      receiver_id: over.receivers?.[i] ?? DEPOSITS[i],
      tokens: { [[BASE, ARB][i]]: over.units?.[i] ?? String((30 - 10 * i) * 1e6) },
    })),
  });
  const many = (quotes: Prepared[], payload: string, statuses: SendStatus[][]) => {
    let polls = 0;
    const d = deps(quotes[0]);
    d.prepare.mockImplementation(async (ask) => quotes[(ask as { fromAssetId: string }).fromAssetId === BASE ? 0 : 1]);
    d.combine.mockImplementation(async () => payload);
    d.status.mockImplementation(async (address: string) => {
      const round = statuses[Math.min(Math.floor(polls++ / 2), statuses.length - 1)];
      return round[DEPOSITS.indexOf(address)];
    });
    return d;
  };
  const done = (amount: number): SendStatus => ({ state: "done", arrived: { amount, usd: amount }, links: [] });

  it("signs once for every part and follows them to the end", async () => {
    const message = combined();
    const d = many([quote(0), quote(1)], message, [
      [{ state: "working", links: [] }, { state: "waiting", links: [] }],
      [done(0.0003), done(0.0002)],
    ]);
    const steps: string[] = [];
    const submitted: string[][] = [];
    const r = await sendMany(legs, {
      shown: 0.0005, shownUsd: 50, onStep: (s) => steps.push(s),
      onSubmitted: ({ depositAddresses }) => submitted.push(depositAddresses),
    }, d);
    expect(d.combine).toHaveBeenCalledWith(accountId, DEPOSITS);
    expect(d.signPayload).toHaveBeenCalledTimes(1);
    expect(d.signPayload).toHaveBeenCalledWith(accountId, message);
    expect(d.submitMany).toHaveBeenCalledWith(DEPOSITS, expect.objectContaining({ payload: message }));
    expect(submitted).toEqual([DEPOSITS]);
    expect(r).toMatchObject({ depositAddress: DEPOSITS[0], legs: DEPOSITS, intentHash: "tx123", state: "done", arrived: { amount: 0.0005 } });
    expect(steps).toContain("Waiting for your passkey");
  });

  it("calls it partial when one part arrives and the other comes back", async () => {
    const d = many([quote(0), quote(1)], combined(), [[done(0.0003), { state: "refunded", refunded: { amount: 20 }, links: [] }]]);
    const r = await sendMany(legs, { shown: 0.0005, shownUsd: 50, onStep: () => {} }, d);
    expect(r.state).toBe("partial");
  });

  it("asks again when the parts together come to less than was shown", async () => {
    const d = many([quote(0), quote(1)], combined(), [[done(0)]]);
    await expect(sendMany(legs, { shown: 0.001, shownUsd: 50, onStep: () => {} }, d)).rejects.toBeInstanceOf(PriceMoved);
    expect(d.signPayload).not.toHaveBeenCalled();
  });

  it("stops before signing when a part asks for more than its holding has", async () => {
    const d = many([quote(0, "50000000"), quote(1)], combined(), [[done(0)]]);
    await expect(sendMany(legs, { shown: 0.0005, shownUsd: 60, onStep: () => {} }, d)).rejects.toThrow("doesn't hold enough");
    expect(d.signPayload).not.toHaveBeenCalled();
  });

  it("stops before signing when the message doesn't match the quotes", async () => {
    for (const payload of [combined({ units: ["30000001", "20000000"] }), combined({ receivers: [DEPOSITS[0], "c".repeat(64)] })]) {
      const d = many([quote(0), quote(1)], payload, [[done(0)]]);
      await expect(sendMany(legs, { shown: 0.0005, shownUsd: 50, onStep: () => {} }, d)).rejects.toThrow("before anything was signed");
      expect(d.signPayload).not.toHaveBeenCalled();
      expect(d.submitMany).not.toHaveBeenCalled();
    }
  });
});
