import { addressProblem, familyOf } from "../send/address";

export const walletNetworks = ["eth", "base", "arb", "sol"] as const;
export type WalletNetwork = (typeof walletNetworks)[number];
export type WatchedWallet = { network: WalletNetwork; address: string };
export type WalletAsset = { symbol: string; amount: number; usd: number | null };
export type TradingBalance = { equity: number; withdrawable: number };

export function parseWatchedWallet(value: unknown): WatchedWallet | null {
  if (!value || typeof value !== "object") return null;
  const { network, address } = value as Partial<WatchedWallet>;
  if (!network || !walletNetworks.includes(network) || typeof address !== "string") return null;
  const trimmed = address.trim();
  const family = familyOf(network)!;
  if (trimmed.length > 44 || addressProblem(family, trimmed)) return null;
  return { network, address: family === "evm" ? trimmed.toLowerCase() : trimmed };
}

export function walletKey({ network, address }: WatchedWallet) {
  return `${network}:${address}`;
}
