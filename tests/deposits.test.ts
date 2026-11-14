import { describe, expect, it } from "vitest";
import { DEPOSIT_NETWORKS, depositAmount, leadingSymbols, parseDeposits } from "../lib/account/deposits";

const BASE_USDC = "base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const tokens = new Map([
  [`eth:8453|${BASE_USDC}`, { symbol: "USDC", decimals: 6, min: 0.15 }],
  ["eth:8453|base.omft.near", { symbol: "ETH", decimals: 18, min: 1e-7 }],
  ["eth:42161|arb-0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9.omft.near", { symbol: "USDT0", decimals: 6, min: 0.001 }],
  ["eth:8453|base-0x532f27101965dd16442e59d40670faf5ebb142e4.omft.near", { symbol: "BRETT", decimals: 18, min: 1e-18 }],
  ["sol:mainnet|sol.omft.near", { symbol: "SOL", decimals: 9, min: 0.00125 }],
]);

describe("parseDeposits", () => {
  it("scales amounts, names the token and keeps the newest-first order", () => {
    const deposits = parseDeposits([
      { tx_hash: "0xaa", mint_tx_hash: "Mint1", chain: "eth:8453", near_token_id: BASE_USDC, decimals: 6, amount: 25_500_000, status: "PENDING", created_at: "2026-11-14T10:00:00.000Z" },
      { tx_hash: "0xbb", chain: "eth:8453", near_token_id: "base.omft.near", decimals: 18, amount: "10000000000000000", status: "COMPLETED" },
    ], tokens);
    expect(deposits).toEqual([
      { id: "eth:8453:0xaa", chain: "eth:8453", symbol: "USDC", amount: 25.5, status: "pending", at: Date.parse("2026-11-14T10:00:00.000Z"), url: "https://nearblocks.io/txns/Mint1" },
      { id: "eth:8453:0xbb", chain: "eth:8453", symbol: "ETH", amount: 0.01, status: "done", at: undefined, url: undefined },
    ]);
  });

  it("leaves out statuses it doesn't know and records without a hash", () => {
    expect(parseDeposits([
      { tx_hash: "0xcc", chain: "eth:8453", near_token_id: BASE_USDC, decimals: 6, amount: 1, status: "SOMETHING_NEW" },
      { tx_hash: "", chain: "eth:8453", near_token_id: BASE_USDC, decimals: 6, amount: 1, status: "COMPLETED" },
    ], tokens)).toEqual([]);
  });
});

describe("depositAmount", () => {
  it("shows dollars for stablecoins and the token otherwise", () => {
    expect(depositAmount({ id: "a", chain: "eth:8453", symbol: "USDC", amount: 25.5, status: "done" })).toBe("$25.50 on Base");
    expect(depositAmount({ id: "b", chain: "eth:42161", symbol: "ETH", amount: 0.01, status: "done" })).toBe("0.01 ETH on Arbitrum");
    expect(depositAmount({ id: "c", chain: "sui:mainnet", symbol: "", amount: 3, status: "pending" })).toBe("3 on sui:mainnet");
  });
});

describe("leadingSymbols", () => {
  it("lists the best-known tokens a network accepts", () => {
    const evm = DEPOSIT_NETWORKS.find(network => network.id === "evm")!;
    expect(leadingSymbols(tokens, evm)).toEqual({ symbols: ["USDC", "ETH"], more: true });
    expect(leadingSymbols(tokens, DEPOSIT_NETWORKS.find(network => network.id === "sol")!)).toEqual({ symbols: ["SOL"], more: false });
  });
});
