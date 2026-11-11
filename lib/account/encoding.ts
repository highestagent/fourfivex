import { base64, base64urlnopad } from "@scure/base";

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function fromBuffer(buf: ArrayBuffer | ArrayBufferView): Uint8Array {
  return buf instanceof ArrayBuffer
    ? new Uint8Array(buf.slice(0))
    : new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

/** base64url without padding, the form WebAuthn uses. Padding is tolerated on the way in. */
export const b64u = {
  encode: (bytes: Uint8Array): string => base64urlnopad.encode(bytes),
  decode: (text: string): Uint8Array => base64urlnopad.decode(text.replace(/=+$/, "")),
};

export const b64 = {
  encode: (bytes: Uint8Array): string => base64.encode(bytes),
  decode: (text: string): Uint8Array => base64.decode(text),
};

export function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
