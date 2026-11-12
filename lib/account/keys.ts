/**
 * Passkey public keys and the account they stand for.
 *
 * A passkey here is a P-256 key pair whose private half never leaves the authenticator.
 * NEAR Intents derives an account straight from the public half, so creating a passkey
 * is creating an account. There is no seed phrase and no private key anywhere in this app.
 *
 * Formats follow the verifier contract: github.com/near/intents, contracts/defuse/core.
 */
import { p256 } from "@noble/curves/nist.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { base58, hex } from "@scure/base";
import { concat, utf8 } from "./encoding";

/** 64 bytes, x then y. The only form the contract accepts for P-256. */
export type RawPublicKey = Uint8Array;

const CURVE = "p256";

/** The fixed header of a P-256 SubjectPublicKeyInfo. The 65-byte uncompressed point follows it. */
const SPKI_HEADER = hex.decode("3059301306072a8648ce3d020106082a8648ce3d030107034200");

function assertOnCurve(raw: RawPublicKey): void {
  if (raw.length !== 64) throw new Error("A P-256 public key must be 64 bytes.");
  p256.Point.fromBytes(concat(Uint8Array.of(4), raw)).assertValidity();
}

/** Reads the key a browser reports for a new passkey (`getPublicKey()`). */
export function publicKeyFromSpki(spki: Uint8Array): RawPublicKey {
  if (spki.length !== SPKI_HEADER.length + 65) throw new Error("This passkey is not a P-256 key.");
  for (let i = 0; i < SPKI_HEADER.length; i++) {
    if (spki[i] !== SPKI_HEADER[i]) throw new Error("This passkey is not a P-256 key.");
  }
  if (spki[SPKI_HEADER.length] !== 4) throw new Error("This passkey's key is not in uncompressed form.");
  const raw = spki.slice(SPKI_HEADER.length + 1);
  assertOnCurve(raw);
  return raw;
}

/** `p256:<base58>`, the spelling the contract uses for keys. */
export function encodePublicKey(raw: RawPublicKey): string {
  assertOnCurve(raw);
  return `${CURVE}:${base58.encode(raw)}`;
}

export function decodePublicKey(text: string): RawPublicKey {
  const [curve, data] = text.split(":");
  if (curve !== CURVE || !data) throw new Error("Not a P-256 public key.");
  const raw = base58.decode(data);
  assertOnCurve(raw);
  return raw;
}

/**
 * The account a passkey creates.
 * `"0x" + hex(keccak256("p256" || publicKey)[12..32])`, as in `PublicKey::to_implicit_account_id`.
 */
export function accountIdOf(raw: RawPublicKey): string {
  assertOnCurve(raw);
  return hashToAccountId(raw);
}

/** The bare derivation, with no check that the bytes are a real key. Prefer `accountIdOf`. */
export function hashToAccountId(raw: Uint8Array): string {
  return "0x" + hex.encode(keccak_256(concat(utf8(CURVE), raw)).slice(12));
}

export function isAccountId(text: string): boolean {
  return /^0x[0-9a-f]{40}$/.test(text);
}

/**
 * Authenticators sign in DER. The contract wants the bare 64 bytes, r then s.
 *
 * Every ECDSA signature has a twin: (r, s) and (r, n - s) are both valid. An authenticator
 * returns either one, about half the time each, but the verifier contract accepts only the
 * twin with the lower s. So the signature is always moved to that form here, the one place
 * an authenticator's signature enters the app.
 */
export function signatureFromDer(der: Uint8Array): Uint8Array {
  const sig = p256.Signature.fromBytes(der, "der");
  const s = sig.hasHighS() ? p256.Point.Fn.ORDER - sig.s : sig.s;
  return new p256.Signature(sig.r, s).toBytes("compact");
}

export function encodeSignature(raw: Uint8Array): string {
  if (raw.length !== 64) throw new Error("A P-256 signature must be 64 bytes.");
  return `${CURVE}:${base58.encode(raw)}`;
}
