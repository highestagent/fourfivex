import { Account, JsonRpcProvider, actions, teraToGas, type KeyPairString } from 'near-api-js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { base58, hex } from '@scure/base';
import { b64, concat } from '../account/encoding';
import { VERIFIER, type SignedIntent } from '../account/intents';
import { signingPath } from './authorization';
import type { TradingAddress } from './trade';

const mpc = 'v1.signer';
const decoder = new TextDecoder();
let relayer: Account | undefined;
const provider = () => new JsonRpcProvider({ url: process.env.TRADING_NEAR_RPC_URL ?? 'https://rpc.fastnear.com' });

/** A named `.near` account, or a plain (implicit) account: 64 lowercase hex characters. */
const NAMED_ACCOUNT = /^[a-z0-9]+(?:[._-][a-z0-9]+)*\.near$/;
const IMPLICIT_ACCOUNT = /^[0-9a-f]{64}$/;

export function signerContract() {
  const contract = process.env.TRADING_SIGNER_CONTRACT;
  return contract && contract.length <= 64 && (NAMED_ACCOUNT.test(contract) || IMPLICIT_ACCOUNT.test(contract)) ? contract : undefined;
}

export function tradingConfigured() {
  return Boolean(signerContract() && process.env.TRADING_SIGNER_CODE_HASH && process.env.TRADING_RELAYER_ACCOUNT && process.env.TRADING_RELAYER_KEY);
}

export function addressFromPoint(point: Uint8Array): TradingAddress {
  if (point.length !== 64) throw new Error('Trading address is unavailable.');
  return `0x${hex.encode(keccak_256(point).slice(-20))}`;
}

let verifiedDeployment: { contract: string; hash: string; until: number } | undefined;

export async function verifySignerDeployment() {
  const contract = signerContract();
  const hash = process.env.TRADING_SIGNER_CODE_HASH;
  if (!contract || !hash) throw new Error('Trading signer is unavailable.');
  if (verifiedDeployment?.contract === contract && verifiedDeployment.hash === hash && verifiedDeployment.until > Date.now()) return;
  const rpc = provider();
  const [account, keys, version] = await Promise.all([
    rpc.viewAccount({ accountId: contract, blockQuery: { finality: 'final' } }),
    rpc.viewAccessKeyList({ accountId: contract, finalityQuery: { finality: 'final' } }),
    rpc.callFunction<number>({ contractId: contract, method: 'version', args: {}, blockQuery: { finality: 'final' } }),
  ]);
  if (account.code_hash !== hash || keys.keys.length !== 0 || keys.last_key || version !== 1) {
    throw new Error('Trading signer is unavailable.');
  }
  verifiedDeployment = { contract, hash, until: Date.now() + 60_000 };
}

export async function tradingAddress(accountId: string): Promise<TradingAddress> {
  const contract = signerContract();
  if (!contract) throw new Error('Trading signer is unavailable.');
  await verifySignerDeployment();
  const key = await provider().callFunction<string>({
    contractId: mpc, method: 'derived_public_key',
    args: { predecessor: contract, path: signingPath(accountId), domain_id: 0 },
  });
  if (!key?.startsWith('secp256k1:')) throw new Error('Trading address is unavailable.');
  return addressFromPoint(base58.decode(key.slice('secp256k1:'.length)));
}

type Signature = { r: TradingAddress; s: TradingAddress; v: 27 | 28 };

export function verifiedSignature(value: unknown, digest: Uint8Array, address: TradingAddress): Signature | undefined {
  if (!value || typeof value !== 'object') return;
  const { big_r, s, recovery_id: recovery } = value as { big_r?: { affine_point?: string }; s?: { scalar?: string }; recovery_id?: number };
  const affine = big_r?.affine_point;
  const scalar = s?.scalar;
  if (!affine || !/^(02|03)[a-f0-9]{64}$/i.test(affine) || !scalar || !/^[a-f0-9]{64}$/i.test(scalar) || (recovery !== 0 && recovery !== 1)) return;
  try {
    const signature = secp256k1.Signature.fromBytes(hex.decode(affine.slice(2) + scalar), 'compact');
    const normalized = signature.hasHighS() ? new secp256k1.Signature(signature.r, secp256k1.Point.Fn.ORDER - signature.s) : signature;
    const bit = signature.hasHighS() ? recovery ^ 1 : recovery;
    const point = secp256k1.recoverPublicKey(concat(Uint8Array.of(bit), normalized.toBytes('compact')), digest, { prehash: false });
    const uncompressed = secp256k1.Point.fromBytes(point).toBytes(false).slice(1);
    if (addressFromPoint(uncompressed) !== address) return;
    const bytes = hex.encode(normalized.toBytes('compact'));
    return { r: `0x${bytes.slice(0, 64)}`, s: `0x${bytes.slice(64)}`, v: bit === 0 ? 27 : 28 };
  } catch {
    return;
  }
}

export async function requestSignatures(signed: SignedIntent, digests: Uint8Array[], address: TradingAddress) {
  if (!tradingConfigured()) throw new Error('Trading signer is unavailable.');
  await verifySignerDeployment();
  relayer ??= new Account(process.env.TRADING_RELAYER_ACCOUNT!, provider(), process.env.TRADING_RELAYER_KEY as KeyPairString);
  const result = await relayer.signAndSendTransaction({
    receiverId: VERIFIER, actions: [actions.functionCall('execute_intents', { signed: [signed] }, teraToGas(250))],
    waitUntil: 'FINAL',
  });
  const candidates: unknown[] = [];
  for (const { outcome } of result.receipts_outcome) {
    if (outcome.executor_id !== mpc || typeof outcome.status !== 'object' || !('SuccessValue' in outcome.status)) continue;
    try {
      candidates.push(JSON.parse(decoder.decode(b64.decode(outcome.status.SuccessValue))));
    } catch {}
  }
  return digests.map(digest => {
    const signature = candidates.map(value => verifiedSignature(value, digest, address)).find(Boolean);
    if (!signature) throw new Error('NEAR did not return a valid trading signature. Review a fresh quote.');
    return signature;
  });
}
