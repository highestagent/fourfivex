import dynamic from 'next/dynamic';
import { Headphones } from 'lucide-react';
import { useRef, useState } from 'react';
import type { Member } from '@fourfivex/markets-protocol/protocol';

export type AudioStatus = 'idle' | 'joining' | 'connected' | 'reconnecting';

const AudioSession = dynamic(() => import('./audio-session').then(module => module.AudioSession), {
  ssr: false,
  loading: () => <span className="sr-only" role="status">Loading room audio…</span>,
});

export function RoomAudio({ roomId, member }: { roomId: string; member: Member }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<AudioStatus>('idle');
  const trigger = useRef<HTMLButtonElement>(null);
  const active = status !== 'idle';
  const label = status === 'connected' ? 'Room audio · Connected' : status === 'reconnecting' ? 'Room audio · Reconnecting' : 'Room audio';

  return <>
    <button ref={trigger} className="room-icon room-audio" data-active={active} type="button" title={label}
      aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <Headphones size={17} aria-hidden="true" />
    </button>
    {(open || active) && <AudioSession roomId={roomId} member={member} open={open} status={status} setStatus={setStatus} close={() => {
      setOpen(false);
      requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
    }} />}
  </>;
}
