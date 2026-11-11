/**
 * A software stand-in for a passkey, for tests only. It produces exactly what a browser
 * returns from `navigator.credentials.get()`, so everything after the fingerprint can be
 * exercised without one. The app itself never holds a private key.
 */
import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { Assertion } from "../lib/account/assertion";
import { b64u, concat, utf8 } from "../lib/account/encoding";
import { signatureFromDer, type RawPublicKey } from "../lib/account/keys";

/** User present, user verified, backup eligible, backed up: what a synced passkey reports. */
export const SYNCED = 0x1d;

export function makeAuthenticator(opts: { origin?: string; rpId?: string; flags?: number } = {}) {
  const origin = opts.origin ?? "http://localhost:3000";
  const rpId = opts.rpId ?? "localhost";
  const flags = opts.flags ?? SYNCED;
  const secretKey = p256.utils.randomSecretKey();
  const publicKey: RawPublicKey = p256.getPublicKey(secretKey, false).slice(1);
  const credentialId = b64u.encode(crypto.getRandomValues(new Uint8Array(16)));

  return {
    publicKey,
    credentialId,
    assert(challenge: Uint8Array, userHandle: Uint8Array | null = null): Assertion {
      const authenticatorData = concat(sha256(utf8(rpId)), Uint8Array.of(flags), new Uint8Array(4));
      const clientDataJSON = JSON.stringify({
        type: "webauthn.get",
        challenge: b64u.encode(challenge),
        origin,
        crossOrigin: false,
      });
      const der = p256.sign(concat(authenticatorData, sha256(utf8(clientDataJSON))), secretKey, {
        prehash: true,
        lowS: false,
        format: "der",
      });
      return { credentialId, authenticatorData, clientDataJSON, signature: signatureFromDer(der), userHandle };
    },
  };
}
