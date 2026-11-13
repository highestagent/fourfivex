import type { TradingRoom } from './room';

export interface Env {
  APP_ORIGIN: string;
  ROOMS: DurableObjectNamespace<TradingRoom>;
  SESSION_SECRET: string;
  RATE_LIMIT?: RateLimit;
}
