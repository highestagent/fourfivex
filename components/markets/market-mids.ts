import { useEffect, useState } from 'react';
import { hyperliquidSocket } from './kline-feed';

export function useMarketMids(enabled: boolean) {
  const [mids, setMids] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!enabled) return;
    const desktop = window.matchMedia('(min-width: 56rem)');
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout>;
    let heartbeat: ReturnType<typeof setInterval>;
    let attempts = 0;

    function connect() {
      const stream = new WebSocket(hyperliquidSocket);
      socket = stream;
      stream.onopen = () => {
        stream.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'allMids' } }));
        heartbeat = setInterval(() => {
          if (stream.readyState === WebSocket.OPEN) stream.send(JSON.stringify({ method: 'ping' }));
        }, 25_000);
      };
      stream.onmessage = ({ data }) => {
        try {
          const message = JSON.parse(data);
          if (message.channel !== 'allMids' || !message.data?.mids || typeof message.data.mids !== 'object') return;
          attempts = 0;
          setMids(message.data.mids);
        } catch {}
      };
      stream.onclose = () => {
        socket = undefined;
        clearInterval(heartbeat);
        setMids({});
        retry = setTimeout(connect, Math.min(10_000, 1000 * 2 ** attempts++));
      };
    }

    function disconnect() {
      clearInterval(heartbeat);
      clearTimeout(retry);
      if (!socket) return;
      socket.onclose = null;
      socket.onmessage = null;
      socket.onopen = null;
      socket.close();
      socket = undefined;
    }
    function sync() {
      if (desktop.matches) connect();
      else disconnect();
    }

    if (desktop.matches) connect();
    desktop.addEventListener('change', sync);
    return () => {
      desktop.removeEventListener('change', sync);
      disconnect();
    };
  }, [enabled]);

  return mids;
}
