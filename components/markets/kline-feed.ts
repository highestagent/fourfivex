import type { Chart, KLineData, Period } from 'klinecharts';
import { hyperliquidMarket, type Market } from '@intuite/markets-protocol/markets';
import { hyperliquidCandle, hyperliquidIntervals, type Candle, type Interval } from '@intuite/markets-protocol/protocol';

export type FeedStatus = 'connecting' | 'live' | 'offline';
export const hyperliquidSocket = 'wss://api.hyperliquid.xyz/ws';

export function chartPeriod(interval: Interval): Period {
  if (interval === 1440) return { type: 'day', span: 1 };
  if (interval >= 60) return { type: 'hour', span: interval / 60 };
  return { type: 'minute', span: interval };
}

function toBar({ time, ...bar }: Candle): KLineData {
  return { ...bar, timestamp: time * 1000 };
}

function validBar(bar: KLineData) {
  return [bar.timestamp, bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite);
}

export function marketFeed(chart: Chart, market: Market, interval: Interval, onStatus: (status: FeedStatus) => void,
  onBar: (bar: KLineData) => void) {
  const hyperliquid = hyperliquidMarket(market);
  if (!hyperliquid) {
    onStatus('offline');
    return;
  }
  const remoteInterval = hyperliquidIntervals[interval];
  const subscription = { type: 'candle', coin: hyperliquid.coin, interval: remoteInterval };
  const controller = new AbortController();
  const path = '/api/markets/candles?' + new URLSearchParams({ interval: String(interval), market, history: 'full' });
  let history: KLineData[] = [];
  let recoveredForInit: KLineData[] | undefined;
  let socket: WebSocket | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let attempts = 0;
  let unsubscribe = () => {};

  async function readHistory() {
    const response = await fetch(path, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
    if (!response.ok) throw new Error('Market history is unavailable.');
    return (await response.json() as Candle[]).map(toBar).filter(validBar).sort((a, b) => a.timestamp - b.timestamp);
  }

  function publish(bars: KLineData[], update: (bar: KLineData) => void) {
    let last = chart.getDataList().at(-1)?.timestamp ?? 0;
    for (const bar of bars) {
      if (bar.timestamp < last) continue;
      update(bar);
      last = bar.timestamp;
    }
    const bar = chart.getDataList().at(-1);
    if (bar) onBar(bar);
  }

  function subscribe(update: (bar: KLineData) => void) {
    let active = true;
    const isActive = () => active && !controller.signal.aborted;
    async function connect(backfill: boolean) {
      if (backfill) {
        try {
          const recovered = await readHistory();
          if (!isActive()) return;
          if (!history.length && recovered.length) {
            recoveredForInit = recovered;
            chart.resetData();
            return;
          }
          history = recovered;
          publish(recovered, update);
        } catch {  }
      }
      if (!isActive()) return;
      const stream = new WebSocket(hyperliquidSocket);
      socket = stream;
      const armWatchdog = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => stream.close(), 35_000);
      };
      armWatchdog();
      stream.onopen = () => {
        stream.send(JSON.stringify({ method: 'subscribe', subscription }));
        heartbeat = setInterval(() => {
          if (stream.readyState === WebSocket.OPEN) stream.send(JSON.stringify({ method: 'ping' }));
        }, 25_000);
      };
      stream.onmessage = ({ data }) => {
        if (!isActive()) return;
        armWatchdog();
        let message;
        try { message = JSON.parse(data); } catch { return; }
        if (message.channel === 'error') {
          stream.close();
          return;
        }
        if (message.channel === 'subscriptionResponse' && message.data?.subscription?.type === 'candle') {
          attempts = 0;
          onStatus('live');
        }
        if (message.channel !== 'candle' || !message.data) return;
        const rows: { s?: string; i?: string }[] = Array.isArray(message.data) ? message.data : [message.data];
        const bars = rows.flatMap(row => {
          if (row?.s !== subscription.coin || row?.i !== remoteInterval) return [];
          const bar = hyperliquidCandle(row);
          return bar ? [toBar(bar)] : [];
        }).sort((a, b) => a.timestamp - b.timestamp);
        if (!bars.length) return;
        publish(bars, update);
        attempts = 0;
        onStatus('live');
      };
      stream.onclose = () => {
        clearInterval(heartbeat);
        clearTimeout(watchdog);
        if (!isActive()) return;
        onStatus('offline');
        reconnect = setTimeout(() => void connect(true), Math.min(10_000, 1000 * 2 ** attempts++));
      };
    }
    void connect(false);
    unsubscribe = () => {
      active = false;
      clearTimeout(reconnect);
      clearTimeout(watchdog);
      clearInterval(heartbeat);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }

  chart.setPeriod(chartPeriod(interval));
  chart.setDataLoader({
    async getBars({ type, callback }) {
      if (type === 'init') {
        try { history = recoveredForInit ?? await readHistory(); }
        catch { if (!controller.signal.aborted) onStatus('offline'); }
        if (controller.signal.aborted) return;
        recoveredForInit = undefined;
        callback(history);
        const last = history.at(-1);
        if (last) onBar(last);
      } else {
        callback([]);
      }
    },
    subscribeBar({ callback }) { subscribe(callback); },
    unsubscribeBar() { unsubscribe(); },
  });
  return () => {
    controller.abort();
    unsubscribe();
  };
}
