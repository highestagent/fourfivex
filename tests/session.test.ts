import { describe, expect, it } from "vitest";
import type { Assertion } from "../lib/account/assertion";
import { equal } from "../lib/account/encoding";
import { founderHandle, memberHandle, parseHandle } from "../lib/account/handle";
import { accountIdOf, encodePublicKey } from "../lib/account/keys";
import { AccountError, openWithPasskey, type Known } from "../lib/account/session";
import { makeAuthenticator } from "./virtual-authenticator";

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

/** A stand-in for the browser, the contract and this device's memory. */
function world(passkey: ReturnType<typeof makeAuthenticator>, handle: Uint8Array) {
  const attached = new Set<string>();
  const memory = new Map<string, Known>();
  const prompts: (string[] | undefined)[] = [];
  let secondTouch = 0;
  return {
    attached,
    memory,
    prompts,
    get secondTouch() {
      return secondTouch;
    },
    attach: (accountId: string, key: Uint8Array) => attached.add(`${accountId}|${encodePublicKey(key)}`),
    deps: {
      use: async (challenge: Uint8Array, allow?: string[]): Promise<Assertion> => {
        prompts.push(allow);
        return passkey.assert(challenge, handle);
      },
      hasKey: async (accountId: string, publicKey: string) => attached.has(`${accountId}|${publicKey}`),
      recall: (id: string) => memory.get(id),
      onSecondTouch: () => {
        secondTouch++;
      },
    },
  };
}

describe("user handle", () => {
  it("tells a founding passkey from one that joined an account", () => {
    const account = accountIdOf(makeAuthenticator().publicKey);
    expect(parseHandle(founderHandle(random(15)))).toEqual({ kind: "founder" });
    expect(parseHandle(memberHandle(account, random(8)))).toEqual({ kind: "member", accountId: account });
    expect(parseHandle(null)).toEqual({ kind: "unknown" });
    expect(parseHandle(Uint8Array.of(9, 9, 9))).toEqual({ kind: "unknown" });
  });

  it("gives two backups of one account different handles", () => {
    const account = accountIdOf(makeAuthenticator().publicKey);
    expect(equal(memberHandle(account, random(8)), memberHandle(account, random(8)))).toBe(false);
  });
});

describe("opening an account with a passkey", () => {
  it("takes one touch on a device that remembers the passkey", async () => {
    const passkey = makeAuthenticator();
    const account = accountIdOf(passkey.publicKey);
    const w = world(passkey, founderHandle(random(15)));
    w.attach(account, passkey.publicKey);
    w.memory.set(passkey.credentialId, {
      credentialId: passkey.credentialId,
      publicKey: encodePublicKey(passkey.publicKey),
      accountId: account,
    });
    const opened = await openWithPasskey(w.deps);
    expect(opened.accountId).toBe(account);
    expect(opened.remembered).toBe(true);
    expect(w.prompts.length).toBe(1);
  });

  it("works a founding passkey out from two touches on a new device, with no server", async () => {
    const passkey = makeAuthenticator();
    const account = accountIdOf(passkey.publicKey);
    const w = world(passkey, founderHandle(random(15)));
    w.attach(account, passkey.publicKey);
    const opened = await openWithPasskey(w.deps);
    expect(opened.accountId).toBe(account);
    expect(equal(opened.publicKey, passkey.publicKey)).toBe(true);
    expect(opened.remembered).toBe(false);
    expect(w.prompts.length).toBe(2);
    expect(w.prompts[1]).toEqual([passkey.credentialId]);
    expect(w.secondTouch).toBe(1);
  });

  it("opens a backup passkey's account in one touch on a new device", async () => {
    const founder = makeAuthenticator();
    const backup = makeAuthenticator();
    const account = accountIdOf(founder.publicKey);
    const w = world(backup, memberHandle(account, random(8)));
    w.attach(account, backup.publicKey);
    const opened = await openWithPasskey(w.deps);
    expect(opened.accountId).toBe(account);
    expect(equal(opened.publicKey, backup.publicKey)).toBe(true);
    expect(w.prompts.length).toBe(1);
  });

  it("does not believe a passkey that merely claims to belong to an account", async () => {
    const victim = accountIdOf(makeAuthenticator().publicKey);
    const impostor = makeAuthenticator();
    const w = world(impostor, memberHandle(victim, random(8)));
    await expect(openWithPasskey(w.deps)).rejects.toMatchObject({ code: "detached" });
  });

  it("refuses a passkey that was removed from its account", async () => {
    const passkey = makeAuthenticator();
    const account = accountIdOf(passkey.publicKey);
    const w = world(passkey, founderHandle(random(15)));
    w.memory.set(passkey.credentialId, {
      credentialId: passkey.credentialId,
      publicKey: encodePublicKey(passkey.publicKey),
      accountId: account,
    });
    await expect(openWithPasskey(w.deps)).rejects.toBeInstanceOf(AccountError);
  });

  it("refuses when this device's record of the passkey has been altered", async () => {
    const passkey = makeAuthenticator();
    const other = makeAuthenticator();
    const w = world(passkey, founderHandle(random(15)));
    w.attach(accountIdOf(other.publicKey), other.publicKey);
    w.memory.set(passkey.credentialId, {
      credentialId: passkey.credentialId,
      publicKey: encodePublicKey(other.publicKey),
      accountId: accountIdOf(other.publicKey),
    });
    await expect(openWithPasskey(w.deps)).rejects.toMatchObject({ code: "mismatch" });
  });
});
