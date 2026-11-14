import { base58 } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";
import { verifyAssertion } from "./assertion";
import { b64u, equal, utf8 } from "./encoding";
import { challengeFor, type SignedIntent } from "./intents";
import { decodePublicKey } from "./keys";

/**
 * A passkey-signed intent as a browser sent it, if its signature checks out and it was made on this site.
 * Runs on the server, before anything is sent anywhere.
 */
export function signedIntent(value: unknown, origin: string): SignedIntent | undefined {
  if (!value || typeof value !== 'object') return;
  const signed = value as Record<string, unknown>;
  if (signed.standard !== 'webauthn') return;
  for (const key of ['payload', 'public_key', 'signature', 'client_data_json', 'authenticator_data']) {
    if (typeof signed[key] !== 'string' || signed[key].length > 4000) return;
  }
  const envelope = signed as unknown as SignedIntent;
  try {
    const client = JSON.parse(envelope.client_data_json);
    if (client.origin !== origin || client.crossOrigin === true || !envelope.signature.startsWith('p256:')) return;
    const authenticatorData = b64u.decode(envelope.authenticator_data);
    if (!equal(authenticatorData.slice(0, 32), sha256(utf8(new URL(origin).hostname)))) return;
    if (!verifyAssertion(decodePublicKey(envelope.public_key), challengeFor(envelope.payload), {
      clientDataJSON: envelope.client_data_json, authenticatorData,
      signature: base58.decode(envelope.signature.slice(5)), credentialId: '', userHandle: null,
    })) return;
    return envelope;
  } catch {
    return;
  }
}
