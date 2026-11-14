/** Encodings NEAR and WebAuthn use. No Worker APIs, so the NEAR client can run anywhere. */

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Decode(text: string): Uint8Array {
  let value = BigInt(0);
  for (const char of text) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) throw new Error('Not base58.');
    value = value * BigInt(58) + BigInt(digit);
  }
  const bytes: number[] = [];
  while (value > BigInt(0)) {
    bytes.unshift(Number(value % BigInt(256)));
    value /= BigInt(256);
  }
  for (const char of text) {
    if (char !== '1') break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

export function base58Encode(bytes: Uint8Array): string {
  let value = BigInt(0);
  for (const byte of bytes) value = value * BigInt(256) + BigInt(byte);
  let text = '';
  while (value > BigInt(0)) {
    text = ALPHABET[Number(value % BigInt(58))] + text;
    value /= BigInt(58);
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    text = '1' + text;
  }
  return text;
}

export const base64url = {
  encode: (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''),
  decode: (text: string) => Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0)),
};
