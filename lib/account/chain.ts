/**
 * Read-only calls to the verifier contract on NEAR mainnet. Runs on the server.
 * Nothing here can change state: these are view calls, and `simulate_intents`
 * runs an intent without committing it.
 */
import { b64, utf8 } from "./encoding";
import { VERIFIER, type SignedIntent } from "./intents";

const RPCS = ["https://rpc.fastnear.com", "https://free.rpc.fastnear.com", "https://near.lava.build"];

/** The contract ran and refused. The message is the contract's own. */
export class ContractError extends Error {}

export type Simulation = {
  intents_executed: { intent_hash: string; account_id: string; nonce: string }[];
  logs: string[];
  min_deadline: string;
  state: { fee: number; current_salt: string };
};

async function view<T>(method: string, args: unknown): Promise<T> {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: "fourfivex",
    method: "query",
    params: {
      request_type: "call_function",
      finality: "final",
      account_id: VERIFIER,
      method_name: method,
      args_base64: b64.encode(utf8(JSON.stringify(args))),
    },
  });
  let last: unknown = new Error("No NEAR RPC answered.");
  for (const rpc of RPCS) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(12_000),
      });
      const json = (await res.json()) as {
        error?: { message?: string; data?: unknown };
        result?: { result?: number[]; error?: string };
      };
      if (json.result?.error) throw new ContractError(json.result.error);
      if (json.error) {
        // Some nodes report a contract panic at this level.
        const detail = typeof json.error.data === "string" ? json.error.data : (json.error.message ?? "");
        if (/panicked|Smart contract|wasm execution/i.test(detail)) throw new ContractError(detail);
        throw new Error(detail || "RPC error");
      }
      if (!json.result?.result) throw new Error("Empty RPC result");
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(json.result.result))) as T;
    } catch (err) {
      if (err instanceof ContractError) throw err;
      last = err;
    }
  }
  throw last;
}

/** The 4-byte salt every new nonce must carry. It rotates. */
export const currentSalt = () => view<string>("current_salt", {});

export const hasPublicKey = (accountId: string, publicKey: string) =>
  view<boolean>("has_public_key", { account_id: accountId, public_key: publicKey });

/** Keys added to an account. The key an account was derived from is implied and not listed. */
export const publicKeysOf = (accountId: string) => view<string[]>("public_keys_of", { account_id: accountId });

export const balancesOf = (accountId: string, tokenIds: string[]) =>
  view<string[]>("mt_batch_balance_of", { account_id: accountId, token_ids: tokenIds });

/** Runs signed intents through the contract's real checks without changing anything. */
export const simulate = (signed: SignedIntent[]) => view<Simulation>("simulate_intents", { signed });
