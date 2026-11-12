/**
 * What a passkey is told about its owner when it is made (WebAuthn's user handle).
 * It comes back every time the passkey is used, which makes it the one place a passkey
 * can carry a note to a device that has never seen it.
 *
 * The first passkey of an account cannot know its account, because the account is derived
 * from the key that is only then being created. A later passkey is told which account it joins.
 * The note is a hint only. It is never trusted without asking the contract.
 */
import { hex } from "@scure/base";
import { concat } from "./encoding";
import { isAccountId } from "./keys";

const FOUNDER = 0;
const MEMBER = 1;

export type Handle = { kind: "founder" } | { kind: "member"; accountId: string } | { kind: "unknown" };

/** For the passkey that creates an account. */
export function founderHandle(random: Uint8Array): Uint8Array {
  return concat(Uint8Array.of(FOUNDER), random.slice(0, 15));
}

/**
 * For a passkey added to an existing account. The random tail keeps a second backup
 * from silently replacing the first one in the same password manager.
 */
export function memberHandle(accountId: string, random: Uint8Array): Uint8Array {
  if (!isAccountId(accountId)) throw new Error("Not an account id.");
  return concat(Uint8Array.of(MEMBER), hex.decode(accountId.slice(2)), random.slice(0, 8));
}

export function parseHandle(bytes: Uint8Array | null): Handle {
  if (!bytes || bytes.length === 0) return { kind: "unknown" };
  if (bytes[0] === FOUNDER) return { kind: "founder" };
  if (bytes[0] === MEMBER && bytes.length >= 21) return { kind: "member", accountId: "0x" + hex.encode(bytes.slice(1, 21)) };
  return { kind: "unknown" };
}
