import type { TradingRoom } from './room';

export interface Env {
  APP_ORIGIN: string;
  ROOMS: DurableObjectNamespace<TradingRoom>;
  SESSION_SECRET: string;
  CF_ACCOUNT_ID?: string;
  REALTIME_APP_ID?: string;
  REALTIME_API_TOKEN?: string;
  VOICE_OWNER_PRESET?: string;
  VOICE_EDITOR_PRESET?: string;
  VOICE_VIEWER_PRESET?: string;
  RATE_LIMIT?: RateLimit;
}
