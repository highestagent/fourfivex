import type { AccountProof } from '@fourfivex/markets-protocol/protocol';
import type { Env } from './env';
import { HttpError, upstream } from './http';

/**
 * Proof that whoever creates a room holds a passkey of a fourfivex account.
 *
 * The service hands out a one-time challenge, the passkey signs it in the browser, and this checks the WebAuthn
 * signature the way the NEAR Intents verifier does, then asks that contract whether the key belongs to the account.
 * Accounts live nowhere else: the passkey's public key is the account, or was added to it on chain.
 */

const encoder = new TextEncoder();
const challengeLife = 2 * 60_000;
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Decode(text: string): Uint8Array {
  let value = BigInt(0);
  for (const char of text) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) throw new Error('Not base58.');
    value = value * BigInt(58) + BigInt(digit);
  }
  const bytes: number[] = [];
  while (value > BigInt(0)) {
    bytes.unshift(Number(value % BigInt(256)));
    value /= BigInt(256);
  }
  for (const char of text) {
    if (char !== '1') break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

export function base58Encode(bytes: Uint8Array): string {
  let value = BigInt(0);
  for (const byte of bytes) value = value * BigInt(256) + BigInt(byte);
  let text = '';
  while (value > BigInt(0)) {
    text = ALPHABET[Number(value % BigInt(58))] + text;
    value /= BigInt(58);
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    text = '1' + text;
  }
  return text;
}

export const base64url = {
  encode: (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''),
  decode: (text: string) => Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0)),
};

const sha256 = async (bytes: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, index) => byte === b[index]);

function challengeKey(env: Env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new HttpError(503, 'Room creation is unavailable.');
  return crypto.subtle.importKey('raw', encoder.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

const challengeValue = (env: Env, accountId: string, expires: number, nonce: string) =>
  encoder.encode(`create-room:${env.APP_ORIGIN}:${accountId}:${expires}:${nonce}`);

/** A challenge only this service could have issued, for one account, good for two minutes and one room. */
export async function issueChallenge(env: Env, accountId: string) {
  const expires = Date.now() + challengeLife;
  const nonce = crypto.randomUUID();
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await challengeKey(env), challengeValue(env, accountId, expires, nonce)));
  return { challenge: `${accountId}.${expires}.${nonce}.${base64url.encode(signature)}`, expires };
}

async function readChallenge(env: Env, challenge: string, accountId: string) {
  const match = /^(0x[0-9a-f]{40})\.(\d{13})\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(challenge);
  if (!match || match[1] !== accountId || Number(match[2]) <= Date.now()) return;
  const [, , expires, nonce, signature] = match;
  const valid = await crypto.subtle.verify('HMAC', await challengeKey(env), base64url.decode(signature),
    challengeValue(env, accountId, Number(expires), nonce));
  return valid ? { nonce, expires: Number(expires) } : undefined;
}

/** Whether the NEAR Intents verifier lets this key sign for the account. */
async function keyBelongs(env: Env, accountId: string, publicKey: string) {
  // Both values are ASCII (checked by the proof's schema), so btoa encodes them as they are.
  const args = btoa(JSON.stringify({ account_id: accountId, public_key: publicKey }));
  const response = await upstream(env.NEAR_RPC_URL ?? 'https://rpc.fastnear.com', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'fourfivex', method: 'query', params: {
      request_type: 'call_function', finality: 'final', account_id: 'intents.near', method_name: 'has_public_key', args_base64: args,
    } }),
  });
  const body = await response.json().catch(() => null) as { result?: { result?: number[] } } | null;
  if (!response.ok || !Array.isArray(body?.result?.result)) throw new HttpError(503, 'Your account could not be checked. Try again.');
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(body.result.result))) === true;
}

/** Checks the proof and returns the account and the challenge it used, which must then be spent. */
export async function verifyAccountProof(env: Env, proof: AccountProof) {
  const refused = () => new HttpError(401, 'Your passkey could not be confirmed. Try again.');
  const challenge = await readChallenge(env, proof.challenge, proof.accountId);
  if (!challenge) throw new HttpError(401, 'This approval expired. Try again.');

  let client: { type?: unknown; challenge?: unknown; origin?: unknown };
  let authenticatorData: Uint8Array;
  let signature: Uint8Array;
  let publicKey: CryptoKey;
  try {
    client = JSON.parse(proof.clientDataJSON);
    authenticatorData = base64url.decode(proof.authenticatorData);
    signature = base64url.decode(proof.signature);
    const raw = base58Decode(proof.publicKey.slice('p256:'.length));
    if (raw.length !== 64 || signature.length !== 64) throw refused();
    publicKey = await crypto.subtle.importKey('raw', Uint8Array.of(4, ...raw), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  } catch {
    throw refused();
  }
  const expected = base64url.encode(await sha256(encoder.encode(proof.challenge)));
  const rpId = new URL(env.APP_ORIGIN).hostname;
  const flags = authenticatorData[32] ?? 0;
  if (client.type !== 'webauthn.get' || client.challenge !== expected || client.origin !== env.APP_ORIGIN
    || authenticatorData.length < 37 || !equal(authenticatorData.slice(0, 32), await sha256(encoder.encode(rpId)))
    || !(flags & 0x01) || !(flags & 0x04)) throw refused();
  const signed = new Uint8Array([...authenticatorData, ...await sha256(encoder.encode(proof.clientDataJSON))]);
  if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, signature, signed)) throw refused();
  if (!await keyBelongs(env, proof.accountId, proof.publicKey)) throw refused();
  return { accountId: proof.accountId, nonce: challenge.nonce, nonceExpires: challenge.expires };
}
