import { registerOverlay, type OverlayCreate, type OverlayFigure, type Point as KPoint } from 'klinecharts';
import measure from '@klinecharts/extension/overlays/measure';
import rect from '@klinecharts/extension/overlays/rect';
import { setupRatio, type Item, type Mutation, type Point } from '@intuite/markets-protocol/protocol';
import { chartPalette } from './chart-theme';

export type DrawingItem = Extract<Item, { kind: 'trendline' | 'setup' | 'overlay' }>;
export type Drawing = Extract<Mutation, { kind: 'trendline' | 'setup' | 'overlay' }>;
export type DrawingHandle = { name: string; point: Point; movesInTime: boolean };
export const pricePane = 'candle_pane';
export const setupOverlay = 'intuiteTradeSetup';

export function drawingHandles(item: Drawing): DrawingHandle[] {
  if (!item.data || item.kind === 'overlay') return [];
  if (item.kind === 'trendline') return [
    { name: 'Trendline start', point: item.data.start, movesInTime: true },
    { name: 'Trendline end', point: item.data.end, movesInTime: true },
  ];
  const { entry, stop, target } = item.data;
  return [
    { name: 'Entry', point: entry, movesInTime: true },
    { name: 'Stop', point: { ...entry, price: stop }, movesInTime: false },
    { name: 'Target', point: { ...entry, price: target }, movesInTime: false },
  ];
}

export function moveDrawing(item: Drawing, index: number, point: Point): Drawing {
  if (!item.data || item.kind === 'overlay') return item;
  if (item.kind === 'trendline') return { ...item, data: { ...item.data, [index === 0 ? 'start' : 'end']: point } };
  const data = { ...item.data };
  if (index === 0) data.entry = point;
  if (index === 1) data.stop = point.price;
  if (index === 2) data.target = point.price;
  return setupRatio(data.entry.price, data.stop, data.target) === null ? item : { ...item, data };
}

export function nativePoint(point: Point) {
  return { timestamp: point.time * 1000, value: Number(point.price) };
}

export function roomPoint(point: Partial<KPoint>, precision: number): Point | null {
  if (!point.timestamp || !Number.isFinite(point.value)) return null;
  const time = Math.round(point.timestamp / 1000);
  const price = point.value!.toFixed(precision);
  return time >= 1 && time <= 4_102_444_800 && Number(price) > 0 && Number(price) < 1e9 ? { time, price } : null;
}

registerOverlay(rect);
registerOverlay(measure);
registerOverlay({
  name: setupOverlay,
  needDefaultYAxisFigure: true,
  totalStep: 4,
  createPointFigures({ coordinates, bounding, overlay }) {
    const [entry, stop, target] = coordinates;
    if (!entry) return [];
    const left = Math.max(0, entry.x);
    const right = Math.min(bounding.width, entry.x + 220);
    if (right <= left) return [];
    const colors = chartPalette();
    const lines = [colors.blue, colors.rose, colors.green];
    const fills = [colors.blueWash, colors.roseWash, colors.greenWash];
    const figures: OverlayFigure[] = [];
    for (const [index, point] of coordinates.entries()) {
      const color = lines[index];
      if (index) figures.push({
        type: 'rect', attrs: { x: left, y: Math.min(entry.y, point.y), width: right - left, height: Math.abs(point.y - entry.y) },
        styles: { color: fills[index], style: 'fill' }, ignoreEvent: true,
      });
      figures.push({
        type: 'line', attrs: { coordinates: [{ x: left, y: point.y }, { x: right, y: point.y }] },
        styles: { color, size: 1, style: index ? 'dashed' : 'solid' }, ignoreEvent: true,
      });
    }
    if (stop && target) {
      const [e, s, t] = overlay.points.map(point => String(point.value));
      const ratio = setupRatio(e, s, t);
      if (ratio !== null && right - left >= 100) figures.push({
        type: 'text', attrs: { x: right - 5, y: entry.y - 6, text: (target.y < entry.y ? 'Long  ' : 'Short  ') + ratio.toFixed(2) + 'R', align: 'right', baseline: 'bottom' },
        styles: { color: colors.ink, backgroundColor: colors.page, borderColor: colors.line, style: 'stroke_fill', borderSize: 1, borderRadius: 8, paddingLeft: 5, paddingRight: 5, paddingTop: 3, paddingBottom: 3 },
        ignoreEvent: true,
      });
    }
    return figures;
  },
});

export function overlayFor(item: Item | Drawing, mode: OverlayCreate['mode']): OverlayCreate | null {
  if (!item.data || item.kind === 'comment' || item.kind === 'idea') return null;
  const base = { id: item.id, paneId: pricePane, lock: true, mode };
  if (item.kind === 'level') return {
    ...base, name: 'horizontalStraightLine', points: [nativePoint(item.data)], needDefaultXAxisFigure: false,
    styles: { line: { color: chartPalette().blue, size: 1, style: 'dashed' } },
  };
  if (item.kind === 'overlay') return {
    ...base, name: item.data.shape, points: item.data.points.map(nativePoint),
  };
  return {
    ...base, name: item.kind === 'trendline' ? 'segment' : setupOverlay,
    points: drawingHandles(item).map(handle => nativePoint(handle.point)),
    styles: { line: { color: chartPalette().blue, size: 1.5 } },
  };
}
