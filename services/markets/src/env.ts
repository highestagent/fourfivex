import type { RoomOwner } from './owner';
import type { TradingRoom } from './room';
import type { RoomSettler } from './escrow';

export interface Env {
  APP_ORIGIN: string;
  ROOMS: DurableObjectNamespace<TradingRoom>;
  OWNERS: DurableObjectNamespace<RoomOwner>;
  SETTLER: DurableObjectNamespace<RoomSettler>;
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
  /** Paid sessions. All of these must be set, or paid sessions are unavailable and free rooms carry on. */
  TRADING_SIGNER_CONTRACT?: string;
  /** The Chain Signatures contract that derives trading addresses. Defaults to `v1.signer`. */
  MPC_CONTRACT?: string;
  /** Defaults to Hyperliquid's public API. */
  HYPERLIQUID_API?: string;
  ROOM_ESCROW_CONTRACT?: string;
  /** The verifier's ID for the fee token, such as `nep141:<USDC contract>`. */
  ROOM_ESCROW_TOKEN?: string;
  ROOM_SETTLER_ACCOUNT?: string;
  /** Secret. An ed25519 function-call key for the settler account, limited to the escrow's settlement methods. */
  ROOM_SETTLER_KEY?: string;
}
