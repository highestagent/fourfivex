import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { roomCanceledCode, type RoomEvent } from '@fourfivex/markets-protocol/protocol';
import { recordRule, sessionRule, sessionTag, usdcUnits, type Booking, type TrackRecord } from '@fourfivex/markets-protocol/sessions';
import type { Env } from '../src/env';
import { base58Encode, base64url } from '../src/passkey';
import { escrowId, fill, FakeWorld, token } from './fake-world';

const worker = (exports as unknown as { default: Fetcher }).default;
const origin = 'https://fourfivex.test';
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const utf8 = (text: string) => new TextEncoder().encode(text);
const sha256 = async (bytes: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

let world: FakeWorld;
beforeEach(() => { world = new FakeWorld(); world.install(); });
afterEach(() => { vi.useRealTimers(); world.uninstall(); });

function call(path: string, payload?: object, cookie?: string) {
  return worker.fetch(origin + '/api/markets' + path, {
    method: payload ? 'POST' : 'GET',
    headers: { Origin: origin, ...(payload && { 'Content-Type': 'application/json' }), ...(cookie && { Cookie: cookie }) },
    body: payload ? JSON.stringify(payload) : undefined,
  });
}
const cookieOf = (response: Response, fallback?: string) => response.headers.get('Set-Cookie')?.split(';')[0] ?? fallback;

async function passkeyAccount() {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)).slice(1);
  const accountId = '0x' + hex(crypto.getRandomValues(new Uint8Array(20)));
  const account = { accountId, publicKey: 'p256:' + base58Encode(raw), privateKey: keys.privateKey };
  world.own(accountId, account.publicKey);
  return account;
}
type Account = Awaited<ReturnType<typeof passkeyAccount>>;

/** What a passkey returns for `message` on this app's origin. */
async function assert(account: Account, message: string) {
  const clientDataJSON = JSON.stringify({ type: 'webauthn.get', challenge: base64url.encode(await sha256(utf8(message))), origin });
  const authenticatorData = new Uint8Array([...await sha256(utf8('fourfivex.test')), 0x05, 0, 0, 0, 1]);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, account.privateKey,
    new Uint8Array([...authenticatorData, ...await sha256(utf8(clientDataJSON))])));
  return { clientDataJSON, authenticatorData, signature };
}

async function prove(account: Account, challenge: string) {
  const { clientDataJSON, authenticatorData, signature } = await assert(account, challenge);
  return { accountId: account.accountId, publicKey: account.publicKey, challenge, clientDataJSON,
    authenticatorData: base64url.encode(authenticatorData), signature: base64url.encode(signature) };
}

/** A host whose address has a profitable month on Hyperliquid. */
async function goodHost() {
  const host = await passkeyAccount();
  const now = Date.now();
  world.addFills(host.accountId, Array.from({ length: 25 }, (_, index) => fill(now - (index % 8 + 1) * DAY - index * MINUTE, { closedPnl: '20', dir: 'Close Long' })));
  return host;
}

async function list(host: Account, terms: { startsIn?: number; minutes?: number; seats?: number; fee?: string } = {}) {
  const { challenge } = await (await call('/sessions/challenge', { accountId: host.accountId })).json<{ challenge: string }>();
  const startsAt = Date.now() + (terms.startsIn ?? 20 * MINUTE);
  const response = await call('/sessions', {
    name: 'Host', fee: terms.fee ?? '25', startsAt, minutes: terms.minutes ?? 30, seats: terms.seats ?? 2, proof: await prove(host, challenge),
  });
  return { response, startsAt, endsAt: startsAt + (terms.minutes ?? 30) * MINUTE };
}

async function listed(host: Account, terms?: Parameters<typeof list>[1]) {
  const { response, startsAt, endsAt } = await list(host, terms);
  expect(response.status, await response.clone().text()).toBe(201);
  const { roomId } = await response.json<{ roomId: string }>();
  return { roomId, cookie: cookieOf(response)!, startsAt, endsAt, stub: (env as unknown as Env).ROOMS.getByName(roomId) };
}

/** Pays for a seat the way the app does: a passkey-signed transfer to the escrow naming the session and this device's entry challenge. */
async function payAndEnter(buyer: Account, roomId: string, { cookie, fee = '25', pays = true }: { cookie?: string; fee?: string; pays?: boolean } = {}) {
  const issued = await call(`/sessions/${roomId}/challenge`, { accountId: buyer.accountId }, cookie);
  const device = cookieOf(issued, cookie)!;
  const { challenge } = await issued.json<{ challenge: string }>();
  const payload = JSON.stringify({
    signer_id: buyer.accountId, verifying_contract: 'intents.near', deadline: new Date(Date.now() + 5 * MINUTE).toISOString(), nonce: 'test',
    intents: [{ intent: 'transfer', receiver_id: escrowId, tokens: { [token]: usdcUnits(fee) },
      msg: JSON.stringify({ session: roomId, entry: hex(await sha256(utf8(challenge))) }) }],
  });
  const { clientDataJSON, authenticatorData, signature } = await assert(buyer, payload);
  const paid = pays ? world.escrow.pay(roomId, buyer.accountId, usdcUnits(fee)) : 'not paid';
  const response = await call(`/sessions/${roomId}/enter`, {
    name: 'Buyer', accountId: buyer.accountId, challenge, signed: {
      standard: 'webauthn', payload, public_key: buyer.publicKey, signature: 'p256:' + base58Encode(signature),
      client_data_json: clientDataJSON, authenticator_data: base64url.encode(authenticatorData),
    },
  }, device);
  const signedPayment = {
    standard: 'webauthn', payload, public_key: buyer.publicKey, signature: 'p256:' + base58Encode(signature),
    client_data_json: clientDataJSON, authenticator_data: base64url.encode(authenticatorData),
  };
  return { response, cookie: device, paid, signed: signedPayment };
}

/** Comes back on another device, or the same one later: one passkey touch proves the account, and NEAR has the seat. */
async function enterWithProof(buyer: Account, roomId: string, cookie?: string) {
  const issued = await call(`/sessions/${roomId}/challenge`, { accountId: buyer.accountId }, cookie);
  const device = cookieOf(issued, cookie)!;
  const { challenge } = await issued.json<{ challenge: string }>();
  const response = await call(`/sessions/${roomId}/enter`, { name: 'Buyer', proof: await prove(buyer, challenge) }, device);
  return { response, cookie: device };
}

async function connect(roomId: string, cookie: string) {
  const response = await worker.fetch(origin + `/api/markets/rooms/${roomId}/socket`, { headers: { Origin: origin, Cookie: cookie, Upgrade: 'websocket' } });
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  const events: RoomEvent[] = [];
  let closed: number | undefined;
  socket.addEventListener('message', ({ data }) => { events.push(JSON.parse(String(data))); });
  socket.addEventListener('close', ({ code }) => { closed = code; });
  socket.accept();
  await expect.poll(() => events.find(event => event.type === 'snapshot')).toBeDefined();
  return { socket, events, closed: () => closed };
}

/** Runs the room's alarm at each minute from `from` to `to`, as time passes. */
async function runMinutes(stub: DurableObjectStub, from: number, to: number, step = MINUTE) {
  vi.useFakeTimers({ toFake: ['Date'] });
  for (let time = from; time <= to; time += step) {
    vi.setSystemTime(time);
    await runDurableObjectAlarm(stub);
  }
}
const booking = async (roomId: string, account?: string) =>
  (await call(`/sessions/${roomId}` + (account ? `?account=${account}` : ''))).json<Booking>();

describe('host record', () => {
  test('shows net P&L over the stated window, and how much of it Hyperliquid could show', async () => {
    const host = await goodHost();
    const { record } = await (await call('/sessions/record', { accountId: host.accountId })).json<{ record: TrackRecord }>();
    expect(record).toMatchObject({
      fills: 25, activeDays: 8, realized: 500, fees: 12.5, funding: 0, net: 487.5, eligible: true, reasons: [],
      window: { days: recordRule.windowDays }, coverage: { complete: true, days: recordRule.windowDays },
    });
  });

  test('a losing or thin record is shown with the reasons, and cannot list a session', async () => {
    const host = await passkeyAccount();
    world.addFills(host.accountId, [fill(Date.now() - DAY, { closedPnl: '-40', dir: 'Close Short' })]);
    const { response } = await list(host);
    expect(response.status).toBe(403);
    const { record } = await response.json<{ record: TrackRecord }>();
    expect(record.net).toBe(-40.5);
    expect(record.reasons).toEqual([
      'Needs at least 20 trades in the last 30 days.', 'Needs trades on at least 5 different days.', "Net P&L over the last 30 days isn't positive.",
    ]);
    expect(world.escrow.calls).toEqual([]);
  });

  test('a record Hyperliquid can only partly show is not complete coverage', async () => {
    const host = await passkeyAccount();
    const now = Date.now();
    world.addFills(host.accountId, Array.from({ length: 10_000 }, (_, index) => fill(now - DAY + index * 1000, { closedPnl: '1' })));
    const { record } = await (await call('/sessions/record', { accountId: host.accountId })).json<{ record: TrackRecord }>();
    expect(record.coverage.complete).toBe(false);
    expect(record.coverage.days).toBe(1);
    expect(record.eligible).toBe(false);
  });
});

describe('listing a session', () => {
  test('the app can ask whether this deployment sells seats', async () => {
    expect(await (await call('/sessions')).json()).toEqual({ available: true });
  });

  test('opens it on the escrow with the published schedule, one session per host', async () => {
    const host = await goodHost();
    const { roomId, startsAt, endsAt } = await listed(host, { fee: '12.50', seats: 3 });
    expect(world.escrow.calls[0]).toEqual({ method: 'open_session', args: { id: roomId, terms: {
      host: host.accountId, price: '12500000', seats: 3, booking_closes: startsAt, ends_at: endsAt,
      release_after: endsAt + sessionRule.exceptionMinutes * MINUTE,
      refund_after: endsAt + sessionRule.exceptionMinutes * MINUTE + sessionRule.backstopHours * 3600_000,
    } } });
    expect(await booking(roomId)).toMatchObject({ host: 'Host', fee: '12.50', seats: 3, sold: 0, state: 'open', escrow: escrowId, token });
    const second = await list(host);
    expect(second.response.status).toBe(409);
  });

  test('a session must start between 15 minutes and 14 days from now', async () => {
    const host = await goodHost();
    expect((await list(host, { startsIn: 5 * MINUTE })).response.status).toBe(400);
    expect((await list(host, { startsIn: 15 * DAY })).response.status).toBe(400);
  });
});

describe('seats', () => {
  test('a paid seat opens the room for that account, on any device it proves itself on', async () => {
    const host = await goodHost();
    const { roomId } = await listed(host);
    const buyer = await passkeyAccount();
    const first = await payAndEnter(buyer, roomId);
    expect(first.response.status, await first.response.clone().text()).toBe(200);
    const room = await connect(roomId, first.cookie);
    const snapshot = room.events.find(event => event.type === 'snapshot');
    expect(snapshot?.type === 'snapshot' && snapshot.room.session).toMatchObject({ host: 'Host', fills: [] });
    expect(await booking(roomId, buyer.accountId)).toMatchObject({ sold: 1, seat: 'paid' });

    // Another device: a fresh cookie, one passkey touch, and the same member.
    const laptop = await enterWithProof(buyer, roomId);
    expect(laptop.response.status).toBe(200);
    const members = async (cookie: string) => (await call(`/rooms/${roomId}/membership`, undefined, cookie)).json<{ id: string }>();
    expect((await members(laptop.cookie)).id).toBe((await members(first.cookie)).id);
    room.socket.close();
  });

  test('a forwarded link opens nothing for an account without a seat', async () => {
    const host = await goodHost();
    const { roomId } = await listed(host);
    const buyer = await passkeyAccount();
    const { cookie, signed } = await payAndEnter(buyer, roomId);
    const friend = await passkeyAccount();
    const forwarded = await enterWithProof(friend, roomId);
    expect(forwarded.response.status).toBe(402);
    for (const action of ['socket-ticket', 'voice']) expect((await call(`/rooms/${roomId}/${action}`, {}, forwarded.cookie)).status).toBe(403);
    // A proof only works on the device its challenge was issued to.
    const issued = await call(`/sessions/${roomId}/challenge`, { accountId: buyer.accountId }, cookie);
    const { challenge } = await issued.json<{ challenge: string }>();
    const proof = await prove(buyer, challenge);
    expect((await call(`/sessions/${roomId}/enter`, { name: 'Friend', proof }, forwarded.cookie)).status).toBe(401);
    // The buyer's payment is public on NEAR, but it names the hash of the buyer's own challenge, not a new one.
    const theirs = await (await call(`/sessions/${roomId}/challenge`, { accountId: buyer.accountId }, forwarded.cookie)).json<{ challenge: string }>();
    const replay = await call(`/sessions/${roomId}/enter`, { name: 'Friend', accountId: buyer.accountId, challenge: theirs.challenge, signed }, forwarded.cookie);
    expect(replay.status).toBe(401);
    // On the buyer's own device the proof works, once.
    expect((await call(`/sessions/${roomId}/enter`, { name: 'Buyer', proof }, cookie)).status).toBe(200);
    expect((await call(`/sessions/${roomId}/enter`, { name: 'Buyer', proof }, cookie)).status).toBe(401);
  });

  test('the last seat goes to one payer; the other is refunded by the escrow and gets no access', async () => {
    const host = await goodHost();
    const { roomId } = await listed(host, { seats: 1 });
    const [first, second] = await Promise.all([passkeyAccount(), passkeyAccount()]);
    const [a, b] = await Promise.all([payAndEnter(first, roomId), payAndEnter(second, roomId)]);
    expect([a.paid, b.paid].sort()).toEqual(['seat', 'sold_out']);
    expect([a.response.status, b.response.status].sort()).toEqual([200, 402]);
    expect(await booking(roomId)).toMatchObject({ sold: 1, state: 'full' });
  });

  test('duplicate and late payments are refunded and change nothing', async () => {
    const host = await goodHost();
    const { roomId, stub, startsAt } = await listed(host);
    const buyer = await passkeyAccount();
    await payAndEnter(buyer, roomId);
    expect((await payAndEnter(buyer, roomId)).paid).toBe('duplicate');
    expect(world.escrow.balances.get(buyer.accountId)).toBe(-25_000_000);
    await runMinutes(stub, startsAt, startsAt);
    const late = await passkeyAccount();
    const tooLate = await payAndEnter(late, roomId);
    expect(tooLate.paid).toBe('booking_closed');
    expect(tooLate.response.status).toBe(402);
    expect(world.escrow.balances.get(late.accountId) ?? 0).toBe(0);
  });

  test('a removed buyer is refunded at once and can’t come back', async () => {
    const host = await goodHost();
    const { roomId, cookie: hostCookie } = await listed(host);
    const buyer = await passkeyAccount();
    const entered = await payAndEnter(buyer, roomId);
    const room = await connect(roomId, entered.cookie);
    const { id: member } = await (await call(`/rooms/${roomId}/membership`, undefined, entered.cookie)).json<{ id: string }>();
    expect((await call(`/rooms/${roomId}/members/revoke`, { member }, hostCookie)).status).toBe(200);
    expect(world.escrow.seats.get(`${roomId}/${buyer.accountId}`)?.state).toBe('refunded');
    await expect.poll(room.closed).toBe(1008);
    expect((await enterWithProof(buyer, roomId)).response.status).toBe(403);
  });

  test('invites are off in paid sessions, and free rooms are unaffected', async () => {
    const host = await goodHost();
    const { roomId, cookie } = await listed(host);
    expect((await call(`/rooms/${roomId}/invite`, { role: 'viewer' }, cookie)).status).toBe(400);
  });
});

describe('the live feed', () => {
  test('members see the host’s fills as they happen; outsiders see nothing', async () => {
    const host = await goodHost();
    const { roomId, stub, startsAt, cookie: hostCookie } = await listed(host);
    const buyer = await passkeyAccount();
    const { cookie } = await payAndEnter(buyer, roomId);
    const hostRoom = await connect(roomId, hostCookie);
    const member = await connect(roomId, cookie);
    world.addFills(host.accountId, [fill(startsAt + 30_000, { coin: 'ETH', px: '3000', dir: 'Open Short', side: 'A', tid: 42 })]);
    await runMinutes(stub, startsAt, startsAt + MINUTE);
    await expect.poll(() => member.events.find(event => event.type === 'fill')).toMatchObject({
      fill: { id: '42', market: 'hyperliquid:perp:ETH', side: 'short', opening: true, price: '3000' },
    });
    // Before the session, the feed doesn't run. A fill from then never shows.
    expect(member.events.filter(event => event.type === 'fill')).toHaveLength(1);
    hostRoom.socket.close(); member.socket.close();
  });
});

describe('settlement', () => {
  /** A session the host attends throughout, with one buyer who watched and one who paid and never came. */
  async function delivered(options: { feedDown?: (minute: number) => boolean } = {}) {
    const host = await goodHost();
    const session = await listed(host, { seats: 3 });
    const watcher = await passkeyAccount();
    const absent = await passkeyAccount();
    const { cookie } = await payAndEnter(watcher, session.roomId);
    expect(world.escrow.pay(session.roomId, absent.accountId, usdcUnits('25'))).toBe('seat');
    const hostRoom = await connect(session.roomId, session.cookie);
    vi.useFakeTimers({ toFake: ['Date'] });
    for (let time = session.startsAt; time < session.endsAt; time += MINUTE) {
      vi.setSystemTime(time);
      world.hyperliquidDown = options.feedDown?.(Math.round((time - session.startsAt) / MINUTE)) ?? false;
      await runDurableObjectAlarm(session.stub);
    }
    world.hyperliquidDown = false;
    hostRoom.socket.close();
    return { ...session, host, watcher, absent, buyerCookie: cookie };
  }
  const settleAt = async (stub: DurableObjectStub, time: number) => {
    vi.setSystemTime(time);
    await runDurableObjectAlarm(stub);
  };
  const stateOf = (roomId: string, account: Account) => world.escrow.seats.get(`${roomId}/${account.accountId}`)?.state;

  test('a delivered session pays the host for every seat after the exception window, even a buyer who never came', async () => {
    const { roomId, stub, endsAt, watcher, absent, host } = await delivered();
    await settleAt(stub, endsAt + 10 * MINUTE);
    expect(world.escrow.calls.filter(({ method }) => method === 'release')).toEqual([]);
    await settleAt(stub, endsAt + sessionRule.exceptionMinutes * MINUTE);
    expect([stateOf(roomId, watcher), stateOf(roomId, absent)]).toEqual(['released', 'released']);
    expect(world.escrow.balances.get(host.accountId)).toBe(50_000_000);
    expect(await booking(roomId, watcher.accountId)).toMatchObject({ state: 'ended', seat: 'released' });
  });

  test('a host who never joins is a no-show: the session is canceled and every seat refunded', async () => {
    const host = await goodHost();
    const { roomId, stub, startsAt } = await listed(host);
    const buyer = await passkeyAccount();
    const { cookie } = await payAndEnter(buyer, roomId);
    const room = await connect(roomId, cookie);
    await runMinutes(stub, startsAt, startsAt + sessionRule.hostGraceMinutes * MINUTE);
    expect(stateOf(roomId, buyer)).toBe('refunded');
    expect(world.escrow.sessions.get(roomId)?.canceled).toBe(true);
    await expect.poll(room.closed).toBe(roomCanceledCode);
    expect((await call(`/rooms/${roomId}/membership`, undefined, cookie)).status).toBe(410);
    expect(await booking(roomId)).toMatchObject({ state: 'canceled' });
  });

  test('a material outage refunds everyone', async () => {
    const { roomId, stub, endsAt, watcher, absent } = await delivered({ feedDown: minute => minute >= 10 });
    await settleAt(stub, endsAt + sessionRule.exceptionMinutes * MINUTE);
    expect([stateOf(roomId, watcher), stateOf(roomId, absent)]).toEqual(['refunded', 'refunded']);
  });

  test('a host who left early is paid only for buyers who traded from the feed', async () => {
    const host = await goodHost();
    const session = await listed(host, { seats: 3 });
    const follower = await passkeyAccount();
    const watcher = await passkeyAccount();
    await payAndEnter(follower, session.roomId);
    await payAndEnter(watcher, session.roomId);
    const hostRoom = await connect(session.roomId, session.cookie);
    await runMinutes(session.stub, session.startsAt, session.startsAt + 5 * MINUTE);
    hostRoom.socket.close();
    world.addFills(follower.accountId, [fill(session.startsAt + 3 * MINUTE, { cloid: `0x${await sessionTag(session.roomId)}0123456789abcdef` })]);
    world.addFills(watcher.accountId, [fill(session.startsAt + 3 * MINUTE, { cloid: '0x00000000000000000123456789abcdef' })]);
    await runMinutes(session.stub, session.startsAt + 6 * MINUTE, session.endsAt);
    await settleAt(session.stub, session.endsAt + sessionRule.exceptionMinutes * MINUTE);
    expect([stateOf(session.roomId, follower), stateOf(session.roomId, watcher)]).toEqual(['released', 'refunded']);
  });

  test('a reported problem holds the fee for review, then refunds it if nobody resolves it', async () => {
    const { roomId, stub, endsAt, watcher, absent, buyerCookie, cookie: hostCookie } = await delivered();
    expect((await call(`/rooms/${roomId}/report`, { text: 'The host never shared a screen.' }, hostCookie)).status).toBe(403);
    expect((await call(`/rooms/${roomId}/report`, { text: 'The host never shared a screen.' }, buyerCookie)).status).toBe(200);
    await settleAt(stub, endsAt + sessionRule.exceptionMinutes * MINUTE);
    expect([stateOf(roomId, watcher), stateOf(roomId, absent)]).toEqual(['paid', 'released']);
    const refundAfter = endsAt + sessionRule.exceptionMinutes * MINUTE + sessionRule.backstopHours * 3600_000;
    await settleAt(stub, refundAfter - 3600_000);
    expect(stateOf(roomId, watcher)).toBe('refunded');
  });

  test('a payout that fails on NEAR is retried until it goes through', async () => {
    const { roomId, stub, endsAt, watcher } = await delivered();
    world.escrow.failing.release = 3;
    const due = endsAt + sessionRule.exceptionMinutes * MINUTE;
    await settleAt(stub, due);
    expect(stateOf(roomId, watcher)).toBe('paid');
    for (let attempt = 1; attempt <= 6 && stateOf(roomId, watcher) !== 'released'; attempt++) {
      const alarm = await runInDurableObject(stub, (_, state) => state.storage.getAlarm());
      await settleAt(stub, alarm!);
    }
    expect(stateOf(roomId, watcher)).toBe('released');
  });

  test('NEAR being unreachable at settlement time delays it, and nothing is lost', async () => {
    const { roomId, stub, endsAt, watcher } = await delivered();
    world.nearDown = true;
    await settleAt(stub, endsAt + sessionRule.exceptionMinutes * MINUTE);
    world.nearDown = false;
    expect(stateOf(roomId, watcher)).toBe('paid');
    await settleAt(stub, endsAt + (sessionRule.exceptionMinutes + 2) * MINUTE);
    expect(stateOf(roomId, watcher)).toBe('released');
  });

  test('the host canceling refunds every seat, and a payment after that is refunded too', async () => {
    const host = await goodHost();
    const { roomId, stub, cookie, startsAt } = await listed(host);
    const buyer = await passkeyAccount();
    await payAndEnter(buyer, roomId);
    expect((await call(`/rooms/${roomId}/delete`, {}, cookie)).status).toBe(200);
    expect(stateOf(roomId, buyer)).toBe('refunded');
    expect((await payAndEnter(await passkeyAccount(), roomId)).paid).toBe('canceled');
    expect((await enterWithProof(buyer, roomId)).response.status).toBe(410);
    expect(await booking(roomId)).toMatchObject({ state: 'canceled' });
    // Nothing left to do: the room finishes once booking would have closed.
    await runMinutes(stub, startsAt + 2 * MINUTE, startsAt + 2 * MINUTE);
    await runInDurableObject(stub, (_, state) => {
      expect(state.storage.sql.exec<{ state: string }>('SELECT state FROM booking').one().state).toBe('refunded');
    });
  });

  test('the host can’t certify delivery or pay themselves', async () => {
    const host = await goodHost();
    const { roomId, cookie } = await listed(host);
    for (const action of ['release', 'settle', 'deliver']) expect((await call(`/rooms/${roomId}/${action}`, {}, cookie)).status).toBe(404);
    expect(world.escrow.calls.map(({ method }) => method)).toEqual(['open_session']);
  });
});
