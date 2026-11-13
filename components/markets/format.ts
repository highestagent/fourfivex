import type { MarketQuote } from '@intuite/markets-protocol/markets';

const priceFormats = new Map<number, Intl.NumberFormat>();
export function money(value: number | string, { precision, quote }: MarketQuote) {
  let format = priceFormats.get(precision);
  if (!format) {
    format = new Intl.NumberFormat('en-US', { minimumFractionDigits: precision, maximumFractionDigits: 8 });
    priceFormats.set(precision, format);
  }
  const amount = format.format(typeof value === 'number' ? Number(value.toFixed(precision)) : Number(value));
  return quote === 'USD' ? '$' + amount : quote ? amount + ' ' + quote : amount;
}
export const timeLabel = (value: number) => new Date(value * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
