import { hyperliquidMarket, isMarket } from '@fourfivex/markets-protocol/markets';
import { decodePublicKey, isAccountId } from '@/lib/account/keys';
import { verifyAssertion } from '@/lib/account/assertion';
import { b64u } from '@/lib/account/encoding';
import { challengeFor, type SignedIntent } from '@/lib/account/intents';
import { base58 } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import { equal, utf8 } from '@/lib/account/encoding';
import { CollateralRequired, executeTrade, executeWithdrawal, executionConfigured, prepareTrade, prepareWithdrawal } from '@/lib/markets/execution';
import { tradingAddress } from '@/lib/markets/signer';
import { prepareFunding, submitFunding, fundingConfigured } from '@/lib/markets/funding';
import { isCrossSite } from '@/lib/http/origin';

function signedIntent(value: unknown, origin: string): SignedIntent | undefined {
  if (!value || typeof value !== 'object') return;
  const signed = value as Record<string, unknown>;
  if (signed.standard !== 'webauthn') return;
  for (const key of ['payload', 'public_key', 'signature', 'client_data_json', 'authenticator_data']) {
    if (typeof signed[key] !== 'string' || signed[key].length > 4000) return;
  }
  const envelope = signed as unknown as SignedIntent;
  try {
    const client = JSON.parse(envelope.client_data_json);
    if (client.origin !== origin || client.crossOrigin === true || !envelope.signature.startsWith('p256:')) return;
    const authenticatorData = b64u.decode(envelope.authenticator_data);
    if (!equal(authenticatorData.slice(0, 32), sha256(utf8(new URL(origin).hostname)))) return;
    if (!verifyAssertion(decodePublicKey(envelope.public_key), challengeFor(envelope.payload), {
      clientDataJSON: envelope.client_data_json, authenticatorData,
      signature: base58.decode(envelope.signature.slice(5)), credentialId: '', userHandle: null,
    })) return;
    return envelope;
  } catch {
    return;
  }
}

function reply(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  if (isCrossSite(request)) return reply({ error: 'Invalid request origin.' }, 403);
  const origin = new URL(request.url).origin;
  const data = await request.json().catch(() => null);
  if (!data || typeof data.accountId !== 'string' || !isAccountId(data.accountId)) return reply({ error: 'Invalid account.' }, 400);
  const { accountId } = data;
  if (!executionConfigured()) {
    if (data.op === 'account') return reply({ available: false, funding: false });
    return reply({ error: 'Trading signer is unavailable.' }, 503);
  }
  try {
    if (data.op === 'account') return reply({ available: true, address: await tradingAddress(accountId), funding: fundingConfigured() });
    if (data.op === 'prepare' && isMarket(data.market) && hyperliquidMarket(data.market)?.type === 'perp'
      && ['long', 'short'].includes(data.side) && typeof data.margin === 'number' && Number.isFinite(data.margin)
      && data.margin >= 0 && data.margin <= 1_000_000 && Number.isInteger(data.leverage) && typeof data.closing === 'boolean') {
      return reply(await prepareTrade(accountId, data.market, data, data.closing));
    }
    const signed = signedIntent(data.signed, origin);
    if (data.op === 'withdraw-quote' && typeof data.destination === 'string' && typeof data.amount === 'string') {
      return reply(await prepareWithdrawal(accountId, data.destination.trim().toLowerCase(), data.amount.trim()));
    }
    if ((data.op === 'execute' || data.op === 'withdraw-submit') && typeof data.ticket === 'string' && data.ticket.length <= 5000 && signed) {
      return reply(data.op === 'execute'
        ? await executeTrade(accountId, data.ticket, signed)
        : await executeWithdrawal(accountId, data.ticket, signed));
    }
    if (data.op === 'fund-quote' && typeof data.asset === 'string' && typeof data.amount === 'number') {
      return reply(await prepareFunding(accountId, data.asset, data.amount));
    }
    if (data.op === 'fund-submit' && typeof data.deposit === 'string' && signed) {
      return reply(await submitFunding(accountId, data.deposit, signed));
    }
    return reply({ error: 'Invalid trading request.' }, 400);
  } catch (error) {
    return reply({
      error: error instanceof Error ? error.message.split('\n')[0].slice(0, 240) : 'Trading request failed.',
      code: error instanceof CollateralRequired ? 'collateral' : 'not_submitted',
    }, 422);
  }
}
