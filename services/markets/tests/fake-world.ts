/**
 * MOCK. A stand-in for NEAR (the verifier, Chain Signatures and the room escrow) and Hyperliquid's info API,
 * for the Worker's tests only. The escrow here follows services/room-escrow's rules; the real contract is tested
 * against the real verifier code in services/room-escrow/tests/sandbox.test.ts. Nothing here talks to a network.
 */
import { keccak_256 } from '@noble/hashes/sha3.js';
import { vi } from 'vitest';
import { base58Decode, base58Encode } from '../src/passkey';
import type { Fill } from '../src/hyperliquid';

export const nearRpc = 'https://near-rpc.test';
export const hyperliquid = 'https://hyperliquid.test/info';
export const escrowId = 'room-escrow.fourfivex.near';
export const settlerId = 'room-settler.fourfivex.near';
export const token = 'nep141:usdc.test';
const encoder = new TextEncoder();

type Terms = { host: string; price: string; seats: number; booking_closes: number; ends_at: number; release_after: number; refund_after: number };
type SeatState = 'paid' | 'releasing' | 'released' | 'refunding' | 'refunded';
type Seat = { amount: string; state: SeatState; paid_at: number };

/** The room escrow's rules, kept in memory. */
export class FakeEscrow {
  sessions = new Map<string, { terms: Terms; sold: number; canceled: boolean; payers: string[] }>();
  seats = new Map<string, Seat>();
  /** Calls the settler made, in order. */
  calls: { method: string; args: Record<string, unknown> }[] = [];
  /** How many of the next payouts or refunds should fail on NEAR's side, like a paused verifier. */
  failing = { release: 0, refund: 0 };
  /** What each account holds inside the verifier, beyond what it started with. */
  balances = new Map<string, number>();

  private credit(account: string, amount: string) {
    this.balances.set(account, (this.balances.get(account) ?? 0) + Number(amount));
  }

  /** What the verifier does with a transfer to the escrow: a seat, or the payment straight back. */
  pay(session: string, payer: string, amount: string): 'seat' | string {
    const entry = this.sessions.get(session);
    const key = `${session}/${payer}`;
    const reason = !entry ? 'unknown_session' : entry.canceled ? 'canceled' : Date.now() >= entry.terms.booking_closes ? 'booking_closed'
      : payer === entry.terms.host ? 'host' : amount !== entry.terms.price ? 'wrong_amount'
        : this.seats.get(key) && this.seats.get(key)!.state !== 'refunded' ? 'duplicate' : entry.sold >= entry.terms.seats ? 'sold_out' : undefined;
    if (reason) return reason;
    if (!this.seats.has(key)) entry!.payers.push(payer);
    entry!.sold += 1;
    this.seats.set(key, { amount, state: 'paid', paid_at: Date.now() });
    this.credit(payer, `-${amount}`);
    return 'seat';
  }

  view(method: string, args: Record<string, string>) {
    if (method === 'session') return this.sessions.get(args.id) ?? null;
    if (method === 'seat') return this.seats.get(`${args.session}/${args.payer}`) ?? null;
    if (method === 'seats') {
      return (this.sessions.get(args.session)?.payers ?? []).map(payer => [payer, this.seats.get(`${args.session}/${payer}`)]);
    }
    throw new Error(`Unknown escrow view ${method}`);
  }

  call(method: string, args: Record<string, unknown>): { value?: unknown; failure?: string } {
    this.calls.push({ method, args });
    if (method === 'open_session') {
      const id = String(args.id);
      if (this.sessions.has(id)) return { failure: 'Session already exists' };
      this.sessions.set(id, { terms: args.terms as Terms, sold: 0, canceled: false, payers: [] });
      return {};
    }
    if (method === 'cancel_session') {
      this.sessions.get(String(args.id))!.canceled = true;
      return {};
    }
    const session = this.sessions.get(String(args.session));
    const seat = this.seats.get(`${args.session}/${args.payer}`);
    if (!session || !seat) return { failure: 'Unknown seat' };
    if (seat.state !== 'paid') return { failure: 'This seat is already settled or settling' };
    if (method === 'release') {
      if (session.canceled) return { failure: 'Session was canceled' };
      if (Date.now() < session.terms.release_after) return { failure: 'Too early to pay the host' };
      if (this.failing.release > 0) { this.failing.release--; return { value: false }; }
      seat.state = 'released';
      this.credit(session.terms.host, seat.amount);
      return { value: true };
    }
    if (method === 'refund') {
      if (this.failing.refund > 0) { this.failing.refund--; return { value: false }; }
      seat.state = 'refunded';
      session.sold -= 1;
      this.credit(String(args.payer), seat.amount);
      return { value: true };
    }
    return { failure: `Unknown method ${method}` };
  }
}

class Reader {
  private offset = 0;
  constructor(private bytes: Uint8Array) {}
  take(length: number) { const out = this.bytes.slice(this.offset, this.offset + length); this.offset += length; return out; }
  u8() { return this.take(1)[0]; }
  u32() { return new DataView(this.take(4).buffer).getUint32(0, true); }
  u64() { return new DataView(this.take(8).buffer).getBigUint64(0, true); }
  string() { return new TextDecoder().decode(this.take(this.u32())); }
}

/** Reads the one function call in a signed transaction, as NEAR would. */
function functionCall(signedBase64: string) {
  const reader = new Reader(Uint8Array.from(atob(signedBase64), char => char.charCodeAt(0)));
  const signer = reader.string();
  reader.u8(); reader.take(32);
  reader.u64();
  const receiver = reader.string();
  reader.take(32);
  if (reader.u32() !== 1 || reader.u8() !== 2) throw new Error('Expected one function call.');
  const method = reader.string();
  const args = JSON.parse(new TextDecoder().decode(reader.take(reader.u32())));
  return { signer, receiver, method, args };
}

/** The point Chain Signatures would derive for an account. Only its hash matters to the service. */
const derivedPoint = (account: string) => {
  const first = keccak_256(encoder.encode(`point:${account}`));
  return new Uint8Array([...first, ...keccak_256(first)]);
};

export function addressOf(account: string): `0x${string}` {
  return `0x${Array.from(keccak_256(derivedPoint(account)).slice(-20), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

const result = (value: unknown) => ({ result: { result: Array.from(encoder.encode(JSON.stringify(value))) } });

export class FakeWorld {
  escrow = new FakeEscrow();
  /** Passkeys the verifier lists for each account. */
  keys = new Map<string, Set<string>>();
  fills = new Map<string, Fill[]>();
  funding = new Map<string, { time: number; delta: { type: string; usdc: string } }[]>();
  hyperliquidDown = false;
  nearDown = false;

  own(account: string, publicKey: string) {
    if (!this.keys.has(account)) this.keys.set(account, new Set());
    this.keys.get(account)!.add(publicKey);
  }

  addFills(account: string, fills: Fill[]) {
    const address = addressOf(account);
    this.fills.set(address, [...this.fills.get(address) ?? [], ...fills].sort((a, b) => a.time - b.time));
  }

  private near(body: { method: string; params: Record<string, string> }) {
    if (this.nearDown) return Response.json({ error: { name: 'TIMEOUT_ERROR' } });
    const { method, params } = body;
    if (method === 'block') return Response.json({ result: { header: { hash: base58Encode(new Uint8Array(32).fill(7)) } } });
    if (method === 'query' && params.request_type === 'view_access_key') return Response.json({ result: { nonce: 0 } });
    if (method === 'query' && params.request_type === 'call_function') {
      const args = JSON.parse(atob(params.args_base64));
      if (params.account_id === 'intents.near' && params.method_name === 'has_public_key') {
        return Response.json(result(this.keys.get(args.account_id)?.has(args.public_key) ?? false));
      }
      if (params.method_name === 'derived_public_key') {
        if (params.account_id !== 'v1.signer' || args.predecessor !== 'trading-signer.fourfivex.near'
          || !String(args.path).startsWith('fourfivex:hyperliquid:v1:')) throw new Error('Unexpected derivation.');
        return Response.json(result(`secp256k1:${base58Encode(derivedPoint(String(args.path).split(':').at(-1)!))}`));
      }
      if (params.account_id === escrowId) return Response.json(result(this.escrow.view(params.method_name, args)));
    }
    if (method === 'send_tx') {
      const call = functionCall(params.signed_tx_base64);
      if (call.signer !== settlerId || call.receiver !== escrowId) throw new Error('Only the settler signs, only for the escrow.');
      const outcome = this.escrow.call(call.method, call.args);
      const status = outcome.failure !== undefined
        ? { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: `Smart contract panicked: ${outcome.failure}` } } } } }
        : { SuccessValue: outcome.value === undefined ? '' : btoa(JSON.stringify(outcome.value)) };
      return Response.json({ result: { status, transaction_outcome: { outcome: { logs: [] } }, receipts_outcome: [] } });
    }
    throw new Error(`Unexpected NEAR request ${method} ${JSON.stringify(params).slice(0, 120)}`);
  }

  private hyperliquid(body: { type: string; user: string; startTime: number; endTime?: number }) {
    if (this.hyperliquidDown) return new Response('down', { status: 502 });
    const within = <T extends { time: number }>(rows: T[]) => rows.filter(row => row.time >= body.startTime && row.time <= (body.endTime ?? Infinity));
    if (body.type === 'userFillsByTime') return Response.json(within(this.fills.get(body.user) ?? []).slice(0, 2000));
    if (body.type === 'userFunding') return Response.json(within(this.funding.get(body.user) ?? []).slice(0, 500));
    throw new Error(`Unexpected Hyperliquid request ${body.type}`);
  }

  /** Answers every outside request the Worker makes, until `uninstall`. */
  install() {
    vi.stubGlobal('fetch', async (input: string | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;
      const text = typeof input === 'string' ? String(init?.body) : await input.text();
      if (url === nearRpc) return this.near(JSON.parse(text));
      if (url === hyperliquid) return this.hyperliquid(JSON.parse(text));
      if (url.startsWith('https://api.cloudflare.com/')) return Response.json({ success: true, data: { id: 'voice', token: 'voice', expires_on: new Date(Date.now() + 60_000).toISOString() } });
      throw new Error(`Unexpected request to ${url}`);
    });
  }

  uninstall() {
    vi.unstubAllGlobals();
  }
}

/** A fill as Hyperliquid reports it, with the parts the service reads. */
export function fill(time: number, overrides: Partial<Fill> = {}): Fill {
  return {
    coin: 'BTC', px: '100000', sz: '0.01', side: 'B', time, dir: 'Open Long', closedPnl: '0', fee: '0.5',
    feeToken: 'USDC', tid: Math.floor(Math.random() * 1e12), oid: 1, hash: `0x${crypto.randomUUID().replaceAll('-', '')}`, ...overrides,
  };
}

export { base58Decode };
