import { ASSETS } from "../assets";
import { getTokens } from "../oneclick";
import { PAY_IN } from "../send/payin";
import type { WalletAsset, WatchedWallet } from "./portfolio";

const rpcUrls = {
  eth: "https://ethereum-rpc.publicnode.com",
  base: "https://mainnet.base.org",
  arb: "https://arb1.arbitrum.io/rpc",
  sol: "https://api.mainnet.solana.com",
};
const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

async function rpc<T>(network: WatchedWallet["network"], method: string, params: unknown[]): Promise<T> {
  const response = await fetch(rpcUrls[network], {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("Wallet RPC unavailable.");
  const result = await response.json() as { result?: T; error?: unknown };
  if (result.error || result.result === undefined) throw new Error("Wallet RPC returned no balance.");
  return result.result;
}

async function evmUnits(network: Exclude<WatchedWallet["network"], "sol">, address: string, contract: string) {
  const [native, usdc] = await Promise.all([
    rpc<string>(network, "eth_getBalance", [address, "latest"]),
    rpc<string>(network, "eth_call", [{ to: contract, data: `0x70a08231${address.slice(2).padStart(64, "0")}` }, "latest"]),
  ]);
  if (![native, usdc].every(value => typeof value === "string" && /^0x[0-9a-f]+$/i.test(value))) {
    throw new Error("Invalid wallet balance.");
  }
  return [BigInt(native), BigInt(usdc)] as const;
}

async function solanaUnits(address: string) {
  type TokenAccount = { account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } };
  const [native, usdc] = await Promise.all([
    rpc<{ value: number }>("sol", "getBalance", [address, { commitment: "confirmed" }]),
    rpc<{ value: TokenAccount[] }>("sol", "getTokenAccountsByOwner", [address, { mint: usdcMint }, { encoding: "jsonParsed", commitment: "confirmed" }]),
  ]);
  if (!Number.isInteger(native.value) || native.value < 0) throw new Error("Invalid SOL balance.");
  const tokens = usdc.value.reduce((sum, account) => {
    const units = account.account.data.parsed.info.tokenAmount.amount;
    if (typeof units !== "string" || !/^\d+$/.test(units)) throw new Error("Invalid USDC balance.");
    return sum + BigInt(units);
  }, BigInt(0));
  return [BigInt(native.value), tokens] as const;
}

export async function walletBalances({ network, address }: WatchedWallet): Promise<WalletAsset[]> {
  const stable = PAY_IN.find(token => token.id === `usd-${network}`)!;
  const native = ASSETS[network === "sol" ? "sol" : "eth"];
  // EVM 1Click IDs contain the underlying ERC-20 address.
  const contract = stable.assetId.match(/0x[0-9a-f]{40}/)?.[0];
  const balances = network === "sol" ? solanaUnits(address) : evmUnits(network, address, contract!);
  const [[nativeUnits, stableUnits], tokens] = await Promise.all([balances, getTokens().catch(() => [])]);
  return [
    { symbol: native.symbol, units: nativeUnits, decimals: native.decimals, id: native.id },
    { symbol: stable.symbol, units: stableUnits, decimals: stable.decimals, id: stable.assetId },
  ].filter(asset => asset.units > BigInt(0)).map(asset => {
    const amount = Number(asset.units) / 10 ** asset.decimals;
    const price = tokens.find(token => token.assetId === asset.id)?.price;
    return { symbol: asset.symbol, amount, usd: price && Number.isFinite(price) && price > 0 ? amount * price : null };
  });
}
