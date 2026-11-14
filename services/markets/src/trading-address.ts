import { keccak_256 } from '@noble/hashes/sha3.js';
import type { Env } from './env';
import { HttpError } from './http';
import { NearError, view } from './near';
import { base58Decode } from './passkey';

export const nearRpc = (env: Env) => env.NEAR_RPC_URL ?? 'https://rpc.fastnear.com';

/**
 * The Hyperliquid address an account trades from. NEAR Chain Signatures derives it from the trading signer's
 * account and the account ID, so only that account's passkeys can sign for it. Proving the passkey proves the address.
 */
export async function tradingAddress(env: Env, accountId: string): Promise<`0x${string}`> {
  const contract = env.TRADING_SIGNER_CONTRACT;
  if (!contract) throw new HttpError(503, 'Paid sessions are unavailable on this deployment.');
  let key: string;
  try {
    key = await view<string>(nearRpc(env), env.MPC_CONTRACT ?? 'v1.signer', 'derived_public_key', {
      predecessor: contract, path: `fourfivex:hyperliquid:v1:${accountId}`, domain_id: 0,
    });
  } catch (error) {
    if (error instanceof NearError) throw new HttpError(503, 'Your trading account could not be checked. Try again.');
    throw error;
  }
  const point = typeof key === 'string' && key.startsWith('secp256k1:') ? base58Decode(key.slice('secp256k1:'.length)) : undefined;
  if (point?.length !== 64) throw new HttpError(503, 'Your trading account could not be checked. Try again.');
  const address = Array.from(keccak_256(point).slice(-20), byte => byte.toString(16).padStart(2, '0')).join('');
  return `0x${address}`;
}
