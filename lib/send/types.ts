import type { AssetKey } from "../assets";

/** Networks a person can be paid on. These are the 1Click `blockchain` codes. */
export const NETWORKS = ["base", "eth", "arb", "sol", "near"] as const;
export type Network = (typeof NETWORKS)[number];

export type SendAsk =
  | { kind: "change"; accountId: string; fromAssetId: string; to: AssetKey; usd: number }
  | { kind: "pay"; accountId: string; fromAssetId: string; usd: number; to: { address: string; network: Network } }
  | { kind: "add"; accountId: string; payAssetId: string; usd: number; refundTo: string };

/** One side of a send. */
export type Leg = {
  assetId: string;
  symbol: string;
  network: string;
  decimals: number;
  /** Smallest units, as an integer string. */
  units: string;
  amount: number;
  usd: number;
};

export type Prepared = {
  kind: SendAsk["kind"];
  depositAddress: string;
  depositMemo?: string;
  leaves: Leg;
  arrives: Leg;
  seconds: number;
  deadline: string;
  /** What the passkey signs. Present for change and pay, absent for add. */
  payload?: string;
};

export type SendState = "waiting" | "seen" | "short" | "working" | "done" | "refunded" | "failed";

export type SendStatus = {
  state: SendState;
  arrived?: { amount: number; usd: number };
  refunded?: { amount: number; reason?: string };
  links: { hash: string; url: string }[];
};
