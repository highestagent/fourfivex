"use client";

import type { Booking, TrackRecord } from "@fourfivex/markets-protocol/sessions";
import { fetchSalt } from "@/lib/account/api";
import { proveAccount, signPayload } from "@/lib/account/flows";
import { buildPayload, makeNonce } from "@/lib/account/intents";
import { api } from "./client";

/** Paid sessions, from the browser: reading a booking, paying for a seat, getting in, and listing one. */

const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
const entryHash = async (challenge: string) =>
  hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(challenge))));

export const readBooking = (roomId: string, accountId?: string | null) =>
  api<Booking>(`/sessions/${roomId}${accountId ? `?account=${accountId}` : ""}`);

export const readRecord = async (accountId: string) => (await api<{ record: TrackRecord }>("/sessions/record", { accountId })).record;

const refused: Record<string, string> = {
  sold_out: "The last seat just went.",
  booking_closed: "Booking has closed.",
  duplicate: "You already have a seat.",
  canceled: "This session was canceled.",
  host: "Hosts can’t buy a seat in their own session.",
};

/**
 * One passkey touch pays for the seat and lets this device in. The payment names a challenge handed to this
 * device, so the service can tell the same person paid and asked to come in.
 */
export async function buySeat(accountId: string, booking: Booking, name: string) {
  const { challenge } = await api<{ challenge: string }>(`/sessions/${booking.roomId}/challenge`, { accountId });
  const deadline = new Date(Date.now() + 5 * 60_000);
  const payload = buildPayload({
    signerId: accountId, deadline, nonce: makeNonce(await fetchSalt(), deadline, crypto.getRandomValues(new Uint8Array(15))),
    intents: [{
      intent: "transfer", receiver_id: booking.escrow, tokens: { [booking.token]: booking.feeUnits },
      msg: JSON.stringify({ session: booking.roomId, entry: await entryHash(challenge) }),
    }],
  });
  const signed = await signPayload(accountId, payload);
  const response = await fetch("/api/room-payments", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, signed }),
  });
  const result = await response.json().catch(() => null) as { seat?: boolean; reason?: string; error?: string } | null;
  if (!response.ok || !result) throw new Error(result?.error ?? "The payment could not be sent.");
  if (!result.seat) throw new Error(`${refused[result.reason ?? ""] ?? "The seat couldn’t be booked."} Your payment was refunded.`);
  await api(`/sessions/${booking.roomId}/enter`, { name, accountId, challenge, signed });
}

/** A seat already held, on a device that isn't in yet: one passkey touch proves the account. */
export async function enterSession(accountId: string, roomId: string, name: string) {
  const { challenge } = await api<{ challenge: string }>(`/sessions/${roomId}/challenge`, { accountId });
  await api(`/sessions/${roomId}/enter`, { name, proof: await proveAccount(accountId, challenge) });
}

export type ListingTerms = { name: string; fee: string; startsAt: number; minutes: number; seats: number; market?: string };

export async function listSession(accountId: string, terms: ListingTerms) {
  const { challenge } = await api<{ challenge: string }>("/sessions/challenge", { accountId });
  return api<{ roomId: string; record: TrackRecord }>("/sessions", { ...terms, proof: await proveAccount(accountId, challenge) });
}
