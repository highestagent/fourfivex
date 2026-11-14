/**
 * The server side of a real send. The route stays thin; the rules live here.
 * Nothing here holds a key: it forwards only what a passkey signed, and only after checking it.
 */
import { balancesOf, ContractError, simulate } from "../account/chain";
import type { SignedIntent } from "../account/intents";
import { isAccountId } from "../account/keys";
import {
  findToken,
  getTokens,
  generateIntent,
  OneClickError,
  realQuote,
  STATE_OF,
  submitIntent,
  swapStatus,
  usdcOn,
  type RealQuote,
  type SwapStatus,
  type Token,
} from "../oneclick";
import { ASSETS } from "../assets";
import { payloadProblem } from "./guard";
import { addressProblem, familyOf } from "./address";
import { withdrawalUnits } from "./amount";
import type { Leg, Prepared, SendAsk, SendStatus } from "./types";

/** Its message is written for the person. */
export class SendError extends Error {}

export async function transferAssets() {
  return (await getTokens()).filter(token => familyOf(token.blockchain)).map(({ assetId, symbol, blockchain }) => ({ assetId, symbol, blockchain }));
}

function leg(token: Token | undefined, assetId: string, units: string, amount: string, usd: string): Leg {
  if (!token) throw new SendError("We don't know that kind of money.");
  return {
    assetId,
    symbol: token.symbol,
    network: token.blockchain,
    decimals: token.decimals,
    units,
    amount: Number(amount),
    usd: Number(usd),
  };
}

async function askProblem(ask: SendAsk): Promise<string | null> {
  if (!isAccountId(ask.accountId)) return "That account isn't valid.";
  if (ask.kind === "withdraw") {
    const [source, destination] = await Promise.all([findToken(ask.fromAssetId), findToken(ask.assetId)]);
    const family = destination && familyOf(destination.blockchain);
    if (!source || !destination || !family) return "Choose a supported source and destination asset.";
    if (!withdrawalUnits(ask.amount, destination.decimals)) return `Enter a positive amount with up to ${destination.decimals} decimal places.`;
    return addressProblem(family, ask.address);
  }
  if (!Number.isFinite(ask.usd) || ask.usd < 1 || ask.usd > 1_000_000) return "Pick an amount between $1 and $1,000,000.";
  if (ask.kind === "change") {
    if (!(ask.to in ASSETS)) return "We can't change into that.";
    if (!(await findToken(ask.fromAssetId))) return "We don't know that kind of money.";
    if (ask.fromAssetId === ASSETS[ask.to].id) return "That's already what you'd get.";
  } else if (ask.kind === "pay") {
    if (!(await findToken(ask.fromAssetId))) return "We don't know that kind of money.";
    if (!(await usdcOn(ask.to.network))) return "We can't pay on that network yet.";
  }
  return null;
}

/** Turns a refusal from the network or 1Click into words for a person. */
function explain(err: unknown): never {
  if (err instanceof SendError) throw err;
  if (err instanceof ContractError) {
    if (/insufficient|balance/i.test(err.message)) throw new SendError("Your account doesn't hold enough for this.");
    throw new SendError(`The network refused it: ${err.message}`);
  }
  if (err instanceof OneClickError && err.status >= 400 && err.status < 500) {
    if (/liquidity/i.test(err.message)) throw new SendError("There's no offer for that right now. Try a different amount.");
    throw new SendError(`That couldn't be set up: ${err.message}`);
  }
  throw new SendError("The service could not be reached. Please try again.");
}

function legsOf(q: RealQuote, from: Token | undefined, to: Token | undefined): [Leg, Leg] {
  return [
    leg(from, q.originAsset, q.amountIn, q.amountInFormatted, q.amountInUsd),
    leg(to, q.destinationAsset, q.amountOut, q.amountOutFormatted, q.amountOutUsd),
  ];
}

/** Gets a live quote and, when a signature is needed, the checked payload to sign. */
export async function prepare(ask: SendAsk): Promise<Prepared> {
  try {
    const problem = await askProblem(ask);
    if (problem) throw new SendError(problem);
    const q = await realQuote(ask);
    const [from, to] = await Promise.all([findToken(q.originAsset), findToken(q.destinationAsset)]);
    const [leaves, arrives] = legsOf(q, from, to);
    const prepared: Prepared = {
      kind: ask.kind,
      depositAddress: q.depositAddress,
      ...(q.depositMemo ? { depositMemo: q.depositMemo } : {}),
      leaves,
      arrives,
      seconds: Number(q.timeEstimate),
      deadline: q.deadline,
    };
    if (ask.kind === "withdraw") {
      if (q.amountOut !== withdrawalUnits(ask.amount, arrives.decimals)) throw new SendError("The quote changed. Review a new withdrawal.");
      const [available] = await balancesOf(ask.accountId, [q.originAsset]);
      if (BigInt(available) < BigInt(q.amountIn)) throw new SendError("Your balance cannot cover this withdrawal.");
    }
    const payload = await generateIntent(q.depositAddress, ask.accountId);
    const bad = payloadProblem(payload, {
      accountId: ask.accountId,
      depositAddress: q.depositAddress,
      assetId: q.originAsset,
      maxUnits: q.amountIn,
    });
    if (bad) throw new SendError(`We stopped this before anything was signed. ${bad}`);
    return { ...prepared, payload };
  } catch (err) {
    return explain(err);
  }
}

function envelope(v: unknown): SignedIntent | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  if (s.standard !== "webauthn") return null;
  for (const f of ["payload", "public_key", "signature", "client_data_json", "authenticator_data"])
    if (typeof s[f] !== "string" || (s[f] as string).length > 4000) return null;
  return s as unknown as SignedIntent;
}

/**
 * Sends a signed transfer, but only if it is exactly what a quote we made asked for, and
 * only after the contract's own checks pass in simulation.
 */
export async function submit(depositAddress: string, signedIn: unknown): Promise<{ intentHash: string }> {
  try {
    const signed = envelope(signedIn);
    if (!signed) throw new SendError("That wasn't a valid signature.");

    let swap: SwapStatus;
    try {
      swap = await swapStatus(depositAddress);
    } catch (err) {
      if (err instanceof OneClickError && err.status === 404) throw new SendError("We can't find that payment.");
      throw err;
    }
    const req = swap.quoteResponse?.quoteRequest;
    const quote = swap.quoteResponse?.quote;
    if (swap.status !== "PENDING_DEPOSIT") throw new SendError("That payment has already been started.");
    if (req?.depositType !== "INTENTS") throw new SendError("That payment doesn't come from your account.");
    if (typeof req.refundTo !== "string" || typeof req.originAsset !== "string" || typeof quote?.amountIn !== "string")
      throw new SendError("That payment's details are incomplete.");

    const bad = payloadProblem(signed.payload, {
      accountId: req.refundTo,
      depositAddress,
      assetId: req.originAsset,
      maxUnits: quote.amountIn,
    });
    if (bad) throw new SendError(`We stopped this before it was sent. ${bad}`);

    await simulate([signed]);
    return { intentHash: await submitIntent(signed) };
  } catch (err) {
    return explain(err);
  }
}

export async function status(depositAddress: string): Promise<SendStatus> {
  let s: SwapStatus;
  try {
    s = await swapStatus(depositAddress);
  } catch (err) {
    if (err instanceof OneClickError && err.status === 404) throw new SendError("We can't find that payment.");
    return explain(err);
  }
  const state = STATE_OF[s.status];
  if (!state) throw new SendError("We couldn't tell where that payment is.");
  const d = s.swapDetails ?? {};
  const out: SendStatus = {
    state,
    links: [...(d.originChainTxHashes ?? []), ...(d.destinationChainTxHashes ?? [])].map((t) => ({
      hash: t.hash,
      url: t.explorerUrl,
    })),
  };
  if (state === "done" && d.amountOutFormatted)
    out.arrived = { amount: Number(d.amountOutFormatted), usd: Number(d.amountOutUsd ?? 0) };
  if (state === "refunded")
    out.refunded = { amount: Number(d.refundedAmountFormatted ?? 0), ...(d.refundReason ? { reason: d.refundReason } : {}) };
  return out;
}
