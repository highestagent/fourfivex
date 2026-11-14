import { z } from 'zod';
import { defaultMarket, isMarket, type Market } from './markets';

export const id = z.uuid();
export const displayName = z.string().trim().min(1).max(32);
export const role = z.enum(['owner', 'editor', 'viewer']);
export type Role = z.infer<typeof role>;
export const price = z.string().regex(/^\d{1,9}(\.\d{1,8})?$/).refine(value => Number(value) > 0);
const time = z.number().int().min(1).max(4_102_444_800);
const point = z.object({ price, time });
const level = point.extend({ label: z.string().trim().min(1).max(48) });
const comment = point.extend({ levelId: id.optional(), text: z.string().trim().min(1).max(500) });
const idea = z.object({
  title: z.string().trim().min(1).max(64),
  rationale: z.string().trim().min(1).max(1200),
  entry: price, invalidation: price, target: price,
});

export function setupRatio(entry: string, stop: string, target: string) {
  const loss = Number(entry) - Number(stop);
  const gain = Number(target) - Number(entry);
  return loss * gain > 0 ? Math.abs(gain / loss) : null;
}

const marketId = z.custom<Market>(isMarket);
export const roomCreation = z.object({ name: displayName, market: marketId.optional() });
const key = { id, expected: z.number().int().nonnegative(), market: marketId };
const trendline = z.object({ start: point, end: point });
const setup = z.object({ entry: point, stop: price, target: price })
  .refine(data => setupRatio(data.entry.price, data.stop, data.target) !== null);
export const overlayTools = {
  rayLine: { label: 'Ray', points: 2 },
  verticalStraightLine: { label: 'Vertical line', points: 1 },
  priceChannelLine: { label: 'Price channel', points: 3 },
  fibonacciLine: { label: 'Fibonacci retracement', points: 2 },
  rect: { label: 'Rectangle', points: 2 },
} as const;
export type OverlayTool = keyof typeof overlayTools;
const overlay = z.object({
  shape: z.enum(Object.keys(overlayTools) as OverlayTool[]),
  points: z.array(point).min(1).max(3),
}).refine(data => data.points.length === overlayTools[data.shape].points);
export const mutation = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('level'), ...key, data: level.nullable() }),
  z.object({ kind: z.literal('comment'), ...key, data: comment }),
  z.object({ kind: z.literal('idea'), ...key, data: idea }),
  z.object({ kind: z.literal('trendline'), ...key, data: trendline.nullable() }),
  z.object({ kind: z.literal('setup'), ...key, data: setup.nullable() }),
  z.object({ kind: z.literal('overlay'), ...key, data: overlay.nullable() }),
]);
export const intervals = [1, 5, 15, 30, 60, 240, 1440] as const;
export type Interval = typeof intervals[number];
const chartInterval = z.literal(intervals);
const chartScale = z.enum(['normal', 'logarithm', 'percentage']);
const camera = z.object({
  time, position: z.number().min(0).max(1), bars: z.number().min(0.5).max(20_000), live: z.boolean(),
});
export type ChartCamera = z.infer<typeof camera>;
const chartSettings = z.object({ market: marketId, interval: chartInterval, scale: chartScale });
export type ChartSettings = z.infer<typeof chartSettings>;
export type ChartPresentation = { presenter: string; view: ChartSettings & { camera: ChartCamera | null } };
export const defaultChartView: ChartPresentation['view'] = { market: defaultMarket, interval: 15, scale: 'normal', camera: null };

export const command = z.discriminatedUnion('type', [
  z.object({ type: z.literal('edit'), op: id, change: mutation }),
  z.object({ type: z.literal('pointer'), market: marketId, interval: chartInterval.optional(), point: point.nullable() }),
  z.object({ type: z.literal('preview'), market: marketId, id, point: point.nullable() }),
  z.object({ type: z.literal('chart-settings'), settings: chartSettings.partial() }),
  z.object({ type: z.literal('chart-camera'), market: marketId, interval: chartInterval, camera, settled: z.boolean() }),
  z.object({ type: z.literal('chart-presenter'), member: id }),
]);
export type Command = z.infer<typeof command>;
export type Mutation = z.infer<typeof mutation>;
export type Point = z.infer<typeof point>;
export type Idea = z.infer<typeof idea>;
type Revision = { revision: number; author: string; updatedAt: number };
export type Item = Mutation & Revision;
export type Member = { id: string; name: string; role: Role };
export type Room = { me: Member; members: Member[]; items: Item[]; presentation?: ChartPresentation };
export type RoomEvent =
  | { type: 'snapshot'; room: Room }
  | { type: 'members'; members: Member[] }
  | { type: 'presence'; online: string[] }
  | { type: 'change'; item: Item }
  | { type: 'ack'; op: string; error?: string; item?: Item }
  | { type: 'error'; error: string }
  | { type: 'chart-presentation'; presentation: ChartPresentation }
  | { type: 'chart-camera'; market: Market; interval: Interval; camera: ChartCamera }
  | { type: 'pointer' | 'preview'; interval?: Interval; member: string; market?: Market; point: Point | null; id?: string };
export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
export const hyperliquidIntervals = { 1: '1m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', 240: '4h', 1440: '1d' } as const;

export function hyperliquidCandle(value: unknown): Candle | undefined {
  if (!value || typeof value !== 'object') return;
  const row = value as Record<string, unknown>;
  const numbers = ['t', 'o', 'h', 'l', 'c', 'v'].map(key => {
    const field = row[key];
    return typeof field === 'number' || (typeof field === 'string' && field.trim()) ? Number(field) : NaN;
  });
  const [time, open, high, low, close, volume] = numbers;
  if (!numbers.every(Number.isFinite) || time <= 0 || volume < 0) return;
  return { time: Math.floor(time / 1000), open, high, low, close, volume };
}
