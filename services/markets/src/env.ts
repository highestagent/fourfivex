import type { RoomOwner } from './owner';
import type { TradingRoom } from './room';

export interface Env {
  APP_ORIGIN: string;
  ROOMS: DurableObjectNamespace<TradingRoom>;
  OWNERS: DurableObjectNamespace<RoomOwner>;
  /** NEAR RPC used to check that a passkey belongs to an account. Defaults to FastNEAR. */
  NEAR_RPC_URL?: string;
  SESSION_SECRET: string;
  CF_ACCOUNT_ID?: string;
  REALTIME_APP_ID?: string;
  REALTIME_API_TOKEN?: string;
  VOICE_OWNER_PRESET?: string;
  VOICE_EDITOR_PRESET?: string;
  VOICE_VIEWER_PRESET?: string;
  RATE_LIMIT?: RateLimit;
}
