import { p256 } from "@noble/curves/nist.js";
import { base58 } from "@scure/base";
import { describe, expect, it } from "vitest";
import { equal } from "../lib/account/encoding";
import {
  accountIdOf,
  decodePublicKey,
  encodePublicKey,
  encodeSignature,
  hashToAccountId,
  isAccountId,
  publicKeyFromSpki,
  signatureFromDer,
} from "../lib/account/keys";

describe("account id", () => {
  // From the contract's own tests: contracts/defuse/core/src/public_key.rs
  it("matches the verifier contract's test vector", () => {
    // The contract's vector reuses 64 bytes that are not a point on P-256, so it exercises
    // the derivation alone. `accountIdOf` rightly refuses those bytes.
    const bytes = base58.decode("3aMVMxsoAnHUbweXMtdKaN1uJaNwsfKv7wnc97SDGjXhyK62VyJwhPUPLZefKVthcoUcuWK6cqkSU4M542ipNxS3");
    expect(hashToAccountId(bytes)).toBe("0x7edf07ede58238026db3f90fc8032633b69b8de5");
    expect(() => accountIdOf(bytes)).toThrow();
  });

  // From contracts/defuse/core/src/payload/webauthn.rs
  it("matches the signer in the contract's passkey example", () => {
    const key = decodePublicKey(
      "p256:2V8Np9vGqLiwVZ8qmMmpkxU7CTRqje4WtwFeLimSwuuyF1rddQK5fELiMgxUnYbVjbZHCNnGc6fAe4JeDcVxgj3Q",
    );
    expect(accountIdOf(key)).toBe("0x3602b546589a8fcafdce7fad64a46f91db0e4d50");
  });

  it("recognises its own shape", () => {
    expect(isAccountId("0x7edf07ede58238026db3f90fc8032633b69b8de5")).toBe(true);
    expect(isAccountId("0x7EDF07ede58238026db3f90fc8032633b69b8de5")).toBe(false);
    expect(isAccountId("alice.near")).toBe(false);
  });
});

describe("public keys", () => {
  it("reads the key a browser reports for a new passkey", async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
    const point = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    expect(equal(publicKeyFromSpki(spki), point.slice(1))).toBe(true);
  });

  it("refuses a key on another curve", async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-384" }, true, ["sign", "verify"]);
    const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
    expect(() => publicKeyFromSpki(spki)).toThrow();
  });

  it("round-trips the contract's spelling", () => {
    const raw = p256.getPublicKey(p256.utils.randomSecretKey(), false).slice(1);
    const text = encodePublicKey(raw);
    expect(text.startsWith("p256:")).toBe(true);
    expect(equal(decodePublicKey(text), raw)).toBe(true);
  });

  it("refuses bytes that are not a point on the curve", () => {
    const junk = new Uint8Array(64).fill(7);
    expect(() => encodePublicKey(junk)).toThrow();
    expect(() => accountIdOf(junk)).toThrow();
    expect(() => decodePublicKey("ed25519:5TagutioHgKLh7KZ1VEFBYfgRkPtqnKm9LoMnJMJugxm")).toThrow();
  });
});

describe("signatures", () => {
  it("turns an authenticator's DER signature into the 64 bytes the contract wants", () => {
    const key = p256.utils.randomSecretKey();
    const msg = new Uint8Array([1, 2, 3]);
    const der = p256.sign(msg, key, { format: "der", lowS: false });
    const compact = p256.sign(msg, key, { format: "compact", lowS: false });
    const raw = signatureFromDer(der);
    expect(raw.length).toBe(64);
    expect(equal(raw, compact)).toBe(true);
    expect(encodeSignature(raw).startsWith("p256:")).toBe(true);
  });
});
