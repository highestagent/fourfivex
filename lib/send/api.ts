"use client";

import { NetworkError } from "../account/api";
import type { SignedIntent } from "../account/intents";
import { combinedStatus } from "./legs";
import type { Prepared, SendAsk, SendStatus, TransferAsset } from "./types";

async function post<T>(body: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api/send", {
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

export const prepareSend = async (ask: SendAsk) => (await post<{ prepared: Prepared }>({ op: "prepare", ...ask })).prepared;

export const fetchTransferAssets = async () => (await post<{ assets: TransferAsset[] }>({ op: "assets" })).assets;

export const submitSend = async (depositAddress: string, signed: SignedIntent) =>
  (await post<{ intentHash: string }>({ op: "submit", depositAddress, signed })).intentHash;

export const sendStatus = async (depositAddress: string) =>
  (await post<{ status: SendStatus }>({ op: "status", depositAddress })).status;

/** The message to sign for a send split across networks: one transfer per quote. */
export const combineSend = async (accountId: string, depositAddresses: string[]) =>
  (await post<{ payload: string }>({ op: "combine", accountId, depositAddresses })).payload;

export const submitSendMany = async (depositAddresses: string[], signed: SignedIntent) =>
  (await post<{ intentHash: string }>({ op: "submit-many", depositAddresses, signed })).intentHash;

/** Where a recorded send is: one quote's status, or all of them combined for a send split across networks. */
export async function entryStatus(entry: { id: string; legs?: string[] }): Promise<SendStatus> {
  if (!entry.legs?.length) return sendStatus(entry.id);
  return combinedStatus(await Promise.all(entry.legs.map(sendStatus)));
}
