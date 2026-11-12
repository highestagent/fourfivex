"use client";

import { NetworkError } from "../account/api";
import { signPayload as realSign } from "../account/flows";
import type { Part } from "../account/holdings";
import { payloadProblem } from "./guard";
import { prepareSend, sendStatus, submitSend } from "./api";
import type { Prepared, SendAsk, SendState, SendStatus } from "./types";

/** The final price is worse than the one on screen, so the person must be asked again. */
export class PriceMoved extends Error {
  constructor(readonly prepared: Prepared) {
    super("The price moved.");
  }
}

export type Receipt = {
  depositAddress: string;
  intentHash: string;
  state: SendState;
  arrived?: { amount: number; usd: number };
  refunded?: { amount: number; reason?: string };
  links: { hash: string; url: string }[];
  prepared: Prepared;
};

export type SendDeps = {
  prepare: typeof prepareSend;
  signPayload: typeof realSign;
  submit: typeof submitSend;
  status: (depositAddress: string) => Promise<SendStatus>;
  sleep: (ms: number) => Promise<void>;
};

const defaults: SendDeps = {
  prepare: prepareSend,
  signPayload: realSign,
  submit: submitSend,
  status: sendStatus,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

const TOLERANCE = 0.005;

/**
 * Prepare, check, sign, submit, follow. Nothing is signed unless every earlier check passed.
 * `opts.shown` is what the person saw: what arrives for a change, what leaves for a pay.
 */
export async function send(
  ask: Extract<SendAsk, { kind: "change" | "pay" }>,
  opts: { shown: number; source: Part; onStep: (step: string) => void; pollMs?: number; maxPolls?: number },
  overrides: Partial<SendDeps> = {},
): Promise<Receipt> {
  const d = { ...defaults, ...overrides };
  const { onStep } = opts;

  onStep("Getting the final price");
  const prepared = await d.prepare(ask);

  const worse =
    ask.kind === "change"
      ? !(prepared.arrives.amount >= opts.shown * (1 - TOLERANCE))
      : !(prepared.leaves.amount <= opts.shown * (1 + TOLERANCE));
  if (worse) throw new PriceMoved(prepared);

  if (prepared.leaves.assetId !== opts.source.assetId || BigInt(prepared.leaves.units) > BigInt(opts.source.units))
    throw new NetworkError("Your account doesn't hold enough for this.");

  const problem = prepared.payload
    ? payloadProblem(prepared.payload, {
        accountId: ask.accountId,
        depositAddress: prepared.depositAddress,
        assetId: ask.fromAssetId,
        maxUnits: prepared.leaves.units,
      })
    : "There was nothing to sign.";
  if (problem || !prepared.payload) throw new NetworkError(`We stopped this before anything was signed. ${problem}`);

  onStep("Waiting for your passkey");
  const signed = await d.signPayload(ask.accountId, prepared.payload);

  onStep("Sending");
  const intentHash = await d.submit(prepared.depositAddress, signed);

  const pollMs = opts.pollMs ?? 2000;
  const maxPolls = opts.maxPolls ?? 90;
  let last: SendStatus = { state: "waiting", links: [] };
  for (let i = 0; i < maxPolls; i++) {
    await d.sleep(pollMs);
    try {
      last = await d.status(prepared.depositAddress);
    } catch {
      continue; // try again next tick
    }
    if (last.state === "done" || last.state === "refunded" || last.state === "failed") break;
    onStep(last.state === "working" ? "Delivering" : "Waiting for the network");
  }
  return {
    depositAddress: prepared.depositAddress,
    intentHash,
    state: last.state,
    ...(last.arrived ? { arrived: last.arrived } : {}),
    ...(last.refunded ? { refunded: last.refunded } : {}),
    links: last.links,
    prepared,
  };
}
