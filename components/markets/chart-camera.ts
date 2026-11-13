import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { Chart } from 'klinecharts';
import type { Market } from '@intuite/markets-protocol/markets';
import type { ChartCamera, Command, Interval } from '@intuite/markets-protocol/protocol';
import { pricePane } from './drawings';

const pane = { paneId: pricePane };
export const minChartBarSpace = 0.25;
export const maxChartBarSpace = 240;

function xAtTime(chart: Chart, timestamp: number) {
  const pixel = chart.convertToPixel({ timestamp }, pane);
  return Array.isArray(pixel) ? undefined : pixel.x;
}

function geometryKey(chart: Chart) {
  const candles = chart.getDataList();
  return [chart.getSize(pricePane, 'main')?.width, candles[0]?.timestamp, candles.at(-1)?.timestamp].join('/');
}

function readCamera(chart: Chart): ChartCamera | null {
  const width = chart.getSize(pricePane, 'main')?.width ?? 0;
  const candles = chart.getDataList();
  if (!width || !candles.length) return null;
  const { from, to } = chart.getVisibleRange();
  const last = candles[candles.length - 1];
  const lastX = xAtTime(chart, last.timestamp) ?? -1;
  const live = lastX >= 0 && lastX <= width && chart.getOffsetRightDistance() > 0;
  const middle = Math.max(0, Math.min(candles.length - 1, Math.floor((from + to - 1) / 2)));
  const candle = live ? last : candles[middle];
  const x = xAtTime(chart, candle.timestamp);
  if (x === undefined || x < 0 || x > width) return null;
  return {
    time: Math.floor(candle.timestamp / 1000),
    position: Number((x / width).toFixed(4)),
    bars: Number((width / chart.getBarSpace().bar).toFixed(3)),
    live,
  };
}

function applyCamera(chart: Chart, view: ChartCamera) {
  const candles = chart.getDataList();
  const first = candles[0]?.timestamp;
  const last = candles.at(-1)?.timestamp;
  if (first === undefined || last === undefined) return;
  const timestamp = view.live ? last : Math.max(first, Math.min(last, view.time * 1000));
  const wasEnabled = chart.isScrollEnabled();
  chart.setScrollEnabled(true);
  try {
    // The price axis can change width after the first pass.
    for (let pass = 0; pass < 2; pass++) {
      const width = chart.getSize(pricePane, 'main')?.width ?? 0;
      if (!width) return;
      chart.setBarSpace(Math.max(minChartBarSpace, Math.min(maxChartBarSpace, width / view.bars)));
      const x = xAtTime(chart, timestamp);
      const currentWidth = chart.getSize(pricePane, 'main')?.width ?? width;
      if (x !== undefined) chart.scrollByDistance(currentWidth * view.position - x);
    }
  } finally { chart.setScrollEnabled(wasEnabled); }
}

type Options = {
  market: Market; interval: Interval; camera: ChartCamera | null; presenting: boolean; following: boolean; connected: boolean;
  send: (command: Command) => boolean;
};

export function useChartCamera(chart: RefObject<Chart | null>, ready: RefObject<boolean>, options: Options) {
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; });
  const target = useRef<ChartCamera | null>(options.camera);
  const local = useRef<ChartCamera | null>(null);
  const applying = useRef(false);
  const initialSent = useRef(false);
  const lastPreview = useRef(0);
  const frame = useRef(0);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const applied = useRef('');

  const moved = useCallback(() => {
    const instance = chart.current;
    const { market, interval, presenting, connected, send } = latest.current;
    if (!instance || !ready.current || applying.current) return;
    target.current = null;
    if (!presenting || !connected) return;
    const view = readCamera(instance);
    if (!view) return;
    local.current = view;
    applied.current = geometryKey(instance);
    initialSent.current = true;
    const now = Date.now();
    if (now - lastPreview.current >= 100) {
      send({ type: 'chart-camera', market, interval, camera: view, settled: false });
      lastPreview.current = now;
    }
    clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      if (!ready.current || latest.current.market !== market || latest.current.interval !== interval ||
        !latest.current.presenting || !latest.current.connected) return;
      const finalView = chart.current && readCamera(chart.current);
      if (finalView) send({ type: 'chart-camera', market, interval, camera: finalView, settled: true });
    }, 240);
  }, [chart, ready]);

  const refresh = useCallback(() => {
    if (frame.current || applying.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const instance = chart.current;
      if (!instance || !ready.current) return;
      const view = target.current ?? local.current;
      if (!view) {
        if (!initialSent.current && latest.current.presenting && latest.current.connected) moved();
        return;
      }
      const candles = instance.getDataList();
      const size = instance.getSize(pricePane, 'main');
      const key = geometryKey(instance);
      if (!candles.length || !size?.width || key === applied.current) return;
      applying.current = true;
      try { applyCamera(instance, view); }
      finally {
        applying.current = false;
        applied.current = geometryKey(instance);
      }
    });
  }, [chart, moved, ready]);

  useEffect(() => {
    initialSent.current = false;
    lastPreview.current = 0;
    return () => {
      clearTimeout(settle.current);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [options.market, options.interval, options.presenting, options.connected]);

  useEffect(() => {
    target.current = options.camera;
    local.current = null;
    applied.current = '';
    refresh();
  }, [options.camera, options.market, options.interval, options.presenting, options.following, options.connected, refresh]);

  return { moved, refresh };
}
