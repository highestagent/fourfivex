import { actions, teraToGas } from 'near-api-js';
import { simulate } from '../account/chain';
import { VERIFIER, type SignedIntent } from '../account/intents';
import { relayerAccount } from './signer';

/**
 * Paying for a seat in a paid session. The buyer's passkey signs one transfer to the room escrow; this
 * submits it, and nothing else. The escrow keeps the fee for a seat or hands it straight back, and the
 * verifier refunds the buyer in the same transaction. Runs on the server.
 */

export type SeatPaymentResult = { transaction: string; seat: true } | { transaction: string; seat: false; reason: string };

const SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function roomPaymentsConfigured() {
  return Boolean(process.env.ROOM_ESCROW_CONTRACT && process.env.ROOM_ESCROW_TOKEN
    && process.env.TRADING_RELAYER_ACCOUNT && process.env.TRADING_RELAYER_KEY);
}

/** The session a payload pays for, if it is exactly one seat payment from `accountId` to the escrow and nothing more. */
export function seatPayment(payload: string, accountId: string, now = Date.now()) {
  let parsed: { signer_id?: unknown; verifying_contract?: unknown; deadline?: unknown; intents?: unknown };
  try { parsed = JSON.parse(payload); } catch { return; }
  const intents = Array.isArray(parsed.intents) ? parsed.intents as Record<string, unknown>[] : [];
  const deadline = typeof parsed.deadline === 'string' ? Date.parse(parsed.deadline) : NaN;
  const [transfer] = intents;
  if (parsed.signer_id !== accountId || parsed.verifying_contract !== VERIFIER || intents.length !== 1
    || !(deadline > now) || deadline > now + 10 * 60_000) return;
  const keys = Object.keys(transfer).sort().join(',');
  const tokens = transfer.tokens as Record<string, unknown> | undefined;
  if (transfer.intent !== 'transfer' || transfer.receiver_id !== process.env.ROOM_ESCROW_CONTRACT || keys !== 'intent,msg,receiver_id,tokens'
    || !tokens || Object.keys(tokens).join() !== process.env.ROOM_ESCROW_TOKEN || typeof tokens[process.env.ROOM_ESCROW_TOKEN!] !== 'string'
    || !/^[1-9]\d{0,12}$/.test(String(tokens[process.env.ROOM_ESCROW_TOKEN!]))) return;
  let message: { session?: unknown; entry?: unknown };
  try { message = JSON.parse(String(transfer.msg)); } catch { return; }
  if (typeof message.session !== 'string' || !SESSION.test(message.session)
    || typeof message.entry !== 'string' || !/^[0-9a-f]{64}$/.test(message.entry)) return;
  return { session: message.session };
}

type Receipt = { outcome: { logs: string[] } };

/** What the escrow logged about this payment: a seat, or why it handed the payment back. */
export function seatOutcome(receipts: Receipt[], transaction: string): SeatPaymentResult {
  for (const log of receipts.flatMap(receipt => receipt.outcome.logs)) {
    if (!log.startsWith('EVENT_JSON:')) continue;
    try {
      const event = JSON.parse(log.slice('EVENT_JSON:'.length)) as { standard?: string; event?: string; data?: { reason?: string }[] };
      if (event.standard !== 'fourfivex_room_escrow') continue;
      if (event.event === 'seat_paid') return { transaction, seat: true };
      if (event.event === 'payment_refunded') return { transaction, seat: false, reason: String(event.data?.[0]?.reason ?? 'refunded') };
    } catch {}
  }
  return { transaction, seat: false, reason: 'unknown' };
}

export async function payForSeat(accountId: string, signed: SignedIntent): Promise<SeatPaymentResult> {
  if (!roomPaymentsConfigured()) throw new Error('Paid sessions are unavailable.');
  if (!seatPayment(signed.payload, accountId)) throw new Error('This is not a seat payment.');
  // The verifier's own checks first, so a payment that can't land costs nothing: a balance too low, a stale salt.
  await simulate([signed]).catch((failure: unknown) => {
    throw new Error(failure instanceof Error && /balance|insufficient/i.test(failure.message)
      ? 'Your account doesn’t hold enough USDC for this seat.' : 'NEAR refused this payment. Nothing was sent.');
  });
  const result = await relayerAccount().signAndSendTransaction({
    receiverId: VERIFIER, waitUntil: 'FINAL',
    actions: [actions.functionCall('execute_intents', { signed: [signed] }, teraToGas(150))],
  });
  return seatOutcome(result.receipts_outcome, result.transaction.hash);
}
