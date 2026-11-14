import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { describe, expect, test, vi } from 'vitest';
import { defaultMarket } from '@fourfivex/markets-protocol/markets';
import type { Env } from '../src/env';
import type { RoomEvent } from '@fourfivex/markets-protocol/protocol';

const worker = (exports as unknown as { default: Fetcher }).default;

const origin = 'https://fourfivex.test';
function request(path: string, payload?: object, cookie?: string) {
  return worker.fetch(origin + '/api/markets' + path, {
    method: payload ? 'POST' : 'GET',
    headers: { Origin: origin, ...(payload && { 'Content-Type': 'application/json' }), ...(cookie && { Cookie: cookie }) },
    body: payload ? JSON.stringify(payload) : undefined,
  });
}
async function create() {
  const response = await request('/rooms', { name: 'Owner' });
  expect(response.status).toBe(201);
  const { roomId } = await response.json<{ roomId: string }>();
  return { path: '/rooms/' + roomId, roomId, cookie: response.headers.get('Set-Cookie')!.split(';')[0] };
}

test('only room members receive a short-lived ticket for their room socket', async () => {
  const { path, cookie } = await create();
  const outsider = await create();
  expect((await request(path + '/socket-ticket', {})).status).toBe(401);
  expect((await request(path + '/socket-ticket', {}, outsider.cookie)).status).toBe(403);
  const response = await request(path + '/socket-ticket', {}, cookie);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  const { ticket } = await response.json<{ ticket: string }>();
  const expires = Number(ticket.split('.')[4]);
  expect(expires).toBeGreaterThan(Date.now());
  expect(expires).toBeLessThanOrEqual(Date.now() + 30_000);

  const connect = (target: string, protocol: string, browserOrigin = origin) => worker.fetch('https://worker.test/api/markets' + target + '/socket', {
    headers: { Origin: browserOrigin, Upgrade: 'websocket', 'Sec-Fetch-Site': 'cross-site', 'Sec-WebSocket-Protocol': `fourfivex, ${protocol}` },
  });
  expect((await connect(outsider.path, ticket)).status).toBe(401);
  expect((await connect(path, ticket + '0')).status).toBe(401);
  expect((await connect(path, ticket, 'https://other.test')).status).toBe(403);
  const session = await connect(path, ticket);
  expect(session.status).toBe(101);
  expect(session.headers.get('Sec-WebSocket-Protocol')).toBe('fourfivex');
  session.webSocket!.accept();
  session.webSocket!.close();
});

test('opens a new room on the selected market and keeps the draft private', async () => {
  const market = 'hyperliquid:perp:ETH';
  const response = await request('/rooms', { name: 'Owner', market, margin: 123, leverage: 20 });
  expect(response.status).toBe(201);
  const { roomId } = await response.json<{ roomId: string }>();
  const stub = (env as unknown as Env).ROOMS.getByName(roomId);
  await runInDurableObject(stub, (_, state) => {
    const { payload } = state.storage.sql.exec<{ payload: string }>('SELECT payload FROM chart_view').one();
    const presentation = JSON.parse(payload);
    expect(presentation.view.market).toBe(market);
    expect(presentation.view).not.toHaveProperty('margin');
    expect(presentation.view).not.toHaveProperty('leverage');
  });
  expect((await request('/rooms', { name: 'Owner', market: 'other:perp:ETH' })).status).toBe(400);
});

test('scopes voice tokens to room members and retries provider revocation', async () => {
  const { path, roomId, cookie } = await create();
  const outsider = await create();
  const { token } = await (await request(path + '/invite', { role: 'viewer' }, cookie)).json<{ token: string }>();
  const joined = await request(path + '/join', { name: 'Listener', token });
  const listenerCookie = joined.headers.get('Set-Cookie')!.split(';')[0];
  const { id: member } = await (await request(path + '/membership', undefined, listenerCookie)).json<{ id: string }>();
  expect((await request(path + '/voice', {})).status).toBe(401);
  expect((await request(path + '/voice', {}, outsider.cookie)).status).toBe(403);
  const stub = (env as unknown as Env).ROOMS.getByName(roomId);
  const internal = (action: string, session: string, body?: object) => new Request(origin + action, {
    method: 'POST',
    headers: {
      'x-fourfivex-identity': session.split('=')[1].split('.')[0],
      'x-fourfivex-expires': String(Date.now() + 30 * 60_000),
      'Content-Type': 'application/json',
    },
    body: body && JSON.stringify(body),
  });

  await runInDurableObject(stub, async room => {
    const calls = vi.fn(async (url: string, init: RequestInit) => {
      const target = new URL(url).pathname;
      const payload = JSON.parse(String(init.body ?? '{}'));
      if (target.endsWith('/meetings')) {
        expect(payload.record_on_start).toBe(false);
        return Response.json({ success: true, data: { id: 'test-meeting' } });
      }
      if (target.endsWith('/participants')) {
        expect(payload).toMatchObject({ custom_participant_id: member, preset_name: 'zik_viewer' });
        expect(Date.parse(payload.token.expires_on)).toBeLessThanOrEqual(Date.now() + 15 * 60_000);
        return Response.json({ success: true, data: { id: 'test-participant', token: 'initial', expires_on: payload.token.expires_on } });
      }
      if (target.endsWith('/token')) {
        return Response.json({ success: true, data: { token: 'refreshed', expires_on: payload.expires_on } });
      }
      expect(target).toMatch(/\/participants\/test-participant$/);
      expect(init.method).toBe('DELETE');
      return new Response(null, { status: 502 });
    });
    vi.stubGlobal('fetch', calls);
    try {
      const [first, second] = await Promise.all([
        room.fetch(internal('/voice', listenerCookie)),
        room.fetch(internal('/voice', listenerCookie)),
      ]);
      expect(await first.json()).toEqual({ token: 'initial' });
      expect(await second.json()).toEqual({ token: 'refreshed' });
      expect(first.headers.get('Cache-Control')).toBe('no-store');
      expect(await (await room.fetch(internal('/members/revoke', cookie, { member }))).json()).toMatchObject({ voicePending: true });
      expect((await room.fetch(internal('/voice', listenerCookie))).status).toBe(403);
      expect(calls).toHaveBeenCalledTimes(4);
    } finally { vi.unstubAllGlobals(); }
  });

  const retry = vi.fn(async (_url: string, init: RequestInit) => {
    expect(init.method).toBe('DELETE');
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal('fetch', retry);
  try {
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(retry).toHaveBeenCalledOnce();
    await runInDurableObject(stub, (_, state) => {
      expect(state.storage.sql.exec('SELECT member FROM voice_participants').toArray()).toEqual([]);
    });
  } finally { vi.unstubAllGlobals(); }
});
async function connect(path: string, cookie: string) {
  const response = await worker.fetch(origin + '/api/markets' + path + '/socket', { headers: { Origin: origin, Cookie: cookie, Upgrade: 'websocket' } });
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  const events: RoomEvent[] = [];
  socket.addEventListener('message', ({ data }) => { events.push(JSON.parse(String(data))); });
  socket.accept();
  const find = (predicate: (event: RoomEvent) => boolean) => expect.poll(() => events.find(predicate)).toBeDefined();
  await find(event => event.type === 'snapshot');
  return { socket, events, find };
}

describe('trading rooms', () => {
  test('rejects Kraken markets and prevents moving a drawing across Hyperliquid markets', async () => {
    const { path, cookie } = await create();
    const owner = await connect(path, cookie);
    const id = crypto.randomUUID();
    const change = { kind: 'level', id, data: { label: 'Support', price: '3200', time: 1794414000 } };
    const save = (market: string, expected = 0) => {
      const op = crypto.randomUUID();
      owner.socket.send(JSON.stringify({ type: 'edit', op, change: { ...change, market, expected } }));
      return op;
    };
    try {
      save('ETH');
      await owner.find(event => event.type === 'error' && event.error === 'Invalid room message.');
      save('hyperliquid:perp:ETH');
      await owner.find(event => event.type === 'change' && event.item.market === 'hyperliquid:perp:ETH');
      const wrongMarket = save(defaultMarket, 1);
      await owner.find(event => event.type === 'ack' && event.op === wrongMarket && Boolean(event.error));
    } finally { owner.socket.close(); }
  });

  test('reopens a room with a legacy chart on Hyperliquid and preserves stored drawings', async () => {
    const { path, roomId, cookie } = await create();
    const { id: ownerId } = await (await request(path + '/membership', undefined, cookie)).json<{ id: string }>();
    const stub = (env as unknown as Env).ROOMS.getByName(roomId);
    const drawing = { kind: 'level', data: { label: 'Support', price: '75000', time: 1794414000 }, revision: 1 };
    const legacy = { ...drawing, id: crypto.randomUUID(), market: 'BTC' };
    const current = { ...drawing, id: crypto.randomUUID(), market: defaultMarket };
    await runInDurableObject(stub, (_, state) => {
      state.storage.sql.exec('INSERT INTO chart_view VALUES (1, ?)', JSON.stringify({
        presenter: ownerId,
        view: { market: 'BTC', interval: 60, scale: 'normal', camera: { time: 1794414000, position: 0.5, bars: 60, live: false } },
      }));
      for (const item of [legacy, current]) {
        state.storage.sql.exec('INSERT INTO items VALUES (?, ?)', item.id, JSON.stringify(item));
      }
    });
    const owner = await connect(path, cookie);
    try {
      expect(owner.events[0]).toMatchObject({ room: {
        presentation: { presenter: ownerId, view: { market: defaultMarket, interval: 60, camera: null } },
        items: [current],
      } });
      await runInDurableObject(stub, (_, state) => {
        expect(state.storage.sql.exec('SELECT payload FROM items WHERE id = ?', legacy.id).one().payload)
          .toBe(JSON.stringify(legacy));
      });
    } finally { owner.socket.close(); }
  });

  test('consumes single-use invites, limits viewers, and closes a revoked member connection', async () => {
    const { path, cookie } = await create();
    const invite = await request(path + '/invite', { role: 'viewer' }, cookie);
    const { token } = await invite.json<{ token: string }>();
    const joined = await request(path + '/join', { name: 'Viewer', token });
    expect(joined.status).toBe(200);
    expect((await request(path + '/join', { name: 'Uninvited', token })).status).toBe(404);
    const guestCookie = joined.headers.get('Set-Cookie')!.split(';')[0];
    expect((await request(path + '/invite', { role: 'editor' }, guestCookie)).status).toBe(403);
    const guest = await connect(path, guestCookie);
    guest.socket.send(JSON.stringify({ type: 'edit', op: crypto.randomUUID(),
      change: { kind: 'level', id: crypto.randomUUID(), expected: 0, market: defaultMarket, data: { label: 'Support', price: '75000', time: 1794414000 } } }));
    await guest.find(event => event.type === 'ack' && Boolean(event.error));
    const { id } = await (await request(path + '/membership', undefined, guestCookie)).json<{ id: string }>();
    const closed = new Promise<number>(resolve => guest.socket.addEventListener('close', event => resolve(event.code)));
    expect((await request(path + '/members/revoke', { member: id }, cookie)).status).toBe(200);
    expect(await closed).toBe(1008);
    expect((await request(path + '/membership', undefined, guestCookie)).status).toBe(403);
  });

  test('orders edits, rejects stale writes, and deduplicates a retry after reconnect', async () => {
    const { path, cookie } = await create();
    const owner = await connect(path, cookie);
    const op = crypto.randomUUID();
    const id = crypto.randomUUID();
    const change = { kind: 'level', id, expected: 0, market: defaultMarket, data: { label: 'Support', price: '75000', time: 1794414000 } };
    const original = { type: 'edit', op, change };
    owner.socket.send(JSON.stringify(original));
    await owner.find(event => event.type === 'change' && event.item.revision === 1);
    owner.socket.close();
    const reconnect = await connect(path, cookie);
    reconnect.socket.send(JSON.stringify(original));
    await reconnect.find(event => event.type === 'ack' && event.op === op && !event.item && !event.error);
    const stale = crypto.randomUUID();
    reconnect.socket.send(JSON.stringify({ type: 'edit', op: stale, change: { ...change, data: { ...change.data, price: '75100' } } }));
    await reconnect.find(event => event.type === 'ack' && event.op === stale && event.item?.revision === 1 && Boolean(event.error));
    expect(reconnect.events.filter(event => event.type === 'change')).toHaveLength(0);
    reconnect.socket.close();
  });

  test('blocks forged origins and executable swap requests in Markets', async () => {
    const { cookie } = await create();
    expect((await worker.fetch(origin + '/api/markets/rooms', {
      method: 'POST', headers: { Origin: 'https://other.test', 'Content-Type': 'application/json' }, body: '{"name":"Cross-origin"}',
    })).status).toBe(403);
    expect((await request('/quotes', { amount: '100000000', slippage: 100, dry: false }, cookie)).status).toBe(404);
    expect((await request('/swaps', { amount: '100000000', slippage: 100 }, cookie)).status).toBe(404);
  });
});

test('saves the settled chart view, restricts control, and returns it to the owner on revocation', async () => {
  const { path, cookie } = await create();
  async function join(role: 'editor' | 'viewer') {
    const invite = await request(path + '/invite', { role }, cookie);
    const { token } = await invite.json<{ token: string }>();
    const joined = await request(path + '/join', { name: role, token });
    const session = joined.headers.get('Set-Cookie')!.split(';')[0];
    const { id } = await (await request(path + '/membership', undefined, session)).json<{ id: string }>();
    return { ...(await connect(path, session)), id, session };
  }
  const owner = await connect(path, cookie);
  const editor = await join('editor');
  const viewer = await join('viewer');
  const snapshot = owner.events[0];
  if (snapshot.type !== 'snapshot') throw new Error('Expected a room snapshot');
  const ownerId = snapshot.room.me.id;
  const send = (socket: WebSocket, message: object) => socket.send(JSON.stringify(message));
  const camera = { time: 1794414000, position: 0.56, bars: 84.5, live: false };
  try {
    expect(snapshot.room.presentation).toMatchObject({ presenter: ownerId, view: { market: defaultMarket, interval: 15, camera: null } });

    send(viewer.socket, { type: 'chart-settings', settings: { market: 'hyperliquid:perp:SOL' } });
    send(viewer.socket, { type: 'chart-presenter', member: viewer.id });
    await viewer.find(event => event.type === 'error');
    send(owner.socket, { type: 'chart-presenter', member: viewer.id });
    await owner.find(event => event.type === 'error');

    send(owner.socket, { type: 'chart-settings', settings: { market: 'hyperliquid:perp:ETH' } });
    send(owner.socket, { type: 'chart-settings', settings: { interval: 60, scale: 'logarithm' } });
    await editor.find(event => event.type === 'chart-presentation' && event.presentation.view.interval === 60 &&
      event.presentation.view.market === 'hyperliquid:perp:ETH');

    send(owner.socket, { type: 'chart-camera', market: 'hyperliquid:perp:ETH', interval: 60, camera, settled: false });
    await editor.find(event => event.type === 'chart-camera' && event.camera.bars === camera.bars);
    const liveJoin = await connect(path, editor.session);
    expect(liveJoin.events[0]).toMatchObject({ room: { presentation: { view: { camera: null } } } });
    liveJoin.socket.close();

    const settled = { ...camera, bars: 62.25 };
    send(owner.socket, { type: 'chart-camera', market: 'hyperliquid:perp:ETH', interval: 60, camera: settled, settled: true });
    await editor.find(event => event.type === 'chart-camera' && event.camera.bars === settled.bars);
    const resumed = await connect(path, editor.session);
    expect(resumed.events[0]).toMatchObject({ room: { presentation: { view: { market: 'hyperliquid:perp:ETH', interval: 60, camera: settled } } } });
    resumed.socket.close();

    send(owner.socket, { type: 'chart-presenter', member: editor.id });
    await viewer.find(event => event.type === 'chart-presentation' && event.presentation.presenter === editor.id);
    send(owner.socket, { type: 'chart-settings', settings: { market: 'hyperliquid:perp:SOL' } });
    send(editor.socket, { type: 'chart-settings', settings: { interval: 30 } });
    await viewer.find(event => event.type === 'chart-presentation' && event.presentation.view.interval === 30 &&
      event.presentation.view.market === 'hyperliquid:perp:ETH' && event.presentation.view.camera === null);

    expect((await request(path + '/members/revoke', { member: editor.id }, cookie)).ok).toBe(true);
    await viewer.find(event => event.type === 'chart-presentation' && event.presentation.presenter === ownerId &&
      event.presentation.view.interval === 30);
  } finally {
    for (const peer of [owner, editor, viewer]) peer.socket.close();
  }
});

test('loads Hyperliquid candles by default and rejects Kraken candle requests', async () => {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe('https://api.hyperliquid.xyz/info');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      type: 'candleSnapshot', req: { coin: 'BTC', interval: '15m' },
    });
    return Response.json([{ t: 1794414000000, o: '75000', h: '75100', l: '74900', c: '75050', v: '20' }]);
  });
  vi.stubGlobal('fetch', fetch);
  try {
    expect((await request('/candles?interval=15&market=BTC')).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    const result = await request('/candles?interval=15');
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual([{ time: 1794414000, open: 75000, high: 75100, low: 74900, close: 75050, volume: 20 }]);
    expect(fetch).toHaveBeenCalledOnce();
  } finally { vi.unstubAllGlobals(); }
});
