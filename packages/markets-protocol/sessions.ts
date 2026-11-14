import { z } from 'zod';
import { isMarket, type Market } from './markets';
import { accountProof, displayName } from './protocol';

/**
 * Paid sessions: a host with a verified trading record sells seats in a live room for a USDC fee.
 * Every rule both sides of the service need is here, so the app shows exactly what the service enforces.
 */

/** What makes a host eligible: a profitable, readable record over the stated window. */
export const recordRule = { windowDays: 30, minFills: 20, minActiveDays: 5 } as const;

export const sessionRule = {
  minFee: 1,
  maxFee: 500,
  maxSeats: 20,
  durations: [30, 60, 90, 120] as const,
  /** How soon and how far ahead a session can start. */
  minLeadMinutes: 15,
  maxLeadDays: 14,
  /** A host who hasn't joined this long after the start is a no-show, and every seat is refunded. */
  hostGraceMinutes: 10,
  /** After the session ends, buyers can report a problem for this long before fees are released. */
  exceptionMinutes: 30,
  /** If a fee is somehow never settled, anyone can refund it this long after it became payable. */
  backstopHours: 72,
  /** A buyer who only watched counts as served when the host was there and the room and feed were up this much. */
  hostPresence: 0.8,
  roomUptime: 0.9,
} as const;

/** A trade signal older than this, or a price that moved more than this since the fill, can't be used. */
export const signalRule = { maxAgeMs: 5 * 60_000, maxDriftBps: 100 } as const;

export const usdcDecimals = 6;
const usdcAmount = z.string().regex(/^\d{1,3}(\.\d{1,2})?$/)
  .refine(value => Number(value) >= sessionRule.minFee && Number(value) <= sessionRule.maxFee);

export const usdcUnits = (amount: string) => {
  const [whole, fraction = ''] = amount.split('.');
  return (BigInt(whole) * BigInt(10 ** usdcDecimals) + BigInt(fraction.padEnd(usdcDecimals, '0'))).toString();
};

export const sessionTerms = z.object({
  fee: usdcAmount,
  startsAt: z.number().int().positive(),
  minutes: z.literal(sessionRule.durations),
  seats: z.number().int().min(1).max(sessionRule.maxSeats),
});
export type SessionTerms = z.infer<typeof sessionTerms>;

/** Listing a session: the terms, the host's room name, and proof of the account they trade from. */
export const sessionListing = sessionTerms.extend({
  name: displayName,
  market: z.custom<Market>(isMarket).optional(),
  proof: accountProof,
});

export type TrackRecord = {
  /** The Hyperliquid address the host's account trades from. */
  address: `0x${string}`;
  window: { from: number; to: number; days: number };
  /** The part of the window the record could read. Hyperliquid serves only an address's most recent 10,000 fills. */
  coverage: { from: number; to: number; days: number; complete: boolean };
  fills: number;
  activeDays: number;
  /** In USDC. Net is closed P&L, less trading fees, plus funding. Open positions aren't counted. */
  realized: number;
  fees: number;
  funding: number;
  net: number;
  eligible: boolean;
  /** Why a host isn't eligible, in plain words. Empty when eligible. */
  reasons: string[];
  checkedAt: number;
};

export type SessionState = 'open' | 'full' | 'closed' | 'live' | 'ended' | 'canceled';

/** What a booking link shows anyone who opens it. */
export type Booking = {
  roomId: string;
  host: string;
  record: TrackRecord;
  fee: string;
  feeUnits: string;
  seats: number;
  sold: number;
  startsAt: number;
  endsAt: number;
  bookingCloses: number;
  state: SessionState;
  escrow: string;
  token: string;
  /** Set when the account asking holds a seat, or hosts the session. */
  seat?: 'host' | 'paid' | 'refunded' | 'released';
};

/** One of the host's own fills, as the room's live feed shows it to members. */
export type FeedFill = {
  id: string;
  market?: Market;
  coin: string;
  side: 'long' | 'short';
  /** Hyperliquid's description, such as "Open Long" or "Close Short". */
  dir: string;
  opening: boolean;
  price: string;
  size: string;
  time: number;
};

/** The Hyperliquid market a fill's coin trades on, when it's one the app knows. */
export function fillMarket(coin: string): Market | undefined {
  const market = coin.startsWith('@') || coin.includes('/') ? `hyperliquid:spot:${coin}` : `hyperliquid:perp:${coin}`;
  return isMarket(market) ? market : undefined;
}

const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

/** The first half of every order ID placed from a session's feed, so a follower's fill can be tied to that session. */
export async function sessionTag(roomId: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`fourfivex:session:${roomId}`)));
  return hex(digest.slice(0, 8));
}

/** A Hyperliquid client order ID for a trade placed from a session's feed. */
export async function signalOrderId(roomId: string): Promise<`0x${string}`> {
  return `0x${await sessionTag(roomId)}${hex(crypto.getRandomValues(new Uint8Array(8)))}`;
}

/** Why a signal can't be traded any more, or undefined if it still can. */
export function signalProblem(fill: { price: string; time: number }, mark: number, now = Date.now()) {
  if (now - fill.time > signalRule.maxAgeMs) return 'This trade is more than 5 minutes old.';
  const drift = Math.abs(mark - Number(fill.price)) / Number(fill.price) * 10_000;
  if (!Number.isFinite(drift) || drift > signalRule.maxDriftBps) return 'The price has moved more than 1% since this fill.';
}

/** A passkey-signed NEAR Intents payload, as the browser sends it to the relay and the markets service. */
export const signedPayload = z.object({
  standard: z.literal('webauthn'),
  payload: z.string().max(2000),
  public_key: z.string().max(120),
  signature: z.string().max(120),
  client_data_json: z.string().max(1024),
  authenticator_data: z.string().max(512),
});
