import { sessionRule, sessionTag, type Booking, type FeedFill, type SessionState } from '@fourfivex/markets-protocol/sessions';
import type { RoomEvent } from '@fourfivex/markets-protocol/protocol';
import { chainSeat, chainSeats, chainSession, settle, type ChainSeat, type ChainTerms } from './escrow';
import type { Env } from './env';
import { HttpError } from './http';
import { feedFill, fillsBetween } from './hyperliquid';
import { tradingAddress } from './trading-address';

const MINUTE = 60_000;
const pollEvery = 4_000;
const keptFills = 200;

type BookingState = 'scheduled' | 'live' | 'ended' | 'settling' | 'settled' | 'canceled' | 'refunded';
type Verdict = 'delivered' | 'host_absent' | 'outage' | 'canceled';
type Decision = 'release' | 'refund' | 'hold';

export type BookingRow = {
  room: string; host_account: string; host_address: string; host_name: string; fee: string; fee_units: string; seats: number;
  starts_at: number; ends_at: number; booking_closes: number; release_after: number; refund_after: number;
  record: string; state: BookingState; outcome: string | null; last_fill: number;
};
type SeatRow = { account: string; member: string | null; decision: Decision | null; reason: string | null; done: number; attempts: number; retry_at: number };

export type NewBooking = Omit<BookingRow, 'state' | 'outcome' | 'last_fill'>;

export type BookingHooks = {
  hostOnline(): boolean;
  broadcast(event: RoomEvent): void;
  /** Ends the room for everyone now, because the session was canceled. */
  cancelRoom(): Promise<void>;
};

/**
 * A paid session in a room: its booking terms, the evidence of what was delivered, the host's live fills,
 * and settling every seat with the escrow. The host can't mark anything delivered; the room records it.
 */
export class RoomBooking {
  private sql: SqlStorage;

  constructor(private storage: DurableObjectStorage, private env: Env, private hooks: BookingHooks) {
    this.sql = storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS booking (slot INTEGER PRIMARY KEY CHECK (slot = 1), room TEXT NOT NULL, host_account TEXT NOT NULL,
        host_address TEXT NOT NULL, host_name TEXT NOT NULL, fee TEXT NOT NULL, fee_units TEXT NOT NULL, seats INTEGER NOT NULL,
        starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, booking_closes INTEGER NOT NULL, release_after INTEGER NOT NULL,
        refund_after INTEGER NOT NULL, record TEXT NOT NULL, state TEXT NOT NULL, outcome TEXT, last_fill INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS seats (account TEXT PRIMARY KEY, member TEXT, decision TEXT, reason TEXT,
        done INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS evidence (minute INTEGER PRIMARY KEY, room INTEGER NOT NULL, host INTEGER NOT NULL, feed INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS fills (id TEXT PRIMARY KEY, time INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reports (account TEXT PRIMARY KEY, text TEXT NOT NULL, at INTEGER NOT NULL);
    `);
  }

  get() {
    return this.sql.exec<BookingRow>('SELECT * FROM booking WHERE slot = 1').toArray()[0];
  }

  private setState(state: BookingState, outcome?: object) {
    this.sql.exec('UPDATE booking SET state = ?, outcome = COALESCE(?, outcome) WHERE slot = 1', state, outcome ? JSON.stringify(outcome) : null);
  }

  private terms(row: Pick<BookingRow, 'host_account' | 'fee_units' | 'seats' | 'booking_closes' | 'ends_at' | 'release_after' | 'refund_after'>): ChainTerms {
    return {
      host: row.host_account, price: row.fee_units, seats: row.seats, booking_closes: row.booking_closes,
      ends_at: row.ends_at, release_after: row.release_after, refund_after: row.refund_after,
    };
  }

  /** Opens the session on the escrow, then records it here. Nothing can be paid until NEAR has it. */
  async create(row: NewBooking) {
    const opened = await settle(this.env, 'open_session', { id: row.room, terms: this.terms(row) });
    if (opened.failure !== undefined) throw new HttpError(503, 'The session could not be opened for payment. Try again.');
    this.sql.exec(`INSERT INTO booking (slot, room, host_account, host_address, host_name, fee, fee_units, seats, starts_at, ends_at,
      booking_closes, release_after, refund_after, record, state) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')`,
      row.room, row.host_account, row.host_address, row.host_name, row.fee, row.fee_units, row.seats, row.starts_at, row.ends_at,
      row.booking_closes, row.release_after, row.refund_after, row.record);
  }

  private publicState(row: BookingRow, sold: number, now: number): SessionState {
    if (row.state === 'canceled' || row.state === 'refunded') return 'canceled';
    if (row.state !== 'scheduled' && row.state !== 'live') return 'ended';
    if (now >= row.ends_at) return 'ended';
    if (now >= row.starts_at) return 'live';
    if (now >= row.booking_closes) return 'closed';
    return sold >= row.seats ? 'full' : 'open';
  }

  /** What the booking link shows. With an account, also whether it holds a seat. */
  async view(account?: string): Promise<Booking> {
    const row = this.get();
    if (!row) throw new HttpError(404, 'This room has no paid session.');
    const now = Date.now();
    const [session, seat] = await Promise.all([
      chainSession(this.env, row.room).catch(() => null),
      account && account !== row.host_account ? chainSeat(this.env, row.room, account).catch(() => null) : undefined,
    ]);
    const sold = session?.sold ?? this.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM seats WHERE decision IS NULL OR decision != 'refund'").one().count;
    const held: Booking['seat'] = account === row.host_account ? 'host'
      : seat?.state === 'paid' || seat?.state === 'releasing' ? 'paid'
        : seat?.state === 'released' ? 'released'
          : seat ? 'refunded' : undefined;
    return {
      roomId: row.room, host: row.host_name, record: JSON.parse(row.record), fee: row.fee, feeUnits: row.fee_units,
      seats: row.seats, sold, startsAt: row.starts_at, endsAt: row.ends_at, bookingCloses: row.booking_closes,
      state: this.publicState(row, sold, now), escrow: this.env.ROOM_ESCROW_CONTRACT ?? '', token: this.env.ROOM_ESCROW_TOKEN ?? '',
      ...(held && { seat: held }),
    };
  }

  /** Whether NEAR has finalized a seat for this account that still gives access. */
  async entitled(account: string): Promise<boolean> {
    const seat: ChainSeat | null = await chainSeat(this.env, this.get()!.room, account);
    return seat?.state === 'paid' || seat?.state === 'releasing' || seat?.state === 'released';
  }

  seat(account: string) {
    return this.sql.exec<SeatRow>('SELECT * FROM seats WHERE account = ?', account).toArray()[0];
  }

  seatOfMember(member: string) {
    return this.sql.exec<SeatRow>('SELECT * FROM seats WHERE member = ?', member).toArray()[0];
  }

  bindSeat(account: string, member: string) {
    this.sql.exec('INSERT INTO seats (account, member) VALUES (?, ?) ON CONFLICT(account) DO UPDATE SET member = excluded.member', account, member);
  }

  /** The host took a buyer's access away, so the buyer gets their fee back. */
  async remove(account: string) {
    this.sql.exec(`INSERT INTO seats (account, decision, reason) VALUES (?, 'refund', 'removed')
      ON CONFLICT(account) DO UPDATE SET decision = 'refund', reason = 'removed', retry_at = 0`, account);
    await this.settleSeats(Date.now());
  }

  /** A buyer reports a problem. Their fee then waits for a person to look, instead of being released on schedule. */
  report(account: string, text: string) {
    const row = this.get();
    if (!row || Date.now() >= row.release_after || !['scheduled', 'live', 'ended'].includes(row.state)) {
      throw new HttpError(409, 'Problems can be reported until 30 minutes after the session ends.');
    }
    this.sql.exec('INSERT INTO reports VALUES (?, ?, ?) ON CONFLICT(account) DO UPDATE SET text = excluded.text, at = excluded.at', account, text, Date.now());
  }

  /** Cancels the session: no more payments, and every seat is refunded. The room's alarm finishes any refund that fails. */
  async cancel(reason: 'host_canceled' | 'host_no_show') {
    const row = this.get();
    if (!row || (row.state !== 'scheduled' && row.state !== 'live')) return;
    this.setState('canceled', { verdict: 'canceled', reason });
    this.sql.exec("UPDATE seats SET decision = 'refund', reason = ?, retry_at = 0", reason);
    this.sql.exec('DELETE FROM fills');
    // Even if this fails, every seat that still gets paid is refunded.
    await settle(this.env, 'cancel_session', { id: row.room });
    await this.hooks.cancelRoom();
    await this.settleSeats(Date.now());
  }

  recentFills(): FeedFill[] {
    return this.sql.exec<{ payload: string }>('SELECT payload FROM fills ORDER BY time DESC LIMIT 50').toArray()
      .map(fill => JSON.parse(fill.payload) as FeedFill).reverse();
  }

  private record(now: number, host: boolean, feed: boolean) {
    this.sql.exec(`INSERT INTO evidence VALUES (?, 1, ?, ?) ON CONFLICT(minute) DO UPDATE SET
      host = MAX(host, excluded.host), feed = MAX(feed, excluded.feed)`, Math.floor(now / MINUTE), host ? 1 : 0, feed ? 1 : 0);
  }

  /** Reads the host's new fills from Hyperliquid and shows them to the room. */
  private async poll(row: BookingRow, now: number) {
    try {
      const { fills } = await fillsBetween(this.env, row.host_address, Math.max(row.last_fill, row.starts_at), Math.min(now, row.ends_at));
      let last = row.last_fill;
      for (const fill of fills) {
        last = Math.max(last, fill.time);
        const shown = feedFill(fill);
        if (this.sql.exec('SELECT 1 FROM fills WHERE id = ?', shown.id).toArray().length) continue;
        this.sql.exec('INSERT INTO fills VALUES (?, ?, ?)', shown.id, shown.time, JSON.stringify(shown));
        this.hooks.broadcast({ type: 'fill', fill: shown });
      }
      this.sql.exec('UPDATE booking SET last_fill = ? WHERE slot = 1', last);
      this.sql.exec('DELETE FROM fills WHERE id NOT IN (SELECT id FROM fills ORDER BY time DESC LIMIT ?)', keptFills);
      return true;
    } catch {
      return false;
    }
  }

  /** How much of the session the room, the host and the feed were there for, minute by minute. */
  shares(row: BookingRow) {
    const first = Math.floor(row.starts_at / MINUTE);
    const last = Math.ceil(row.ends_at / MINUTE) - 1;
    const minutes = Math.max(1, last - first + 1);
    const totals = this.sql.exec<{ room: number; host: number; feed: number }>(
      'SELECT COALESCE(SUM(room), 0) AS room, COALESCE(SUM(host), 0) AS host, COALESCE(SUM(feed), 0) AS feed FROM evidence WHERE minute BETWEEN ? AND ?',
      first, last).one();
    return { room: totals.room / minutes, host: totals.host / minutes, feed: totals.feed / minutes };
  }

  private verdict(row: BookingRow): { verdict: Verdict; shares: ReturnType<RoomBooking['shares']> } {
    const shares = this.shares(row);
    // Missing evidence counts against delivery: a room that wasn't recorded as up wasn't up.
    if (shares.room < sessionRule.roomUptime || shares.feed < sessionRule.roomUptime) return { verdict: 'outage', shares };
    if (shares.host < sessionRule.hostPresence) return { verdict: 'host_absent', shares };
    return { verdict: 'delivered', shares };
  }

  /** Whether the buyer traded from this session's feed: a fill on their own address carrying the session's order tag. */
  private async traded(row: BookingRow, account: string) {
    try {
      const [address, tag] = await Promise.all([tradingAddress(this.env, account), sessionTag(row.room)]);
      const { fills } = await fillsBetween(this.env, address, row.starts_at, row.release_after);
      return fills.some(fill => fill.cloid?.toLowerCase().startsWith(`0x${tag}`));
    } catch {
      return false;
    }
  }

  /** Decides every seat once the exception window is over. */
  private async decide(row: BookingRow) {
    const { verdict, shares } = this.verdict(row);
    const seats = await chainSeats(this.env, row.room);
    const reported = new Set(this.sql.exec<{ account: string }>('SELECT account FROM reports').toArray().map(report => report.account));
    const decisions: [string, Decision, string][] = [];
    for (const [account, seat] of seats) {
      if (seat.state !== 'paid' || this.seat(account)?.decision) continue;
      if (reported.has(account)) decisions.push([account, 'hold', 'reported']);
      else if (verdict === 'outage') decisions.push([account, 'refund', 'outage']);
      else if (verdict === 'delivered') decisions.push([account, 'release', 'attended']);
      else if (await this.traded(row, account)) decisions.push([account, 'release', 'traded']);
      else decisions.push([account, 'refund', 'host_absent']);
    }
    this.storage.transactionSync(() => {
      for (const [account, decision, reason] of decisions) {
        this.sql.exec(`INSERT INTO seats (account, decision, reason) VALUES (?, ?, ?)
          ON CONFLICT(account) DO UPDATE SET decision = excluded.decision, reason = excluded.reason`, account, decision, reason);
      }
      this.setState('settling', { verdict, shares });
    });
  }

  /**
   * Pays out or refunds every seat NEAR knows about, including payers who never opened the room.
   * Returns when to try again, or undefined once every seat is settled.
   */
  private async settleSeats(now: number): Promise<number | undefined> {
    const row = this.get()!;
    let seats: [string, ChainSeat][];
    try { seats = await chainSeats(this.env, row.room); } catch { return now + MINUTE; }
    const canceled = row.state === 'canceled';
    let next: number | undefined;
    const later = (time: number) => { next = Math.min(next ?? time, time); };
    for (const [account, seat] of seats) {
      if (seat.state === 'released' || seat.state === 'refunded') {
        this.sql.exec('INSERT INTO seats (account, done) VALUES (?, 1) ON CONFLICT(account) DO UPDATE SET done = 1', account);
        continue;
      }
      if (seat.state !== 'paid') { later(now + 15_000); continue; }
      let local = this.seat(account);
      if (canceled && local?.decision !== 'refund') {
        this.sql.exec(`INSERT INTO seats (account, decision, reason) VALUES (?, 'refund', 'canceled')
          ON CONFLICT(account) DO UPDATE SET decision = 'refund', reason = COALESCE(reason, 'canceled')`, account);
        local = this.seat(account);
      }
      const decision = local?.decision;
      if (!decision) { if (row.state === 'settling') later(now + MINUTE); continue; }
      if (decision === 'hold') {
        // Nobody resolved the report in time: the buyer gets their fee back before anyone else could claim it.
        const deadline = row.refund_after - 3600_000;
        if (now < deadline) { later(deadline); continue; }
        this.sql.exec("UPDATE seats SET decision = 'refund', reason = 'report_unresolved' WHERE account = ?", account);
      }
      if ((local?.retry_at ?? 0) > now) { later(local!.retry_at); continue; }
      const method = this.seat(account)!.decision === 'release' ? 'release' : 'refund';
      const outcome = await settle(this.env, method, { session: row.room, payer: account });
      if (outcome.value === true) {
        this.sql.exec('UPDATE seats SET done = 1 WHERE account = ?', account);
      } else {
        const attempts = (local?.attempts ?? 0) + 1;
        const retry = now + Math.min(3600_000, 30_000 * 2 ** Math.min(attempts, 7));
        this.sql.exec('UPDATE seats SET attempts = ?, retry_at = ? WHERE account = ?', attempts, retry, account);
        later(retry);
      }
    }
    // A canceled session can still be paid until NEAR has the cancellation, so look again after booking closes.
    if (canceled && now < row.booking_closes + MINUTE) later(row.booking_closes + MINUTE);
    return next;
  }

  /** Moves the session along. Returns when it next needs to run. */
  async tick(now: number): Promise<number | undefined> {
    let row = this.get();
    if (!row) return;
    if (row.state === 'scheduled' && now >= row.starts_at) { this.setState('live'); row = this.get()!; }
    if (row.state === 'live' && now < row.ends_at) {
      const feed = await this.poll(row, now);
      this.record(now, this.hooks.hostOnline(), feed);
      const noShow = now >= row.starts_at + sessionRule.hostGraceMinutes * MINUTE
        && !this.sql.exec('SELECT 1 FROM evidence WHERE host = 1 LIMIT 1').toArray().length;
      if (!noShow) return Math.min(now + pollEvery, row.ends_at);
      await this.cancel('host_no_show');
      row = this.get()!;
    }
    if (row.state === 'live') {
      // The session is over. Its feed was room content, so it goes with the room.
      this.sql.exec('DELETE FROM fills');
      this.setState('ended');
      row = this.get()!;
    }
    if (row.state === 'scheduled') return row.starts_at;
    if (row.state === 'ended') {
      if (now < row.release_after) return row.release_after;
      try { await this.decide(row); } catch { return now + MINUTE; }
      row = this.get()!;
    }
    if (row.state === 'settling' || row.state === 'canceled') {
      const next = await this.settleSeats(now);
      if (next !== undefined) return next;
      this.setState(row.state === 'canceled' ? 'refunded' : 'settled');
      this.sql.exec('DELETE FROM reports');
      this.sql.exec('DELETE FROM evidence');
    }
  }
}
