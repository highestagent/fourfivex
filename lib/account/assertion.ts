/**
 * Checking what a passkey signed, exactly as the verifier contract will check it.
 * See github.com/near/intents, crates/signatures/webauthn.
 */
import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { b64u, concat, equal, utf8 } from "./encoding";
import type { RawPublicKey } from "./keys";

/** One use of a passkey, in the forms the rest of the app needs. */
export type Assertion = {
  /** base64url id of the passkey that signed. */
  credentialId: string;
  authenticatorData: Uint8Array;
  /** Kept as the exact string the browser produced, because its hash is what gets signed. */
  clientDataJSON: string;
  /** 64 bytes, r then s. */
  signature: Uint8Array;
  /** What the passkey was told about its owner when it was made. Null if the browser withheld it. */
  userHandle: Uint8Array | null;
};

const UP = 1 << 0;
const UV = 1 << 2;
const BE = 1 << 3;
const BS = 1 << 4;

/** The bytes the authenticator actually signs. */
export function signedBytes(a: Pick<Assertion, "authenticatorData" | "clientDataJSON">): Uint8Array {
  return concat(a.authenticatorData, sha256(utf8(a.clientDataJSON)));
}

/**
 * Returns why an assertion is unacceptable, or null if it is sound.
 * Stricter than the contract in one way: the person must have been verified
 * (fingerprint, face or device PIN), not merely present.
 */
export function assertionProblem(a: Assertion, challenge: Uint8Array): string | null {
  if (a.authenticatorData.length < 37) return "The passkey's reply was too short.";
  const flags = a.authenticatorData[32];
  if (!(flags & UP)) return "The passkey did not confirm you were present.";
  if (!(flags & UV)) return "The passkey did not verify it was you.";
  if (!(flags & BE) && flags & BS) return "The passkey reported an impossible backup state.";
  let client: { type?: unknown; challenge?: unknown };
  try {
    client = JSON.parse(a.clientDataJSON);
  } catch {
    return "The passkey's reply could not be read.";
  }
  if (client.type !== "webauthn.get") return "The passkey answered a different kind of request.";
  if (typeof client.challenge !== "string") return "The passkey's reply has no challenge.";
  let got: Uint8Array;
  try {
    got = b64u.decode(client.challenge);
  } catch {
    return "The passkey's reply has a malformed challenge.";
  }
  if (!equal(got, challenge)) return "The passkey signed something other than what was asked.";
  return null;
}

/** True only if this public key signed this challenge with a sound assertion. */
export function verifyAssertion(publicKey: RawPublicKey, challenge: Uint8Array, a: Assertion): boolean {
  if (assertionProblem(a, challenge)) return false;
  try {
    return p256.verify(a.signature, signedBytes(a), concat(Uint8Array.of(4), publicKey), {
      prehash: true,
      lowS: false,
      format: "compact",
    });
  } catch {
    return false;
  }
}

/**
 * The public keys that could have produced this signature. There are usually two.
 *
 * A passkey never repeats its public key after it is created, so on a device that has
 * not seen the passkey before this is how the key is found again without asking a
 * server to remember it.
 */
export function recoverPublicKeys(a: Assertion): RawPublicKey[] {
  const digest = sha256(signedBytes(a));
  const found: RawPublicKey[] = [];
  for (const bit of [0, 1]) {
    try {
      const point = p256.Signature.fromBytes(a.signature, "compact").addRecoveryBit(bit).recoverPublicKey(digest);
      const raw = point.toBytes(false).slice(1);
      if (!found.some((k) => equal(k, raw))) found.push(raw);
    } catch {
      /* no key for this bit */
    }
  }
  return found;
}
