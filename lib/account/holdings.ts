/**
 * What an account actually holds, read from the verifier contract. Runs on the server.
 * Balances are grouped under the plain words the surface uses, with the exact assets kept
 * underneath for anyone who taps to see them.
 */
import { getTokens } from "../oneclick";
import { balancesOf } from "./chain";

export type Group = "usd" | "btc" | "eth" | "sol" | "other";

export type Part = {
  assetId: string;
  decimals: number;
  /** The raw balance, in smallest units. */
  units: string;
  symbol: string; network: string;
  amount: number;
  usd: number;
  group: Group;
};

export type Holdings = {
  total: number;
  groups: Record<Group, { amount: number; usd: number }>;
  /** Only the assets with a balance. */
  parts: Part[];
};

const GROUP_OF: Record<string, Group> = { USDC: "usd", USDT: "usd", BTC: "btc", ETH: "eth", SOL: "sol" };
const CHUNK = 100;

export async function holdingsOf(accountId: string): Promise<Holdings> {
  const tokens = await getTokens();
  const ids = tokens.map((t) => t.assetId);
  const raw: string[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) raw.push(...(await balancesOf(accountId, ids.slice(i, i + CHUNK))));

  const groups: Holdings["groups"] = {
    usd: { amount: 0, usd: 0 },
    btc: { amount: 0, usd: 0 },
    eth: { amount: 0, usd: 0 },
    sol: { amount: 0, usd: 0 },
    other: { amount: 0, usd: 0 },
  };
  const parts: Part[] = [];
  tokens.forEach((t, i) => {
    if (!raw[i] || raw[i] === "0") return;
    const amount = Number(raw[i]) / 10 ** t.decimals;
    const usd = amount * (t.price || 0);
    const group = GROUP_OF[t.symbol] ?? "other";
    groups[group].amount += group === "other" ? 0 : amount;
    groups[group].usd += usd;
    parts.push({ assetId: t.assetId, decimals: t.decimals, units: raw[i], symbol: t.symbol, network: t.blockchain, amount, usd, group });
  });
  parts.sort((a, b) => b.usd - a.usd);
  return { total: parts.reduce((n, p) => n + p.usd, 0), groups, parts };
}
