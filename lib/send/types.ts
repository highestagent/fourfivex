import type { AssetKey } from "../assets";

/** Networks a person can be paid on. These are the 1Click `blockchain` codes. */
export const NETWORKS = ["base", "eth", "arb", "sol", "near"] as const;
export type Network = (typeof NETWORKS)[number];

export const NETWORK_NAME: Record<Network, string> = { base: "Base", eth: "Ethereum", arb: "Arbitrum", sol: "Solana", near: "NEAR" };

export type SendAsk =
  | { kind: "change"; accountId: string; fromAssetId: string; to: AssetKey; usd: number }
  | { kind: "pay"; accountId: string; fromAssetId: string; usd: number; to: { address: string; network: Network } }
  | { kind: "withdraw"; accountId: string; fromAssetId: string; assetId: string; amount: string; address: string };

export type TransferAsset = { assetId: string; symbol: string; blockchain: string };

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

/** `partial`: a send split across networks where some parts arrived and the rest came back. */
export type SendState = "waiting" | "seen" | "short" | "working" | "done" | "refunded" | "failed" | "partial";

export type SendStatus = {
  state: SendState;
  arrived?: { amount: number; usd: number };
  refunded?: { amount: number; reason?: string };
  links: { hash: string; url: string }[];
};
