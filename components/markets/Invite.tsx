import { useEffect, useState } from 'react';
import { Check, Copy, Link2, Shield, Trash2 } from 'lucide-react';
import type { Member } from '@fourfivex/markets-protocol/protocol';
import { api } from './client';
import { recentRoomKey } from './RoomEntry';
import { Select } from '@/components/Select';

const inviteRoles = [
  { value: 'editor', label: 'Editor' },
  { value: 'viewer', label: 'Viewer' },
] as const;

export function Invite({ roomId, members, me, onDeleted }: { roomId: string; members: Member[]; me: Member; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [invites, setInvites] = useState<{ inviteId: string; role: string; expires: number }[]>([]);
  const roomPath = '/rooms/' + roomId;
  const load = () => api<typeof invites>(roomPath + '/invites').then(setInvites);
  useEffect(() => {
    let active = true;
    void api<typeof invites>(roomPath + '/invites').then(result => { if (active) setInvites(result); }, () => {
      if (active) setMessage('Could not load pending invites.');
    });
    return () => { active = false; };
  }, [roomPath]);
  async function action(work: () => Promise<unknown>) {
    setBusy(true); setMessage('');
    try { await work(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not update room access.'); }
    finally { setBusy(false); }
  }
  return <div className="invite-content">
    <p className="secondary">Each link works once and expires after 24 hours.</p>
    <form className="invite-form" onSubmit={event => { event.preventDefault(); void action(async () => {
      const { token } = await api<{ token: string }>(roomPath + '/invite', { role });
      setLink(location.origin + '/markets/' + roomId + '#invite=' + token); setCopied(false); await load();
    }); }}>
      <div className="field">
        <label htmlFor="market-invite-role">Invite role</label>
        <Select id="market-invite-role" pickerTitle="Invite role" label="Invite role" className="action action-secondary"
          value={role} options={inviteRoles} onValueChange={setRole} />
      </div>
      <button className="button primary" type="submit" disabled={busy}><Link2 size={16}/> Create link</button>
    </form>
    {link && <div className="copy-field"><input aria-label="Invite link" value={link} readOnly onFocus={event => event.currentTarget.select()}/><button className="button" onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true)).catch(() => setMessage('Select the link and copy it manually.'))}>{copied ? <Check size={16}/> : <Copy size={16}/>} {copied ? 'Copied' : 'Copy'}</button></div>}
    {invites.length > 0 && <div className="invite-members"><h3>Pending invites</h3>{invites.map(invite => <div key={invite.inviteId}>
      <span className="capitalize">{invite.role}<small>{new Date(invite.expires).toLocaleString()}</small></span>
      <button className="button small danger" disabled={busy} onClick={() => void action(async () => {
        await api(roomPath + '/invite/revoke', { inviteId: invite.inviteId }); setLink(''); await load();
      })}>Revoke</button></div>)}</div>}
    <div className="invite-members"><h3>Members</h3>{members.map(member => <div key={member.id}><span>{member.name}<small className="capitalize">{member.role}</small></span>
      {member.id === me.id ? <Shield size={16}/> : <button className="button small danger" disabled={busy} onClick={() => void action(async () => {
        const { voicePending } = await api<{ voicePending?: boolean }>(roomPath + '/members/revoke', { member: member.id });
        if (voicePending) setMessage('Room access removed. Audio removal is retrying.');
      })}>Remove</button>}</div>)}</div>
    <div className="invite-members room-delete">
      {confirming
        ? <div><span>Delete for everyone? Ideas, comments and drawings go too.</span><span className="room-delete-actions">
          <button className="button small" type="button" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
          <button className="button small danger" type="button" disabled={busy} onClick={() => void action(async () => {
            await api(roomPath + '/delete', {});
            if (sessionStorage.getItem(recentRoomKey) === roomId) sessionStorage.removeItem(recentRoomKey);
            onDeleted();
          })}>{busy ? 'Deleting…' : 'Delete'}</button></span></div>
        : <div><span>Delete room</span><button className="button small danger" type="button" disabled={busy}
          onClick={() => setConfirming(true)}><Trash2 size={14} aria-hidden="true"/> Delete</button></div>}
    </div>
    {message && <p role="status" className="notice">{message}</p>}
  </div>;
}
