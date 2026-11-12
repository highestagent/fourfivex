"use client";

import type { Holdings } from "./holdings";
import type { SignedIntent } from "./intents";

/** The contract or the relay said no, in words meant for the person. */
export class NetworkError extends Error {}

async function chain<T>(body: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api/chain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new NetworkError("The network could not be reached. Please try again.");
  }
  const data = (await res.json().catch(() => null)) as ({ ok: boolean; reason?: string } & T) | null;
  if (!data || !data.ok) throw new NetworkError(data?.reason || "The network could not be reached. Please try again.");
  return data;
}

export const fetchSalt = async () => (await chain<{ salt: string }>({ op: "salt" })).salt;

export const hasKey = async (accountId: string, publicKey: string) =>
  (await chain<{ has: boolean }>({ op: "has-key", accountId, publicKey })).has;

export const fetchKeys = async (accountId: string) => (await chain<{ keys: string[] }>({ op: "keys", accountId })).keys;

export const fetchHoldings = async (accountId: string) =>
  (await chain<{ holdings: Holdings }>({ op: "holdings", accountId })).holdings;

export const publishIntent = async (signed: SignedIntent) =>
  (await chain<{ intentHash: string }>({ op: "publish", signed })).intentHash;

export const intentStatus = (intentHash: string) =>
  chain<{ status: string; details?: string }>({ op: "status", intentHash });
