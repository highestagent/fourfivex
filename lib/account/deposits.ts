import { coin, usd } from "../format";

/**
 * Lasting deposit addresses from the NEAR Intents bridge. Anything sent to an account's address on a
 * supported network lands in that account, in any amount, at any time.
 */
const BRIDGE = "https://bridge.chaindefuser.com/rpc";

export type DepositNetworkId = "evm" | "sol" | "btc" | "tron";
export type DepositNetwork = { id: DepositNetworkId; label: string; chain: string; chains: readonly string[]; detail?: string };

export const DEPOSIT_NETWORKS: readonly DepositNetwork[] = [
  {
    id: "evm", label: "Ethereum", chain: "eth:1",
    // The bridge gives one address for every EVM network it supports.
    chains: ["eth:1", "eth:8453", "eth:42161", "eth:10", "eth:56", "eth:137", "eth:43114"],
    detail: "Same address on Base, Arbitrum, Optimism, BNB, Polygon and Avalanche.",
  },
  { id: "sol", label: "Solana", chain: "sol:mainnet", chains: ["sol:mainnet"] },
  { id: "btc", label: "Bitcoin", chain: "btc:mainnet", chains: ["btc:mainnet"] },
  { id: "tron", label: "Tron", chain: "tron:mainnet", chains: ["tron:mainnet"] },
];

const CHAIN_NAMES: Record<string, string> = {
  "eth:1": "Ethereum", "eth:8453": "Base", "eth:42161": "Arbitrum", "eth:10": "Optimism", "eth:56": "BNB Chain",
  "eth:137": "Polygon", "eth:43114": "Avalanche", "sol:mainnet": "Solana", "btc:mainnet": "Bitcoin", "tron:mainnet": "Tron",
};
const STABLE = new Set(["USDC", "USDT", "USDT0", "DAI", "USD1", "USDe", "PYUSD", "USDC.e"]);
const LEADING = ["USDC", "USDT", "ETH", "SOL", "BTC", "TRX", "BNB", "POL", "AVAX"];

export const chainName = (chain: string) => CHAIN_NAMES[chain] ?? chain;

async function rpc<T>(method: string, params: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(BRIDGE, {
    method: "POST", headers: { "Content-Type": "application/json" }, signal,
    body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params: [params] }),
  });
  if (!response.ok) throw new Error("Deposits are unavailable.");
  const body = await response.json() as { result?: T; error?: unknown };
  if (body.result === undefined) throw new Error("Deposits are unavailable.");
  return body.result;
}

export async function depositAddress(accountId: string, chain: string, signal?: AbortSignal) {
  const { address } = await rpc<{ address?: unknown }>("deposit_address", { account_id: accountId, chain }, signal);
  if (typeof address !== "string" || !address) throw new Error("Deposits are unavailable.");
  return address;
}

type Token = { symbol: string; decimals: number; min: number };
let tokens: Promise<Map<string, Token>> | undefined;
const tokenKey = (chain: string, nearToken: string) => `${chain}|${nearToken}`;

/** The bridge's token list, read once per page load. */
export function supportedTokens() {
  tokens ??= rpc<{ tokens: { defuse_asset_identifier: string; near_token_id: string; asset_name: string; decimals: number; min_deposit_amount: string }[] }>(
    "supported_tokens", { chains: DEPOSIT_NETWORKS.flatMap(network => network.chains) },
  ).then(({ tokens: list }) => new Map(list.map(token => {
    const chain = token.defuse_asset_identifier.split(":").slice(0, 2).join(":");
    return [tokenKey(chain, token.near_token_id), {
      symbol: token.asset_name, decimals: token.decimals, min: Number(token.min_deposit_amount) / 10 ** token.decimals,
    }];
  })), error => {
    tokens = undefined;
    throw error;
  });
  return tokens;
}

/** The best-known tokens a network accepts, for a short "USDC, USDT, ETH and more" line. */
export function leadingSymbols(list: Map<string, Token>, network: DepositNetwork, count = 3) {
  const symbols = new Set<string>();
  for (const [key, token] of list) if (network.chains.includes(key.split("|")[0])) symbols.add(token.symbol);
  const leading = LEADING.filter(symbol => symbols.has(symbol)).slice(0, count);
  return { symbols: leading, more: symbols.size > leading.length };
}

export type IncomingDeposit = {
  id: string; chain: string; symbol: string; amount: number; status: "pending" | "done" | "failed"; at?: number; url?: string;
};

type RawDeposit = {
  tx_hash: string; mint_tx_hash?: string | null; chain: string; near_token_id?: string | null;
  decimals?: number | null; amount?: number | string | null; status: string; created_at?: string | null;
};

const STATUS: Record<string, IncomingDeposit["status"]> = { PENDING: "pending", COMPLETED: "done", FAILED: "failed" };

/** Deposits the bridge saw for this account on any network, newest first. Unknown statuses are left out. */
export function parseDeposits(raw: readonly RawDeposit[], list: Map<string, Token>): IncomingDeposit[] {
  return raw.flatMap(deposit => {
    const status = STATUS[deposit.status];
    if (!status || !deposit.tx_hash) return [];
    const token = deposit.near_token_id ? list.get(tokenKey(deposit.chain, deposit.near_token_id)) : undefined;
    const decimals = deposit.decimals ?? token?.decimals ?? 0;
    const at = deposit.created_at ? Date.parse(deposit.created_at) : NaN;
    return [{
      id: `${deposit.chain}:${deposit.tx_hash}`,
      chain: deposit.chain,
      symbol: token?.symbol ?? "",
      amount: Number(deposit.amount ?? 0) / 10 ** decimals,
      status,
      at: Number.isFinite(at) ? at : undefined,
      url: deposit.mint_tx_hash ? `https://nearblocks.io/txns/${deposit.mint_tx_hash}` : undefined,
    }];
  });
}

export async function recentDeposits(accountId: string, signal?: AbortSignal) {
  const [list, page] = await Promise.all([
    supportedTokens(),
    rpc<{ deposits?: RawDeposit[] }>("recent_deposits", { account_id: accountId, limit: 20, offset: 0 }, signal),
  ]);
  return parseDeposits(page.deposits ?? [], list);
}

/** Whether the bridge has ever delivered anything to this account. */
export async function hasDeposits(accountId: string, signal?: AbortSignal) {
  const page = await rpc<{ deposits?: RawDeposit[] }>("recent_deposits", { account_id: accountId, limit: 1, offset: 0 }, signal);
  return (page.deposits?.length ?? 0) > 0;
}

/** "$25.00 on Base" for dollars, "0.01 ETH on Base" for anything else. */
export function depositAmount(deposit: IncomingDeposit) {
  const value = STABLE.has(deposit.symbol) ? usd(deposit.amount) : `${coin(deposit.amount)} ${deposit.symbol}`.trim();
  return `${value} on ${chainName(deposit.chain)}`;
}
