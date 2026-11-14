import { base58Decode, base58Encode, base64url } from './encoding';

/**
 * The little of NEAR the markets service needs: read a contract, and sign function calls as one account.
 * Plain fetch and WebCrypto, so it runs the same in the Worker and in Node against a local sandbox.
 */

export class NearError extends Error {
  constructor(message: string, readonly kind: 'rpc' | 'failure' = 'rpc') { super(message); }
}

type RpcError = { name?: string; cause?: { name?: string; info?: unknown }; message?: string; data?: unknown };

export async function rpc<T>(url: string, method: string, params: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'fourfivex', method, params }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new NearError('NEAR is unreachable.');
  }
  const body = await response.json().catch(() => null) as { result?: T; error?: RpcError } | null;
  if (!body || body.error || body.result === undefined) {
    const error = body?.error;
    throw new NearError(error?.cause?.name ?? error?.name ?? (response.ok ? 'NEAR did not answer.' : `NEAR answered ${response.status}.`));
  }
  return body.result;
}

/** Calls a view method at final finality, so the answer can't be rolled back. */
export async function view<T>(url: string, contract: string, method: string, args: object): Promise<T> {
  const result = await rpc<{ result?: number[]; error?: string }>(url, 'query', {
    request_type: 'call_function', finality: 'final', account_id: contract, method_name: method,
    args_base64: btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(args)))),
  });
  if (!Array.isArray(result.result)) throw new NearError(result.error ?? 'The contract did not answer.', 'failure');
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(result.result))) as T;
}

class Writer {
  private parts: Uint8Array[] = [];
  bytes(value: Uint8Array) { this.parts.push(value); return this; }
  u8(value: number) { return this.bytes(Uint8Array.of(value)); }
  u32(value: number) { const out = new Uint8Array(4); new DataView(out.buffer).setUint32(0, value, true); return this.bytes(out); }
  u64(value: bigint) { const out = new Uint8Array(8); new DataView(out.buffer).setBigUint64(0, value, true); return this.bytes(out); }
  u128(value: bigint) { return this.u64(value & BigInt('0xffffffffffffffff')).u64(value >> BigInt(64)); }
  string(value: string) { const bytes = new TextEncoder().encode(value); return this.u32(bytes.length).bytes(bytes); }
  vec(value: Uint8Array) { return this.u32(value.length).bytes(value); }
  done() {
    const out = new Uint8Array(this.parts.reduce((size, part) => size + part.length, 0));
    let offset = 0;
    for (const part of this.parts) { out.set(part, offset); offset += part.length; }
    return out;
  }
}

export type FunctionCall = { method: string; args: object; gas: bigint; deposit?: bigint };
export type Outcome = { hash: string; value?: unknown; failure?: string; logs: string[] };

const tera = BigInt(1_000_000_000_000);
export const tgas = (amount: number) => BigInt(amount) * tera;

/** Signs function calls for one account with one ed25519 key. Calls go out one at a time, so nonces never collide. */
export class NearSigner {
  private key?: Promise<{ privateKey: CryptoKey; publicKey: Uint8Array }>;
  private queue: Promise<unknown> = Promise.resolve();
  private nonce?: bigint;

  constructor(private url: string, readonly accountId: string, private secret: string) {}

  private keys() {
    this.key ??= (async () => {
      if (!this.secret.startsWith('ed25519:')) throw new NearError('The signing key must be an ed25519 key.', 'failure');
      const raw = base58Decode(this.secret.slice('ed25519:'.length));
      if (raw.length !== 64) throw new NearError('The signing key is malformed.', 'failure');
      const privateKey = await crypto.subtle.importKey('jwk', {
        kty: 'OKP', crv: 'Ed25519', d: base64url.encode(raw.slice(0, 32)), x: base64url.encode(raw.slice(32)),
      }, { name: 'Ed25519' }, false, ['sign']);
      return { privateKey, publicKey: raw.slice(32) };
    })();
    return this.key;
  }

  call(receiver: string, call: FunctionCall): Promise<Outcome> {
    const next = this.queue.then(() => this.send(receiver, call));
    this.queue = next.catch(() => {});
    return next;
  }

  private async send(receiver: string, call: FunctionCall, retried = false): Promise<Outcome> {
    const { privateKey, publicKey } = await this.keys();
    const publicText = 'ed25519:' + base58Encode(publicKey);
    const [access, block] = await Promise.all([
      this.nonce === undefined
        ? rpc<{ nonce: number | string }>(this.url, 'query', { request_type: 'view_access_key', finality: 'final', account_id: this.accountId, public_key: publicText })
        : undefined,
      rpc<{ header: { hash: string } }>(this.url, 'block', { finality: 'final' }),
    ]);
    if (access) this.nonce = BigInt(access.nonce);
    this.nonce = this.nonce! + BigInt(1);
    const args = new TextEncoder().encode(JSON.stringify(call.args));
    const transaction = new Writer()
      .string(this.accountId).u8(0).bytes(publicKey).u64(this.nonce).string(receiver).bytes(base58Decode(block.header.hash))
      .u32(1).u8(2).string(call.method).vec(args).u64(call.gas).u128(call.deposit ?? BigInt(0))
      .done();
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', transaction));
    const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', privateKey, hash));
    const signed = new Writer().bytes(transaction).u8(0).bytes(signature).done();
    let result: TransactionResult;
    try {
      result = await rpc<TransactionResult>(this.url, 'send_tx', {
        signed_tx_base64: btoa(String.fromCharCode(...signed)), wait_until: 'FINAL',
      });
    } catch (error) {
      // Another sender may have used the key. Read the nonce again and try once more.
      this.nonce = undefined;
      if (!retried && error instanceof NearError && /InvalidNonce|InvalidTransaction/.test(error.message)) return this.send(receiver, call, true);
      throw error;
    }
    return outcome(base58Encode(hash), result);
  }
}

type Status = { SuccessValue?: string; Failure?: unknown };
type TransactionResult = {
  status: Status;
  transaction_outcome: { outcome: { logs: string[] } };
  receipts_outcome: { outcome: { logs: string[]; status: Status; executor_id: string } }[];
};

function failureText(failure: unknown): string {
  const text = JSON.stringify(failure);
  return /"ExecutionError":"([^"]+)"/.exec(text)?.[1] ?? /Smart contract panicked: ([^"\\]+)/.exec(text)?.[1] ?? text.slice(0, 200);
}

function outcome(hash: string, result: TransactionResult): Outcome {
  const logs = result.receipts_outcome.flatMap(receipt => receipt.outcome.logs);
  if (result.status.Failure !== undefined) return { hash, failure: failureText(result.status.Failure), logs };
  const value = result.status.SuccessValue;
  let decoded: unknown;
  if (value) {
    try { decoded = JSON.parse(atob(value)); } catch { decoded = undefined; }
  }
  return { hash, value: decoded, logs };
}

/** The events a contract logged in NEP-297 form (`EVENT_JSON:`), for one standard. */
export function events(logs: string[], standard: string) {
  return logs.flatMap(log => {
    if (!log.startsWith('EVENT_JSON:')) return [];
    try {
      const event = JSON.parse(log.slice('EVENT_JSON:'.length)) as { standard?: string; event?: string; data?: unknown[] };
      return event.standard === standard ? [{ event: String(event.event), data: (event.data ?? [])[0] as Record<string, unknown> }] : [];
    } catch {
      return [];
    }
  });
}
