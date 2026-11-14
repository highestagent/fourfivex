import { z } from 'zod';
import { accountProof, displayName, id } from '@fourfivex/markets-protocol/protocol';
import { sessionListing, sessionRule, signedPayload, usdcUnits, type Booking } from '@fourfivex/markets-protocol/sessions';
import { identity } from '../auth';
import { requireSessions, sessionsConfigured } from '../escrow';
import type { Env } from '../env';
import { body, HttpError, json, limit } from '../http';
import { trackRecord } from '../hyperliquid';
import { issueChallenge, verifyAccountProof, verifyPaymentProof } from '../passkey';
import { tradingAddress } from '../trading-address';
import { roomRequest } from './rooms';

const accountId = z.string().regex(/^0x[0-9a-f]{40}$/);
const MINUTE = 60_000;
const entry = z.union([
  z.object({ name: displayName, proof: accountProof }),
  z.object({ name: displayName, accountId, challenge: z.string().max(200), signed: signedPayload }),
]);

/** Paid sessions: a host's record, listing a session, its booking link, and getting a paying account in. */
export async function sessionsRoutes(request: Request, env: Env, url: URL) {
  const path = url.pathname;
  const post = request.method === 'POST';

  // Whether this deployment sells seats at all, so the app only offers paid sessions where they work.
  if (path === '/api/markets/sessions' && request.method === 'GET') return json({ available: sessionsConfigured(env) });

  if (path === '/api/markets/sessions/record' && post) {
    await limit(request, env, 'session-record');
    const { accountId: account } = await body(request, z.object({ accountId }));
    return json({ record: await trackRecord(env, await tradingAddress(env, account)) });
  }

  if (path === '/api/markets/sessions/challenge' && post) {
    requireSessions(env);
    await limit(request, env, 'session-create');
    const { accountId: account } = await body(request, z.object({ accountId }));
    return json(await issueChallenge(env, account, { use: 'list-session' }));
  }

  if (path === '/api/markets/sessions' && post) {
    requireSessions(env);
    await limit(request, env, 'session-create');
    const { proof, name, market, fee, startsAt, minutes, seats } = await body(request, sessionListing);
    const now = Date.now();
    if (startsAt < now + sessionRule.minLeadMinutes * MINUTE || startsAt > now + sessionRule.maxLeadDays * 24 * 60 * MINUTE) {
      throw new HttpError(400, `Start the session between ${sessionRule.minLeadMinutes} minutes and ${sessionRule.maxLeadDays} days from now.`);
    }
    const proven = await verifyAccountProof(env, proof, { use: 'list-session' });
    const owner = env.OWNERS.getByName(proven.accountId);
    const address = await tradingAddress(env, proven.accountId);
    const record = await trackRecord(env, address, now);
    if (!record.eligible) {
      await owner.spend(proven.nonce, proven.nonceExpires);
      return json({ error: 'Your trading record doesn’t qualify yet.', record }, 403);
    }
    const roomId = crypto.randomUUID();
    const endsAt = startsAt + minutes * MINUTE;
    const claim = await owner.claimSession(proven.nonce, proven.nonceExpires, roomId, endsAt);
    if (!claim.ok && claim.reason === 'used') throw new HttpError(401, 'This approval was already used. Try again.');
    if (!claim.ok) return json({ error: 'You already host a session.', roomId: claim.roomId, endsAt: claim.endsAt }, 409);
    const auth = (await identity(request, env, true))!;
    const releaseAfter = endsAt + sessionRule.exceptionMinutes * MINUTE;
    const booking = {
      room: roomId, host_account: proven.accountId, host_address: address, host_name: name, fee, fee_units: usdcUnits(fee), seats,
      starts_at: startsAt, ends_at: endsAt, booking_closes: startsAt, release_after: releaseAfter,
      refund_after: releaseAfter + sessionRule.backstopHours * 3600_000, record: JSON.stringify(record),
    };
    const created = await env.ROOMS.getByName(roomId).fetch(roomRequest(request, auth, '/create-session', { name, market, booking }));
    if (!created.ok) {
      await owner.release(roomId);
      return created;
    }
    return json({ roomId, record }, 201, auth.cookie ? { 'Set-Cookie': auth.cookie } : undefined);
  }

  const match = /^\/api\/markets\/sessions\/([^/]+)(?:\/(challenge|enter))?$/.exec(path);
  if (!match || !id.safeParse(match[1]).success) return;
  requireSessions(env);
  const roomId = match[1];
  const room = env.ROOMS.getByName(roomId);
  const action = match[2];

  if (!action && request.method === 'GET') {
    await limit(request, env, 'session-view');
    // Anyone with the link can see the session. Seats are public on NEAR anyway, so an account can ask about its own.
    const viewer = accountId.safeParse(url.searchParams.get('account'));
    const auth = await identity(request, env) ?? { id: 'booking-link', expires: 0 };
    return room.fetch(roomRequest(request, auth, '/booking', undefined, viewer.success ? { 'x-fourfivex-account': viewer.data } : {}));
  }
  if (!post) throw new HttpError(405, 'Method not allowed.');
  await limit(request, env, 'session-enter');

  if (action === 'challenge') {
    const { accountId: account } = await body(request, z.object({ accountId }));
    const auth = (await identity(request, env, true))!;
    const issued = await issueChallenge(env, account, { use: 'enter-session', room: roomId, identity: auth.id });
    return json(issued, 200, auth.cookie ? { 'Set-Cookie': auth.cookie } : undefined);
  }

  if (action === 'enter') {
    const auth = await identity(request, env);
    if (!auth) throw new HttpError(401, 'Open the booking link again.');
    const input = await body(request, entry);
    const purpose = { use: 'enter-session', room: roomId, identity: auth.id } as const;
    let proven;
    if ('proof' in input) {
      proven = await verifyAccountProof(env, input.proof, purpose);
    } else {
      const booking = await (await room.fetch(roomRequest(request, auth, '/booking'))).json<Booking>();
      proven = await verifyPaymentProof(env, input.accountId, input.challenge, input.signed, purpose,
        { escrow: env.ROOM_ESCROW_CONTRACT!, token: env.ROOM_ESCROW_TOKEN!, units: booking.feeUnits });
    }
    if (!await env.OWNERS.getByName(proven.accountId).spend(proven.nonce, proven.nonceExpires)) {
      throw new HttpError(401, 'This approval was already used. Try again.');
    }
    return room.fetch(roomRequest(request, auth, '/enter', { name: input.name }, { 'x-fourfivex-account': proven.accountId }));
  }
}
