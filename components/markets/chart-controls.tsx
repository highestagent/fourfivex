import { useRef, useState, type FormEvent, type RefObject } from 'react';
import { getSupportedIndicators, type CandleType, type Chart, type OverlayMode } from 'klinecharts';
import { Camera, Ellipsis, LocateFixed, Maximize, Minus, Plus, SlidersHorizontal } from 'lucide-react';
import { Select } from '@/components/Select';
import { Dialog } from './controls';
import { intervals, type Interval } from '@fourfivex/markets-protocol/protocol';

const indicators = getSupportedIndicators().filter(name => name !== 'AVP').sort();
const indicatorNames: Record<string, string> = {
  AO: 'Awesome oscillator', BBI: 'Bull and bear index', BIAS: 'Bias ratio', BOLL: 'Bollinger Bands',
  BRAR: 'BRAR', CCI: 'Commodity channel index', CR: 'CR energy indicator', DMA: 'Different moving averages',
  DMI: 'Directional movement index', EMA: 'Exponential moving average', EMV: 'Ease of movement', KDJ: 'KDJ stochastic',
  MA: 'Moving average', MACD: 'MACD', MTM: 'Momentum', OBV: 'On-balance volume', PSY: 'Psychological line',
  PVT: 'Price volume trend', ROC: 'Rate of change', RSI: 'Relative strength index', SAR: 'Parabolic SAR',
  SMA: 'Smoothed moving average', TRIX: 'TRIX', VOL: 'Volume', VR: 'Volume ratio', WR: 'Williams %R',
};
const parameterLabels: Record<string, string[]> = {
  BOLL: ['Period', 'Standard deviation multiplier'],
  MACD: ['Fast period', 'Slow period', 'Signal period'],
  SAR: ['Initial acceleration (%)', 'Acceleration step (%)', 'Maximum acceleration (%)'],
  KDJ: ['Lookback period', 'K smoothing', 'D smoothing'],
};
export const onPrice = (name: string) => ['BBI', 'BOLL', 'EMA', 'MA', 'SAR', 'SMA'].includes(name);
export const indicatorId = (name: string) => 'study-' + name;
export const zoomStep = 1.22;
const candleTypes = { candle_solid: 'Candles', candle_up_stroke: 'Hollow candles', ohlc: 'OHLC bars', area: 'Area' } satisfies Partial<Record<CandleType, string>>;
const scales = { normal: 'Linear', logarithm: 'Log', percentage: 'Percent' };
const snaps = { normal: 'Free placement', weak_magnet: 'Near candle OHLC', strong_magnet: 'Always to candle OHLC' } satisfies Record<OverlayMode, string>;
export type Study = { name: string; params?: number[] };
export type ChartPreferences = {
  interval: Interval; candle: keyof typeof candleTypes; scale: keyof typeof scales; snap: OverlayMode; studies: Study[];
};
const defaults: ChartPreferences = { interval: 15, candle: 'candle_solid', scale: 'normal', snap: 'normal', studies: [{ name: 'VOL' }] };
const storageKey = 'intuite:markets:chart-preferences:v1';

function validParameter(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1000;
}

export function readChartPreferences(): ChartPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as Partial<ChartPreferences>;
    const seen = new Set<string>();
    const studies = Array.isArray(value.studies) ? value.studies.filter(study => {
      if (!study || !indicators.includes(study.name) || seen.has(study.name)) return false;
      if (study.params !== undefined && (!Array.isArray(study.params) || study.params.length > 12 || !study.params.every(validParameter))) return false;
      seen.add(study.name);
      return true;
    }) : defaults.studies;
    return {
      interval: intervals.find(interval => interval === value.interval) ?? defaults.interval,
      candle: value.candle && Object.hasOwn(candleTypes, value.candle) ? value.candle : defaults.candle,
      scale: value.scale && Object.hasOwn(scales, value.scale) ? value.scale : defaults.scale,
      snap: value.snap && Object.hasOwn(snaps, value.snap) ? value.snap : defaults.snap,
      studies,
    };
  } catch { return defaults; }
}

export function persistChartPreferences(value: ChartPreferences) {
  try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch {}
}

function label(name: string) {
  return indicatorNames[name] ?? name;
}
function studyLabel(name: string) {
  return label(name) === name ? name : label(name) + ' (' + name + ')';
}
function timeframe(interval: Interval) {
  if (interval === 1440) return '1D';
  return interval >= 60 ? interval / 60 + 'h' : interval + 'm';
}

type Props = {
  chart: RefObject<Chart | null>;
  preferences: ChartPreferences;
  following: boolean;
  onChange: (patch: Partial<ChartPreferences>) => void;
  fit: () => void;
  download: () => void;
};

function selectOptions<Key extends string>(labels: Record<Key, string>) {
  return (Object.keys(labels) as Key[]).map(value => ({ value, label: labels[value] }));
}

const candleOptions = selectOptions(candleTypes);
const scaleOptions = selectOptions(scales);
const snapOptions = selectOptions(snaps);

export function ChartControls({ chart, preferences, following, onChange, fit, download }: Props) {
  const { interval, candle, scale, snap, studies } = preferences;
  const [showStudies, setShowStudies] = useState(false);
  const [showDisplay, setShowDisplay] = useState(false);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string>();
  const [studyError, setStudyError] = useState('');
  const active = new Set(studies.map(study => study.name));
  const lowerCount = studies.filter(study => !onPrice(study.name)).length;
  const matching = indicators.filter(name => !active.has(name) && studyLabel(name).toLowerCase().includes(query.trim().toLowerCase()));

  function addStudy(name: string) {
    if (active.has(name) || (!onPrice(name) && lowerCount >= 3)) return;
    onChange({ studies: [...studies, { name }] });
    setQuery('');
    setStudyError('');
  }

  function updateParams(event: FormEvent<HTMLFormElement>, name: string, expected: unknown[]) {
    event.preventDefault();
    const input = String(new FormData(event.currentTarget).get('parameters'));
    const parts = input.split(',').map(part => part.trim());
    const params = parts.map(Number);
    if (params.length !== expected.length || params.some((value, index) =>
      !validParameter(value) || (name !== 'SAR' && !(name === 'BOLL' && index === 1) && !Number.isInteger(value)))) {
      setStudyError('Enter ' + expected.length + ' positive parameters in the original order. Periods must be whole numbers.');
      return;
    }
    onChange({ studies: studies.map(study => study.name === name ? { name, params } : study) });
    setStudyError('');
    setEditing(undefined);
  }

  return <div className="chart-controls">
    <div className="segmented intervals" role="group" aria-label="Chart timeframe">
      {intervals.map(value => <button key={value} type="button" className={interval === value ? 'active' : ''}
        aria-pressed={interval === value} onClick={() => onChange({ interval: value })}>{timeframe(value)}</button>)}
    </div>
    <div className="view-controls view-display" role="group" aria-label="Chart display">
      <button className="button small indicators-button" type="button" aria-label="Indicators" title="Indicators" aria-haspopup="dialog"
        onClick={() => { setQuery(''); setEditing(undefined); setStudyError(''); setShowStudies(true); }}>
        <SlidersHorizontal size={15}/> <span>Indicators</span>
      </button>
      {showStudies && <Dialog title="Indicators" close={() => setShowStudies(false)}>
        <div className="studies">
          <input type="search" aria-label="Search indicators" placeholder="Search indicators" value={query} data-dialog-focus
            onChange={event => setQuery(event.target.value)} />
          {studies.length > 0 && <ul className="active-studies" aria-label="Active indicators">
            {studies.map(study => {
              const params = chart.current?.getIndicators({ id: indicatorId(study.name) })[0]?.calcParams ?? [];
              return <li key={study.name}>
                <div className="study-row"><span>{studyLabel(study.name)}</span>
                  <button className="text-button" type="button" onClick={() => { setEditing(editing === study.name ? undefined : study.name); setStudyError(''); }}
                    aria-label={'Settings for ' + study.name} aria-expanded={editing === study.name}>Settings</button>
                  <button className="text-button danger" type="button" onClick={() => onChange({ studies: studies.filter(item => item.name !== study.name) })}
                    aria-label={'Remove ' + study.name}>Remove</button>
                </div>
                {editing === study.name && (params.length > 0 ? <form onSubmit={event => updateParams(event, study.name, params)}>
                  <small>{parameterLabels[study.name]?.join(' · ') ?? params.map((_, index) => 'Period ' + (index + 1)).join(' · ')}</small>
                  <label className="field">Calculation parameters<input key={params.join(',')} name="parameters" defaultValue={params.join(', ')} required /></label>
                  <div className="study-actions"><button className="button small primary" type="submit">Apply</button>
                    <button className="button small" type="button" onClick={() => { onChange({ studies: studies.map(item => item.name === study.name ? { name: item.name } : item) }); setStudyError(''); setEditing(undefined); }}>Reset</button></div>
                </form> : <small>This indicator has no calculation parameters.</small>)}
              </li>;
            })}
          </ul>}
          {studyError && <small role="alert">{studyError}</small>}
          {lowerCount >= 3 && <small>Remove a lower-pane indicator to add another.</small>}
          <div className="indicator-catalog" aria-label="Available indicators">
            {matching.map(name => <button className="button small" type="button" key={name} disabled={!onPrice(name) && lowerCount >= 3}
              onClick={() => addStudy(name)}>{studyLabel(name)}<Plus size={13}/></button>)}
            {!matching.length && <small>No available indicators match.</small>}
          </div>
        </div>
      </Dialog>}
    </div>
    <div className="view-controls view-actions" role="group" aria-label="Chart navigation">
      <button className="icon-button" type="button" disabled={following} title={following ? 'Pause following to navigate' : 'Zoom out'} aria-label="Zoom out" onClick={() => chart.current?.zoomAtCoordinate(1 / zoomStep)}><Minus size={15}/></button>
      <button className="icon-button" type="button" disabled={following} title={following ? 'Pause following to navigate' : 'Zoom in'} aria-label="Zoom in" onClick={() => chart.current?.zoomAtCoordinate(zoomStep)}><Plus size={15}/></button>
      <button className="icon-button" type="button" disabled={following} title={following ? 'Pause following to navigate' : 'Fit loaded candles'} aria-label="Fit loaded candles" onClick={fit}><Maximize size={14}/></button>
      <button className="icon-button" type="button" disabled={following} title={following ? 'Pause following to navigate' : 'Go to latest candle'} aria-label="Go to latest candle" onClick={() => chart.current?.scrollToRealTime(200)}><LocateFixed size={15}/></button>
      <button className="icon-button" type="button" title="Download chart image" aria-label="Download chart image" onClick={download}><Camera size={15}/></button>
      <button ref={settingsButton} className="icon-button" type="button" aria-label="Chart settings" title="Chart settings" aria-haspopup="dialog" onClick={() => setShowDisplay(true)}><Ellipsis size={17}/></button>
      {showDisplay && <Dialog title="Chart settings" close={() => {
        setShowDisplay(false);
        requestAnimationFrame(() => settingsButton.current?.focus());
      }}>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <label htmlFor="chart-style" className="text-sm text-ink-2">Chart style</label>
            <Select id="chart-style" label="Chart style" pickerTitle="Chart style" className="action action-secondary"
              value={candle} options={candleOptions} onValueChange={candle => onChange({ candle })} />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="chart-price-scale" className="text-sm text-ink-2">Price scale</label>
            <Select id="chart-price-scale" label="Price scale" pickerTitle="Price scale" className="action action-secondary"
              value={scale} options={scaleOptions} onValueChange={scale => onChange({ scale })} />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="chart-drawing-snap" className="text-sm text-ink-2">Drawing snap</label>
            <Select id="chart-drawing-snap" label="Drawing snap" pickerTitle="Drawing snap" className="action action-secondary"
              value={snap} options={snapOptions} onValueChange={snap => onChange({ snap })} />
          </div>
        </div>
      </Dialog>}
    </div>
  </div>;
}
