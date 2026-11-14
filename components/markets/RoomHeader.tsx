import { useEffect, useState } from 'react';
import { ChevronDown, MonitorUp, Pause, Play, Timer, UserPlus, Users, WifiOff } from 'lucide-react';
import type { Member } from '@fourfivex/markets-protocol/protocol';
import { AppNavigation } from '@/components/AppNavigation';
import { Select } from '@/components/Select';
import { RoomAudio } from './RoomAudio';

type Props = {
  roomId: string;
  me: Member;
  members: Member[];
  presenter?: Member;
  online: string[];
  connected: boolean;
  following: boolean;
  endsAt: number;
  onInvite: () => void;
  onToggleFollowing: () => void;
  onPresenterChange: (member: string) => void;
};

/** Minutes until the room closes. Rooms last an hour; the last five minutes turn amber. */
function TimeLeft({ endsAt }: { endsAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const minutes = Math.max(0, Math.ceil((endsAt - now) / 60_000));
  const closes = new Date(endsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return <span className="room-presence room-time" data-ending={minutes <= 5} title={`Closes at ${closes}`}>
    <Timer size={15} aria-hidden="true" />{minutes}m<span className="sr-only"> left, closes at {closes}</span>
  </span>;
}

export function RoomHeader({ roomId, me, members, presenter, online, connected, following, endsAt, onInvite, onToggleFollowing, onPresenterChange }: Props) {
  const owner = me.role === 'owner';
  const presenting = presenter?.id === me.id;
  const presenterOptions = owner ? members.filter(member => member.role !== 'viewer').map(member => ({
    value: member.id,
    label: member.id === me.id ? 'You' : member.name,
  })) : [];
  const canChoosePresenter = connected && presenterOptions.length > 1;
  const followAction = following ? 'Pause following' : 'Follow chart';
  const presence = connected ? `${online.length} online` : 'Reconnecting…';
  const viewStatus = presenter && (presenting ? 'You’re presenting' : following
    ? `Following ${presenter.name}${connected && !online.includes(presenter.id) ? ' (offline)' : ''}`
    : `Following paused · Presenter: ${presenter.name}`);

  return (
    <header className="markets-container room-header">
      <AppNavigation compact />
      <span className="room-header-divider" aria-hidden="true" />
      <h1 className="room-title" aria-label="Trading room"><span className="room-title-prefix">Trading </span>room</h1>
      <div className="room-actions">
        <span className="sr-only" role="status">{presence}{viewStatus && ` · ${viewStatus}`}</span>
        <TimeLeft endsAt={endsAt} />
        <span className="room-presence" data-connected={connected} title={presence} aria-hidden="true">
          {connected ? <><Users size={15} />{online.length}</> : <WifiOff size={16} />}
        </span>
        {presenter && !presenting && <button className="room-icon" type="button"
          aria-label={followAction} title={`${followAction} · ${viewStatus}`} onClick={onToggleFollowing}>
          {following ? <Pause size={17} aria-hidden="true" /> : <Play size={17} aria-hidden="true" />}
        </button>}
        {presenter && canChoosePresenter
          ? <Select label={`Chart presenter: ${presenting ? 'You' : presenter.name}`} title={`Change presenter · ${viewStatus}`}
            pickerTitle="Chart presenter" className="room-icon room-presenter" value={presenter.id} options={presenterOptions}
            triggerIcon={<><MonitorUp size={17} aria-hidden="true" /><ChevronDown size={10} aria-hidden="true" /></>}
            onValueChange={onPresenterChange} />
          : presenting && <span className="room-icon room-presenter" title={viewStatus} aria-hidden="true"><MonitorUp size={17} /></span>}
        <RoomAudio key={roomId} roomId={roomId} member={me} />
        {owner && <button className="room-icon room-invite" type="button" aria-label="Manage room" title="Invite traders or manage the room" aria-haspopup="dialog" onClick={onInvite}>
          <UserPlus size={17} aria-hidden="true" />
        </button>}
      </div>
    </header>
  );
}
