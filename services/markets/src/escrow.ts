import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';
import { HttpError } from './http';
import { events, NearError, NearSigner, tgas, view, type Outcome } from './near';
import { nearRpc } from './trading-address';

/** The fee escrow on NEAR (services/room-escrow), as the markets service reads and settles it. */

export type ChainSeatState = 'paid' | 'releasing' | 'released' | 'refunding' | 'refunded';
export type ChainSeat = { amount: string; state: ChainSeatState; paid_at: number };
export type ChainTerms = {
  host: string; price: string; seats: number;
  booking_closes: number; ends_at: number; release_after: number; refund_after: number;
};
export type ChainSession = { terms: ChainTerms; sold: number; canceled: boolean; payers: string[] };
type Method = 'open_session' | 'cancel_session' | 'release' | 'refund';

export const escrowStandard = 'fourfivex_room_escrow';

export function sessionsConfigured(env: Env) {
  return Boolean(env.TRADING_SIGNER_CONTRACT && env.ROOM_ESCROW_CONTRACT && env.ROOM_ESCROW_TOKEN
    && env.ROOM_SETTLER_ACCOUNT && env.ROOM_SETTLER_KEY);
}

export function requireSessions(env: Env) {
  if (!sessionsConfigured(env)) throw new HttpError(503, 'Paid sessions are unavailable on this deployment.');
}

async function read<T>(env: Env, method: string, args: object) {
  try {
    return await view<T>(nearRpc(env), env.ROOM_ESCROW_CONTRACT!, method, args);
  } catch (error) {
    if (error instanceof NearError) throw new HttpError(503, 'NEAR could not be reached. Try again.');
    throw error;
  }
}

/** A seat as NEAR has finalized it, or null if the account never paid for one. */
export const chainSeat = (env: Env, session: string, payer: string) => read<ChainSeat | null>(env, 'seat', { session, payer });
export const chainSession = (env: Env, id: string) => read<ChainSession | null>(env, 'session', { id });
/** Every seat the session has had on chain, including payers who never opened the room. */
export const chainSeats = (env: Env, session: string) => read<[string, ChainSeat][]>(env, 'seats', { session });

/** Sends a settlement call through the one object that signs as the settler, so its nonces never collide. */
export function settle(env: Env, method: Method, args: object): Promise<Outcome> {
  return env.SETTLER.getByName('settler').call(method, args);
}

export function seatEvents(outcome: Outcome) {
  return events(outcome.logs, escrowStandard);
}

/** Signs as the settler. One instance, named "settler", handles every settlement call in order. */
export class RoomSettler extends DurableObject<Env> {
  private signer?: NearSigner;

  async call(method: Method, args: object): Promise<Outcome> {
    const { ROOM_ESCROW_CONTRACT, ROOM_SETTLER_ACCOUNT, ROOM_SETTLER_KEY } = this.env;
    if (!sessionsConfigured(this.env)) return { hash: '', failure: 'Paid sessions are unavailable on this deployment.', logs: [] };
    this.signer ??= new NearSigner(nearRpc(this.env), ROOM_SETTLER_ACCOUNT!, ROOM_SETTLER_KEY!);
    try {
      return await this.signer.call(ROOM_ESCROW_CONTRACT!, {
        method, args, gas: tgas(method === 'release' || method === 'refund' ? 60 : 30),
      });
    } catch (error) {
      return { hash: '', failure: error instanceof Error ? error.message : 'NEAR could not be reached.', logs: [] };
    }
  }
}
