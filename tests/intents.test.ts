import { hex } from "@scure/base";
import { describe, expect, it } from "vitest";
import { verifyAssertion } from "../lib/account/assertion";
import { b64, b64u } from "../lib/account/encoding";
import { buildPayload, challengeFor, makeNonce, signedIntent, VERIFIER } from "../lib/account/intents";
import { accountIdOf, decodePublicKey, encodePublicKey } from "../lib/account/keys";
import { makeAuthenticator } from "./virtual-authenticator";

describe("nonce", () => {
  it("has the layout of the nonces in the contract's documentation", () => {
    // docs.near-intents.org, signing-intents: a nonce minted under salt 252812b3
    const documented = b64.decode("Vij2xgAlKBKzgNPJFViEQRgYyS7p2NEiYTTY4XmT8go=");
    expect(hex.encode(documented.slice(0, 4))).toBe("5628f6c6");
    expect(documented[4]).toBe(0);
    expect(hex.encode(documented.slice(5, 9))).toBe("252812b3");
  });

  it("packs magic, version, salt, deadline and randomness into 32 bytes", () => {
    const deadline = new Date("2026-11-12T10:00:00.000Z");
    const random = new Uint8Array(15).fill(0xab);
    const nonce = b64.decode(makeNonce("252812b3", deadline, random));
    expect(nonce.length).toBe(32);
    expect(hex.encode(nonce.slice(0, 4))).toBe("5628f6c6");
    expect(nonce[4]).toBe(0);
    expect(hex.encode(nonce.slice(5, 9))).toBe("252812b3");
    const ns = new DataView(nonce.buffer, nonce.byteOffset + 9, 8).getBigInt64(0, true);
    expect(ns).toBe(BigInt(deadline.getTime()) * BigInt(1_000_000));
    expect(hex.encode(nonce.slice(17))).toBe("ab".repeat(15));
  });

  it("refuses a malformed salt or too little randomness", () => {
    expect(() => makeNonce("2528", new Date(), new Uint8Array(15))).toThrow();
    expect(() => makeNonce("252812b3", new Date(), new Uint8Array(8))).toThrow();
  });
});

describe("signed intent", () => {
  it("is built so the contract's checks pass", () => {
    const owner = makeAuthenticator();
    const backup = makeAuthenticator();
    const signerId = accountIdOf(owner.publicKey);
    const deadline = new Date(Date.now() + 5 * 60_000);
    const payload = buildPayload({
      signerId,
      deadline,
      nonce: makeNonce("252812b3", deadline, crypto.getRandomValues(new Uint8Array(15))),
      intents: [{ intent: "add_public_key", public_key: encodePublicKey(backup.publicKey) }],
    });

    const parsed = JSON.parse(payload);
    expect(Object.keys(parsed)).toEqual(["signer_id", "verifying_contract", "deadline", "nonce", "intents"]);
    expect(parsed.verifying_contract).toBe(VERIFIER);
    expect(parsed.signer_id).toBe(signerId);

    const assertion = owner.assert(challengeFor(payload));
    const signed = signedIntent(payload, owner.publicKey, assertion);
    expect(signed.standard).toBe("webauthn");
    expect(signed.payload).toBe(payload);

    // Re-read the envelope the way the contract does and verify it from scratch.
    const key = decodePublicKey(signed.public_key);
    expect(accountIdOf(key)).toBe(signerId);
    expect(
      verifyAssertion(key, challengeFor(signed.payload), {
        ...assertion,
        authenticatorData: b64u.decode(signed.authenticator_data),
        clientDataJSON: signed.client_data_json,
      }),
    ).toBe(true);
  });

  it("cannot be moved onto a different payload", () => {
    const owner = makeAuthenticator();
    const deadline = new Date(Date.now() + 60_000);
    const base = { signerId: accountIdOf(owner.publicKey), deadline, nonce: makeNonce("252812b3", deadline, new Uint8Array(15)) };
    const asked = buildPayload({ ...base, intents: [{ intent: "add_public_key", public_key: encodePublicKey(owner.publicKey) }] });
    const swapped = buildPayload({ ...base, intents: [{ intent: "remove_public_key", public_key: encodePublicKey(owner.publicKey) }] });
    const assertion = owner.assert(challengeFor(asked));
    expect(verifyAssertion(owner.publicKey, challengeFor(swapped), assertion)).toBe(false);
  });
});
