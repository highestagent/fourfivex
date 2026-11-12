"use client";

/**
 * The things a person can do to their account, each as one function.
 * Every change to an account is signed by a passkey. Nothing is signed for them.
 */
import { verifyAssertion } from "./assertion";
import { fetchKeys, fetchSalt, hasKey, intentStatus, NetworkError, publishIntent } from "./api";
import { founderHandle, memberHandle } from "./handle";
import { buildPayload, challengeFor, makeNonce, signedIntent, type Intent } from "./intents";
import { accountIdOf, decodePublicKey, encodePublicKey } from "./keys";
import { createPasskey, askPasskey } from "./passkey";
import { openWithPasskey } from "./session";
import { memory, type Passkey } from "./store";

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Creating a passkey is creating the account. Nothing is sent anywhere. */
export async function createAccount(name: string): Promise<string> {
  const label = name.trim() || "My account";
  const { credentialId, publicKey } = await createPasskey({ label, handle: founderHandle(random(15)) });
  const accountId = accountIdOf(publicKey);
  memory.remember({
    credentialId,
    publicKey: encodePublicKey(publicKey),
    accountId,
    label: "First passkey",
    addedAt: Date.now(),
    founder: true,
  });
  memory.name(accountId, label);
  memory.open(accountId);
  return accountId;
}

/** Finds the account a passkey opens. `onSecondTouch` fires if a new device needs one more touch. */
export async function openAccount(onSecondTouch?: () => void): Promise<string> {
  const opened = await openWithPasskey({ use: askPasskey, hasKey, recall: memory.recall, onSecondTouch });
  if (!opened.remembered) {
    const founder = accountIdOf(opened.publicKey) === opened.accountId;
    memory.remember({
      credentialId: opened.credentialId,
      publicKey: encodePublicKey(opened.publicKey),
      accountId: opened.accountId,
      label: founder ? "First passkey" : "Backup passkey",
      addedAt: Date.now(),
      founder,
    });
  }
  memory.open(opened.accountId);
  return opened.accountId;
}

export function signOut(): void {
  memory.open(null);
}

/** Has a passkey of this account sign one key-management intent, sends it, and waits for it to land. */
async function signAndSend(accountId: string, intent: Intent, onStep: (step: string) => void): Promise<void> {
  const signers = memory.get().passkeys.filter((p) => p.accountId === accountId && !p.pending);
  if (signers.length === 0) throw new NetworkError("This device has no passkey for the account. Sign in again first.");

  onStep("Preparing");
  const deadline = new Date(Date.now() + 5 * 60_000);
  const payload = buildPayload({
    signerId: accountId,
    deadline,
    nonce: makeNonce(await fetchSalt(), deadline, random(15)),
    intents: [intent],
  });
  const challenge = challengeFor(payload);

  onStep("Waiting for your passkey");
  const assertion = await askPasskey(
    challenge,
    signers.map((p) => p.credentialId),
  );
  const signer = signers.find((p) => p.credentialId === assertion.credentialId);
  if (!signer || !verifyAssertion(decodePublicKey(signer.publicKey), challenge, assertion))
    throw new NetworkError("That passkey's signature did not check out. Nothing was sent.");

  onStep("Sending");
  const intentHash = await publishIntent(signedIntent(payload, decodePublicKey(signer.publicKey), assertion));

  onStep("Waiting for the network");
  for (let i = 0; i < 40; i++) {
    await sleep(1500);
    const { status, details } = await intentStatus(intentHash);
    if (status === "SETTLED") return;
    if (status === "NOT_FOUND_OR_NOT_VALID" && i > 2) throw new NetworkError(details || "The network did not accept it.");
  }
  throw new NetworkError("The network is taking too long to confirm. Check again in a minute.");
}

/** Attaches a passkey that was created here but is not yet on the account. */
export async function attachPasskey(pending: Passkey, onStep: (step: string) => void): Promise<void> {
  if (!(await hasKey(pending.accountId, pending.publicKey)))
    await signAndSend(pending.accountId, { intent: "add_public_key", public_key: pending.publicKey }, onStep);
  if (!(await hasKey(pending.accountId, pending.publicKey)))
    throw new NetworkError("The network confirmed, but the passkey is not showing on the account yet. Try again shortly.");
  memory.confirm(pending.credentialId);
}

/**
 * Makes a second passkey and attaches it to the account, so losing one device does not
 * lose the account. Two prompts: one to make the new passkey, one for an existing passkey to approve it.
 */
export async function addBackupPasskey(accountId: string, name: string, onStep: (step: string) => void): Promise<void> {
  onStep("Creating the new passkey");
  const { credentialId, publicKey } = await createPasskey({
    label: `${name} (backup)`,
    handle: memberHandle(accountId, random(8)),
    exclude: memory.get().passkeys.filter((p) => p.accountId === accountId).map((p) => p.credentialId),
  });
  const pending: Passkey = {
    credentialId,
    publicKey: encodePublicKey(publicKey),
    accountId,
    label: "Backup passkey",
    addedAt: Date.now(),
    founder: false,
    pending: true,
  };
  // Remembered straight away, so a failure after this point can be retried without making another.
  memory.remember(pending);
  await attachPasskey(pending, onStep);
}

/** How many passkeys can currently sign for the account, as far as this device can tell. */
export async function countPasskeys(accountId: string): Promise<{ added: string[]; founderAttached: boolean | null }> {
  const added = await fetchKeys(accountId);
  const founder = memory.get().passkeys.find((p) => p.accountId === accountId && p.founder);
  return { added, founderAttached: founder ? await hasKey(accountId, founder.publicKey) : null };
}

/** Detaches a passkey from the account. Refuses to remove the last one. */
export async function removePasskey(accountId: string, publicKey: string, onStep: (step: string) => void): Promise<void> {
  onStep("Checking");
  const { added, founderAttached } = await countPasskeys(accountId);
  const remaining = added.filter((k) => k !== publicKey).length + (founderAttached && accountIdOf(decodePublicKey(publicKey)) !== accountId ? 1 : 0);
  if (remaining === 0)
    throw new NetworkError("This is the only passkey this device can confirm on the account. Add a backup before removing it.");
  await signAndSend(accountId, { intent: "remove_public_key", public_key: publicKey }, onStep);
  const local = memory.get().passkeys.find((p) => p.publicKey === publicKey);
  if (local) memory.forget(local.credentialId);
}
