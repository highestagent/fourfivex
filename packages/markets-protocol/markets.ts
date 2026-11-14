export type Product = 'spot' | 'perp';
export type Market = `hyperliquid:${Product}:${string}`;
export const defaultMarket = 'hyperliquid:perp:BTC' satisfies Market;

export function isMarket(value: unknown): value is Market {
  return typeof value === 'string' && hyperliquidMarket(value) !== undefined;
}

export const categories = {
  crypto: 'Crypto', equity: 'Stocks', fund: 'ETFs', index: 'Indices', commodity: 'Commodities',
  fx: 'FX', rates: 'Rates', preipo: 'Pre-IPO', other: 'Other',
} as const;
export type AssetClass = keyof typeof categories;
export type MarketQuote = { symbol: string; quote: string; type: Product; precision: number; venue: string };
export type Instrument = MarketQuote & {
  id: Market; name: string; category: AssetClass; icon?: string; glyph?: string; keywords?: string[];
};
export type MarketCatalog = { instruments: Instrument[]; unavailable: Product[] };
/** Asset logos, from the same service the market catalog reads its icons from. */
export const assetIconOrigin = 'https://flare.mcxross.xyz';

/** The logo for a plain ticker, such as BTC. Undefined for symbols that can't name a logo file. */
export function assetIcon(symbol: string): string | undefined {
  return /^[a-z0-9]+$/i.test(symbol) ? `${assetIconOrigin}/assets/${symbol.toLowerCase()}.svg` : undefined;
}

export const defaultInstrument: Instrument = {
  id: defaultMarket, type: 'perp', symbol: 'BTC', quote: 'USD', precision: 2,
  venue: 'Hyperliquid', name: 'Bitcoin', category: 'crypto', glyph: '₿', icon: assetIcon('BTC'),
};

export function hyperliquidMarket(id: string): { type: Product; coin: string } | undefined {
  const spot = /^hyperliquid:spot:(@(?:0|[1-9]\d{0,6})|PURR\/USDC)$/.exec(id);
  if (spot) return { type: 'spot', coin: spot[1] };
  const perp = /^hyperliquid:perp:((?:[a-z][a-z0-9]{0,12}:)?[A-Za-z0-9._-]{1,30})$/.exec(id);
  if (perp) return { type: 'perp', coin: perp[1] };
}

export function marketQuote(market: Market): MarketQuote {
  if (market === defaultMarket) return defaultInstrument;
  const { type, coin } = hyperliquidMarket(market)!;
  const [venue, symbol] = coin.includes(':') ? coin.split(':') : ['Hyperliquid', coin];
  return { symbol, quote: type === 'perp' ? 'USD' : '', type, precision: 8, venue };
}

export function marketLabel({ symbol, quote, type }: MarketQuote) {
  if (type === 'perp') return symbol + ' Perp';
  return quote ? symbol + ' / ' + quote : symbol;
}
