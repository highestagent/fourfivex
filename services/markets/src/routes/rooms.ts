import { z } from 'zod';
import { displayName, id, roomCreation } from '@fourfivex/markets-protocol/protocol';
import { identity, issueSocketTicket, socketIdentity, type Identity } from '../auth';
import type { Env } from '../env';
import { body, HttpError, json, limit } from '../http';

export function roomRequest(request: Request, auth: Identity, path: string, payload?: object) {
  const headers = new Headers();
  headers.set('x-fourfivex-identity', auth.id);
  headers.set('x-fourfivex-expires', String(auth.expires));
  if (request.headers.has('Upgrade')) headers.set('Upgrade', request.headers.get('Upgrade')!);
  if (path === '/socket' && request.headers.get('Sec-WebSocket-Protocol')?.split(',').some(value => value.trim() === 'fourfivex')) {
    headers.set('Sec-WebSocket-Protocol', 'fourfivex');
  }
  if (path === '/socket' && new URL(request.url).searchParams.get('reconnect') === '1') headers.set('x-fourfivex-reconnect', '1');
  if (payload) headers.set('Content-Type', 'application/json');
  return new Request(new URL(path, request.url), { method: request.method, headers, body: payload ? JSON.stringify(payload) : undefined });
}

const roomActions = {
  socket: ['GET', null],
  'socket-ticket': ['POST', null],
  membership: ['GET', null],
  voice: ['POST', null],
  join: ['POST', z.object({ name: displayName, token: id })],
  invite: ['POST', z.object({ role: z.enum(['editor', 'viewer']) })],
  invites: ['GET', null],
  'invite/revoke': ['POST', z.object({ inviteId: z.string().regex(/^[a-f0-9]{64}$/) })],
  'members/revoke': ['POST', z.object({ member: id })],
} as const;

export async function roomsRoutes(request: Request, env: Env, url: URL) {
  const path = url.pathname;
  if (path === '/api/markets/rooms' && request.method === 'POST') {
    await limit(request, env, 'room-create');
    const payload = await body(request, roomCreation);
    const auth = (await identity(request, env, true))!;
    const roomId = crypto.randomUUID();
    const result = await env.ROOMS.getByName(roomId).fetch(roomRequest(request, auth, '/create', payload));
    if (!result.ok) return result;
    return json({ roomId }, 201, auth.cookie ? { 'Set-Cookie': auth.cookie } : undefined);
  }

  const roomMatch = /^\/api\/markets\/rooms\/([^/]+)\/(.+)$/.exec(path);
  if (roomMatch && id.safeParse(roomMatch[1]).success && Object.hasOwn(roomActions, roomMatch[2])) {
    const roomId = roomMatch[1];
    const action = roomMatch[2] as keyof typeof roomActions;
    const [method, schema] = roomActions[action];
    if (request.method !== method) throw new HttpError(405, 'Method not allowed.');
    const auth = action === 'socket' && request.headers.has('Sec-WebSocket-Protocol')
      ? await socketIdentity(request, env, roomId)
      : await identity(request, env, action === 'join');
    if (!auth) throw new HttpError(401, 'Join the room with an invite.');
    if (action === 'join' || action === 'socket' || action === 'socket-ticket' || action === 'voice') await limit(request, env, action);
    const room = env.ROOMS.getByName(roomId);
    if (action === 'socket-ticket') {
      const membership = await room.fetch(roomRequest(request, auth, '/membership'));
      if (!membership.ok) return membership;
      return json({ ticket: await issueSocketTicket(env, roomId, auth) });
    }
    const payload = schema ? await body(request, schema as z.ZodType<object>) : undefined;
    const response = await room.fetch(roomRequest(request, auth, '/' + action, payload));
    if (auth.cookie && response.ok) {
      const headers = new Headers(response.headers);
      headers.set('Set-Cookie', auth.cookie);
      return new Response(response.body, { status: response.status, headers });
    }
    return response;
  }
}
