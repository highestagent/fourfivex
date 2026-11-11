export type AssetKey = "usd" | "btc" | "eth" | "sol";

export type Asset = {
  /** The plain word the surface uses. */
  name: string;
  /** The exact term, shown one tap beneath the plain word. */
  symbol: string;
  network: string;
  color: string;
  decimals: number;
  /** NEAR Intents asset id. */
  id: string;
  glyph: string;
};

export const ASSETS: Record<AssetKey, Asset> = {
  usd: {
    name: "dollars",
    symbol: "USDC",
    network: "NEAR",
    color: "#2553e6",
    decimals: 6,
    id: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    glyph: "$",
  },
  btc: {
    name: "bitcoin",
    symbol: "BTC",
    network: "Bitcoin",
    color: "#f08c00",
    decimals: 8,
    id: "nep141:btc.omft.near",
    glyph: "₿",
  },
  eth: {
    name: "ether",
    symbol: "ETH",
    network: "Ethereum",
    color: "#6d5ce0",
    decimals: 18,
    id: "nep141:eth.omft.near",
    glyph: "Ξ",
  },
  sol: {
    name: "sol",
    symbol: "SOL",
    network: "Solana",
    color: "#0e9f8e",
    decimals: 9,
    id: "nep141:sol.omft.near",
    glyph: "◎",
  },
};

/** Where a friend who "wants dollars" receives them in this demo. */
export const USDC_ON_BASE =
  "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";

export type Prices = Record<AssetKey, number>;

/** Used only until the first live price arrives, and if the price service is unreachable. */
export const FALLBACK_PRICES: Prices = { usd: 1, btc: 74000, eth: 2070, sol: 84 };

/** The demo account. These balances are examples, not a real account. */
export const HOLDINGS: { usd: number; btc: number } = { usd: 412.2, btc: 0.0089 };
