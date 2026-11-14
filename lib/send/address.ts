import { sha256 } from "@noble/hashes/sha2.js";
import { base58, createBase58check, bech32, bech32m } from "@scure/base";

export type Family = "evm" | "sol" | "near" | "btc";

const names: Record<string, string> = {
  eth: "Ethereum", base: "Base", arb: "Arbitrum", op: "Optimism", pol: "Polygon", bsc: "BNB Chain", avax: "Avalanche",
  abs: "Abstract", adi: "ADI", bera: "Berachain", gnosis: "Gnosis", hood: "Robinhood Chain", monad: "Monad", plasma: "Plasma",
  scroll: "Scroll", xlayer: "X Layer", sol: "Solana", fogo: "Fogo", near: "NEAR", btc: "Bitcoin",
};

export function networkName(code: string) {
  return names[code] ?? code;
}

/** The address style a 1Click `blockchain` code uses, or null if we don't handle it. */
export function familyOf(blockchainCode: string): Family | null {
  switch (blockchainCode) {
    case "eth":
    case "base":
    case "arb":
    case "op":
    case "pol":
    case "bsc":
    case "avax":
    case "abs":
    case "adi":
    case "bera":
    case "gnosis":
    case "hood":
    case "monad":
    case "plasma":
    case "scroll":
    case "xlayer":
      return "evm";
    case "sol":
    case "fogo":
      return "sol";
    case "near":
      return "near";
    case "btc":
      return "btc";
    default:
      return null;
  }
}

const NEAR_NAME = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

function isBitcoin(a: string): boolean {
  if (/^(bc1|BC1)/.test(a)) {
    for (const code of [bech32, bech32m]) {
      try {
        const d = code.decode(a as `${string}1${string}`, 90);
        if (d.prefix === "bc" && d.words.length >= 2) return true;
      } catch {
        /* try the next */
      }
    }
    return false;
  }
  if (/^[13]/.test(a)) {
    try {
      const raw = createBase58check(sha256).decode(a);
      return raw.length === 21 && (raw[0] === 0 || raw[0] === 5);
    } catch {
      return false;
    }
  }
  return false;
}

/** A plain-English reason the address is wrong, or null if it looks right. */
export function addressProblem(family: Family, address: string): string | null {
  const a = address.trim();
  if (a !== address || !a) return "Please paste the address with nothing before or after it.";
  switch (family) {
    case "evm":
      if (/^0x0{40}$/.test(a)) return "Use a wallet address you control.";
      return /^0x[0-9a-fA-F]{40}$/.test(a) ? null : "That doesn't look like an Ethereum-style address. It should start with 0x.";
    case "sol":
      try {
        return base58.decode(a).length === 32 ? null : "That doesn't look like a Solana address.";
      } catch {
        return "That doesn't look like a Solana address.";
      }
    case "near":
      return (a.length >= 2 && a.length <= 64 && NEAR_NAME.test(a)) || /^[0-9a-f]{64}$/.test(a)
        ? null
        : "That doesn't look like a NEAR address.";
    case "btc":
      return isBitcoin(a) ? null : "That doesn't look like a Bitcoin address.";
  }
}
