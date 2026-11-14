import { hyperliquidMarket, isMarket } from '@fourfivex/markets-protocol/markets';
import { isAccountId } from '@/lib/account/keys';
import { signedIntent } from '@/lib/account/signed';
import { CollateralRequired, executeTrade, executeWithdrawal, executionConfigured, prepareTrade, prepareWithdrawal, type Signal } from '@/lib/markets/execution';
import { tradingAddress } from '@/lib/markets/signer';
import { readTradingBalance } from '@/lib/markets/trade';
import { prepareFunding, submitFunding, fundingConfigured } from '@/lib/markets/funding';
import { isCrossSite } from '@/lib/http/origin';

const ROOM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A paid session's fill that this order follows, if the request names one in the right shape. */
function signalOf(value: unknown): Signal | undefined {
  if (!value || typeof value !== 'object') return;
  const { room, price, time } = value as Record<string, unknown>;
  if (typeof room === 'string' && ROOM.test(room) && typeof price === 'string' && /^\d{1,9}(\.\d{1,8})?$/.test(price)
    && typeof time === 'number' && Number.isSafeInteger(time) && time > 0) return { room, price, time };
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
    if (data.op === 'balance') return reply({ balance: null });
    return reply({ error: 'Trading signer is unavailable.' }, 503);
  }
  try {
    if (data.op === 'account') return reply({ available: true, address: await tradingAddress(accountId), funding: fundingConfigured() });
    if (data.op === 'balance') return reply({ balance: await readTradingBalance(await tradingAddress(accountId), request.signal) });
    if (data.op === 'prepare' && isMarket(data.market) && hyperliquidMarket(data.market)?.type === 'perp'
      && ['long', 'short'].includes(data.side) && typeof data.margin === 'number' && Number.isFinite(data.margin)
      && data.margin >= 0 && data.margin <= 1_000_000 && Number.isInteger(data.leverage) && typeof data.closing === 'boolean') {
      return reply(await prepareTrade(accountId, data.market, data, data.closing, signalOf(data.signal)));
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
