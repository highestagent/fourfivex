import type { AccountProof } from '@fourfivex/markets-protocol/protocol';
import type { Env } from './env';
import { base58Decode, base64url } from './encoding';
import { HttpError, upstream } from './http';

export { base58Decode, base58Encode, base64url } from './encoding';

/**
 * Proof that whoever creates a room holds a passkey of a fourfivex account.
 *
 * The service hands out a one-time challenge, the passkey signs it in the browser, and this checks the WebAuthn
 * signature the way the NEAR Intents verifier does, then asks that contract whether the key belongs to the account.
 * Accounts live nowhere else: the passkey's public key is the account, or was added to it on chain.
 */

const encoder = new TextEncoder();
const challengeLife = 2 * 60_000;
const sha256 = async (bytes: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, index) => byte === b[index]);

function challengeKey(env: Env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new HttpError(503, 'Room creation is unavailable.');
  return crypto.subtle.importKey('raw', encoder.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** What a challenge is for, and who it was handed to. Part of what the service signs, so one can't stand in for another. */
export type Purpose = { use: 'create-room' } | { use: 'list-session' } | { use: 'enter-session'; room: string; identity: string };
const purposeText = (purpose: Purpose) => purpose.use === 'enter-session' ? `enter-session:${purpose.room}:${purpose.identity}` : purpose.use;

const challengeValue = (env: Env, purpose: Purpose, accountId: string, expires: number, nonce: string) =>
  encoder.encode(`${purposeText(purpose)}:${env.APP_ORIGIN}:${accountId}:${expires}:${nonce}`);

/** A challenge only this service could have issued, for one account and one purpose, good for two minutes and once. */
export async function issueChallenge(env: Env, accountId: string, purpose: Purpose = { use: 'create-room' }) {
  const expires = Date.now() + challengeLife;
  const nonce = crypto.randomUUID();
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await challengeKey(env), challengeValue(env, purpose, accountId, expires, nonce)));
  return { challenge: `${accountId}.${expires}.${nonce}.${base64url.encode(signature)}`, expires };
}

async function readChallenge(env: Env, challenge: string, accountId: string, purpose: Purpose) {
  const match = /^(0x[0-9a-f]{40})\.(\d{13})\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(challenge);
  if (!match || match[1] !== accountId || Number(match[2]) <= Date.now()) return;
  const [, , expires, nonce, signature] = match;
  const valid = await crypto.subtle.verify('HMAC', await challengeKey(env), base64url.decode(signature),
    challengeValue(env, purpose, accountId, Number(expires), nonce));
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

const refused = () => new HttpError(401, 'Your passkey could not be confirmed. Try again.');

/**
 * Checks a WebAuthn signature over `message` the way the NEAR Intents verifier does, made on this app's origin
 * with the user present and verified, then asks that contract whether the key belongs to the account.
 */
async function verifyPasskey(env: Env, accountId: string, publicKeyText: string, message: string,
  clientDataJSON: string, authenticatorData: Uint8Array, signature: Uint8Array) {
  let client: { type?: unknown; challenge?: unknown; origin?: unknown };
  let publicKey: CryptoKey;
  try {
    client = JSON.parse(clientDataJSON);
    if (!publicKeyText.startsWith('p256:')) throw refused();
    const raw = base58Decode(publicKeyText.slice('p256:'.length));
    if (raw.length !== 64 || signature.length !== 64) throw refused();
    publicKey = await crypto.subtle.importKey('raw', Uint8Array.of(4, ...raw), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  } catch {
    throw refused();
  }
  const expected = base64url.encode(await sha256(encoder.encode(message)));
  const rpId = new URL(env.APP_ORIGIN).hostname;
  const flags = authenticatorData[32] ?? 0;
  if (client.type !== 'webauthn.get' || client.challenge !== expected || client.origin !== env.APP_ORIGIN
    || authenticatorData.length < 37 || !equal(authenticatorData.slice(0, 32), await sha256(encoder.encode(rpId)))
    || !(flags & 0x01) || !(flags & 0x04)) throw refused();
  const signed = new Uint8Array([...authenticatorData, ...await sha256(encoder.encode(clientDataJSON))]);
  if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, signature, signed)) throw refused();
  if (!await keyBelongs(env, accountId, publicKeyText)) throw refused();
}

const decoded = (text: string) => {
  try { return base64url.decode(text); } catch { throw refused(); }
};

/** Checks the proof and returns the account and the challenge it used, which must then be spent. */
export async function verifyAccountProof(env: Env, proof: AccountProof, purpose: Purpose = { use: 'create-room' }) {
  const challenge = await readChallenge(env, proof.challenge, proof.accountId, purpose);
  if (!challenge) throw new HttpError(401, 'This approval expired. Try again.');
  await verifyPasskey(env, proof.accountId, proof.publicKey, proof.challenge, proof.clientDataJSON,
    decoded(proof.authenticatorData), decoded(proof.signature));
  return { accountId: proof.accountId, nonce: challenge.nonce, nonceExpires: challenge.expires };
}

/** A passkey-signed NEAR Intents payload, as the browser sends it. */
export type SignedPayload = {
  standard: 'webauthn'; payload: string; public_key: string; signature: string; client_data_json: string; authenticator_data: string;
};

export const entryHash = async (challenge: string) =>
  Array.from(await sha256(encoder.encode(challenge)), byte => byte.toString(16).padStart(2, '0')).join('');

/**
 * Proof from a seat payment: the passkey signed one transfer of the fee to the escrow, naming this session and
 * the hash of an entry challenge handed to this device. The payment is public once it lands, but the challenge
 * isn't, and it only works for the device it was issued to.
 */
export async function verifyPaymentProof(env: Env, accountId: string, challengeText: string, signed: SignedPayload,
  purpose: Extract<Purpose, { use: 'enter-session' }>, expected: { escrow: string; token: string; units: string }) {
  const challenge = await readChallenge(env, challengeText, accountId, purpose);
  if (!challenge) throw new HttpError(401, 'This approval expired. Try again.');
  let payload: { signer_id?: unknown; verifying_contract?: unknown; intents?: unknown };
  try { payload = JSON.parse(signed.payload); } catch { throw refused(); }
  const intents = Array.isArray(payload.intents) ? payload.intents as Record<string, unknown>[] : [];
  const [transfer] = intents;
  let message: { session?: unknown; entry?: unknown } = {};
  try { message = JSON.parse(String(transfer?.msg)); } catch {}
  const tokens = transfer?.tokens as Record<string, unknown> | undefined;
  if (payload.signer_id !== accountId || payload.verifying_contract !== 'intents.near' || intents.length !== 1
    || transfer.intent !== 'transfer' || transfer.receiver_id !== expected.escrow
    || !tokens || Object.keys(tokens).length !== 1 || tokens[expected.token] !== expected.units
    || message.session !== purpose.room || message.entry !== await entryHash(challengeText)) throw refused();
  if (signed.standard !== 'webauthn' || !signed.signature.startsWith('p256:')) throw refused();
  let signature: Uint8Array;
  try { signature = base58Decode(signed.signature.slice('p256:'.length)); } catch { throw refused(); }
  await verifyPasskey(env, accountId, signed.public_key, signed.payload, signed.client_data_json, decoded(signed.authenticator_data), signature);
  return { accountId, nonce: challenge.nonce, nonceExpires: challenge.expires };
}
