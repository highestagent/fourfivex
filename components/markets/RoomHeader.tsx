import { ChevronDown, MonitorUp, Pause, Play, UserPlus, Users, WifiOff } from 'lucide-react';
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
  onInvite: () => void;
  onToggleFollowing: () => void;
  onPresenterChange: (member: string) => void;
};

export function RoomHeader({ roomId, me, members, presenter, online, connected, following, onInvite, onToggleFollowing, onPresenterChange }: Props) {
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
        {owner && <button className="room-icon room-invite" type="button" aria-label="Invite traders" title="Invite traders" aria-haspopup="dialog" onClick={onInvite}>
          <UserPlus size={17} aria-hidden="true" />
        </button>}
      </div>
    </header>
  );
}
