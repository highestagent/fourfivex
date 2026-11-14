import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultMarket, type Market } from '@fourfivex/markets-protocol/markets';
import type { Command, Interval, Item, Mutation, Point, Room, RoomEvent } from '@fourfivex/markets-protocol/protocol';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function api<T>(path: string, payload?: object): Promise<T> {
  const response = await fetch('/api/markets' + path, payload === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || result === null) throw new ApiError(response.status, result?.error ?? 'The request could not be completed.');
  return result as T;
}

export type Transient = { market: Market; member: string; id?: string; interval?: Interval; point: Point; expires: number };

function updated(room: Room | null, item: Item) {
  if (!room) return room;
  const current = room.items.find(row => row.id === item.id);
  if (current && current.revision >= item.revision) return room;
  const items = room.items.filter(row => row.id !== item.id);
  if (item.data) items.push(item);
  return { ...room, items };
}

export function useRoom(roomId: string) {
  const [room, setRoom] = useState<Room | null>(null);
  const [online, setOnline] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [revoked, setRevoked] = useState(false);
  const transient = useRef(new Map<string, Transient>());
  const socket = useRef<WebSocket | null>(null);
  const queued = useRef(new Map<string, Command>());
  const send = useCallback((message: Command) => {
    if (socket.current?.readyState === WebSocket.OPEN && socket.current.bufferedAmount < 65536) {
      socket.current.send(JSON.stringify(message));
      return true;
    }
    return false;
  }, []);
  const edit = useCallback((change: Mutation) => {
    const op = crypto.randomUUID();
    const message: Command = { type: 'edit', op, change };
    setError('');
    if (send(message)) queued.current.set(op, message);
    else setError('The room is reconnecting. Try your edit again when it is online.');
  }, [send]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    function connect() {
      const url = new URL('/api/markets/rooms/' + roomId + '/socket', location.href);
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      if (attempts) url.searchParams.set('reconnect', '1');
      const connection = new WebSocket(url);
      socket.current = connection;
      connection.onmessage = ({ data }) => {
        if (disposed) return;
        const event = JSON.parse(data) as RoomEvent;
        switch (event.type) {
          case 'snapshot':
            attempts = 0;
            transient.current.clear();
            setRoom(event.room);
            setConnected(true);
            for (const message of queued.current.values()) send(message);
            break;
          case 'members':
            setRoom(value => value && { ...value, members: event.members });
            break;
          case 'presence': setOnline(event.online); break;
          case 'chart-presentation':
            setRoom(value => {
              if (!value) return value;
              const previous = value.presentation;
              const next = event.presentation;
              const sameCamera = previous && previous.presenter === next.presenter &&
                previous.view.market === next.view.market && previous.view.interval === next.view.interval;
              return { ...value, presentation: sameCamera
                ? { ...next, view: { ...next.view, camera: previous.view.camera } } : next };
            });
            break;
          case 'chart-camera':
            setRoom(value => {
              const presentation = value?.presentation;
              if (!value || !presentation || event.market !== presentation.view.market || event.interval !== presentation.view.interval) return value;
              return { ...value, presentation: { ...presentation, view: { ...presentation.view, camera: event.camera } } };
            });
            break;
          case 'change': setRoom(value => updated(value, event.item)); break;
          case 'ack':
            queued.current.delete(event.op);
            if (event.item) { const item = event.item; setRoom(value => updated(value, item)); }
            if (event.error) setError(event.error);
            break;
          case 'error': setError(event.error); break;
          case 'pointer':
          case 'preview': {
            const key = event.type + ':' + event.member + ':' + (event.id ?? '');
            if (event.point) transient.current.set(key, { market: event.market ?? defaultMarket, member: event.member, id: event.id, interval: event.interval, point: event.point, expires: Date.now() + 2200 });
            else transient.current.delete(key);
          }
        }
      };
      connection.onclose = ({ code }) => {
        if (disposed) return;
        setConnected(false);
        setOnline([]);
        transient.current.clear();
        if (code === 1008) {
          setRevoked(true);
          return;
        }
        timer = setTimeout(connect, Math.min(7000, 350 * 2 ** attempts++));
      };
    }
    connect();
    return () => { disposed = true; clearTimeout(timer); socket.current?.close(); socket.current = null; };
  }, [roomId, send]);
  return { room, online, connected, error, revoked, transient, edit, send };
}
