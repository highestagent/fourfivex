/**
 * The room escrow against the NEAR Intents verifier, on a local NEAR node.
 *
 * NEAR Intents has no testnet deployment, so this runs the exact code deployed at `intents.near` on mainnet
 * (fetched by its code hash) on a local sandbox, with `wrap.near`'s code as the token. Buyers are passkey
 * accounts signing `transfer` intents the way the app does. Settlement goes through the markets service's own
 * NEAR client. Nothing here touches mainnet state or real money.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { Account, JsonRpcProvider, KeyPair, actions, teraToGas } from 'near-api-js';
import { DEFAULT_ACCOUNT_ID, DEFAULT_PRIVATE_KEY, GenesisAccount, Sandbox } from 'near-sandbox';
import { sha256 } from '@noble/hashes/sha2.js';
import { base58 } from '@scure/base';
import { buildPayload, challengeFor, makeNonce, signedIntent, VERIFIER, type SignedIntent } from '../../../lib/account/intents';
import { accountIdOf } from '../../../lib/account/keys';
import { makeAuthenticator } from '../../../tests/virtual-authenticator';
import { events, NearSigner, tgas, view } from '../../markets/src/near';

const here = dirname(fileURLToPath(import.meta.url));
const cache = join(here, '../target/sandbox');
const ESCROW = 'room-escrow.fourfivex.near';
const SETTLER = 'room-settler.fourfivex.near';
const TOKEN_CONTRACT = 'wrap.near';
const TOKEN = `nep141:${TOKEN_CONTRACT}`;
const STANDARD = 'fourfivex_room_escrow';
const FEE = '25000000';
const MAINNET = 'https://rpc.mainnet.fastnear.com';
const zero = BigInt(0);
const yocto = BigInt(1);
const near = (amount: number) => BigInt(amount) * BigInt(10) ** BigInt(24);

/** The code deployed at `account` on mainnet, checked against the code hash the chain reports for it. */
async function mainnetCode(account: string) {
  const call = async <T>(params: object) => {
    const body = await (await fetch(MAINNET, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params }),
    })).json() as { result: T };
    return body.result;
  };
  const { code_hash: hash, block_hash: block } = await call<{ code_hash: string; block_hash: string }>({ request_type: 'view_account', finality: 'final', account_id: account });
  const path = join(cache, `${account}-${hash}.wasm`);
  const cached = await readFile(path).catch(() => undefined);
  if (cached && base58.encode(sha256(cached)) === hash) return { code: new Uint8Array(cached), hash };
  const { code_base64 } = await call<{ code_base64: string }>({ request_type: 'view_code', block_id: block, account_id: account });
  const code = Uint8Array.from(Buffer.from(code_base64, 'base64'));
  if (base58.encode(sha256(code)) !== hash) throw new Error(`${account}'s code does not match its hash.`);
  await mkdir(cache, { recursive: true });
  await writeFile(path, code);
  return { code, hash };
}

let sandbox: Sandbox;
let provider: JsonRpcProvider;
let operator: Account;
let settler: NearSigner;
let verifierHash: string;
const keys = new Map<string, string>();

const chainNow = async () => {
  const block = await provider.viewBlock({ finality: 'optimistic' });
  return Math.floor(Number(BigInt(block.header.timestamp_nanosec) / BigInt(1_000_000)));
};
const waitUntil = async (time: number) => { while (await chainNow() < time) await new Promise(resolve => setTimeout(resolve, 400)); };
const viewOf = <T>(contract: string, method: string, args: object = {}) => view<T>(sandbox.rpcUrl, contract, method, args);
const balance = async (account: string) => BigInt(await viewOf<string>(VERIFIER, 'mt_balance_of', { account_id: account, token_id: TOKEN }));
const seat = (session: string, payer: string) => viewOf<{ amount: string; state: string } | null>(ESCROW, 'seat', { session, payer });

function signer(accountId: string) {
  return new Account(accountId, provider, keys.get(accountId) as `ed25519:${string}`);
}

async function call(account: Account, receiverId: string, method: string, args: object, deposit = zero, gas = 100) {
  return account.signAndSendTransaction({
    receiverId, actions: [actions.functionCall(method, args, teraToGas(gas), deposit)], waitUntil: 'FINAL', throwOnFailure: false,
  });
}

/** A passkey account, holding `amount` of the token inside the verifier. */
async function buyer(amount = BigInt(FEE) * BigInt(4)) {
  const authenticator = makeAuthenticator({ origin: 'https://fourfivex.xyz', rpId: 'fourfivex.xyz' });
  const accountId = accountIdOf(authenticator.publicKey);
  if (amount > zero) {
    const deposit = await call(operator, TOKEN_CONTRACT, 'ft_transfer_call', { receiver_id: VERIFIER, amount: String(amount), msg: accountId }, yocto);
    expect(deposit.status, JSON.stringify(deposit.status)).toHaveProperty('SuccessValue');
  }
  return { accountId, authenticator };
}
type Buyer = Awaited<ReturnType<typeof buyer>>;

/** What the app signs to pay for a seat: one transfer to the escrow, naming the session. */
async function payment(from: Buyer, session: string, amount = FEE): Promise<SignedIntent> {
  const deadline = new Date(Date.now() + 5 * 60_000);
  const salt = await viewOf<string>(VERIFIER, 'current_salt');
  const payload = buildPayload({
    signerId: from.accountId, deadline, nonce: makeNonce(salt, deadline, crypto.getRandomValues(new Uint8Array(15))),
    intents: [{ intent: 'transfer', receiver_id: ESCROW, tokens: { [TOKEN]: amount }, msg: JSON.stringify({ session }) }],
  });
  return signedIntent(payload, from.authenticator.publicKey, from.authenticator.assert(challengeFor(payload)));
}

async function execute(...signed: SignedIntent[]) {
  const result = await call(operator, VERIFIER, 'execute_intents', { signed }, zero, 300);
  expect(result.status, JSON.stringify(result.status)).toHaveProperty('SuccessValue');
  return events(result.receipts_outcome.flatMap(receipt => receipt.outcome.logs), STANDARD);
}

let sessions = 0;
/** Opens a session that takes bookings for `bookingMs`, ends right after, and pays out `releaseMs` later. */
async function open(seats: number, { bookingMs = 15_000, releaseMs = 4_000, host }: { bookingMs?: number; releaseMs?: number; host?: string } = {}) {
  const id = `session-${++sessions}-${crypto.randomUUID().slice(0, 8)}`;
  const now = await chainNow();
  const terms = {
    host: host ?? (await buyer(zero)).accountId, price: FEE, seats,
    booking_closes: now + bookingMs, ends_at: now + bookingMs + 1_000,
    release_after: now + bookingMs + 1_000 + releaseMs, refund_after: now + bookingMs + 1_000 + releaseMs + 4_000,
  };
  const outcome = await settler.call(ESCROW, { method: 'open_session', args: { id, terms }, gas: tgas(30) });
  expect(outcome.failure).toBeUndefined();
  return { id, terms };
}

beforeAll(async () => {
  const escrowCode = await readFile(join(here, '../target/near/fourfivex_room_escrow.wasm')).catch(() => {
    throw new Error('Build the escrow first: see services/room-escrow/README.md.');
  });
  const [verifier, token] = await Promise.all([mainnetCode(VERIFIER), mainnetCode(TOKEN_CONTRACT)]);
  verifierHash = verifier.hash;
  const accounts = [VERIFIER, TOKEN_CONTRACT, ESCROW, SETTLER].map(accountId => {
    const pair = KeyPair.fromRandom('ed25519');
    keys.set(accountId, pair.toString());
    return new GenesisAccount(accountId, pair.getPublicKey().toString(), pair.toString(), near(100));
  });
  keys.set(DEFAULT_ACCOUNT_ID, DEFAULT_PRIVATE_KEY);
  sandbox = await Sandbox.start({ config: { additionalAccounts: accounts } });
  provider = new JsonRpcProvider({ url: sandbox.rpcUrl });
  operator = signer(DEFAULT_ACCOUNT_ID);
  settler = new NearSigner(sandbox.rpcUrl, SETTLER, keys.get(SETTLER)!);

  const deploy = (accountId: string, code: Uint8Array, init: string, args: object) => signer(accountId).signAndSendTransaction({
    receiverId: accountId, waitUntil: 'FINAL',
    actions: [actions.deployContract(code), actions.functionCall(init, args, teraToGas(200), zero)],
  });
  await deploy(VERIFIER, verifier.code, 'new', { config: {
    wnear_id: TOKEN_CONTRACT, fees: { fee: 0, fee_collector: VERIFIER },
    roles: { super_admins: [DEFAULT_ACCOUNT_ID], admins: {}, grantees: { PauseManager: [DEFAULT_ACCOUNT_ID], UnpauseManager: [DEFAULT_ACCOUNT_ID] } },
  } });
  await deploy(TOKEN_CONTRACT, token.code, 'new', {});
  await deploy(ESCROW, new Uint8Array(escrowCode), 'new', { verifier: VERIFIER, token: TOKEN, settler: SETTLER, refund_margin_ms: 3_000 });
  for (const account of [VERIFIER, DEFAULT_ACCOUNT_ID]) await call(operator, TOKEN_CONTRACT, 'storage_deposit', { account_id: account }, near(1) / BigInt(100));
  await call(operator, TOKEN_CONTRACT, 'near_deposit', {}, near(500));
}, 240_000);

afterAll(async () => { await sandbox?.tearDown(); });

describe('NEAR Intents transfer with a message (the payment primitive)', () => {
  test('runs the verifier code deployed on mainnet', async () => {
    expect((await provider.viewAccount({ accountId: VERIFIER, blockQuery: { finality: 'final' } })).code_hash).toBe(verifierHash);
  });

  test('a seat is paid, and the fee sits with the escrow inside the verifier', async () => {
    const { id } = await open(2);
    const alice = await buyer();
    const before = await balance(ESCROW);
    expect(await execute(await payment(alice, id))).toEqual([expect.objectContaining({ event: 'seat_paid', data: expect.objectContaining({ session: id, payer: alice.accountId }) })]);
    expect(await seat(id, alice.accountId)).toEqual(expect.objectContaining({ amount: FEE, state: 'paid' }));
    expect(await balance(ESCROW) - before).toBe(BigInt(FEE));
    expect(await balance(alice.accountId)).toBe(BigInt(FEE) * BigInt(3));
  });

  test('two payments for the last seat: one seat, and the other payer refunded in the same transaction', async () => {
    const { id } = await open(1);
    const [first, second] = await Promise.all([buyer(), buyer()]);
    const logged = await execute(await payment(first, id), await payment(second, id));
    expect(logged.map(({ event }) => event)).toEqual(['seat_paid', 'payment_refunded']);
    expect(logged[1].data).toEqual({ payer: second.accountId, reason: 'sold_out' });
    expect(await seat(id, second.accountId)).toBeNull();
    expect(await balance(second.accountId)).toBe(BigInt(FEE) * BigInt(4));
  });

  test('two separate transactions racing for the last seat end the same way', async () => {
    const { id } = await open(1);
    const [first, second] = await Promise.all([buyer(), buyer()]);
    const [a, b] = await Promise.all([execute(await payment(first, id)), execute(await payment(second, id))]);
    expect([...a, ...b].map(({ event }) => event).sort()).toEqual(['payment_refunded', 'seat_paid']);
    const held = await Promise.all([seat(id, first.accountId), seat(id, second.accountId)]);
    expect(held.filter(Boolean)).toHaveLength(1);
    expect(await balance(first.accountId) + await balance(second.accountId)).toBe(BigInt(FEE) * BigInt(7));
  });

  test('a duplicate payment, a wrong amount, an unknown session and the host paying are all refunded', async () => {
    const host = await buyer();
    const { id } = await open(3, { host: host.accountId });
    const alice = await buyer();
    await execute(await payment(alice, id));
    const refused = await execute(
      await payment(alice, id), await payment(alice, id, '1000000'), await payment(alice, 'no-such-session'), await payment(host, id),
    );
    expect(refused.map(({ data }) => data.reason)).toEqual(['duplicate', 'wrong_amount', 'unknown_session', 'host']);
    expect(await balance(alice.accountId)).toBe(BigInt(FEE) * BigInt(3));
    expect(await balance(host.accountId)).toBe(BigInt(FEE) * BigInt(4));
  });

  test('a late payment is refunded', async () => {
    const { id, terms } = await open(2, { bookingMs: 2_000 });
    const late = await buyer();
    await waitUntil(terms.booking_closes);
    expect((await execute(await payment(late, id)))[0].data.reason).toBe('booking_closed');
    expect(await balance(late.accountId)).toBe(BigInt(FEE) * BigInt(4));
  });

  test('nobody but the verifier can book a seat directly', async () => {
    const { id } = await open(2);
    const result = await call(operator, ESCROW, 'mt_on_transfer', {
      sender_id: DEFAULT_ACCOUNT_ID, previous_owner_ids: [DEFAULT_ACCOUNT_ID], token_ids: [TOKEN], amounts: [FEE], msg: JSON.stringify({ session: id }),
    });
    expect(JSON.stringify(result.status)).toContain('Verifier required');
    expect(await seat(id, DEFAULT_ACCOUNT_ID)).toBeNull();
  });
});

describe('settlement', () => {
  test('the host is paid only after the exception window, and only by the settler', async () => {
    const host = await buyer(zero);
    const { id, terms } = await open(2, { host: host.accountId, bookingMs: 3_000 });
    const alice = await buyer();
    await execute(await payment(alice, id));
    const early = await settler.call(ESCROW, { method: 'release', args: { session: id, payer: alice.accountId }, gas: tgas(60) });
    expect(early.failure).toContain('Too early to pay the host');
    const stranger = await call(operator, ESCROW, 'release', { session: id, payer: alice.accountId }, zero, 60);
    expect(JSON.stringify(stranger.status)).toContain('Only the settler can do this');
    await waitUntil(terms.release_after);
    const paid = await settler.call(ESCROW, { method: 'release', args: { session: id, payer: alice.accountId }, gas: tgas(60) });
    expect(paid.value).toBe(true);
    expect(events(paid.logs, STANDARD).map(({ event }) => event)).toEqual(['seat_released']);
    expect(await balance(host.accountId)).toBe(BigInt(FEE));
    expect((await seat(id, alice.accountId))?.state).toBe('released');
    const again = await settler.call(ESCROW, { method: 'refund', args: { session: id, payer: alice.accountId }, gas: tgas(60) });
    expect(again.failure).toContain('already settled');
  });

  test('a refund returns the fee and frees the seat for someone else', async () => {
    const { id } = await open(1, { bookingMs: 20_000 });
    const [alice, bob] = await Promise.all([buyer(), buyer()]);
    await execute(await payment(alice, id));
    const refunded = await settler.call(ESCROW, { method: 'refund', args: { session: id, payer: alice.accountId }, gas: tgas(60) });
    expect(refunded.value).toBe(true);
    expect(await balance(alice.accountId)).toBe(BigInt(FEE) * BigInt(4));
    expect((await seat(id, alice.accountId))?.state).toBe('refunded');
    expect((await execute(await payment(bob, id)))[0].event).toBe('seat_paid');
  });

  test('a canceled session takes no payments, and its seats are refunded', async () => {
    const { id } = await open(3, { bookingMs: 20_000 });
    const alice = await buyer();
    await execute(await payment(alice, id));
    expect((await settler.call(ESCROW, { method: 'cancel_session', args: { id }, gas: tgas(30) })).failure).toBeUndefined();
    expect((await execute(await payment(await buyer(), id)))[0].data.reason).toBe('canceled');
    expect((await settler.call(ESCROW, { method: 'refund', args: { session: id, payer: alice.accountId }, gas: tgas(60) })).value).toBe(true);
    expect(await balance(alice.accountId)).toBe(BigInt(FEE) * BigInt(4));
  });

  test('a payout that fails leaves the seat paid, and succeeds when retried', async () => {
    const host = await buyer(zero);
    const { id, terms } = await open(1, { host: host.accountId, bookingMs: 3_000 });
    const alice = await buyer();
    await execute(await payment(alice, id));
    await waitUntil(terms.release_after);
    await call(operator, VERIFIER, 'pa_pause_feature', { key: 'mt_transfer' });
    const failed = await settler.call(ESCROW, { method: 'release', args: { session: id, payer: alice.accountId }, gas: tgas(60) });
    expect(failed.value).toBe(false);
    expect(events(failed.logs, STANDARD).map(({ event }) => event)).toEqual(['settlement_failed']);
    expect((await seat(id, alice.accountId))?.state).toBe('paid');
    expect(await balance(host.accountId)).toBe(zero);
    await call(operator, VERIFIER, 'pa_unpause_feature', { key: 'mt_transfer' });
    expect((await settler.call(ESCROW, { method: 'release', args: { session: id, payer: alice.accountId }, gas: tgas(60) })).value).toBe(true);
    expect(await balance(host.accountId)).toBe(BigInt(FEE));
  });

  test('if the service never settles, anyone can refund the payer after the deadline', async () => {
    const { id, terms } = await open(1, { bookingMs: 3_000 });
    const alice = await buyer();
    await execute(await payment(alice, id));
    const early = await call(operator, ESCROW, 'claim_refund', { session: id, payer: alice.accountId }, zero, 60);
    expect(JSON.stringify(early.status)).toContain("The refund deadline hasn't passed");
    await waitUntil(terms.refund_after);
    const claimed = await call(operator, ESCROW, 'claim_refund', { session: id, payer: alice.accountId }, zero, 60);
    expect(claimed.status).toHaveProperty('SuccessValue');
    expect(await balance(alice.accountId)).toBe(BigInt(FEE) * BigInt(4));
  });
});
