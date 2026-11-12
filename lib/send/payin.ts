/** What money can be added to an account with. Asset ids and decimals come from the live token list. */
export type PayIn = {
  id: string;
  label: string;
  /** The plain word for the money. */
  word: string;
  /** The exact asset to send. Shown when someone has to send it from another app, where the plain word is not enough. */
  symbol: string;
  assetId: string;
  /** The 1Click blockchain code. */
  network: string;
  networkName: string;
  family: "evm" | "sol" | "near" | "btc";
  decimals: number;
};

export const PAY_IN: PayIn[] = [
  {
    id: "usd-base",
    label: "dollars on Base",
    word: "dollars",
    symbol: "USDC",
    assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
    network: "base",
    networkName: "Base",
    family: "evm",
    decimals: 6,
  },
  {
    id: "usd-eth",
    label: "dollars on Ethereum",
    word: "dollars",
    symbol: "USDC",
    assetId: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near",
    network: "eth",
    networkName: "Ethereum",
    family: "evm",
    decimals: 6,
  },
  {
    id: "usd-arb",
    label: "dollars on Arbitrum",
    word: "dollars",
    symbol: "USDC",
    assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
    network: "arb",
    networkName: "Arbitrum",
    family: "evm",
    decimals: 6,
  },
  {
    id: "usd-sol",
    label: "dollars on Solana",
    word: "dollars",
    symbol: "USDC",
    assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near",
    network: "sol",
    networkName: "Solana",
    family: "sol",
    decimals: 6,
  },
  {
    id: "eth-eth",
    label: "ether on Ethereum",
    word: "ether",
    symbol: "ETH",
    assetId: "nep141:eth.omft.near",
    network: "eth",
    networkName: "Ethereum",
    family: "evm",
    decimals: 18,
  },
  {
    id: "eth-base",
    label: "ether on Base",
    word: "ether",
    symbol: "ETH",
    assetId: "nep141:base.omft.near",
    network: "base",
    networkName: "Base",
    family: "evm",
    decimals: 18,
  },
  {
    id: "sol-sol",
    label: "sol on Solana",
    word: "sol",
    symbol: "SOL",
    assetId: "nep141:sol.omft.near",
    network: "sol",
    networkName: "Solana",
    family: "sol",
    decimals: 9,
  },
  {
    id: "btc-btc",
    label: "bitcoin",
    word: "bitcoin",
    symbol: "BTC",
    assetId: "nep141:btc.omft.near",
    network: "btc",
    networkName: "Bitcoin",
    family: "btc",
    decimals: 8,
  },
];

/** One option by its id, or the first when the id is not known. */
export const payInOf = (id: unknown): PayIn => PAY_IN.find((p) => p.id === id) ?? PAY_IN[0];
