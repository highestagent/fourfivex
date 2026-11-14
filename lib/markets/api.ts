import type { TradingAddress } from './trade';

export type TradeAccount = { available: false; funding: false } | { available: true; funding: boolean; address: TradingAddress };

export class TradeApiError extends Error {
  constructor(message: string, readonly code?: string) { super(message); }
}

export async function tradeApi<T>(accountId: string, op: string, values: object = {}, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/trades', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId, op, ...values }), signal,
  });
  const result = await response.json();
  if (!response.ok) throw new TradeApiError(result.error || 'Trading request failed.', result.code);
  return result as T;
}
