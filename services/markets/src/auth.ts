import { id } from '@fourfivex/markets-protocol/protocol';
import type { Env } from './env';
import { HttpError } from './http';

export type Identity = { id: string; expires: number; cookie?: string };
const cookieName = '__Host-intuite-markets';
const cookieLife = 30 * 24 * 3600;
const encoder = new TextEncoder();

export async function identity(request: Request, env: Env, create = false): Promise<Identity | undefined> {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new HttpError(503, 'Room sessions are unavailable.');
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const cookie = request.headers.get('Cookie')?.split(';').map(value => value.trim())
    .find(value => value.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  if (cookie) {
    const [session, timestamp, signature, ...rest] = cookie.split('.');
    if (!rest.length && id.safeParse(session).success && /^\d{13}$/.test(timestamp) && /^[a-f0-9]{64}$/.test(signature)) {
      const bytes = Uint8Array.from(signature.match(/../g)!, value => parseInt(value, 16));
      if (Number(timestamp) > Date.now() && await crypto.subtle.verify('HMAC', key, bytes, encoder.encode(`${session}.${timestamp}`))) {
        return { id: session, expires: Number(timestamp) };
      }
    }
  }
  if (!create) return;
  const session = crypto.randomUUID();
  const expires = Date.now() + cookieLife * 1000;
  const value = `${session}.${expires}`;
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
  const hex = Array.from(signature, byte => byte.toString(16).padStart(2, '0')).join('');
  return { id: session, expires, cookie: `${cookieName}=${value}.${hex}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${cookieLife}` };
}
