"use client";

import { NetworkError } from "../account/api";
import { signPayload as realSign } from "../account/flows";
import type { Part } from "../account/holdings";
import { payloadProblem, payloadProblems } from "./guard";
import { combineSend, prepareSend, sendStatus, submitSend, submitSendMany } from "./api";
import { combinedStatus } from "./legs";
import type { Prepared, SendAsk, SendState, SendStatus } from "./types";

/** The final price is worse than the one on screen, so the person must be asked again. */
export class PriceMoved extends Error {
  constructor(readonly prepared: Prepared) {
    super("The price moved.");
  }
}

export type Receipt = {
  /** The deposit address, or the first one of a send split across networks. */
  depositAddress: string;
  /** Every deposit address of a send split across networks. */
  legs?: string[];
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
  combine: typeof combineSend;
  submitMany: typeof submitSendMany;
  status: (depositAddress: string) => Promise<SendStatus>;
  sleep: (ms: number) => Promise<void>;
};

const defaults: SendDeps = {
  prepare: prepareSend,
  signPayload: realSign,
  submit: submitSend,
  combine: combineSend,
  submitMany: submitSendMany,
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
  opts: {
    shown: number;
    source: Part;
    onStep: (step: string) => void;
    /** Called once, right after the send is accepted and before following it. */
    onSubmitted?: (r: { depositAddress: string; intentHash: string; prepared: Prepared }) => void;
    pollMs?: number;
    maxPolls?: number;
  },
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

  opts.onSubmitted?.({ depositAddress: prepared.depositAddress, intentHash, prepared });

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

/** One part of a send split across networks: its own quote request and the holding it draws on. */
export type PlanLeg = { ask: Extract<SendAsk, { kind: "change" | "pay" }>; source: Part };

/** The parts of a split send as one quote, for the price check and the "final price" on screen. */
export function combinedPrepared(parts: readonly Prepared[]): Prepared {
  const add = (pick: (p: Prepared) => number) => parts.reduce((total, part) => total + pick(part), 0);
  const [first] = parts;
  return {
    ...first,
    leaves: { ...first.leaves, amount: add((p) => p.leaves.amount), usd: add((p) => p.leaves.usd) },
    arrives: {
      ...first.arrives,
      amount: add((p) => p.arrives.amount),
      usd: add((p) => p.arrives.usd),
      units: String(parts.reduce((total, part) => total + BigInt(part.arrives.units), BigInt(0))),
    },
    seconds: Math.max(...parts.map((p) => p.seconds)),
    deadline: parts.map((p) => p.deadline).sort()[0],
  };
}

/**
 * A send drawn from several holdings, signed once. Each part gets its own final quote and the same
 * checks as a single send; nothing is signed unless all of them pass.
 * `opts.shown` is what arrives (a change); `opts.shownUsd` is what leaves, in dollars (a pay).
 */
export async function sendMany(
  legs: readonly PlanLeg[],
  opts: {
    shown: number;
    shownUsd: number;
    onStep: (step: string) => void;
    onSubmitted?: (r: { depositAddresses: string[]; intentHash: string; prepared: Prepared }) => void;
    pollMs?: number;
    maxPolls?: number;
  },
  overrides: Partial<SendDeps> = {},
): Promise<Receipt> {
  const d = { ...defaults, ...overrides };
  const { onStep } = opts;
  const [{ ask: first }] = legs;

  onStep("Getting the final price");
  const parts = await Promise.all(legs.map((leg) => d.prepare(leg.ask)));
  const total = combinedPrepared(parts);
  const worse =
    first.kind === "change"
      ? !(total.arrives.amount >= opts.shown * (1 - TOLERANCE))
      : !(total.leaves.usd <= opts.shownUsd * (1 + TOLERANCE));
  if (worse) throw new PriceMoved(total);

  for (const [index, part] of parts.entries()) {
    const { source } = legs[index];
    if (part.leaves.assetId !== source.assetId || BigInt(part.leaves.units) > BigInt(source.units))
      throw new NetworkError("Your account doesn't hold enough for this.");
  }

  const addresses = parts.map((part) => part.depositAddress);
  const payload = await d.combine(first.accountId, addresses);
  const problem = payloadProblems(
    payload,
    first.accountId,
    parts.map((part) => ({ depositAddress: part.depositAddress, assetId: part.leaves.assetId, maxUnits: part.leaves.units })),
  );
  if (problem) throw new NetworkError(`We stopped this before anything was signed. ${problem}`);

  onStep("Waiting for your passkey");
  const signed = await d.signPayload(first.accountId, payload);

  onStep("Sending");
  const intentHash = await d.submitMany(addresses, signed);
  opts.onSubmitted?.({ depositAddresses: addresses, intentHash, prepared: total });

  const pollMs = opts.pollMs ?? 2000;
  const maxPolls = opts.maxPolls ?? 90;
  const sent = { hash: intentHash, url: `https://nearblocks.io/txns/${intentHash}` };
  let last: SendStatus = { state: "waiting", links: [] };
  for (let i = 0; i < maxPolls; i++) {
    await d.sleep(pollMs);
    try {
      last = combinedStatus(await Promise.all(addresses.map((address) => d.status(address))));
    } catch {
      continue; // try again next tick
    }
    if (last.state === "done" || last.state === "partial" || last.state === "refunded" || last.state === "failed") break;
    onStep(last.state === "working" ? "Delivering" : "Waiting for the network");
  }
  return {
    depositAddress: addresses[0],
    legs: addresses,
    intentHash,
    state: last.state,
    ...(last.arrived ? { arrived: last.arrived } : {}),
    ...(last.refunded ? { refunded: last.refunded } : {}),
    links: [sent, ...last.links],
    prepared: total,
  };
}
