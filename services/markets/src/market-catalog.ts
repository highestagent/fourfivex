import { z } from 'zod';
import { isMarket, type AssetClass, type Instrument, type MarketCatalog, type Product } from '@intuite/markets-protocol/markets';
import { hyperliquidCandle, hyperliquidIntervals, type Interval } from '@intuite/markets-protocol/protocol';
import { HttpError, upstream } from './http';

const decimals = z.number().int().nonnegative();
const perpMetadata = z.array(z.object({
  universe: z.array(z.object({ name: z.string(), szDecimals: decimals, isDelisted: z.boolean().optional() })),
}));
const dexMetadata = z.array(z.object({ name: z.string(), fullName: z.string() }).nullable());
const annotations = z.array(z.tuple([z.string(), z.object({
  category: z.string().optional(), displayName: z.string().optional(), keywords: z.array(z.string()).optional(),
})]));
const spotMetadata = z.tuple([z.object({
  universe: z.array(z.object({ name: z.string(), index: decimals, tokens: z.tuple([decimals, decimals]) })),
  tokens: z.array(z.object({ index: decimals, name: z.string(), fullName: z.string().nullish(), szDecimals: decimals })),
}), z.array(z.object({ coin: z.string(), dayNtlVlm: z.union([z.number(), z.string()]).optional() }))]);
const flareOrigin = 'https://flare.mcxross.xyz';
const flareMetadata = z.object({
  schemaVersion: z.literal(2),
  assets: z.array(z.object({ symbol: z.string(), name: z.string(), icon: z.string().nullable() })),
  aliases: z.record(z.string(), z.string()),
});
type FlareAsset = z.infer<typeof flareMetadata>['assets'][number];
type FlareAssets = Map<string, FlareAsset>;

const assetClasses: Record<string, AssetClass> = {
  crypto: 'crypto', stock: 'equity', stocks: 'equity', equity: 'equity', equities: 'equity', etf: 'fund', etfs: 'fund',
  index: 'index', indices: 'index', commodity: 'commodity', commodities: 'commodity', fx: 'fx',
  rates: 'rates', preipo: 'preipo',
};
const funds = new Set('DRAM EWY EWJ EWT EWZ URNM XLE SMH KSTR KORU LYTE NCLD SOXL MAGS XBI SNXX TLT IGV GDX QQQ SPY'.split(' '));
const perpClasses: Record<string, AssetClass> = {
  'mkts:BVIV': 'index', 'io:EWY': 'fund', 'io:NVDA': 'equity',
  'para:TOTAL2': 'index', 'para:OTHERS': 'index', 'para:BTCD': 'index',
};
const spotClasses: Record<string, AssetClass> = {
  USPYX: 'fund', SPYX: 'fund', QQQX: 'fund', EQQQQ: 'fund', EQSPY: 'fund',
  NVDA: 'equity', NVDAX: 'equity', EQNVDA: 'equity',
  TSLA: 'equity', TSLAX: 'equity', EQTSLA: 'equity',
  SKHYX: 'equity', MUX: 'equity', EQMU: 'equity', SNDKX: 'equity',
  AAPLX: 'equity', EQAAPL: 'equity', CRCLX: 'equity',
  EQGOOG: 'equity', EQMETA: 'equity', EQMSFT: 'equity', EQAMZN: 'equity',
  SPACEX: 'equity', SPCXD: 'equity', SPCXX: 'equity', EQSPCX: 'equity',
  XAUM: 'commodity', WARS: 'fx', WBRL: 'fx', THBILL: 'rates',
};

async function hyperliquid(payload: Record<string, unknown>) {
  const response = await upstream('https://api.hyperliquid.xyz/info', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!response.ok) throw new HttpError(503, 'Hyperliquid market data is temporarily unavailable.');
  return response.json();
}

async function flareAssets(): Promise<FlareAssets> {
  const response = await upstream(flareOrigin + '/api/assets/v2/manifest.json', { cf: { cacheEverything: true, cacheTtl: 300 } });
  if (!response.ok) throw new Error('Flare asset catalog is unavailable.');
  const { assets, aliases } = flareMetadata.parse(await response.json());
  const bySymbol = new Map(assets.filter(asset => asset.icon && /^\/assets\/[a-z0-9][a-z0-9._-]*\.svg$/.test(asset.icon))
    .map(asset => [asset.symbol, asset]));
  const byMarket: FlareAssets = new Map();
  for (const [market, symbol] of Object.entries(aliases)) {
    const asset = bySymbol.get(symbol);
    if (asset) byMarket.set(market, asset);
  }
  return byMarket;
}

function own<T>(values: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(values, key) ? values[key] : undefined;
}

function flareIcon(asset: FlareAsset | undefined) {
  return asset?.icon ? flareOrigin + asset.icon : undefined;
}

function perpetuals(raw: z.infer<typeof perpMetadata>, dexes: z.infer<typeof dexMetadata>,
  labels: z.infer<typeof annotations>, assets: FlareAssets): Instrument[] {
  const venueNames = new Map(dexes.flatMap(dex => dex ? [[dex.name, dex.fullName] as const] : []));
  const byCoin = new Map(labels);
  const result: Instrument[] = [];
  for (const { universe } of raw) {
    for (const row of universe) {
      const id = 'hyperliquid:perp:' + row.name;
      if (row.isDelisted || !isMarket(id)) continue;
      const [dex, symbol] = row.name.includes(':') ? row.name.split(':') : ['', row.name];
      const label = byCoin.get(row.name);
      const reported = own(assetClasses, label?.category?.toLowerCase() ?? '');
      const fallback = dex ? 'other' : 'crypto';
      const category = own(perpClasses, row.name) ?? (reported === 'equity' && (funds.has(symbol) || label?.keywords?.includes('etf'))
        ? 'fund' : reported ?? fallback);
      const asset = assets.get(id);
      const name = (label?.displayName && label.displayName !== symbol ? label.displayName : asset?.name) ?? symbol;
      result.push({
        id, type: 'perp', symbol, quote: 'USD', name, category, venue: venueNames.get(dex) ?? (dex || 'Hyperliquid'),
        precision: Math.max(2, 6 - row.szDecimals), icon: flareIcon(asset),
        keywords: [row.name, ...(label?.keywords ?? [])],
      });
    }
  }
  const majors = ['BTC', 'ETH', 'SOL', 'HYPE'];
  const rank = (item: Instrument) => {
    const position = majors.indexOf(item.symbol);
    return item.venue === 'Hyperliquid' && position >= 0 ? position : majors.length;
  };
  return result.sort((a, b) => rank(a) - rank(b) || a.symbol.localeCompare(b.symbol) || a.venue.localeCompare(b.venue));
}

function spotPairs([meta, contexts]: z.infer<typeof spotMetadata>, assets: FlareAssets): Instrument[] {
  const tokens = new Map(meta.tokens.map(token => [token.index, token]));
  const volumes = new Map(contexts.map(context => [context.coin, Number(context.dayNtlVlm) || 0]));
  return [...meta.universe].sort((a, b) => (volumes.get(b.name) ?? 0) - (volumes.get(a.name) ?? 0)).flatMap(pair => {
    const coin = pair.index === 0 && pair.name === 'PURR/USDC' ? pair.name : '@' + pair.index;
    const id = 'hyperliquid:spot:' + coin;
    const base = tokens.get(pair.tokens[0]);
    const quote = tokens.get(pair.tokens[1]);
    if (!isMarket(id) || !base || !quote) return [];
    const wrapperName = base.fullName ?? '';
    const eqxTicker = /^EQX Tokenized ([A-Z0-9.]+)$/.exec(wrapperName)?.[1];
    const category = own(spotClasses, base.name) ??
      (eqxTicker && funds.has(eqxTicker) ? 'fund' : /xstock|EQX Tokenized/i.test(wrapperName) ? 'equity' : 'crypto');
    const asset = assets.get(id);
    return [{
      id, type: 'spot', symbol: base.name, quote: quote.name, name: base.fullName || asset?.name || base.name,
      category, venue: 'Hyperliquid', precision: Math.max(2, 8 - base.szDecimals),
      icon: flareIcon(asset), keywords: [asset?.symbol ?? '', asset?.name ?? '', pair.name],
    }];
  });
}

let saved: { catalog: MarketCatalog; expires: number } | undefined;

export async function marketCatalog(): Promise<MarketCatalog> {
  if (saved && saved.expires > Date.now()) return saved.catalog;
  const [perps, dexes, spot, labels, icons] = await Promise.allSettled([
    hyperliquid({ type: 'allPerpMetas' }).then(value => perpMetadata.parse(value)),
    hyperliquid({ type: 'perpDexs' }).then(value => dexMetadata.parse(value)),
    hyperliquid({ type: 'spotMetaAndAssetCtxs' }).then(value => spotMetadata.parse(value)),
    hyperliquid({ type: 'perpConciseAnnotations' }).then(value => annotations.parse(value)),
    flareAssets(),
  ]);
  const unavailable: Product[] = [];
  const assets = icons.status === 'fulfilled' ? icons.value : new Map();
  const lastGood = (type: Product) => saved?.catalog.instruments.filter(item => item.type === type) ?? [];
  if (spot.status === 'rejected') unavailable.push('spot');
  if (perps.status === 'rejected' || labels.status === 'rejected' || dexes.status === 'rejected') unavailable.push('perp');
  const catalog = {
    instruments: [
      ...(spot.status === 'fulfilled' ? spotPairs(spot.value, assets) : lastGood('spot')),
      ...(perps.status === 'fulfilled' ? perpetuals(perps.value, dexes.status === 'fulfilled' ? dexes.value : [],
        labels.status === 'fulfilled' ? labels.value : [], assets) : lastGood('perp')),
    ],
    unavailable,
  };
  saved = { catalog, expires: Date.now() + (unavailable.length ? 15_000 : 60_000) };
  return catalog;
}

export async function hyperliquidHistory(coin: string, interval: Interval, limit: number) {
  const endTime = Date.now();
  const value = await hyperliquid({
    type: 'candleSnapshot', req: { coin, interval: hyperliquidIntervals[interval], startTime: endTime - limit * interval * 60_000, endTime },
  });
  if (!Array.isArray(value)) throw new HttpError(503, 'Hyperliquid history is temporarily unavailable.');
  return value.flatMap(row => hyperliquidCandle(row) ?? []).sort((a, b) => a.time - b.time).slice(-limit);
}
