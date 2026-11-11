/**
 * Building what a passkey signs for the verifier contract (`intents.near`).
 * Layouts follow github.com/near/intents, contracts/defuse/core (payload and nonce).
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { hex } from "@scure/base";
import type { Assertion } from "./assertion";
import { b64, b64u, concat, utf8 } from "./encoding";
import { encodePublicKey, encodeSignature, type RawPublicKey } from "./keys";

export const VERIFIER = "intents.near";

export type Intent =
  | { intent: "add_public_key"; public_key: string }
  | { intent: "remove_public_key"; public_key: string };

export type SignedIntent = {
  standard: "webauthn";
  payload: string;
  public_key: string;
  signature: string;
  client_data_json: string;
  authenticator_data: string;
};

const NONCE_MAGIC = hex.decode("5628f6c6");
const NONCE_V1 = 0;

/**
 * A versioned nonce: magic (4) | version (1) | salt (4) | deadline in ns, little endian (8) | random (15).
 * The salt comes from the contract and rotates, so fetch it fresh.
 */
export function makeNonce(saltHex: string, deadline: Date, random: Uint8Array): string {
  const salt = hex.decode(saltHex);
  if (salt.length !== 4) throw new Error("The contract's salt must be 4 bytes.");
  if (random.length !== 15) throw new Error("A nonce needs 15 random bytes.");
  const when = new Uint8Array(8);
  new DataView(when.buffer).setBigInt64(0, BigInt(deadline.getTime()) * BigInt(1_000_000), true);
  return b64.encode(concat(NONCE_MAGIC, Uint8Array.of(NONCE_V1), salt, when, random));
}

/** The exact string that is hashed and signed. Its bytes must not change afterwards. */
export function buildPayload(p: { signerId: string; deadline: Date; nonce: string; intents: Intent[] }): string {
  return JSON.stringify({
    signer_id: p.signerId,
    verifying_contract: VERIFIER,
    deadline: p.deadline.toISOString(),
    nonce: p.nonce,
    intents: p.intents,
  });
}

/** What the passkey is asked to sign: the hash of the payload, so the two cannot be separated. */
export function challengeFor(payload: string): Uint8Array {
  return sha256(utf8(payload));
}

export function signedIntent(payload: string, publicKey: RawPublicKey, a: Assertion): SignedIntent {
  return {
    standard: "webauthn",
    payload,
    public_key: encodePublicKey(publicKey),
    signature: encodeSignature(a.signature),
    client_data_json: a.clientDataJSON,
    authenticator_data: b64u.encode(a.authenticatorData),
  };
}
