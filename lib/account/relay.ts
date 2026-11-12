/**
 * Handing a signed intent to the NEAR Intents relay, which pays the network fee and
 * submits it to the verifier contract. Runs on the server.
 *
 * This is the only code in the app that can cause a change on-chain, and it only ever
 * forwards what a passkey has already signed.
 */
import type { SignedIntent } from "./intents";

const RELAY = "https://solver-relay-v2.chaindefuser.com/rpc";

export type RelayStatus = "PENDING" | "TX_BROADCASTED" | "SETTLED" | "NOT_FOUND_OR_NOT_VALID";

async function call<T>(method: string, params: unknown): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // Optional. The relay documents a partner key; set NEAR_INTENTS_API_KEY to send one.
  if (process.env.NEAR_INTENTS_API_KEY) headers["X-API-Key"] = process.env.NEAR_INTENTS_API_KEY;
  const res = await fetch(RELAY, {
    method: "POST",
    headers,
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params: [params] }),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401 || res.status === 403) throw new Error("The relay asked for an API key that is not set up.");
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.error || !json.result) throw new Error(json.error?.message || "The relay did not answer.");
  return json.result;
}

export async function publish(signed: SignedIntent): Promise<{ ok: true; intentHash: string } | { ok: false; reason: string }> {
  const r = await call<{ status: string; reason?: string; intent_hash?: string }>("publish_intent", {
    quote_hashes: [],
    signed_data: signed,
  });
  if (r.status !== "OK" || !r.intent_hash) return { ok: false, reason: r.reason || "The relay refused it." };
  return { ok: true, intentHash: r.intent_hash };
}

export async function statusOf(intentHash: string): Promise<{ status: RelayStatus; details?: string }> {
  const r = await call<{ status: RelayStatus; status_details?: string }>("get_status", { intent_hash: intentHash });
  return { status: r.status, details: r.status_details };
}
