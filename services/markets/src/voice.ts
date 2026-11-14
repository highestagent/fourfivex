import { z } from 'zod';
import type { Member } from '@fourfivex/markets-protocol/protocol';
import type { Env } from './env';
import { HttpError, upstream } from './http';

const meetingResponse = z.object({ id: z.string().min(1) });
const tokenResponse = z.object({ token: z.string().min(1), expires_on: z.iso.datetime({ offset: true }) });
const responseEnvelope = z.object({ success: z.literal(true), result: z.unknown().optional(), data: z.unknown().optional() });
const tokenLifetime = 15 * 60_000;

export class RoomVoice {
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private storage: DurableObjectStorage, private env: Env) {
    storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS voice_meeting (slot INTEGER PRIMARY KEY CHECK (slot = 1), meeting TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS voice_participants (member TEXT PRIMARY KEY, participant TEXT NOT NULL);
    `);
  }

  private serialize<T>(work: () => Promise<T>) {
    const next = this.pending.then(work);
    this.pending = next.catch(() => {});
    return next;
  }

  private async request(path: string, method: 'POST' | 'DELETE', data?: object) {
    const { CF_ACCOUNT_ID, REALTIME_APP_ID, REALTIME_API_TOKEN } = this.env;
    if (!CF_ACCOUNT_ID || !REALTIME_APP_ID || !REALTIME_API_TOKEN) {
      throw new HttpError(503, 'Room audio is unavailable on this deployment.');
    }
    const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(CF_ACCOUNT_ID)}/realtime/kit/${encodeURIComponent(REALTIME_APP_ID)}/meetings`;
    const response = await upstream(base + path, {
      method,
      headers: { Authorization: `Bearer ${REALTIME_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: data && JSON.stringify(data),
    });
    if (method === 'DELETE' && (response.ok || response.status === 404)) return;
    const result = responseEnvelope.safeParse(response.ok ? await response.json().catch(() => null) : null);
    if (!result.success) throw new HttpError(502, 'Room audio could not connect. Try again.');
    return result.data.result ?? result.data.data;
  }

  issue(member: () => Member | undefined, sessionExpires: number) {
    return this.serialize(async () => {
      const me = member();
      if (!me || !Number.isFinite(sessionExpires) || sessionExpires <= Date.now()) throw new HttpError(403, 'Room access ended.');
      const presets = {
        owner: this.env.VOICE_OWNER_PRESET ?? 'zik_owner',
        editor: this.env.VOICE_EDITOR_PRESET ?? 'zik_editor',
        viewer: this.env.VOICE_VIEWER_PRESET ?? 'zik_viewer',
      };
      const sql = this.storage.sql;
      const saved = sql.exec<{ meeting: string }>('SELECT meeting FROM voice_meeting WHERE slot = 1').toArray()[0];
      let meeting = saved?.meeting;
      if (!meeting) {
        const result = meetingResponse.safeParse(await this.request('', 'POST', { title: 'fourfivex trading room', record_on_start: false }));
        if (!result.success) throw new HttpError(502, 'Room audio could not connect. Try again.');
        meeting = result.data.id;
        sql.exec('INSERT INTO voice_meeting VALUES (1, ?)', meeting);
      }
      if (!member() || sessionExpires <= Date.now()) throw new HttpError(403, 'Room access ended.');
      const existing = sql.exec<{ participant: string }>('SELECT participant FROM voice_participants WHERE member = ?', me.id).toArray()[0];
      const path = `/${encodeURIComponent(meeting)}/participants`;
      const expires_on = new Date(Math.min(sessionExpires, Date.now() + tokenLifetime)).toISOString();
      const issued = existing
        ? await this.request(`${path}/${encodeURIComponent(existing.participant)}/token`, 'POST', { expires_on })
        : await this.request(path, 'POST', {
          name: me.name, custom_participant_id: me.id, preset_name: presets[me.role], token: { expires_on },
        });
      if (!existing) {
        const participant = meetingResponse.safeParse(issued);
        if (!participant.success) throw new HttpError(502, 'Room audio could not connect. Try again.');
        sql.exec('INSERT INTO voice_participants VALUES (?, ?)', me.id, participant.data.id);
      }
      const result = tokenResponse.safeParse(issued);
      if (!result.success || Date.parse(result.data.expires_on) > Date.parse(expires_on) || Date.parse(result.data.expires_on) <= Date.now()) {
        throw new HttpError(502, 'Room audio could not issue a short-lived token. Try again.');
      }
      if (!member() || sessionExpires <= Date.now()) throw new HttpError(403, 'Room access ended.');
      return { token: result.data.token };
    });
  }

  async revoke(member: string) {
    try {
      await this.serialize(() => this.remove(member));
      return true;
    } catch {
      await this.storage.setAlarm(Date.now() + 10_000);
      return false;
    }
  }

  async retryRevocations() {
    await this.serialize(async () => {
      const pending = this.storage.sql.exec<{ member: string }>(
        'SELECT voice_participants.member FROM voice_participants JOIN members ON members.id = voice_participants.member WHERE members.revoked = 1',
      ).toArray();
      const results = await Promise.allSettled(pending.map(({ member }) => this.remove(member)));
      if (results.some(result => result.status === 'rejected')) await this.storage.setAlarm(Date.now() + 30_000);
    });
  }

  private async remove(member: string) {
    const sql = this.storage.sql;
    const row = sql.exec<{ participant: string; meeting: string }>(
      'SELECT participant, meeting FROM voice_participants CROSS JOIN voice_meeting WHERE member = ?', member,
    ).toArray()[0];
    if (!row) return;
    await this.request(`/${encodeURIComponent(row.meeting)}/participants/${encodeURIComponent(row.participant)}`, 'DELETE');
    sql.exec('DELETE FROM voice_participants WHERE member = ?', member);
  }
}
