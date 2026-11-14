import dynamic from 'next/dynamic';
import { Headphones } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Member } from '@fourfivex/markets-protocol/protocol';

export type AudioStatus = 'idle' | 'joining' | 'connected' | 'reconnecting';

const loadSession = () => import('./audio-session');
const preload = () => void loadSession().catch(() => {});
const AudioSession = dynamic(() => loadSession().then(module => module.AudioSession), {
  ssr: false,
  loading: () => <span className="sr-only" role="status">Loading room audio…</span>,
});

export function RoomAudio({ roomId, member }: { roomId: string; member: Member }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<AudioStatus>('idle');
  const trigger = useRef<HTMLButtonElement>(null);
  const active = status !== 'idle';
  const label = status === 'connected' ? 'Room audio · Connected' : status === 'reconnecting' ? 'Room audio · Reconnecting' : 'Room audio';

  // Downloads the audio software once the room is quiet, so the audio panel opens straight away.
  useEffect(() => {
    if ('requestIdleCallback' in window) {
      const idle = requestIdleCallback(preload, { timeout: 5000 });
      return () => cancelIdleCallback(idle);
    }
    const timer = setTimeout(preload, 3000);
    return () => clearTimeout(timer);
  }, []);

  return <>
    <button ref={trigger} className="room-icon room-audio" data-active={active} type="button" title={label}
      aria-label={label} aria-haspopup="dialog" aria-expanded={open} onPointerEnter={preload} onFocus={preload} onClick={() => setOpen(true)}>
      <Headphones size={17} aria-hidden="true" />
    </button>
    {(open || active) && <AudioSession roomId={roomId} member={member} open={open} status={status} setStatus={setStatus} close={() => {
      setOpen(false);
      requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
    }} />}
  </>;
}
