import { intervals } from '@fourfivex/markets-protocol/protocol';
import { defaultMarket, hyperliquidMarket } from '@fourfivex/markets-protocol/markets';
import type { Env } from '../env';
import { HttpError, json, limit } from '../http';
import { hyperliquidHistory, marketCatalog } from '../market-catalog';

async function candles(url: URL) {
  const interval = intervals.find(value => value === Number(url.searchParams.get('interval')));
  if (interval === undefined) throw new HttpError(400, 'Choose a supported chart interval.');
  const market = url.searchParams.get('market') ?? defaultMarket;
  const limit = url.searchParams.get('history') === 'full' ? 720 : 240;
  const hyperliquid = hyperliquidMarket(market);
  if (!hyperliquid) throw new HttpError(400, 'Choose a supported Hyperliquid market.');
  return json(await hyperliquidHistory(hyperliquid.coin, interval, limit));
}

export async function marketsRoutes(request: Request, env: Env, url: URL) {
  const path = url.pathname;
  if (path === '/api/markets/catalog' && request.method === 'GET') { await limit(request, env, 'markets'); return json(await marketCatalog()); }
  if (path === '/api/markets/candles' && request.method === 'GET') { await limit(request, env, 'candles'); return candles(url); }
}
