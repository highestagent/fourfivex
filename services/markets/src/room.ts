import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import { command, defaultChartView, displayName, id, roomCreation, type ChartPresentation, type Command, type Item, type Member, type Mutation, type RoomEvent } from '@fourfivex/markets-protocol/protocol';
import { isMarket } from '@fourfivex/markets-protocol/markets';
import type { Env } from './env';
import { body, digest, errorResponse, HttpError, json } from './http';
import { RoomVoice } from './voice';

type SocketData = { identity: string; member: string; expires: number; lastTransient?: number; lastCamera?: number; lastSettledCamera?: number };

export class TradingRoom extends DurableObject<Env> {
  private sql = this.ctx.storage.sql;
  private voice: RoomVoice;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS members (identity TEXT PRIMARY KEY, id TEXT UNIQUE, name TEXT, role TEXT, revoked INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS invites (hash TEXT PRIMARY KEY, role TEXT, expires INTEGER);
      CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, payload TEXT);
      CREATE TABLE IF NOT EXISTS operations (member TEXT, op TEXT, PRIMARY KEY(member, op));
      CREATE TABLE IF NOT EXISTS chart_view (slot INTEGER PRIMARY KEY CHECK (slot = 1), payload TEXT NOT NULL);
    `);
    this.voice = new RoomVoice(ctx.storage, env);
  }

  async alarm() {
    await this.voice.retryRevocations();
  }

  private member(identity: string) {
    const row = this.sql.exec('SELECT id, name, role FROM members WHERE identity = ? AND revoked = 0', identity).toArray()[0];
    return row as Member | undefined;
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
    if (path === '/create') {
      const { name, market } = await body(request, roomCreation);
      if (this.sql.exec('SELECT 1 FROM members LIMIT 1').toArray().length) throw new HttpError(409, 'Room already exists.');
      const owner = crypto.randomUUID();
      this.ctx.storage.transactionSync(() => {
        this.sql.exec('INSERT INTO members (identity, id, name, role) VALUES (?, ?, ?, ?)', identity, owner, name, 'owner');
        if (market) this.savePresentation({ presenter: owner, view: { ...defaultChartView, market } });
      });
      return json({ ok: true });
    }
    if (path === '/join') {
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
      this.send(server, { type: 'snapshot', room: { me, members: this.members(), items, presentation: this.presentation() } });
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
      const { role } = await body(request, z.object({ role: z.enum(['editor', 'viewer']) }));
      const token = crypto.randomUUID();
      const hash = await digest(token);
      this.sql.exec('DELETE FROM invites WHERE expires <= ?', Date.now());
      if (this.sql.exec('SELECT COUNT(*) AS count FROM invites').one().count as number >= 32) {
        throw new HttpError(429, 'Revoke an unused invite before creating another.');
      }
      this.sql.exec('INSERT INTO invites VALUES (?, ?, ?)', hash, role, Date.now() + 24 * 3600_000);
      return json({ token });
    }
    if (path === '/invite/revoke') {
      const { inviteId } = await body(request, z.object({ inviteId: z.string().regex(/^[a-f0-9]{64}$/) }));
      this.sql.exec('DELETE FROM invites WHERE hash = ?', inviteId);
      return json({ ok: true });
    }
    if (path === '/members/revoke') {
      const { member } = await body(request, z.object({ member: id }));
      if (member === me.id) throw new HttpError(400, 'The owner cannot be removed.');
      this.sql.exec('UPDATE members SET revoked = 1 WHERE id = ?', member);
      for (const socket of this.ctx.getWebSockets(member)) socket.close(1008, 'Room access removed');
      this.broadcast({ type: 'members', members: this.members() });
      const presentation = this.presentation();
      if (presentation.presenter === member) {
        const updated = { ...presentation, presenter: me.id };
        this.savePresentation(updated);
        this.broadcast({ type: 'chart-presentation', presentation: updated });
      }
      return json({ ok: true, voicePending: !(await this.voice.revoke(member)) });
    }
    throw new HttpError(404, 'Unknown room endpoint.');
  }

  webSocketMessage(socket: WebSocket, data: string | ArrayBuffer) {
    if (typeof data !== 'string' || data.length > 4096) { socket.close(1009, 'Message too large'); return; }
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
