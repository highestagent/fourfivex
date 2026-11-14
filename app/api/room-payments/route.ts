import { isAccountId } from '@/lib/account/keys';
import { signedIntent } from '@/lib/account/signed';
import { isCrossSite } from '@/lib/http/origin';
import { payForSeat, roomPaymentsConfigured } from '@/lib/markets/room-payments';

function reply(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Submits a passkey-signed seat payment, and only that. The markets service checks the seat on NEAR itself. */
export async function POST(request: Request) {
  if (isCrossSite(request)) return reply({ error: 'Invalid request origin.' }, 403);
  if (!roomPaymentsConfigured()) return reply({ error: 'Paid sessions are unavailable.' }, 503);
  const data = await request.json().catch(() => null);
  if (!data || typeof data.accountId !== 'string' || !isAccountId(data.accountId)) return reply({ error: 'Invalid account.' }, 400);
  const signed = signedIntent(data.signed, new URL(request.url).origin);
  if (!signed) return reply({ error: 'That passkey signature did not check out.' }, 400);
  try {
    return reply(await payForSeat(data.accountId, signed));
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message.split('\n')[0].slice(0, 240) : 'The payment could not be sent.' }, 422);
  }
}
