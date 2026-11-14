import { afterEach, describe, expect, it, vi } from "vitest";
import { ASSETS, USDC_ON_BASE } from "../lib/assets";
import { getTokens } from "../lib/oneclick";
import { parseWatchedWallet } from "../lib/account/portfolio";
import { walletBalances } from "../lib/account/wallet-balances";

vi.mock("../lib/oneclick", () => ({ getTokens: vi.fn() }));

const evmAddress = "0x000000000000000000000000000000000000dead";
const solanaAddress = "11111111111111111111111111111111";

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe("linked wallets", () => {
  it("normalizes EVM addresses and rejects addresses for the wrong network", () => {
    expect(parseWatchedWallet({ network: "base", address: ` ${evmAddress.toUpperCase().replace("0X", "0x")} ` })).toEqual({
      network: "base", address: evmAddress,
    });
    expect(parseWatchedWallet({ network: "sol", address: evmAddress })).toBeNull();
    expect(parseWatchedWallet({ network: "https://example.test", address: evmAddress })).toBeNull();
  });

  it("values native and ERC-20 balances from the selected network", async () => {
    vi.mocked(getTokens).mockResolvedValue([
      { assetId: ASSETS.eth.id, symbol: "ETH", price: 2_000, decimals: 18, blockchain: "eth" },
      { assetId: USDC_ON_BASE, symbol: "USDC", price: 1, decimals: 6, blockchain: "base" },
    ]);
    const fetchRpc = vi.fn(async (_url: string, options: RequestInit) => {
      const { method, params } = JSON.parse(String(options.body));
      if (method === "eth_getBalance") return Response.json({ result: "0xde0b6b3a7640000" });
      expect(params[0].to).toBe("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
      expect(params[0].data).toBe(`0x70a08231${evmAddress.slice(2).padStart(64, "0")}`);
      return Response.json({ result: "0x4c4b40" });
    });
    vi.stubGlobal("fetch", fetchRpc);
    expect(await walletBalances({ network: "base", address: evmAddress })).toEqual([
      { symbol: "ETH", amount: 1, usd: 2_000 }, { symbol: "USDC", amount: 5, usd: 5 },
    ]);
    expect(fetchRpc.mock.calls.map(([url]) => url)).toEqual(["https://mainnet.base.org", "https://mainnet.base.org"]);
  });

  it("adds every account for the same Solana mint and keeps amounts when pricing fails", async () => {
    vi.mocked(getTokens).mockRejectedValue(new Error("pricing unavailable"));
    const tokenAccount = (amount: string) => ({ account: { data: { parsed: { info: { tokenAmount: { amount } } } } } });
    vi.stubGlobal("fetch", vi.fn(async (_url: string, options: RequestInit) => {
      const { method } = JSON.parse(String(options.body));
      return Response.json({ result: { value: method === "getBalance" ? 0 : [tokenAccount("3500000"), tokenAccount("1500000")] } });
    }));
    expect(await walletBalances({ network: "sol", address: solanaAddress })).toEqual([{ symbol: "USDC", amount: 5, usd: null }]);
  });
});
