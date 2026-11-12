/**
 * Working out which account a passkey opens.
 *
 * Nothing about an account is kept on a server. A device that has used a passkey before
 * remembers its public key. A device that has not must find the key again from the
 * passkey's own signatures, then confirm with the contract that the key belongs.
 */
import { assertionProblem, recoverPublicKeys, verifyAssertion, type Assertion } from "./assertion";
import { equal } from "./encoding";
import { parseHandle } from "./handle";
import { accountIdOf, decodePublicKey, encodePublicKey, type RawPublicKey } from "./keys";

/** What a device remembers about a passkey it has seen. All of it is public. */
export type Known = { credentialId: string; publicKey: string; accountId: string };

export type Opened = {
  accountId: string;
  publicKey: RawPublicKey;
  credentialId: string;
  /** False when this device had to work the key out from scratch. */
  remembered: boolean;
};

export type OpenDeps = {
  /** Ask a passkey to sign. With `allow`, only those passkeys may answer. */
  use: (challenge: Uint8Array, allow?: string[]) => Promise<Assertion>;
  /** Ask the contract whether a key may sign for an account. */
  hasKey: (accountId: string, publicKey: string) => Promise<boolean>;
  recall: (credentialId: string) => Known | undefined;
  /** Called before a second touch is needed, so the screen can say why. */
  onSecondTouch?: () => void;
  challenge?: () => Uint8Array;
};

export type AccountErrorCode = "detached" | "mismatch" | "unreadable";

export class AccountError extends Error {
  constructor(
    readonly code: AccountErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const DETACHED = "This passkey is no longer attached to an account. It may have been removed from another device.";

const fresh = () => crypto.getRandomValues(new Uint8Array(32));

/** The keys that could have made this signature and really do verify it. */
function candidates(a: Assertion, challenge: Uint8Array): RawPublicKey[] {
  return recoverPublicKeys(a).filter((k) => verifyAssertion(k, challenge, a));
}

export async function openWithPasskey(deps: OpenDeps): Promise<Opened> {
  const next = deps.challenge ?? fresh;
  const c1 = next();
  const a1 = await deps.use(c1);
  const problem = assertionProblem(a1, c1);
  if (problem) throw new AccountError("unreadable", problem);

  // A passkey this device has used before.
  const known = deps.recall(a1.credentialId);
  if (known) {
    const publicKey = decodePublicKey(known.publicKey);
    if (!verifyAssertion(publicKey, c1, a1))
      throw new AccountError("mismatch", "This device's record of that passkey does not match it. Nothing was opened.");
    if (!(await deps.hasKey(known.accountId, known.publicKey))) throw new AccountError("detached", DETACHED);
    return { accountId: known.accountId, publicKey, credentialId: a1.credentialId, remembered: true };
  }

  let found = candidates(a1, c1);
  if (found.length === 0) throw new AccountError("unreadable", "The passkey's signature could not be read.");

  // A passkey added to an existing account says which one. The contract decides if that is true.
  const handle = parseHandle(a1.userHandle);
  if (handle.kind === "member") {
    for (const publicKey of found) {
      if (await deps.hasKey(handle.accountId, encodePublicKey(publicKey)))
        return { accountId: handle.accountId, publicKey, credentialId: a1.credentialId, remembered: false };
    }
    throw new AccountError("detached", DETACHED);
  }

  // The passkey that created its account. One signature leaves two possible keys; a second settles it.
  if (found.length > 1) {
    deps.onSecondTouch?.();
    const c2 = next();
    const a2 = await deps.use(c2, [a1.credentialId]);
    if (a2.credentialId !== a1.credentialId)
      throw new AccountError("unreadable", "A different passkey answered the second time. Please try again.");
    const again = candidates(a2, c2);
    found = found.filter((k) => again.some((j) => equal(j, k)));
  }
  if (found.length !== 1) throw new AccountError("unreadable", "The passkey's key could not be worked out. Please try again.");

  const publicKey = found[0];
  const accountId = accountIdOf(publicKey);
  if (!(await deps.hasKey(accountId, encodePublicKey(publicKey)))) throw new AccountError("detached", DETACHED);
  return { accountId, publicKey, credentialId: a1.credentialId, remembered: false };
}
