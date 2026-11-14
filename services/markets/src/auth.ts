import { id } from '@fourfivex/markets-protocol/protocol';
import type { Env } from './env';
import { HttpError } from './http';

export type Identity = { id: string; expires: number; cookie?: string };
const cookieName = '__Host-fourfivex-markets';
const cookieLife = 30 * 24 * 3600;
const encoder = new TextEncoder();
const ticketPrefix = 'fourfivex.ticket.';

function sessionKey(env: Env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new HttpError(503, 'Room sessions are unavailable.');
  return crypto.subtle.importKey('raw', encoder.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function sign(key: CryptoKey, value: string) {
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
  return Array.from(signature, byte => byte.toString(16).padStart(2, '0')).join('');
}

function verify(key: CryptoKey, value: string, signature: string) {
  const bytes = Uint8Array.from(signature.match(/../g)!, byte => parseInt(byte, 16));
  return crypto.subtle.verify('HMAC', key, bytes, encoder.encode(value));
}

export async function issueSocketTicket(env: Env, room: string, auth: Identity) {
  const expires = Math.min(auth.expires, Date.now() + 30_000);
  const value = `${auth.id}.${auth.expires}.${expires}`;
  const signature = await sign(await sessionKey(env), `socket:${room}:${env.APP_ORIGIN}:${value}`);
  return `${ticketPrefix}${value}.${signature}`;
}

export async function socketIdentity(request: Request, env: Env, room: string): Promise<Identity | undefined> {
  const protocols = request.headers.get('Sec-WebSocket-Protocol')?.split(',').map(value => value.trim());
  const ticket = protocols?.find(value => value.startsWith(ticketPrefix));
  if (!ticket || !protocols?.includes('fourfivex')) return;
  const match = /^([a-f0-9-]{36})\.(\d{13})\.(\d{13})\.([a-f0-9]{64})$/.exec(ticket.slice(ticketPrefix.length));
  if (!match) return;
  const [, session, sessionExpires, ticketExpires, signature] = match;
  if (!id.safeParse(session).success || Number(ticketExpires) <= Date.now() || Number(sessionExpires) < Number(ticketExpires)) return;
  const value = `socket:${room}:${env.APP_ORIGIN}:${session}.${sessionExpires}.${ticketExpires}`;
  if (await verify(await sessionKey(env), value, signature)) return { id: session, expires: Number(sessionExpires) };
}

export async function identity(request: Request, env: Env, create = false): Promise<Identity | undefined> {
  const key = await sessionKey(env);
  const cookie = request.headers.get('Cookie')?.split(';').map(value => value.trim())
    .find(value => value.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  if (cookie) {
    const [session, timestamp, signature, ...rest] = cookie.split('.');
    if (!rest.length && id.safeParse(session).success && /^\d{13}$/.test(timestamp) && /^[a-f0-9]{64}$/.test(signature)) {
      if (Number(timestamp) > Date.now() && await verify(key, `${session}.${timestamp}`, signature)) {
        return { id: session, expires: Number(timestamp) };
      }
    }
  }
  if (!create) return;
  const session = crypto.randomUUID();
  const expires = Date.now() + cookieLife * 1000;
  const value = `${session}.${expires}`;
  const hex = await sign(key, value);
  return { id: session, expires, cookie: `${cookieName}=${value}.${hex}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${cookieLife}` };
}
