import { p256 } from "@noble/curves/nist.js";
import { base58, hex } from "@scure/base";
import { describe, expect, it } from "vitest";
import { assertionProblem, recoverPublicKeys, verifyAssertion, type Assertion } from "../lib/account/assertion";
import { b64u, equal } from "../lib/account/encoding";
import { challengeFor } from "../lib/account/intents";
import { accountIdOf, decodePublicKey } from "../lib/account/keys";
import { makeAuthenticator } from "./virtual-authenticator";

// crates/signatures/webauthn/src/p256.rs, `verify_ok`
const CONTRACT_VECTOR = {
  publicKey: p256.Point.fromBytes(hex.decode("03b87da10683d04e6ec4e2f1775556a63cbb01be843058eb737fe02f9e22663093"))
    .toBytes(false)
    .slice(1),
  challenge: hex.decode("06f269191431372337a0c606a15822e349bd0d5ec317704f97bef1a4ed6f5e1d"),
  assertion: {
    credentialId: "",
    authenticatorData: hex.decode("49960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d97631d00000000"),
    clientDataJSON:
      '{"type":"webauthn.get","challenge":"BvJpGRQxNyM3oMYGoVgi40m9DV7DF3BPl77xpO1vXh0","origin":"http://localhost:5173","crossOrigin":false}',
    signature: hex.decode(
      "002527c17a17d709ab62ffab033e0a26d901f5bee6686a0d605032828e490a7c47a9f4161e6a17688ae42a66adb67c9c22c86153afb08103b1e9eccd5314c271",
    ),
    userHandle: null,
  } satisfies Assertion,
};

// contracts/defuse/core/src/payload/webauthn.rs, `p256`: a real passkey signature the contract accepts
const SIGNED_EXAMPLE = {
  payload:
    '{"signer_id":"0x3602b546589a8fcafdce7fad64a46f91db0e4d50","verifying_contract":"defuse.test.near","deadline":"2025-03-30T00:00:00Z","nonce":"A3nsY1GMVjzyXL3mUzOOP3KT+5a0Ruy+QDNWPhchnxM=","intents":[{"intent":"transfer","receiver_id":"user1.test.near","tokens":{"nep141:ft1.poa-factory.test.near":"1000"}}]}',
  public_key: "p256:2V8Np9vGqLiwVZ8qmMmpkxU7CTRqje4WtwFeLimSwuuyF1rddQK5fELiMgxUnYbVjbZHCNnGc6fAe4JeDcVxgj3Q",
  signature: "p256:3KBMZ72BHUiVfE1ey5dpi3KgbXvSEf9kuxgBEax7qLBQtidZExxxjjQk1hTTGFRrPvUoEStfrjoFNVVW4Abar94W",
  client_data_json:
    '{"type":"webauthn.get","challenge":"4cveZsIe6p-WaEcL-Lhtzt3SZuXbYsjDdlFhLNrSjjk","origin":"https://defuse-widget-git-feat-passkeys-defuse-94bbc1b2.vercel.app"}',
  authenticator_data: "933cQogpBzE3RSAYSAkfWoNEcBd3X84PxE8iRrRVxMgdAAAAAA==",
};

describe("verifying a passkey's signature", () => {
  it("accepts the contract's test vector", () => {
    expect(verifyAssertion(CONTRACT_VECTOR.publicKey, CONTRACT_VECTOR.challenge, CONTRACT_VECTOR.assertion)).toBe(true);
  });

  it("accepts the real signed intent from the contract's tests", () => {
    const key = decodePublicKey(SIGNED_EXAMPLE.public_key);
    const assertion: Assertion = {
      credentialId: "",
      authenticatorData: b64u.decode(SIGNED_EXAMPLE.authenticator_data),
      clientDataJSON: SIGNED_EXAMPLE.client_data_json,
      signature: base58.decode(SIGNED_EXAMPLE.signature.split(":")[1]),
      userHandle: null,
    };
    const challenge = challengeFor(SIGNED_EXAMPLE.payload);
    // The challenge is the hash of the payload, so a signature cannot be moved to another payload.
    expect(b64u.encode(challenge)).toBe("4cveZsIe6p-WaEcL-Lhtzt3SZuXbYsjDdlFhLNrSjjk");
    expect(verifyAssertion(key, challenge, assertion)).toBe(true);
    expect(accountIdOf(key)).toBe(JSON.parse(SIGNED_EXAMPLE.payload).signer_id);
  });

  it("rejects a different challenge, a different key and a changed signature", () => {
    const { publicKey, challenge, assertion } = CONTRACT_VECTOR;
    const other = challenge.slice();
    other[0] ^= 1;
    expect(verifyAssertion(publicKey, other, assertion)).toBe(false);
    expect(verifyAssertion(makeAuthenticator().publicKey, challenge, assertion)).toBe(false);
    const bent = assertion.signature.slice();
    bent[40] ^= 1;
    expect(verifyAssertion(publicKey, challenge, { ...assertion, signature: bent })).toBe(false);
  });

  it("insists the person was verified, not just present", () => {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const presentOnly = makeAuthenticator({ flags: 0x01 });
    const a = presentOnly.assert(challenge);
    expect(assertionProblem(a, challenge)).toMatch(/verify it was you/);
    expect(verifyAssertion(presentOnly.publicKey, challenge, a)).toBe(false);
  });

  it("rejects an impossible backup state and a registration reply", () => {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const odd = makeAuthenticator({ flags: 0x15 }).assert(challenge);
    expect(assertionProblem(odd, challenge)).toMatch(/backup state/);
    const good = makeAuthenticator().assert(challenge);
    const create = { ...good, clientDataJSON: good.clientDataJSON.replace("webauthn.get", "webauthn.create") };
    expect(assertionProblem(create, challenge)).toMatch(/different kind/);
  });
});

describe("finding a passkey's public key again", () => {
  it("recovers the contract vector's key from its signature", () => {
    const found = recoverPublicKeys(CONTRACT_VECTOR.assertion);
    expect(found.length).toBeGreaterThan(0);
    expect(found.some((k) => equal(k, CONTRACT_VECTOR.publicKey))).toBe(true);
  });

  it("narrows to one key with two signatures", () => {
    for (let i = 0; i < 25; i++) {
      const passkey = makeAuthenticator();
      const first = recoverPublicKeys(passkey.assert(crypto.getRandomValues(new Uint8Array(32))));
      const second = recoverPublicKeys(passkey.assert(crypto.getRandomValues(new Uint8Array(32))));
      const both = first.filter((k) => second.some((j) => equal(j, k)));
      expect(both.length).toBe(1);
      expect(equal(both[0], passkey.publicKey)).toBe(true);
    }
  });
});
