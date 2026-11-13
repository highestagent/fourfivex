import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { dispose, init, type Chart, type Crosshair as NativeCrosshair, type KLineData, type Overlay, type OverlayCreate } from 'klinecharts';
import { ChevronDown, Crosshair, Ellipsis, MessageCircle, MousePointer2, Plus, Ruler, TrendingUp, Target } from 'lucide-react';
import { marketLabel, type Instrument } from '@intuite/markets-protocol/markets';
import { overlayTools, setupRatio, type ChartPresentation, type ChartSettings, type Command, type Item, type Member, type OverlayTool, type Point } from '@intuite/markets-protocol/protocol';
import { drawingHandles, moveDrawing, nativePoint, overlayFor, pricePane, roomPoint, setupOverlay, type Drawing, type DrawingItem } from './drawings';
import { ChartControls, indicatorId, onPrice, persistChartPreferences, readChartPreferences, zoomStep, type ChartPreferences } from './chart-controls';
import { maxChartBarSpace, minChartBarSpace, useChartCamera } from './chart-camera';
import { marketFeed, type FeedStatus } from './kline-feed';
import { chartPalette, chartStyles } from './chart-theme';
import type { Transient } from './client';
import { money } from './format';
import { Dialog } from './controls';
import { MarketIcon } from './market-picker';

type Level = Extract<Item, { kind: 'level' }>;
type Comment = Extract<Item, { kind: 'comment' }>;
type Placement = 'level' | 'comment' | 'trendline' | 'setup';
type Tool = 'pointer' | Placement | OverlayTool | 'measure';
type Anchor = Point & { levelId?: string };
type Props = {
  instrument: Instrument; chooseMarket: () => void;
  marketSwitchRef?: RefObject<HTMLButtonElement | null>;
  view: ChartPresentation['view']; presenting: boolean; following: boolean; presenter?: string; connected: boolean;
  updateChart: (settings: Partial<ChartSettings>) => void;
  saveDrawing: (drawing: Drawing) => void;
  items: Item[]; members: Member[]; editable: boolean;
  transient: RefObject<Map<string, Transient>>;
  send: (message: Command) => boolean;
  placeLevel: (point: Point) => void;
  addLevel?: (point: Point) => void; moveLevel: (level: Level, point: Point) => void;
  comment: (point: Anchor) => void; showComment: (id: string) => void;
  clearAnnotations?: () => void;
};

type Drag = {
  item: Level | DrawingItem; index: number; x: number; y: number;
  original: Point; point: Point; drawing?: Drawing; lastSend: number;
};

const currentTime = () => Date.now();
const timeFormat = Intl.NumberFormat('en', { notation: 'compact' });
function createCandleReadout() {
  let latest: KLineData | undefined;
  let hovered: KLineData | undefined;
  let current: KLineData | undefined;
  const listeners = new Set<() => void>();
  function notify() {
    const next = hovered ?? latest;
    if (current === next) return;
    current = next;
    for (const listener of listeners) listener();
  }
  return {
    current: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setLatest(bar?: KLineData) { latest = bar; notify(); },
    setHovered(bar?: KLineData) { hovered = bar; notify(); },
  };
}

function CandleReadout({ readout, instrument }: { readout: ReturnType<typeof createCandleReadout>; instrument: Instrument }) {
  const bar = useSyncExternalStore(readout.subscribe, readout.current);
  return <div className="chart-ohlc">{bar && <span>O <b>{money(bar.open, instrument)}</b> <span className="ohlc-more">H <b>{money(bar.high, instrument)}</b> L <b>{money(bar.low, instrument)}</b></span> C <b>{money(bar.close, instrument)}</b> <span className="ohlc-more">Vol <b>{timeFormat.format(bar.volume ?? 0)}</b></span></span>}</div>;
}

const pane = { paneId: pricePane };
const localDraft = 'local-draft';
const localMeasure = 'local-measure';
const nativeDraft = 'native-draft';
const isPlacement = (tool: Tool): tool is Placement => ['level', 'comment', 'trendline', 'setup'].includes(tool);

function setOverlay(chart: Chart, config: OverlayCreate) {
  if (!chart.overrideOverlay(config)) chart.createOverlay(config);
}

export function TradingChart(props: Props) {
  const [appearance, setAppearance] = useState(0);
  useEffect(() => {
    const refresh = () => setAppearance(value => value + 1);
    const system = window.matchMedia('(prefers-color-scheme: dark)');
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    system.addEventListener('change', refresh);
    return () => {
      observer.disconnect();
      system.removeEventListener('change', refresh);
    };
  }, []);
  const [preferences, setPreferences] = useState(readChartPreferences);
  const { instrument } = props;
  const market = instrument.id;
  const ticker = marketLabel(instrument);
  const { interval, scale } = props.view;
  const { candle, snap, studies } = preferences;
  const [showDrawingTools, setShowDrawingTools] = useState(false);
  const [mode, setMode] = useState<Tool>('pointer');
  const [step, setStep] = useState(0);
  const [toolMessage, setToolMessage] = useState('');
  const [measuring, setMeasuring] = useState(false);
  const [feed, setFeed] = useState<FeedStatus>('connecting');
  const [readout] = useState(createCandleReadout);
  const [lastPrice, setLastPrice] = useState<number>();
  const lastBar = useRef<KLineData | undefined>(undefined);
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<Chart | null>(null);
  const ready = useRef(false);
  const { moved: cameraMoved, refresh: refreshCamera } = useChartCamera(chart, ready, { market, interval, camera: props.view.camera,
    presenting: props.presenting, following: props.following, connected: props.connected, send: props.send });
  const placement = useRef<HTMLDivElement>(null);
  const markers = useRef<HTMLDivElement>(null);
  const controls = useRef(new Map<string, HTMLButtonElement>());
  const remote = useRef(new Map<string, HTMLElement>());
  const modeRef = useRef<Tool>('pointer');
  const draft = useRef<Point[]>([]);
  const pressed = useRef<{ id: number; x: number; y: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  const latest = useRef({ props, snap });
  useLayoutEffect(() => { latest.current = { props, snap }; });
  const studiesApplied = useRef(new Map<string, number[] | undefined>());
  const itemsApplied = useRef(new Map<string, Item>());
  const nativeDrags = useRef(new Map<string, Item>());
  const lastPointer = useRef(0);
  const presenterPointer = useRef<Point | null>(null);
  const frame = useRef(0);
  const { precision } = instrument;

  const clearPresenterPointer = useCallback(() => {
    if (!presenterPointer.current) return;
    presenterPointer.current = null;
    const room = latest.current.props;
    room.send({ type: 'pointer', market, interval: room.view.interval, point: null });
  }, [market]);

  const updateRemote = useCallback(() => {
    const instance = chart.current;
    const size = instance?.getSize(pricePane, 'main');
    const room = latest.current.props;
    if (!instance || !size || !markers.current || !instance.getDataList().length) return;
    for (const [key, info] of room.transient.current) {
      if (info.expires < currentTime()) {
        room.transient.current.delete(key);
        continue;
      }
      const pixel = instance.convertToPixel(nativePoint(info.point), pane);
      if (Array.isArray(pixel)) continue;
      const { x, y } = pixel;
      const visible = info.market === room.instrument.id && y !== undefined && y >= 0 && y < size.height &&
        (info.id || (x !== undefined && x >= 0 && x < size.width));
      if (!visible) {
        remote.current.get(key)?.remove();
        remote.current.delete(key);
        continue;
      }
      const spotlight = !info.id && room.following && info.member === room.presenter &&
        (info.interval === undefined || info.interval === room.view.interval);
      let node = remote.current.get(key);
      if (!node) {
        node = document.createElement('span');
        if (!info.id) {
          const label = document.createElement('span');
          label.textContent = room.members.find(member => member.id === info.member)?.name ?? 'Guest';
          node.appendChild(label);
        }
        markers.current.appendChild(node);
        remote.current.set(key, node);
      }
      node.className = info.id ? 'remote-preview' : spotlight ? 'remote-presenter' : 'remote-pointer';
      if (spotlight) {
        node.dataset.candleTime = String(info.point.time);
        node.style.transform = '';
        node.style.width = size.width + 'px';
        node.style.height = size.height + 'px';
        node.style.setProperty('--crosshair-x', x + 'px');
        node.style.setProperty('--crosshair-y', y + 'px');
      } else {
        delete node.dataset.candleTime;
        node.style.transform = `translate(${info.id ? 0 : x}px, ${y}px)`;
        node.style.width = info.id ? size.width + 'px' : '';
        node.style.height = '';
      }
    }
    for (const [key, node] of remote.current) {
      if (!room.transient.current.has(key)) { node.remove(); remote.current.delete(key); }
    }
  }, []);

  const positionControls = useCallback(() => {
    const instance = chart.current;
    const size = instance?.getSize(pricePane, 'main');
    if (!instance || !size) return;
    const { width, height } = size;
    if (placement.current) {
      placement.current.style.width = width + 'px';
      placement.current.style.height = height + 'px';
    }
    const room = latest.current.props;
    const hasBars = instance.getDataList().length > 0;
    const positions: Array<{ key: string; point: Partial<ReturnType<typeof nativePoint>> }> = [];
    for (const item of room.items) {
      const moving = drag.current?.item.id === item.id ? drag.current : null;
      if (item.kind === 'level' && item.data) {
        positions.push({ key: item.id, point: { value: Number(moving?.point.price ?? item.data.price) } });
      } else if (item.kind === 'comment') {
        const level = item.data.levelId && room.items.find(row => row.id === item.data.levelId && row.kind === 'level');
        const levelPrice = level && level.kind === 'level' ? level.data?.price : undefined;
        positions.push({ key: item.id, point: nativePoint({ ...item.data, price: levelPrice ?? item.data.price }) });
      } else if (item.kind === 'trendline' || item.kind === 'setup') {
        drawingHandles(moving?.drawing ?? item).forEach(({ point }, index) => positions.push({ key: item.id + ':' + index, point: nativePoint(point) }));
      }
    }
    const pixels = hasBars ? instance.convertToPixel(positions.map(entry => entry.point), pane) : [];
    positions.forEach(({ key }, index) => {
      const node = controls.current.get(key);
      if (!node) return;
      const { x = 12, y } = Array.isArray(pixels) ? pixels[index] ?? {} : {};
      node.hidden = !hasBars || y === undefined || x < 0 || x >= width || y < 0 || y >= height;
      if (!node.hidden) node.style.transform = `translate(${Math.round(x)}px, ${Math.round(y!)}px) translateY(-50%)`;
    });
    updateRemote();
  }, [updateRemote]);

  const scheduleLayout = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      positionControls();
    });
  }, [positionControls]);

  const pointAt = useCallback((x: number, y: number, useSnap = true) => {
    const instance = chart.current;
    if (!instance?.getDataList().length) return null;
    const points = instance.convertFromPixel([{ x, y }], pane);
    const point = Array.isArray(points) ? points[0] : points;
    if (!point) return null;
    const bar = instance.getDataList()[point.dataIndex ?? -1];
    if (useSnap && latest.current.snap !== 'normal' && bar) {
      let nearest = { distance: Infinity, value: 0 };
      for (const value of [bar.open, bar.high, bar.low, bar.close]) {
        const pixel = instance.convertToPixel({ value }, pane);
        const distance = !Array.isArray(pixel) && pixel.y !== undefined ? Math.abs(y - pixel.y) : Infinity;
        if (distance < nearest.distance) nearest = { distance, value };
      }
      if (latest.current.snap === 'strong_magnet' || nearest.distance <= 8) point.value = nearest.value;
    }
    return roomPoint(point, precision);
  }, [precision]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const instance = init(element, {
      styles: chartStyles(),
      hotkey: { enabled: false },
      layout: { barSpaceLimit: { min: minChartBarSpace, max: maxChartBarSpace }, pane: { minHeight: 55, dragEnabled: true } },
    });
    if (!instance) return;
    chart.current = instance;
    instance.setSymbol({ ticker, pricePrecision: precision, volumePrecision: 4 });
    instance.setOffsetRightDistance(Math.min(32, element.clientWidth * .06));
    instance.setBarSpace(8);
    const plot = instance.getDom(pricePane, 'main');
    if (plot) plot.dataset.testid = 'price-pane';
    const observer = new ResizeObserver(() => { instance.resize(); refreshCamera(); scheduleLayout(); });
    observer.observe(element);
    const plotObserver = new ResizeObserver(() => { refreshCamera(); scheduleLayout(); });
    if (plot) plotObserver.observe(plot);
    const moved = () => { cameraMoved(); scheduleLayout(); };
    instance.subscribeAction('onZoom', moved);
    instance.subscribeAction('onScroll', moved);
    instance.subscribeAction('onVisibleRangeChange', scheduleLayout);
    instance.subscribeAction('onPaneDrag', scheduleLayout);
    instance.subscribeAction('onCrosshairChange', data => {
      const cursor = data as NativeCrosshair | undefined;
      readout.setHovered(cursor?.kLineData);
      if (modeRef.current !== 'pointer' || cursor?.paneId !== pricePane || cursor.x === undefined || cursor.y === undefined) {
        clearPresenterPointer();
        return;
      }
      const now = Date.now();
      if (now - lastPointer.current < 90) return;
      const point = pointAt(cursor.x, cursor.y, false);
      if (!point) return;
      const room = latest.current.props;
      const candlePoint = cursor.kLineData ? { ...point, time: Math.floor(cursor.kLineData.timestamp / 1000) } : point;
      presenterPointer.current = room.presenting ? candlePoint : null;
      lastPointer.current = now;
      room.send({ type: 'pointer', market, interval: room.view.interval, point: room.presenting ? candlePoint : point });
    });
    const remoteNodes = remote.current;
    const appliedItems = itemsApplied.current;
    const appliedStudies = studiesApplied.current;
    const presenceTimer = setInterval(() => {
      const room = latest.current.props;
      if (remoteNodes.size || room.transient.current.size) updateRemote();
      if (room.presenting && presenterPointer.current && Date.now() - lastPointer.current >= 1000) {
        room.send({ type: 'pointer', market, interval: room.view.interval, point: presenterPointer.current });
        lastPointer.current = Date.now();
      }
    }, 85);
    return () => {
      observer.disconnect();
      plotObserver.disconnect();
      clearInterval(presenceTimer);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      remoteNodes.forEach(node => node.remove());
      remoteNodes.clear();
      appliedItems.clear();
      appliedStudies.clear();
      dispose(instance);
      chart.current = null;
    };
  }, [cameraMoved, clearPresenterPointer, market, pointAt, precision, readout, refreshCamera, scheduleLayout, ticker, updateRemote]);

  useEffect(() => {
    const instance = chart.current;
    if (!instance) return;
    ready.current = false;
    clearPresenterPointer();
    remote.current.forEach(node => node.remove());
    remote.current.clear();
    setFeed('connecting');
    lastBar.current = undefined;
    setLastPrice(undefined);
    readout.setLatest(undefined);
    readout.setHovered(undefined);
    return marketFeed(instance, market, interval, setFeed, bar => {
      ready.current = true;
      lastBar.current = bar;
      setLastPrice(bar.close);
      readout.setLatest(bar);
      refreshCamera();
      scheduleLayout();
    });
  }, [clearPresenterPointer, interval, market, pointAt, precision, readout, refreshCamera, scheduleLayout, ticker]);

  useEffect(() => {
    const styles = chartStyles();
    chart.current?.setStyles({ ...styles, candle: { ...styles.candle, type: candle } });
  }, [appearance, candle]);

  useEffect(() => { if (!props.presenting) clearPresenterPointer(); }, [clearPresenterPointer, props.presenting]);

  useEffect(() => {
    chart.current?.setScrollEnabled(!props.following);
    chart.current?.setZoomEnabled(!props.following);
  }, [props.following]);

  useEffect(() => {
    persistChartPreferences(preferences);
  }, [preferences]);

  useEffect(() => {
    const instance = chart.current;
    if (!instance) return;
    instance.overrideYAxis({ paneId: pricePane, name: scale });
    scheduleLayout();
  }, [scale, scheduleLayout]);

  useEffect(() => {
    const instance = chart.current;
    if (!instance) return;
    const active = new Set(studies.map(study => study.name));
    for (const name of studiesApplied.current.keys()) {
      if (active.has(name)) continue;
      instance.removeIndicator({ id: indicatorId(name) });
      studiesApplied.current.delete(name);
    }
    for (const { name, params } of studies) {
      const id = indicatorId(name);
      const previous = studiesApplied.current.get(name);
      if (studiesApplied.current.has(name) && previous === params) continue;
      const main = onPrice(name);
      const paneId = main ? pricePane : 'pane-' + name;
      if (previous && !params) instance.removeIndicator({ id });
      if (instance.getIndicators({ id }).length) {
        instance.overrideIndicator({ name, id, calcParams: params });
      } else {
        instance.createIndicator({ name, id, paneId, ...(params && { calcParams: params }) }, true);
        if (!main) instance.setPaneOptions({ id: paneId, minHeight: 55, height: name === 'VOL' ? 76 : 100, dragEnabled: true });
      }
      studiesApplied.current.set(name, params);
    }
    scheduleLayout();
  }, [studies, scheduleLayout]);

  const nativeShapePoints = useCallback((overlay: Overlay) => {
    return overlay.points.map(point => roomPoint(point, precision)).filter((point): point is Point => point !== null);
  }, [precision]);

  useEffect(() => {
    const instance = chart.current;
    if (!instance) return;
    const present = new Set(props.items.map(item => item.id));
    for (const id of itemsApplied.current.keys()) {
      if (present.has(id)) continue;
      instance.removeOverlay({ id });
      itemsApplied.current.delete(id);
      nativeDrags.current.delete(id);
    }
    for (const item of props.items) {
      const previous = itemsApplied.current.get(item.id);
      const native = instance.getOverlays({ id: item.id })[0];
      if (previous === item && native?.mode === snap && native.lock === (item.kind !== 'overlay' || !props.editable)) continue;
      const config = overlayFor(item, snap);
      if (!config) continue;
      if (item.kind === 'overlay' && item.data) {
        config.lock = !props.editable;
        config.onRightClick = event => event.preventDefault?.();
        config.onPressedMoveStart = () => { nativeDrags.current.set(item.id, item); };
        config.onPressedMoveEnd = ({ overlay }) => {
          const original = nativeDrags.current.get(item.id);
          nativeDrags.current.delete(item.id);
          if (!latest.current.props.editable || original?.kind !== 'overlay' || !original.data) return;
          const points = nativeShapePoints(overlay);
          const shape = original.data.shape;
          if (points.length === overlayTools[shape].points &&
              points.some((point, index) => point.time !== original.data!.points[index].time || point.price !== original.data!.points[index].price)) {
            latest.current.props.saveDrawing({ ...original, expected: original.revision, data: { shape, points } });
          }
          const current = latest.current.props.items.find(row => row.id === original.id);
          const authoritative = current && overlayFor(current, latest.current.snap);
          if (authoritative) instance.overrideOverlay({ id: original.id, points: authoritative.points });
        };
      }
      setOverlay(instance, config);
      itemsApplied.current.set(item.id, item);
    }
    scheduleLayout();
  }, [nativeShapePoints, props.items, props.editable, scheduleLayout, snap]);

  function clearMeasure() {
    chart.current?.removeOverlay({ id: localMeasure });
    setMeasuring(false);
  }

  function selectTool(tool: Tool) {
    if (tool !== 'pointer') clearPresenterPointer();
    const instance = chart.current;
    instance?.removeOverlay({ id: localDraft });
    instance?.removeOverlay({ id: nativeDraft });
    draft.current = [];
    pressed.current = null;
    setToolMessage('');
    setStep(0);
    modeRef.current = tool;
    setMode(tool);
    if (tool === 'pointer' || isPlacement(tool) || !instance) return;
    if (!lastBar.current) {
      modeRef.current = 'pointer';
      setMode('pointer');
      setToolMessage('Wait for market data before drawing.');
      return;
    }
    if (tool === 'measure') clearMeasure();
    let placed = 0;
    instance.createOverlay({
      name: tool, id: nativeDraft, ...pane, mode: latest.current.snap,
      ...(tool === 'measure' && { extendData: measureText }),
      onDrawing: ({ overlay }) => {
        if (overlay.currentStep !== placed) { placed = overlay.currentStep; setStep(Math.max(0, placed - 1)); }
      },
      onDrawEnd: ({ overlay }) => {
        const points = nativeShapePoints(overlay);
        const inPricePane = overlay.paneId === pricePane;
        const shape = tool;
        queueMicrotask(() => {
          if (chart.current !== instance || modeRef.current !== tool) return;
          selectTool('pointer');
          if (!inPricePane) { setToolMessage('Start the drawing in the price pane.'); return; }
          if (shape === 'measure' && points.length === 2) {
            instance.createOverlay({ name: 'measure', id: localMeasure, ...pane, lock: true, points: points.map(nativePoint), extendData: measureText });
            setMeasuring(true);
          } else if (shape !== 'measure' && latest.current.props.editable && points.length === overlayTools[shape].points) {
            latest.current.props.saveDrawing({ kind: 'overlay', id: crypto.randomUUID(), expected: 0,
              market: instrument.id, data: { shape, points } });
          }
        });
      },
      onRemoved: () => {
        queueMicrotask(() => {
          if (chart.current === instance && modeRef.current === tool && !instance.getOverlays({ id: nativeDraft }).length) selectTool('pointer');
        });
      },
    });
  }

  function measureText(points: Array<{ timestamp?: number; value?: number; dataIndex?: number }>) {
    const [from, to] = points;
    if (!from?.value || !to?.value || from.timestamp === undefined || to.timestamp === undefined) return [];
    const change = to.value - from.value;
    const sign = change >= 0 ? '+' : '−';
    const minutes = Math.round(Math.abs(to.timestamp - from.timestamp) / 60_000);
    const time = minutes >= 1440 ? (minutes / 1440).toFixed(1) + 'd' : minutes >= 60 ? (minutes / 60).toFixed(1) + 'h' : minutes + 'm';
    const instance = chart.current;
    const pixels = instance?.convertToPixel(points, pane);
    const converted = Array.isArray(pixels) && instance ? instance.convertFromPixel(pixels, pane) : null;
    const bars = Array.isArray(converted) ? Math.abs((converted[1]?.dataIndex ?? 0) - (converted[0]?.dataIndex ?? 0)) : 0;
    return [sign + money(Math.abs(change), instrument) + ' (' + sign + Math.abs(change / from.value * 100).toFixed(2) + '%)',
      (bars ? bars + (bars === 1 ? ' bar · ' : ' bars · ') : '') + time];
  }

  function placePoint(x: number, y: number) {
    const tool = modeRef.current;
    const instance = chart.current;
    if (!props.editable || !isPlacement(tool) || !instance) return;
    if (!lastBar.current) { setToolMessage('Wait for market data before drawing.'); return; }
    const point = pointAt(x, y, tool !== 'comment');
    if (!point) { setToolMessage('Wait for market data before drawing.'); return; }
    if (tool === 'level') {
      props.placeLevel(point);
    } else if (tool === 'comment') {
      if (!instance.getDataList().some(bar => bar.timestamp === point.time * 1000)) {
        setToolMessage('Click over a candle to pin your comment.');
        return;
      }
      props.comment(point);
    } else {
      const [start, stop] = draft.current;
      if (!start || (tool === 'setup' && !stop)) {
        if (start?.price === point.price) { setToolMessage('Choose a stop at a different price from the entry.'); return; }
        draft.current.push(point);
        setStep(draft.current.length);
        setToolMessage('');
        previewDraft(point);
        return;
      }
      const key = { id: crypto.randomUUID(), expected: 0, market: instrument.id };
      if (tool === 'trendline') {
        if (start.time === point.time && start.price === point.price) { setToolMessage('Choose a different endpoint.'); return; }
        props.saveDrawing({ ...key, kind: 'trendline', data: { start, end: point } });
      } else {
        if (!stop || setupRatio(start.price, stop.price, point.price) === null) {
          setToolMessage('Place the target on the opposite side of entry from the stop.');
          return;
        }
        props.saveDrawing({ ...key, kind: 'setup', data: { entry: start, stop: stop.price, target: point.price } });
      }
    }
    selectTool('pointer');
  }

  function previewDraft(point: Point | null) {
    const instance = chart.current;
    if (!point || !instance) return;
    const tool = modeRef.current;
    const [entry, stop] = draft.current;
    if (tool === 'level' || tool === 'comment' || !entry) {
      setOverlay(instance, {
        id: localDraft, name: 'horizontalStraightLine', ...pane, lock: true, points: [nativePoint(point)],
        needDefaultXAxisFigure: false, styles: { line: { color: chartPalette().blueLine, style: 'dashed', size: 1 } },
      });
    } else if (tool === 'trendline') {
      if (instance.getOverlays({ id: localDraft })[0]?.name !== 'segment') instance.removeOverlay({ id: localDraft });
      setOverlay(instance, {
        id: localDraft, name: 'segment', ...pane, lock: true, points: [nativePoint(entry), nativePoint(point)],
        styles: { line: { color: chartPalette().blue, style: 'dashed', size: 1 } },
      });
    } else if (tool === 'setup') {
      if (instance.getOverlays({ id: localDraft })[0]?.name !== setupOverlay) instance.removeOverlay({ id: localDraft });
      const stopPoint = { ...entry, price: stop?.price ?? point.price };
      const targetPoint = stop ? { ...entry, price: point.price } : entry;
      setOverlay(instance, { id: localDraft, name: setupOverlay, ...pane, lock: true,
        points: [entry, stopPoint, targetPoint].map(nativePoint) });
    }
  }

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>, item: Level | DrawingItem, index: number, point: Point) {
    if (!props.editable || event.button !== 0) return;
    const pixel = chart.current?.convertToPixel(nativePoint(point), pane);
    if (!pixel || Array.isArray(pixel) || pixel.x === undefined || pixel.y === undefined) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { item, index, x: pixel.x - event.clientX, y: pixel.y - event.clientY, original: point,
      point, lastSend: 0, ...(item.kind !== 'level' && { drawing: item }) };
  }

  function moveDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const state = drag.current;
    const instance = chart.current;
    if (!state || !instance) return;
    const point = pointAt(event.clientX + state.x, event.clientY + state.y, state.item.kind !== 'level');
    if (!point) return;
    if (state.item.kind === 'level') {
      state.point = { ...state.original, price: point.price };
      instance.overrideOverlay({ id: state.item.id, points: [nativePoint(state.point)] });
      if (currentTime() - state.lastSend > 80) {
        props.send({ type: 'preview', market: instrument.id, id: state.item.id, point: state.point });
        state.lastSend = currentTime();
      }
    } else if (state.drawing) {
      if (!drawingHandles(state.item)[state.index].movesInTime) point.time = state.original.time;
      const changed = moveDrawing(state.drawing, state.index, point);
      state.drawing = changed;
      instance.overrideOverlay({ id: state.item.id, points: drawingHandles(changed).map(handle => nativePoint(handle.point)) });
    }
    scheduleLayout();
  }

  function finishDrag(commit: boolean) {
    const state = drag.current;
    if (!state) return;
    drag.current = null;
    if (state.item.kind === 'level') {
      props.send({ type: 'preview', market: instrument.id, id: state.item.id, point: null });
      if (commit && state.original.price !== state.point.price) props.moveLevel(state.item, state.point);
    } else if (commit && state.drawing && state.drawing !== state.item) {
      props.saveDrawing({ ...state.drawing, expected: state.item.revision });
    }
    const authoritative = latest.current.props.items.find(item => item.id === state.item.id);
    const config = authoritative && overlayFor(authoritative, snap);
    if (config) chart.current?.overrideOverlay({ id: config.id, points: config.points });
    scheduleLayout();
  }

  function nudge(point: Point, key: string) {
    const tick = 10 ** -precision;
    return { ...point, price: Math.max(tick, Number(point.price) + (key === 'ArrowUp' ? tick : -tick)).toFixed(precision) };
  }

  function changePreferences(patch: Partial<ChartPreferences>) {
    if (patch.interval && patch.interval !== interval) {
      selectTool('pointer');
      clearMeasure();
    }
    if ((patch.interval && patch.interval !== interval) || (patch.scale && patch.scale !== scale)) {
      props.updateChart({
        ...(patch.interval && { interval: patch.interval }),
        ...(patch.scale && { scale: patch.scale }),
      });
    }
    if (patch.snap && patch.snap !== snap) chart.current?.overrideOverlay({ id: nativeDraft, mode: patch.snap });
    setPreferences(value => ({ ...value, ...patch }));
  }

  function fit() {
    const instance = chart.current;
    const count = instance?.getDataList().length;
    const size = instance?.getSize(pricePane, 'main');
    if (!instance || !count || !size) return;
    instance.setBarSpace(Math.max(0.25, Math.min(32, (size.width - instance.getOffsetRightDistance()) / count)));
    instance.scrollToRealTime();
    cameraMoved();
    scheduleLayout();
  }

  function download() {
    const instance = chart.current;
    if (!instance) return;
    const link = document.createElement('a');
    const filename = (instrument.symbol + instrument.quote + '-' + instrument.venue + '-' + instrument.type)
      .toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    link.download = 'intuite-markets-' + filename + '-' + interval + 'm.png';
    link.href = instance.getConvertPictureUrl(true, 'png', chartPalette().page);
    link.click();
  }

  const lowerCount = studies.filter(study => !onPrice(study.name)).length;
  const toolHint = {
    pointer: '',
    level: 'Click or tap the plot to place a level',
    comment: 'Click or tap a candle to pin a comment',
    trendline: step ? 'Choose the end of the trendline' : 'Choose the start of the trendline',
    setup: ['Choose an entry price', 'Choose a stop price', 'Choose a target price'][step],
    rayLine: 'Choose the origin and direction of the ray',
    verticalStraightLine: 'Choose a time for the vertical line',
    priceChannelLine: 'Choose two points for the baseline, then set the channel width',
    fibonacciLine: 'Choose the two ends of the move',
    rect: 'Choose opposite corners of the rectangle',
    measure: 'Choose two points to measure price and time',
  }[mode];
  const levels = props.items.filter((item): item is Level => item.kind === 'level' && item.data !== null);
  const comments = props.items.filter((item): item is Comment => item.kind === 'comment');
  const drawings = props.items.filter((item): item is DrawingItem => item.kind === 'trendline' || item.kind === 'setup');
  const toolButtons = [
    { tool: 'pointer', label: 'Pointer', Icon: MousePointer2 },
    { tool: 'level', label: 'Place price level', Icon: Crosshair },
    { tool: 'trendline', label: 'Draw trendline', Icon: TrendingUp },
    { tool: 'setup', label: 'Draw trade setup', Icon: Target },
    { tool: 'comment', label: 'Pin comment to chart', Icon: MessageCircle },
    { tool: 'measure', label: 'Measure price and time', Icon: Ruler },
  ] as const;
  const setControl = (id: string, node: HTMLButtonElement | null) => {
    if (node) controls.current.set(id, node);
    else controls.current.delete(id);
  };

  return <section className="chart-panel" aria-label={instrument.type === 'spot' ? instrument.symbol + '/' + instrument.quote + ' chart' : instrument.symbol + ' perpetual chart'} onKeyDown={event => {
    if (event.key === 'Escape' && modeRef.current !== 'pointer') { event.stopPropagation(); selectTool('pointer'); }
  }}>
    <div className="market-head">
      <div className="market-title"><MarketIcon instrument={instrument}/><div>
        <h2><button ref={props.marketSwitchRef} className="market-switch" type="button" aria-label={'Change market. Current market: ' + ticker} onClick={props.chooseMarket}>{ticker} <ChevronDown size={15}/></button></h2>
        <span className="mono-label">{instrument.venue}</span>
      </div></div>
      <div className="market-price"><strong>{lastPrice === undefined ? '—' : money(lastPrice, instrument)}</strong><span className={`feed mono-label ${feed}`}><i />{feed === 'live' ? 'Live' : feed === 'offline' ? 'Reconnecting' : 'Connecting'}</span></div>
    </div>
    <ChartControls chart={chart} preferences={{ ...preferences, interval, scale }} following={props.following} onChange={changePreferences} fit={fit} download={download}/>
    <div className="chart-work" style={{ minHeight: 360 + Math.max(0, lowerCount - 1) * 90 }}>
      <div className="chart-tools" role="group" aria-label="Chart drawing tools">
        {toolButtons.map(({ tool, label, Icon }) => <button className="icon-button" key={tool} type="button" title={label} aria-label={label}
          aria-pressed={mode === tool} disabled={!props.editable && tool !== 'pointer' && tool !== 'measure'}
          onClick={() => selectTool(tool)}><Icon size={18}/></button>)}
        <button className="icon-button" type="button" title="More drawing tools" aria-label="More drawing tools"
          aria-haspopup="dialog" aria-pressed={Object.hasOwn(overlayTools, mode)} disabled={!props.editable}
          onClick={() => setShowDrawingTools(true)}><Ellipsis size={18}/></button>
        {showDrawingTools && <Dialog title="Drawing tools" close={() => setShowDrawingTools(false)}>
          <div className="drawing-options">
            {Object.entries(overlayTools).map(([shape, { label }]) => <button key={shape} type="button" className="button"
              aria-pressed={mode === shape} onClick={() => { selectTool(shape as OverlayTool); setShowDrawingTools(false); }}>
              {label}
            </button>)}
          </div>
          {props.clearAnnotations && <button type="button" className="button danger mt-3" onClick={() => {
            setShowDrawingTools(false);
            props.clearAnnotations?.();
          }}>Clear annotations</button>}
        </Dialog>}
      </div>
      <div className={`chart-area tool-${mode}`} onPointerLeave={() => {
        readout.setHovered(undefined);
        presenterPointer.current = null;
        props.send({ type: 'pointer', market: instrument.id, interval, point: null });
      }}>
        <div className="canvas" ref={host} tabIndex={0} aria-label={props.following ? 'Price chart. Pause following to pan or zoom.' :
            'Price chart. Use left and right to pan, plus and minus to zoom, and End for the latest candle.'}
          onKeyDown={event => {
            const instance = chart.current;
            if (!instance || props.following || event.target !== event.currentTarget) return;
            switch (event.key) {
              case 'ArrowLeft': instance.scrollByDistance(70); break;
              case 'ArrowRight': instance.scrollByDistance(-70); break;
              case '+':
              case '=': instance.zoomAtCoordinate(zoomStep); break;
              case '-': instance.zoomAtCoordinate(1 / zoomStep); break;
              case 'End': instance.scrollToRealTime(); break;
              default: return;
            }
            event.preventDefault();
          }}/>
        <div className="overlays" ref={markers} aria-hidden="true"/>
        <div className="overlays">
          {levels.map(level => <button key={level.id} hidden ref={node => setControl(level.id, node)}
            className="level-handle" type="button" aria-label={`Price level ${level.data!.label} at ${level.data!.price}`}
            onPointerDown={event => startDrag(event, level, 0, level.data!)} onPointerMove={moveDrag} onPointerUp={() => finishDrag(true)}
            onPointerCancel={() => finishDrag(false)} onLostPointerCapture={() => finishDrag(false)}
            onKeyDown={event => {
              if (!props.editable || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
              event.preventDefault();
              props.moveLevel(level, nudge(level.data!, event.key));
            }}>{level.data!.label}</button>)}
          {drawings.flatMap(item => drawingHandles(item).map(({ name, point }, index) => {
            const key = item.id + ':' + index;
            return <button key={key} hidden type="button" ref={node => setControl(key, node)}
              className={`level-handle drawing-handle ${item.kind === 'setup' ? name.toLowerCase() : item.kind}-handle`} aria-label={`${name} at ${point.price}`}
              disabled={!props.editable} onPointerDown={event => startDrag(event, item, index, point)} onPointerMove={moveDrag}
              onPointerUp={() => finishDrag(true)} onPointerCancel={() => finishDrag(false)} onLostPointerCapture={() => finishDrag(false)}
              onKeyDown={event => {
                if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
                event.preventDefault();
                const changed = moveDrawing(item, index, nudge(point, event.key));
                if (changed !== item) props.saveDrawing({ ...changed, expected: item.revision });
              }}>{item.kind === 'trendline' ? '•' : name}</button>;
          }))}
          {comments.map(item => <button key={item.id} hidden ref={node => setControl(item.id, node)} className="comment-marker"
            type="button" title={item.data.text} aria-label="Read chart comment" onClick={() => props.showComment(item.id)}><MessageCircle size={13}/></button>)}
        </div>
        {isPlacement(mode) && <div className="placement-layer" ref={placement} aria-hidden="true"
          onPointerDown={event => {
            if (event.button === 0 && event.isPrimary) pressed.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
          }}
          onPointerMove={event => {
            const box = event.currentTarget.getBoundingClientRect();
            previewDraft(pointAt(event.clientX - box.left, event.clientY - box.top, mode !== 'comment'));
          }}
          onPointerLeave={() => { pressed.current = null; if (!draft.current.length) chart.current?.removeOverlay({ id: localDraft }); }}
          onPointerCancel={() => { pressed.current = null; }}
          onPointerUp={event => {
            const start = pressed.current;
            pressed.current = null;
            if (start?.id !== event.pointerId || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) return;
            const box = event.currentTarget.getBoundingClientRect();
            const x = event.clientX - box.left;
            const y = event.clientY - box.top;
            const size = chart.current?.getSize(pricePane, 'main');
            if (size && x >= 0 && y >= 0 && x < size.width && y < size.height) placePoint(x, y);
          }}/>}
        {feed === 'live' && lastPrice === undefined && <div className="chart-no-candles" role="status">No candles for this timeframe yet.</div>}
        {(toolHint || toolMessage) && <div className="tool-hint" role="status">{toolMessage || toolHint}</div>}
      </div>
    </div>
    <div className="chart-foot">
      <CandleReadout readout={readout} instrument={instrument}/>
      <div className="chart-footer-actions">
        {measuring && <button type="button" className="text-button" onClick={clearMeasure}>Clear measure</button>}
        {props.addLevel && <button type="button" className="text-button" disabled={!props.editable} onClick={() => {
          const bar = lastBar.current;
          props.addLevel?.({ price: bar?.close.toFixed(precision) ?? '', time: Math.floor((bar?.timestamp ?? Date.now()) / 1000) });
        }}><Plus size={14}/> Add level</button>}
      </div>
    </div>
  </section>;
}
