// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { Part } from "../lib/account/holdings";
import { challengeFor, signedIntent } from "../lib/account/intents";
import { accountIdOf } from "../lib/account/keys";
import { PriceMoved, send, type SendDeps } from "../lib/send/flow";
import type { Leg, Prepared, SendStatus } from "../lib/send/types";
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
    prepare: vi.fn(async () => p),
    signPayload: vi.fn(async (_id: string, payload: string) =>
      signedIntent(payload, passkey.publicKey, passkey.assert(challengeFor(payload))),
    ),
    submit: vi.fn(async () => "hash123"),
    status: vi.fn(async () => {
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
