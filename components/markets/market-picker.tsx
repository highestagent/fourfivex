import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { categories, defaultInstrument, marketLabel, marketQuote, type AssetClass, type Instrument,
  type Market, type MarketCatalog, type Product } from '@fourfivex/markets-protocol/markets';
import { api } from './client';

export function useMarketCatalog() {
  const [catalog, setCatalog] = useState<MarketCatalog>({ instruments: [defaultInstrument], unavailable: [] });
  const [result, setResult] = useState<{ request: number; status: 'ready' | 'error' }>();
  const [request, setRequest] = useState(0);
  useEffect(() => {
    let active = true;
    void api<MarketCatalog>('/catalog').then(result => {
      if (!active) return;
      setCatalog({
        ...result,
        instruments: result.instruments.some(item => item.id === defaultInstrument.id)
          ? result.instruments : [defaultInstrument, ...result.instruments],
      });
      setResult({ request, status: 'ready' });
    }, () => {
      if (active) setResult({ request, status: 'error' });
    });
    return () => { active = false; };
  }, [request]);
  const status = result?.request === request ? result.status : 'loading';
  return { ...catalog, status, retry: () => setRequest(value => value + 1) };
}

export function MarketIcon({ instrument }: { instrument: Instrument }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  return <span className="coin market-icon" aria-hidden="true">
    {instrument.icon && failedUrl !== instrument.icon
      ? <Image src={instrument.icon} alt="" width={30} height={30} unoptimized
          onError={() => setFailedUrl(instrument.icon)}/>
      : (instrument.glyph ?? instrument.symbol.slice(0, 2))}
  </span>;
}

const pageSize = 40;
const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
const categoryEntries = Object.entries(categories) as [AssetClass, string][];

export function MarketPicker({ current, select, catalog, product }: {
  current: Market; select: (market: Market) => void; catalog: ReturnType<typeof useMarketCatalog>;
  product?: Product;
}) {
  const [selectedType, setType] = useState<Product>(marketQuote(current).type);
  const type = product ?? selectedType;
  const [category, setCategory] = useState<AssetClass | 'all'>('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(pageSize);

  const { markets, available } = useMemo(() => {
    const instruments = catalog.instruments.filter(item => item.type === type);
    return {
      available: new Set(instruments.map(item => item.category)),
      markets: instruments.map(item => ({
        item,
        terms: [marketLabel(item), item.name, item.symbol, item.quote, categories[item.category],
          ...(item.venue === 'Hyperliquid' ? [] : [item.venue]), ...(item.keywords ?? [])].map(normalize),
      })),
    };
  }, [catalog.instruments, type]);
  const search = normalize(query);
  const choices = markets.filter(({ item, terms }) =>
    (category === 'all' || item.category === category) && (!search || terms.some(term => term.includes(search))));
  const loading = catalog.status === 'loading';
  const unavailable = catalog.status === 'error' || catalog.unavailable.includes(type);
  const searchField = <label className="market-search">
    <Search size={17} aria-hidden="true" />
    <input type="search" aria-label="Search markets" placeholder="Search markets"
      value={query} onChange={event => { setQuery(event.target.value); setLimit(pageSize); }} data-dialog-focus onKeyDown={event => {
        if (event.key === 'Enter' && choices.length === 1) { event.preventDefault(); select(choices[0].item.id); }
      }} />
  </label>;

  return <div className="market-picker">
    {searchField}
    {!product && <div className="segmented market-products" role="group" aria-label="Product">
      {(['spot', 'perp'] as const).map(value => <button key={value} type="button" aria-pressed={type === value}
        onClick={() => { setType(value); setCategory('all'); setLimit(pageSize); }}>{value === 'spot' ? 'Spot' : 'Perps'}</button>)}
    </div>}
    <div className="market-categories" role="group" aria-label="Asset category">
      <button type="button" aria-pressed={category === 'all'} onClick={() => { setCategory('all'); setLimit(pageSize); }}>All assets</button>
      {categoryEntries.filter(([key]) => available.has(key)).map(([key, label]) =>
        <button type="button" key={key} aria-pressed={category === key}
          onClick={() => { setCategory(key); setLimit(pageSize); }}>{label}</button>)}
    </div>
    {unavailable && !loading && <div className="market-notice">
      <span role="status">Some Hyperliquid listings or categories are temporarily unavailable.</span>
      <button className="text-button" type="button" onClick={catalog.retry}>Retry</button>
    </div>}
    <div className="market-count secondary" role="status">
      {loading ? 'Loading Hyperliquid markets…' : choices.length ? `${choices.length} ${choices.length === 1 ? 'market' : 'markets'}` : 'No markets match your filters.'}
    </div>
    <ul key={type + category + search} aria-label={type === 'spot' ? 'Spot markets' : 'Perpetual markets'}>
      {choices.slice(0, limit).map(({ item: instrument }) => <li key={instrument.id}>
          <button className="market-choice" type="button" aria-current={current === instrument.id ? 'true' : undefined}
            onClick={() => select(instrument.id)}>
            <MarketIcon instrument={instrument}/>
            <span><strong>{marketLabel(instrument)}</strong><small>{instrument.name === instrument.symbol ? categories[instrument.category] : instrument.name}</small></span>
            <span className="market-venue">{instrument.venue}</span>
            {current === instrument.id && <Check size={16} aria-label="Current market"/>}
          </button>
        </li>)}
      {choices.length > limit && <li className="market-more"><button className="button small" type="button"
        onClick={() => setLimit(value => value + pageSize)}>Show more markets</button></li>}
    </ul>
  </div>;
}
