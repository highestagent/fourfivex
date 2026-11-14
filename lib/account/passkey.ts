/**
 * The two moments a passkey is touched: making one, and asking one to sign.
 * Browser only. The private key stays inside the authenticator; this code never sees it.
 */
import type { Assertion } from "./assertion";
import { b64u, fromBuffer } from "./encoding";
import { publicKeyFromSpki, signatureFromDer, type RawPublicKey } from "./keys";
import { afterTap } from "./tap";

export type PasskeyErrorCode = "unsupported" | "cancelled" | "exists" | "failed";

export class PasskeyError extends Error {
  constructor(
    readonly code: PasskeyErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const RP_NAME = "fourfivex";
const ES256 = -7;
const TIMEOUT = 120_000;

const buf = (u8: Uint8Array): ArrayBuffer =>
  u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;

export function passkeysAvailable(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;
}

/** A passkey belongs to the site it was made on, so one made on localhost only works there. */
export function isLocalDevelopment(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h.endsWith(".localhost");
}

function explain(err: unknown): PasskeyError {
  if (err instanceof PasskeyError) return err;
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError")
    return new PasskeyError("cancelled", "The passkey prompt was closed before it finished. Nothing changed.");
  if (name === "InvalidStateError") return new PasskeyError("exists", "This device already holds that passkey.");
  if (name === "SecurityError")
    return new PasskeyError("failed", "Passkeys only work on a secure page (https, or localhost while developing).");
  return new PasskeyError("failed", "The passkey could not be used. Please try again.");
}

/** Faster than anyone can close a prompt: the browser refused before showing one. */
const REFUSED_UNSHOWN_MS = 800;

/**
 * Makes a passkey request, and if the browser refuses it at once because no tap led to it (Safari),
 * asks for a tap and makes it again from there. Anything else, including a real cancel, is passed on.
 */
async function withTap<T>(request: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    return await request();
  } catch (err) {
    const unshown = err instanceof DOMException && err.name === "NotAllowedError" && performance.now() - started < REFUSED_UNSHOWN_MS;
    if (!unshown) throw err;
    return afterTap(request, () => new DOMException("The passkey prompt was closed.", "NotAllowedError"));
  }
}

function need(): void {
  if (!passkeysAvailable())
    throw new PasskeyError("unsupported", "This browser cannot use passkeys. Try a current Safari, Chrome, Edge or Firefox.");
}

/**
 * Makes a passkey that lives in the person's own passkey manager and can be found again
 * without typing anything. Requires fingerprint, face or device PIN.
 */
export async function createPasskey(o: {
  label: string;
  handle: Uint8Array;
  exclude?: string[];
}): Promise<{ credentialId: string; publicKey: RawPublicKey }> {
  need();
  let cred: PublicKeyCredential | null;
  try {
    cred = (await withTap(() => navigator.credentials.create({
      publicKey: {
        rp: { name: RP_NAME, id: window.location.hostname },
        user: { id: buf(o.handle), name: o.label, displayName: o.label },
        challenge: buf(crypto.getRandomValues(new Uint8Array(32))),
        pubKeyCredParams: [{ type: "public-key", alg: ES256 }],
        authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" },
        excludeCredentials: (o.exclude ?? []).map((id) => ({ type: "public-key" as const, id: buf(b64u.decode(id)) })),
        attestation: "none",
        timeout: TIMEOUT,
      },
    }))) as PublicKeyCredential | null;
  } catch (err) {
    throw explain(err);
  }
  if (!cred) throw new PasskeyError("failed", "No passkey was created.");
  const response = cred.response as AuthenticatorAttestationResponse;
  if (typeof response.getPublicKey !== "function" || response.getPublicKeyAlgorithm?.() !== ES256)
    throw new PasskeyError("unsupported", "This passkey uses a kind of key the network does not accept.");
  const spki = response.getPublicKey();
  if (!spki) throw new PasskeyError("unsupported", "This browser did not report the new passkey's public key.");
  try {
    return { credentialId: b64u.encode(fromBuffer(cred.rawId)), publicKey: publicKeyFromSpki(fromBuffer(spki)) };
  } catch {
    throw new PasskeyError("unsupported", "This passkey uses a kind of key the network does not accept.");
  }
}

/**
 * Asks a passkey to sign a challenge. With no `allow` list the person picks any passkey
 * they hold for this site, which is how an account is found again on a new device.
 */
export async function askPasskey(challenge: Uint8Array, allow?: string[]): Promise<Assertion> {
  need();
  let cred: PublicKeyCredential | null;
  try {
    cred = (await withTap(() => navigator.credentials.get({
      publicKey: {
        challenge: buf(challenge),
        rpId: window.location.hostname,
        userVerification: "required",
        allowCredentials: (allow ?? []).map((id) => ({ type: "public-key" as const, id: buf(b64u.decode(id)) })),
        timeout: TIMEOUT,
      },
    }))) as PublicKeyCredential | null;
  } catch (err) {
    throw explain(err);
  }
  if (!cred) throw new PasskeyError("failed", "No passkey answered.");
  const r = cred.response as AuthenticatorAssertionResponse;
  try {
    return {
      credentialId: b64u.encode(fromBuffer(cred.rawId)),
      authenticatorData: fromBuffer(r.authenticatorData),
      clientDataJSON: new TextDecoder().decode(r.clientDataJSON),
      signature: signatureFromDer(fromBuffer(r.signature)),
      userHandle: r.userHandle && r.userHandle.byteLength ? fromBuffer(r.userHandle) : null,
    };
  } catch {
    throw new PasskeyError("failed", "The passkey's reply could not be read.");
  }
}
