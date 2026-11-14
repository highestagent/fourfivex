/**
 * The check that stands between a passkey and a signature. Pure and strict: the payload
 * must be exactly the transfers we expect, each of one token to the deposit address we expect,
 * from this account, for no more than was shown. Anything else is refused before anyone is asked to sign.
 */

/** One transfer we expect: to this deposit address, of this token, for at most this many units. */
export type ExpectedTransfer = { depositAddress: string; assetId: string; maxUnits: string };
type Expect = { accountId: string } & ExpectedTransfer;

/** The most transfers one signature may carry. */
export const MAX_TRANSFERS = 4;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function transferProblem(one: unknown, expect: ExpectedTransfer): string | null {
  if (!isRecord(one) || one.intent !== "transfer") return "This payment does something other than send money.";
  if (Object.keys(one).some((k) => k !== "intent" && k !== "receiver_id" && k !== "tokens" && k !== "memo"))
    return "This payment carries something unexpected.";
  if (one.receiver_id !== expect.depositAddress) return "This payment goes to a different place than the one shown.";

  if (!isRecord(one.tokens)) return "This payment does not say what it sends.";
  const ids = Object.keys(one.tokens);
  if (ids.length !== 1) return "This payment sends more than one kind of money.";
  if (ids[0] !== expect.assetId) return "This payment sends a different kind of money than the one shown.";

  const amount = one.tokens[ids[0]];
  if (typeof amount !== "string" || !/^[0-9]+$/.test(amount)) return "This payment has an amount that cannot be read.";
  if (BigInt(amount) <= BigInt(0)) return "This payment has no amount.";
  if (!/^[0-9]+$/.test(expect.maxUnits) || BigInt(amount) > BigInt(expect.maxUnits))
    return "This payment is for more than the amount shown.";
  return null;
}

/** Checks a payload against the transfers expected, in order. One signature may carry several. */
export function payloadProblems(payload: string, accountId: string, transfers: readonly ExpectedTransfer[], now = Date.now()): string | null {
  let p: unknown;
  try {
    p = JSON.parse(payload);
  } catch {
    return "The details of this payment could not be read.";
  }
  if (!isRecord(p)) return "The details of this payment could not be read.";
  if (p.verifying_contract !== "intents.near") return "This payment is addressed to the wrong place.";
  if (p.signer_id !== accountId) return "This payment is from a different account.";
  if (!transfers.length || transfers.length > MAX_TRANSFERS) return "This payment does more than one thing.";
  if (new Set(transfers.map((t) => t.depositAddress)).size !== transfers.length) return "This payment pays the same place twice.";
  if (!Array.isArray(p.intents) || p.intents.length !== transfers.length) return "This payment does more than one thing.";
  for (const [index, transfer] of transfers.entries()) {
    const problem = transferProblem(p.intents[index], transfer);
    if (problem) return problem;
  }

  if (typeof p.deadline !== "string") return "This payment has no expiry.";
  const deadline = Date.parse(p.deadline);
  if (!Number.isFinite(deadline) || deadline <= now) return "This payment has already expired.";
  return null;
}

/** The single-transfer check 1Click payloads go through. */
export function payloadProblem(payload: string, expect: Expect, now = Date.now()): string | null {
  const { accountId, ...transfer } = expect;
  return payloadProblems(payload, accountId, [transfer], now);
}
