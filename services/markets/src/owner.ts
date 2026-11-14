import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';

export type Claim = { ok: true } | { ok: false; reason: 'open'; roomId: string; endsAt: number } | { ok: false; reason: 'used' };

/**
 * One per account: the room it has open, if any, and the creation challenges it has already spent.
 * Requests for one account run here one at a time, so two creations can't both get through.
 */
export class RoomOwner extends DurableObject<Env> {
  private sql = this.ctx.storage.sql;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS open_room (slot INTEGER PRIMARY KEY CHECK (slot = 1), room TEXT NOT NULL, ends_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS spent (nonce TEXT PRIMARY KEY, expires INTEGER NOT NULL);
    `);
  }

  /** Records a new room for the account, unless one is still open or the challenge was already used. */
  claim(nonce: string, nonceExpires: number, roomId: string, endsAt: number): Claim {
    return this.ctx.storage.transactionSync(() => {
      const now = Date.now();
      this.sql.exec('DELETE FROM spent WHERE expires <= ?', now);
      if (this.sql.exec('SELECT 1 FROM spent WHERE nonce = ?', nonce).toArray().length) return { ok: false, reason: 'used' } as const;
      this.sql.exec('INSERT INTO spent VALUES (?, ?)', nonce, nonceExpires);
      const open = this.sql.exec<{ room: string; ends_at: number }>('SELECT room, ends_at FROM open_room WHERE slot = 1').toArray()[0];
      if (open && open.ends_at > now) return { ok: false, reason: 'open', roomId: open.room, endsAt: open.ends_at } as const;
      this.sql.exec('INSERT INTO open_room VALUES (1, ?, ?) ON CONFLICT(slot) DO UPDATE SET room = excluded.room, ends_at = excluded.ends_at', roomId, endsAt);
      return { ok: true } as const;
    });
  }

  /** Frees the account to open another room, once this one has ended or was never made. */
  release(roomId: string) {
    this.sql.exec('DELETE FROM open_room WHERE room = ?', roomId);
  }
}
