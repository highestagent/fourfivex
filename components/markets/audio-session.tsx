import { useCallback, useEffect, useRef, useState } from 'react';
import RTKClient, { type SocketConnectionState } from '@cloudflare/realtimekit';
import { Headphones, Mic, MicOff, PhoneOff, Volume2 } from 'lucide-react';
import type { Member } from '@fourfivex/markets-protocol/protocol';
import { api, ApiError } from './client';
import { Dialog } from './controls';
import type { AudioStatus } from './RoomAudio';

type Meeting = Awaited<ReturnType<typeof RTKClient.init>>;
type Peer = { id: string; name: string; enabled: boolean; track?: MediaStreamTrack };
type Connection = { meeting?: Meeting; unsubscribe?: () => void };
/** A call set up ahead of joining. Its audio pass lasts 15 minutes, so it is only used for the first 10. */
type Prepared = { meeting: Promise<Meeting | undefined>; at: number };
const preparedLife = 10 * 60_000;

export function AudioSession({ roomId, member, open, status, setStatus, close }: {
  roomId: string; member: Member; open: boolean; status: AudioStatus; setStatus: (status: AudioStatus) => void; close: () => void;
}) {
  const connection = useRef<Connection | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [speaker, setSpeaker] = useState('');
  const [muted, setMuted] = useState(true);
  const [micBusy, setMicBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [blocked, setBlocked] = useState(false);
  const audioElements = useRef(new Map<string, HTMLAudioElement>());
  const prepared = useRef<Prepared | null>(null);

  const release = useCallback(() => {
    const previous = connection.current;
    connection.current = null;
    previous?.unsubscribe?.();
    return previous?.meeting?.leave().catch(() => {});
  }, []);

  /** Gets an audio pass and sets up the call, without joining it. Each call is its own, so two never collide. */
  const setUp = useCallback(() => api<{ token: string }>(`/rooms/${roomId}/voice`, {})
    .then(({ token }): Promise<Meeting | undefined> => RTKClient.init({ authToken: token, defaults: { audio: false, video: false } })),
  [roomId]);

  const discard = useCallback(() => {
    const current = prepared.current;
    prepared.current = null;
    void current?.meeting.then(meeting => meeting?.leave()).catch(() => {});
  }, []);

  useEffect(() => () => { discard(); void release(); }, [release, discard]);

  // While the panel is open, the call is set up in the background, so "Join audio" only has to connect.
  useEffect(() => {
    if (!open || status !== 'idle' || prepared.current) return;
    const meeting = setUp();
    meeting.catch(() => {});
    prepared.current = { meeting, at: Date.now() };
  }, [open, status, setUp]);

  /** The call set up while the panel was open, if it is still fresh; otherwise a new one. */
  async function ready(retry: boolean) {
    const current = prepared.current;
    prepared.current = null;
    if (current && !retry && Date.now() - current.at < preparedLife) {
      const meeting = await current.meeting.catch(() => undefined);
      if (meeting) return meeting;
    } else if (current) {
      void current.meeting.then(meeting => meeting?.leave()).catch(() => {});
    }
    return setUp();
  }

  function reset() {
    setStatus('idle');
    setPeers([]);
    setSpeaker('');
    setMuted(true);
    setMicBusy(false);
    setBlocked(false);
  }

  async function join(retry = false) {
    if (connection.current) return;
    const attempt: Connection = {};
    connection.current = attempt;
    setStatus(retry ? 'reconnecting' : 'joining');
    setMessage('');
    try {
      const meeting = await ready(retry);
      if (!meeting) throw new Error('Audio could not initialize.');
      if (connection.current !== attempt) { await meeting.leave(); return; }
      attempt.meeting = meeting;
      const joined = meeting.participants.joined;
      let speakerTimer: ReturnType<typeof setTimeout> | undefined;

      function refresh() {
        setPeers(joined.toArray().map(peer => ({
          id: peer.id, name: peer.name, enabled: peer.audioEnabled, track: peer.audioTrack,
        })));
      }
      function active({ peerId }: { peerId: string }) {
        setSpeaker(peerId);
        clearTimeout(speakerTimer);
        speakerTimer = setTimeout(() => setSpeaker(''), 1300);
      }
      function syncMic() {
        setMuted(!meeting!.self.audioEnabled);
      }
      function ended() {
        if (connection.current !== attempt) return;
        connection.current = null;
        attempt.unsubscribe?.();
        reset();
        setMessage('Room audio ended.');
      }
      async function updateConnection({ state }: SocketConnectionState) {
        if (connection.current !== attempt) return;
        if (state === 'connected' && meeting!.self.roomJoined) setStatus('connected');
        if (state === 'reconnecting' || state === 'disconnected') setStatus('reconnecting');
        if (state !== 'failed') return;
        const leaving = release();
        setPeers([]);
        setSpeaker('');
        setMuted(true);
        setMicBusy(false);
        setBlocked(false);
        if (retry) {
          reset();
          setMessage('Audio disconnected. Join again to reconnect.');
          return;
        }
        const reconnecting: Connection = {};
        connection.current = reconnecting;
        setStatus('reconnecting');
        await leaving;
        if (connection.current !== reconnecting) return;
        connection.current = null;
        void join(true);
      }
      joined.on('participantJoined', refresh);
      joined.on('participantLeft', refresh);
      joined.on('audioUpdate', refresh);
      meeting.participants.on('activeSpeaker', active);
      meeting.self.on('audioUpdate', syncMic);
      meeting.self.on('roomLeft', ended);
      meeting.meta.on('socketConnectionUpdate', updateConnection);
      attempt.unsubscribe = () => {
        clearTimeout(speakerTimer);
        joined.removeListener('participantJoined', refresh);
        joined.removeListener('participantLeft', refresh);
        joined.removeListener('audioUpdate', refresh);
        meeting.participants.removeListener('activeSpeaker', active);
        meeting.self.removeListener('audioUpdate', syncMic);
        meeting.self.removeListener('roomLeft', ended);
        meeting.meta.removeListener('socketConnectionUpdate', updateConnection);
      };
      await meeting.join();
      if (connection.current !== attempt) { await meeting.leave(); return; }
      refresh();
      syncMic();
      setStatus('connected');
    } catch (error) {
      if (connection.current !== attempt) return;
      void release();
      reset();
      setMessage(error instanceof ApiError ? error.message : 'Could not join room audio. Try again.');
    }
  }

  async function toggleMic() {
    const attempt = connection.current;
    const meeting = attempt?.meeting;
    if (!meeting || member.role === 'viewer' || micBusy) return;
    setMessage('');
    setMicBusy(true);
    try {
      if (meeting.self.audioEnabled) await meeting.self.disableAudio();
      else await meeting.self.enableAudio();
      if (connection.current !== attempt) return;
      setMuted(!meeting.self.audioEnabled);
      if (muted && !meeting.self.audioEnabled) setMessage('Microphone unavailable. You can still listen.');
    } catch {
      if (connection.current === attempt) setMessage('Could not change your microphone. Check browser permissions.');
    } finally {
      if (connection.current === attempt) setMicBusy(false);
    }
  }

  const attach = useCallback((id: string, track: MediaStreamTrack, element: HTMLAudioElement) => {
    audioElements.current.set(id, element);
    element.srcObject = new MediaStream([track]);
    void element.play().catch(error => {
      if (error instanceof DOMException && error.name === 'NotAllowedError' && audioElements.current.get(id) === element) setBlocked(true);
    });
    return () => {
      element.srcObject = null;
      audioElements.current.delete(id);
    };
  }, []);

  async function enableSound() {
    const results = await Promise.allSettled([...audioElements.current.values()].map(element => element.play()));
    setBlocked(results.some(result => result.status === 'rejected'));
  }

  return <>
    {peers.map(peer => peer.track && peer.enabled && <RemoteAudio key={peer.id} id={peer.id} track={peer.track} attach={attach} />)}
    {open && <Dialog title="Room audio" close={close}>
      <div className="grid gap-4">
        {status === 'idle' && <p className="text-sm text-ink-2">{member.role === 'viewer' ? 'Join to listen to the room.' : 'Join with your microphone muted.'}</p>}
        {status === 'joining' && <p role="status" className="text-sm text-ink-2">Joining room audio…</p>}
        {status === 'reconnecting' && <p role="status" className="text-sm text-ink-2">Reconnecting audio…</p>}
        {status === 'connected' && <ul aria-label="Audio participants" className="divide-y divide-line rounded-xl border border-line bg-surface px-3">
          <li className="flex min-h-11 items-center justify-between gap-2 text-sm">
            <span>You</span><span className="text-ink-2">{member.role === 'viewer' ? 'Listening' : muted ? 'Muted' : 'Mic on'}</span>
          </li>
          {peers.map(peer => <li key={peer.id} className="flex min-h-11 items-center justify-between gap-2 text-sm">
            <span className="wrap-anywhere">{peer.name}</span>
            <span className={speaker === peer.id ? 'text-green' : 'text-ink-2'} title={speaker === peer.id ? 'Speaking' : peer.enabled ? 'Mic on' : 'Muted'}>
              {speaker === peer.id ? <Volume2 size={16} aria-label="Speaking" /> : peer.enabled ? <Mic size={16} aria-label="Mic on" /> : <MicOff size={16} aria-label="Muted" />}
            </span>
          </li>)}
        </ul>}
        {message && <p role="status" className="text-sm text-ink-2">{message}</p>}
        <div className="flex flex-wrap gap-2">
          {status === 'idle'
            ? <button type="button" className="action action-primary" onClick={() => void join()}><Headphones size={16} aria-hidden="true" />Join audio</button>
            : <>
              {member.role !== 'viewer' && status === 'connected' && <button type="button" className="action action-secondary" disabled={micBusy} onClick={() => void toggleMic()}>
                {muted ? <MicOff size={16} aria-hidden="true" /> : <Mic size={16} aria-hidden="true" />}{muted ? 'Unmute' : 'Mute'}
              </button>}
              {blocked && <button type="button" className="action action-primary" onClick={() => void enableSound()}><Volume2 size={16} aria-hidden="true" />Enable sound</button>}
              <button type="button" className="action action-secondary" onClick={() => { void release(); reset(); setMessage(''); }}>
                <PhoneOff size={16} aria-hidden="true" />{status === 'joining' ? 'Cancel' : 'Leave audio'}
              </button>
            </>}
        </div>
      </div>
    </Dialog>}
  </>;
}

function RemoteAudio({ id, track, attach }: {
  id: string; track: MediaStreamTrack; attach: (id: string, track: MediaStreamTrack, node: HTMLAudioElement) => () => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (audio.current) return attach(id, track, audio.current);
  }, [attach, id, track]);
  return <audio ref={audio} autoPlay />;
}
