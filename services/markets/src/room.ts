import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import { command, defaultChartView, displayName, id, roomCanceledCode, roomDeletedCode, roomEndedCode, roomSetup, type ChartPresentation, type Command, type Item, type Member, type Mutation, type RoomEvent } from '@fourfivex/markets-protocol/protocol';
import { isMarket, type Market } from '@fourfivex/markets-protocol/markets';
import type { Env } from './env';
import { body, digest, errorResponse, HttpError, json } from './http';
import { RoomBooking, type NewBooking } from './booking';
import { RoomVoice } from './voice';

type Ending = 'deleted' | 'expired' | 'canceled';
const endings = {
  deleted: { code: roomDeletedCode, reason: 'Room deleted', message: 'This room was deleted' },
  expired: { code: roomEndedCode, reason: 'Room ended', message: 'This room has ended' },
  canceled: { code: roomCanceledCode, reason: 'Session canceled', message: 'This session was canceled. Every seat is refunded' },
} as const;
type Meta = { room: string; account: string; ends_at: number; ended: Ending | null };

type SocketData = { identity: string; member: string; expires: number; lastTransient?: number; lastCamera?: number; lastSettledCamera?: number };

export class TradingRoom extends DurableObject<Env> {
  private sql = this.ctx.storage.sql;
  private voice: RoomVoice;
  private booking: RoomBooking;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS members (identity TEXT PRIMARY KEY, id TEXT UNIQUE, name TEXT, role TEXT, revoked INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS invites (hash TEXT PRIMARY KEY, role TEXT, expires INTEGER);
      CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, payload TEXT);
      CREATE TABLE IF NOT EXISTS operations (member TEXT, op TEXT, PRIMARY KEY(member, op));
      CREATE TABLE IF NOT EXISTS chart_view (slot INTEGER PRIMARY KEY CHECK (slot = 1), payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS room_meta (slot INTEGER PRIMARY KEY CHECK (slot = 1), room TEXT NOT NULL, account TEXT NOT NULL,
        ends_at INTEGER NOT NULL, ended TEXT);
      CREATE TABLE IF NOT EXISTS devices (identity TEXT PRIMARY KEY, member TEXT NOT NULL);
    `);
    // A member of a paid session is an account, which can come back on any device it signs in on.
    if (!this.sql.exec("SELECT 1 FROM pragma_table_info('members') WHERE name = 'account'").toArray().length) {
      this.sql.exec('ALTER TABLE members ADD COLUMN account TEXT');
    }
    this.voice = new RoomVoice(ctx.storage, env);
    this.booking = new RoomBooking(ctx.storage, env, {
      hostOnline: () => {
        const owner = this.owner();
        return Boolean(owner) && this.ctx.getWebSockets(owner!).some(socket => socket.readyState === WebSocket.OPEN);
      },
      broadcast: event => this.broadcast(event),
      cancelRoom: async () => { await this.end('canceled'); },
    });
  }

  async alarm() {
    await this.voice.retryRevocations();
    const meta = this.meta();
    if (!await this.ending() && meta) await this.endAt(meta.ends_at);
    const next = await this.booking.tick(Date.now());
    if (next !== undefined) await this.endAt(next);
  }

  private owner() {
    return this.sql.exec<{ id: string }>("SELECT id FROM members WHERE role = 'owner' AND revoked = 0").toArray()[0]?.id;
  }

  private meta() {
    return this.sql.exec<Meta>('SELECT room, account, ends_at, ended FROM room_meta WHERE slot = 1').toArray()[0];
  }

  /** Keeps an alarm set for the earliest thing the room has to do: its end, a voice retry, or a session step. */
  private async endAt(endsAt: number) {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > endsAt) await this.ctx.storage.setAlarm(endsAt);
  }

  /**
   * Why the room is over, if it is, ending it first if its hour is up. A room made before rooms had an hour
   * has no end time and ends the first time anyone reaches it.
   */
  private async ending(): Promise<Ending | undefined> {
    const meta = this.meta();
    if (meta?.ended) return meta.ended;
    if (!this.sql.exec('SELECT 1 FROM members LIMIT 1').toArray().length) return;
    if (meta && meta.ends_at > Date.now()) return;
    await this.end('expired');
    return 'expired';
  }

  /**
   * Ends the room for everyone. Everything people made goes. Member rows stay, nameless and revoked, only so a
   * voice removal that fails can be retried by the alarm; nobody can use them, because every request gets a 410.
   */
  private async end(reason: Ending) {
    const meta = this.meta();
    const everyone = this.members().map(member => member.id);
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("INSERT INTO room_meta VALUES (1, '', '', 0, ?) ON CONFLICT(slot) DO UPDATE SET ended = excluded.ended", reason);
      for (const table of ['items', 'operations', 'invites', 'chart_view', 'fills']) this.sql.exec(`DELETE FROM ${table}`);
      this.sql.exec("UPDATE members SET revoked = 1, name = ''");
    });
    for (const socket of this.ctx.getWebSockets()) socket.close(endings[reason].code, endings[reason].reason);
    // Frees the account to open another room. If this fails, the account waits until the hour is up instead.
    if (meta?.account) await this.env.OWNERS.getByName(meta.account).release(meta.room).catch(() => {});
    const removed = await Promise.all(everyone.map(member => this.voice.revoke(member)));
    return { voicePending: removed.includes(false) };
  }

  private member(identity: string) {
    const row = this.sql.exec(`SELECT id, name, role FROM members WHERE revoked = 0 AND (identity = ?
      OR id = (SELECT member FROM devices WHERE identity = ?))`, identity, identity).toArray()[0];
    return row as Member | undefined;
  }

  /** The account behind a device, even after the room ended, for a buyer reporting a problem. */
  private accountOf(identity: string) {
    return this.sql.exec<{ account: string }>(`SELECT account FROM members WHERE account IS NOT NULL AND (identity = ?
      OR id = (SELECT member FROM devices WHERE identity = ?))`, identity, identity).toArray()[0]?.account;
  }

  private members() {
    return this.sql.exec('SELECT id, name, role FROM members WHERE revoked = 0 ORDER BY rowid').toArray() as Member[];
  }

  private send(socket: WebSocket, event: RoomEvent) {
    try { socket.send(JSON.stringify(event)); } catch {}
  }

  private broadcast(event: RoomEvent, skip?: WebSocket) {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketData;
      if (attachment.expires <= Date.now()) socket.close(1008, 'Session expired');
      else if (socket !== skip) this.send(socket, event);
    }
  }

  private presentation(): ChartPresentation {
    const row = this.sql.exec('SELECT payload FROM chart_view WHERE slot = 1').toArray()[0];
    if (row) {
      const presentation = JSON.parse(String(row.payload)) as ChartPresentation;
      if (isMarket(presentation.view.market)) return presentation;
      return { ...presentation, view: { ...presentation.view, market: defaultChartView.market, camera: null } };
    }
    const owner = this.sql.exec("SELECT id FROM members WHERE role = 'owner' AND revoked = 0").one();
    return { presenter: String(owner.id), view: defaultChartView };
  }

  private savePresentation(value: ChartPresentation) {
    this.sql.exec('INSERT INTO chart_view VALUES (1, ?) ON CONFLICT(slot) DO UPDATE SET payload = excluded.payload', JSON.stringify(value));
  }

  private chartMessage(socket: WebSocket, attachment: SocketData, me: Member,
    message: Extract<Command, { type: 'chart-settings' | 'chart-camera' | 'chart-presenter' }>) {
    const presentation = this.presentation();
    if (message.type === 'chart-presenter') {
      const member = this.members().find(item => item.id === message.member);
      if (me.role !== 'owner' || !member || member.role === 'viewer') {
        this.send(socket, { type: 'error', error: 'Only the owner can give chart control to an editor.' });
        return;
      }
      if (member.id === presentation.presenter) return;
      const next = { ...presentation, presenter: member.id };
      this.savePresentation(next);
      this.broadcast({ type: 'chart-presentation', presentation: next });
      return;
    }
    if (me.id !== presentation.presenter || me.role === 'viewer') return;
    const { view } = presentation;
    if (message.type === 'chart-settings') {
      const next = { ...view, ...message.settings };
      if (next.market === view.market && next.interval === view.interval && next.scale === view.scale) return;
      if (next.market !== view.market || next.interval !== view.interval) next.camera = null;
      const updated = { ...presentation, view: next };
      this.savePresentation(updated);
      this.broadcast({ type: 'chart-presentation', presentation: updated });
      return;
    }
    if (message.market !== view.market || message.interval !== view.interval) return;
    const now = Date.now();
    const lastUpdate = message.settled ? attachment.lastSettledCamera : attachment.lastCamera;
    if (now - (lastUpdate ?? 0) < (message.settled ? 180 : 70)) return;
    socket.serializeAttachment({ ...attachment, [message.settled ? 'lastSettledCamera' : 'lastCamera']: now });
    if (message.settled) this.savePresentation({ ...presentation, view: { ...view, camera: message.camera } });
    this.broadcast({ type: 'chart-camera', market: view.market, interval: view.interval, camera: message.camera }, socket);
  }

  private presence() {
    const online = this.ctx.getWebSockets().filter(socket => socket.readyState === WebSocket.OPEN)
      .map(socket => (socket.deserializeAttachment() as SocketData).member);
    this.broadcast({ type: 'presence', online: [...new Set(online)] });
  }

  async fetch(request: Request): Promise<Response> {
    try { return await this.route(request); } catch (error) { return errorResponse(error); }
  }

  private async route(request: Request) {
    const path = new URL(request.url).pathname;
    const identity = request.headers.get('x-fourfivex-identity');
    if (!identity) throw new HttpError(401, 'Session required.');
    // A paid session's booking outlives its room: the link shows how it settled, and buyers can report a problem.
    if (path === '/booking') return json(await this.booking.view(request.headers.get('x-fourfivex-account') ?? undefined));
    if (path === '/report') {
      const { text } = await body(request, z.object({ text: z.string().trim().min(1).max(500) }));
      const account = this.accountOf(identity);
      const row = this.booking.get();
      if (!row || !account || account === row.host_account) throw new HttpError(403, 'Only a buyer in this session can report a problem.');
      this.booking.report(account, text);
      return json({ ok: true });
    }
    const over = await this.ending();
    if (over) throw new HttpError(410, endings[over].message);
    if (path === '/create-session') {
      const { name, market, booking } = await request.json() as { name: string; market?: Market; booking: NewBooking };
      if (this.meta() || this.sql.exec('SELECT 1 FROM members LIMIT 1').toArray().length) throw new HttpError(409, 'Room already exists.');
      await this.booking.create(booking);
      const owner = crypto.randomUUID();
      this.ctx.storage.transactionSync(() => {
        this.sql.exec('INSERT INTO room_meta VALUES (1, ?, ?, ?, NULL)', booking.room, booking.host_account, booking.ends_at);
        this.sql.exec('INSERT INTO members (identity, id, name, role, account) VALUES (?, ?, ?, ?, ?)', identity, owner, name, 'owner', booking.host_account);
        if (market) this.savePresentation({ presenter: owner, view: { ...defaultChartView, market } });
      });
      await this.endAt(booking.starts_at);
      return json({ ok: true });
    }
    if (path === '/enter') return this.enter(request, identity);
    if (path === '/create') {
      const { name, market } = await body(request, roomSetup);
      const room = request.headers.get('x-fourfivex-room');
      const account = request.headers.get('x-fourfivex-account');
      const endsAt = Number(request.headers.get('x-fourfivex-ends'));
      if (!room || !account || !(endsAt > Date.now())) throw new HttpError(400, 'Room details are missing.');
      if (this.meta() || this.sql.exec('SELECT 1 FROM members LIMIT 1').toArray().length) throw new HttpError(409, 'Room already exists.');
      const owner = crypto.randomUUID();
      this.ctx.storage.transactionSync(() => {
        this.sql.exec('INSERT INTO room_meta VALUES (1, ?, ?, ?, NULL)', room, account, endsAt);
        this.sql.exec('INSERT INTO members (identity, id, name, role) VALUES (?, ?, ?, ?)', identity, owner, name, 'owner');
        if (market) this.savePresentation({ presenter: owner, view: { ...defaultChartView, market } });
      });
      await this.endAt(endsAt);
      return json({ ok: true });
    }
    if (path === '/join') {
      if (this.booking.get()) throw new HttpError(403, 'Seats in this session are paid. Open its booking link.');
      const { name, token } = await body(request, z.object({ name: displayName, token: id }));
      const hash = await digest(token);
      this.ctx.storage.transactionSync(() => {
        const existing = this.sql.exec('SELECT revoked FROM members WHERE identity = ?', identity).toArray()[0];
        if (existing?.revoked) throw new HttpError(403, 'Room access was removed.');
        if (existing) return;
        const invite = this.sql.exec('SELECT role FROM invites WHERE hash = ? AND expires > ?', hash, Date.now()).toArray()[0];
        if (!invite) throw new HttpError(404, 'This invite expired, was revoked, or has already been used.');
        if (this.members().length >= 8) throw new HttpError(409, 'This room is full.');
        this.sql.exec('INSERT INTO members (identity, id, name, role) VALUES (?, ?, ?, ?)', identity, crypto.randomUUID(), name, invite.role);
        this.sql.exec('DELETE FROM invites WHERE hash = ?', hash);
      });
      this.broadcast({ type: 'members', members: this.members() });
      return json({ ok: true });
    }
    const me = this.member(identity);
    if (!me) throw new HttpError(403, 'You need a room invite.');
    if (path === '/membership') return json(me);
    if (path === '/voice') {
      const expires = Number(request.headers.get('x-fourfivex-expires'));
      return json(await this.voice.issue(() => this.member(identity), expires));
    }
    if (path === '/socket') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') throw new HttpError(426, 'WebSocket required.');
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server, [me.id]);
      server.serializeAttachment({ identity, member: me.id, expires: Number(request.headers.get('x-fourfivex-expires')) } satisfies SocketData);
      const items = this.sql.exec('SELECT payload FROM items ORDER BY rowid').toArray().map(row => JSON.parse(String(row.payload)) as Item)
        .filter(item => item.data !== null && isMarket(item.market));
      const booking = this.booking.get();
      const session = booking && { startsAt: booking.starts_at, endsAt: booking.ends_at, host: booking.host_name, fills: this.booking.recentFills() };
      this.send(server, { type: 'snapshot', room: {
        me, members: this.members(), items, presentation: this.presentation(), endsAt: this.meta()!.ends_at, ...(session && { session }),
      } });
      if (request.headers.get('x-fourfivex-reconnect') === '1') console.log('room_reconnected');
      this.presence();
      const protocol = request.headers.get('Sec-WebSocket-Protocol');
      return new Response(null, { status: 101, webSocket: client, headers: protocol ? { 'Sec-WebSocket-Protocol': protocol } : undefined });
    }
    if (me.role !== 'owner') throw new HttpError(403, 'Only the owner can manage access.');
    if (path === '/invites') {
      return json(this.sql.exec('SELECT hash AS inviteId, role, expires FROM invites WHERE expires > ? ORDER BY expires', Date.now()).toArray());
    }
    if (path === '/invite') {
      if (this.booking.get()) throw new HttpError(400, 'Seats in this session are paid. Share its booking link instead.');
      const { role } = await body(request, z.object({ role: z.enum(['editor', 'viewer']) }));
      const token = crypto.randomUUID();
      const hash = await digest(token);
      this.sql.exec('DELETE FROM invites WHERE expires <= ?', Date.now());
      if (this.sql.exec('SELECT COUNT(*) AS count FROM invites').one().count as number >= 32) {
        throw new HttpError(429, 'Revoke an unused invite before creating another.');
      }
      // An invite is good until the room ends, and only once.
      this.sql.exec('INSERT INTO invites VALUES (?, ?, ?)', hash, role, this.meta()!.ends_at);
      return json({ token });
    }
    if (path === '/invite/revoke') {
      const { inviteId } = await body(request, z.object({ inviteId: z.string().regex(/^[a-f0-9]{64}$/) }));
      this.sql.exec('DELETE FROM invites WHERE hash = ?', inviteId);
      return json({ ok: true });
    }
    if (path === '/delete') {
      if (!this.booking.get()) return json({ ok: true, ...await this.end('deleted') });
      // Canceling a paid session refunds every seat. The alarm retries any refund that doesn't go through now.
      await this.booking.cancel('host_canceled');
      await this.endAt(Date.now() + 15_000);
      return json({ ok: true });
    }
    if (path === '/members/revoke') {
      const { member } = await body(request, z.object({ member: id }));
      if (member === me.id) throw new HttpError(400, 'The owner cannot be removed.');
      const paid = this.booking.get() ? this.booking.seatOfMember(member) : undefined;
      this.sql.exec('UPDATE members SET revoked = 1 WHERE id = ?', member);
      for (const socket of this.ctx.getWebSockets(member)) socket.close(1008, 'Room access removed');
      this.broadcast({ type: 'members', members: this.members() });
      const presentation = this.presentation();
      if (presentation.presenter === member) {
        const updated = { ...presentation, presenter: me.id };
        this.savePresentation(updated);
        this.broadcast({ type: 'chart-presentation', presentation: updated });
      }
      const voicePending = !(await this.voice.revoke(member));
      // Taking a paid seat away refunds it. The host can't keep the fee of someone they removed.
      if (paid) {
        await this.booking.remove(paid.account);
        await this.endAt(Date.now() + 15_000);
      }
      return json({ ok: true, voicePending });
    }
    throw new HttpError(404, 'Unknown room endpoint.');
  }

  /** Lets a device into a paid session for an account the service has already proven. NEAR decides whether it has a seat. */
  private async enter(request: Request, identity: string) {
    const { name } = await body(request, z.object({ name: displayName }));
    const account = request.headers.get('x-fourfivex-account');
    const row = this.booking.get();
    if (!row || !account) throw new HttpError(404, 'This room has no paid session.');
    const bind = (member: string) => {
      const current = this.member(identity);
      if (current && current.id !== member) throw new HttpError(409, 'This device is already in this room as someone else.');
      if (!current) this.sql.exec('INSERT INTO devices VALUES (?, ?) ON CONFLICT(identity) DO UPDATE SET member = excluded.member', identity, member);
    };
    if (account === row.host_account) {
      this.ctx.storage.transactionSync(() => bind(this.owner()!));
      return json({ ok: true, role: 'owner' });
    }
    const seat = this.booking.seat(account);
    if (seat?.reason === 'removed') throw new HttpError(403, 'You were removed from this session. Your fee is refunded.');
    if (!await this.booking.entitled(account)) throw new HttpError(402, 'This account has no seat in this session.');
    this.ctx.storage.transactionSync(() => {
      if (seat?.member) return bind(seat.member);
      if (this.sql.exec('SELECT 1 FROM members WHERE identity = ?', identity).toArray().length) {
        throw new HttpError(409, 'This device is already in this room as someone else.');
      }
      const member = crypto.randomUUID();
      this.sql.exec('INSERT INTO members (identity, id, name, role, account) VALUES (?, ?, ?, ?, ?)', identity, member, name, 'viewer', account);
      this.booking.bindSeat(account, member);
    });
    this.broadcast({ type: 'members', members: this.members() });
    return json({ ok: true, role: 'viewer' });
  }

  async webSocketMessage(socket: WebSocket, data: string | ArrayBuffer) {
    if (typeof data !== 'string' || data.length > 4096) { socket.close(1009, 'Message too large'); return; }
    if (await this.ending()) return;
    const attachment = socket.deserializeAttachment() as SocketData;
    const me = this.member(attachment.identity);
    if (!me || attachment.expires <= Date.now()) { socket.close(1008, 'Room access ended'); return; }
    let message;
    try { message = command.parse(JSON.parse(data)); }
    catch { this.send(socket, { type: 'error', error: 'Invalid room message.' }); return; }
    if (message.type === 'chart-settings' || message.type === 'chart-camera' || message.type === 'chart-presenter') {
      this.chartMessage(socket, attachment, me, message);
      return;
    }
    if (message.type !== 'edit') {
      if (message.type === 'preview' && me.role === 'viewer') return;
      if (Date.now() - (attachment.lastTransient ?? 0) < 60 && message.point !== null) return;
      socket.serializeAttachment({ ...attachment, lastTransient: Date.now() });
      this.broadcast({ ...message, member: me.id }, socket);
      return;
    }
    if (me.role === 'viewer') {
      this.send(socket, { type: 'ack', op: message.op, error: 'Viewers cannot edit the room.' });
      return;
    }
    const started = Date.now();
    try {
      const result = this.commit(me, message.op, message.change);
      this.send(socket, { type: 'ack', op: message.op, ...result });
      if (result.item && !result.error && Math.random() < .1) console.log('room_edit_ack_ms', Date.now() - started);
      if (result.item && !result.error) this.broadcast({ type: 'change', item: result.item });
    } catch {
      this.send(socket, { type: 'ack', op: message.op, error: 'The edit could not be saved.' });
    }
  }

  private commit(me: Member, op: string, change: Mutation): { item?: Item; error?: string } {
    return this.ctx.storage.transactionSync(() => {
      if (this.sql.exec('SELECT 1 FROM operations WHERE member = ? AND op = ?', me.id, op).toArray().length) return {};
      const row = this.sql.exec('SELECT payload FROM items WHERE id = ?', change.id).toArray()[0];
      const current = row ? JSON.parse(String(row.payload)) as Item : undefined;
      if ((current?.revision ?? 0) !== change.expected || (current && (current.kind !== change.kind || current.market !== change.market))) {
        return { item: current && isMarket(current.market) ? current : undefined, error: 'Someone edited this first. Review the latest version and try again.' };
      }
      if (!current && Number(this.sql.exec("SELECT COUNT(*) AS count FROM items WHERE json_extract(payload, '$.market') LIKE 'hyperliquid:%'").one().count) >= 300) {
        return { error: 'This room has reached its item limit.' };
      }
      if (change.kind === 'comment' && change.data.levelId) {
        const target = this.sql.exec('SELECT payload FROM items WHERE id = ?', change.data.levelId).toArray()[0];
        const level = target && JSON.parse(String(target.payload)) as Item;
        if (!level || level.kind !== 'level' || !level.data || level.market !== change.market) return { error: 'That price level is no longer available.' };
      }
      const item = { ...change, revision: change.expected + 1, author: me.id, updatedAt: Date.now() };
      const payload = JSON.stringify(item);
      this.sql.exec('INSERT INTO items VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload', item.id, payload);
      this.sql.exec('INSERT INTO operations VALUES (?, ?)', me.id, op);
      return { item };
    });
  }

  webSocketClose(socket: WebSocket, code: number, reason: string) {
    const attachment = socket.deserializeAttachment() as SocketData;
    socket.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    this.broadcast({ type: 'pointer', point: null, member: attachment.member }, socket);
    this.presence();
  }
  webSocketError(socket: WebSocket) { socket.close(1011, 'Connection interrupted'); }
}
