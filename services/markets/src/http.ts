import { z } from 'zod';
import type { Env } from './env';

export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function json(data: unknown, status = 200, extra?: HeadersInit) {
  const headers = new Headers(extra);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  return Response.json(data, { status, headers });
}

export async function body<T>(request: Request, schema: z.ZodType<T>) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    throw new HttpError(415, 'Expected JSON.');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Request body is required.');
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) {
      await reader.cancel();
      throw new HttpError(413, 'Request is too large.');
    }
    text += decoder.decode(value, { stream: true });
  }
  try { return schema.parse(JSON.parse(text + decoder.decode())); }
  catch { throw new HttpError(400, 'Check the request fields and try again.'); }
}

export function errorResponse(error: unknown) {
  if (error instanceof HttpError) return json({ error: error.message }, error.status);
  console.error('request_failed');
  return json({ error: 'Something went wrong. Try again.' }, 500);
}

export async function upstream(url: string | URL, init?: RequestInit) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new HttpError(503, 'The upstream service is temporarily unavailable.');
  }
}

export async function digest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function limit(request: Request, env: Env, category: string) {
  if (!env.RATE_LIMIT) return;
  const key = category + ':' + (request.headers.get('CF-Connecting-IP') ?? 'local');
  if (!(await env.RATE_LIMIT.limit({ key })).success) throw new HttpError(429, 'Too many requests. Try again in a minute.');
}
