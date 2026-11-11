/**
 * Server-side access to NEAR Intents (the 1Click API).
 *
 * This module only ever asks for DRY quotes. A dry quote prices an outcome and creates
 * no deposit address, so nothing here can move money. The app has no account and no keys.
 */
import { ASSETS, USDC_ON_BASE, type AssetKey, type Prices } from "./assets";

const BASE = "https://1click.chaindefuser.com/v0";

/**
 * A quote needs well-formed addresses even when it is dry. These are public documentation
 * examples (ethers.js, BIP-173, Solana docs). Nothing is ever sent to them.
 */
const EXAMPLE = {
  account: "0x8ba1f109551bd432803012645ac136ddd64dba72",
  evm: "0x8ba1f109551bD432803012645Ac136ddd64DBA72",
  btc: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
  sol: "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T",
};

const HOME_ADDRESS: Record<AssetKey, string> = {
  usd: EXAMPLE.account,
  btc: EXAMPLE.btc,
  eth: EXAMPLE.evm,
  sol: EXAMPLE.sol,
};

export type QuoteAsk =
  | { kind: "pay"; from: AssetKey; usd: number }
  | { kind: "getpaid"; payer: AssetKey; usd: number }
  | { kind: "change"; from: AssetKey; to: AssetKey; usd: number };

export type QuoteOk = {
  ok: true;
  /** What leaves, in units of the origin asset. */
  amountIn: number;
  amountInUsd: number;
  /** What arrives, in units of the destination asset. */
  amountOut: number;
  amountOutUsd: number;
  seconds: number;
};

export type QuoteFail = { ok: false; reason: "no-offer" | "unavailable" | "bad-request" };
export type QuoteResult = QuoteOk | QuoteFail;

let priceMemo: { at: number; prices: Prices } | null = null;

export async function getPrices(): Promise<Prices> {
  const now = Date.now();
  if (priceMemo && now - priceMemo.at < 30_000) return priceMemo.prices;
  const res = await fetch(`${BASE}/tokens`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`tokens ${res.status}`);
  const tokens = (await res.json()) as { assetId: string; price: number }[];
  const byId = new Map(tokens.map((t) => [t.assetId, t.price]));
  const prices = {} as Prices;
  for (const key of Object.keys(ASSETS) as AssetKey[]) {
    const p = byId.get(ASSETS[key].id);
    if (typeof p !== "number" || !(p > 0)) throw new Error(`no price for ${key}`);
    prices[key] = p;
  }
  priceMemo = { at: now, prices };
  return prices;
}

function isAsset(v: unknown): v is AssetKey {
  return typeof v === "string" && v in ASSETS;
}

/** Accept only the three shapes the surface uses, with sane amounts. */
export function parseAsk(body: unknown): QuoteAsk | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const amount = b.usd;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 1 || amount > 5000) return null;
  if (b.kind === "pay" && isAsset(b.from)) return { kind: "pay", from: b.from, usd: amount };
  if (b.kind === "getpaid" && isAsset(b.payer) && b.payer !== "usd")
    return { kind: "getpaid", payer: b.payer, usd: amount };
  if (b.kind === "change" && isAsset(b.from) && isAsset(b.to) && b.from !== b.to)
    return { kind: "change", from: b.from, to: b.to, usd: amount };
  return null;
}

/** Whole units of an asset as the integer string the API expects. */
function toUnits(amount: number, decimals: number): string {
  const pow10 = (k: number) => BigInt("1" + "0".repeat(k));
  const e8 = BigInt(Math.round(amount * 1e8));
  const units = decimals >= 8 ? e8 * pow10(decimals - 8) : e8 / pow10(8 - decimals);
  return units.toString();
}

async function buildRequest(ask: QuoteAsk): Promise<Record<string, unknown>> {
  const common = {
    dry: true, // never anything else
    slippageTolerance: 100,
    deadline: new Date(Date.now() + 15 * 60_000).toISOString(),
    quoteWaitingTimeMs: 3000,
  };
  if (ask.kind === "pay") {
    // Money already in the account, delivered as an exact amount of dollars on the friend's network.
    return {
      ...common,
      swapType: "EXACT_OUTPUT",
      originAsset: ASSETS[ask.from].id,
      depositType: "INTENTS",
      refundTo: EXAMPLE.account,
      refundType: "INTENTS",
      destinationAsset: USDC_ON_BASE,
      amount: toUnits(ask.usd, 6),
      recipient: EXAMPLE.evm,
      recipientType: "DESTINATION_CHAIN",
    };
  }
  if (ask.kind === "getpaid") {
    // A payer on their own network, an exact amount of dollars arriving in the account.
    return {
      ...common,
      swapType: "EXACT_OUTPUT",
      originAsset: ASSETS[ask.payer].id,
      depositType: "ORIGIN_CHAIN",
      refundTo: HOME_ADDRESS[ask.payer],
      refundType: "ORIGIN_CHAIN",
      destinationAsset: ASSETS.usd.id,
      amount: toUnits(ask.usd, 6),
      recipient: EXAMPLE.account,
      recipientType: "INTENTS",
    };
  }
  // change: both sides stay in the account
  const prices = await getPrices();
  return {
    ...common,
    swapType: "EXACT_INPUT",
    originAsset: ASSETS[ask.from].id,
    depositType: "INTENTS",
    refundTo: EXAMPLE.account,
    refundType: "INTENTS",
    destinationAsset: ASSETS[ask.to].id,
    amount: toUnits(ask.usd / prices[ask.from], ASSETS[ask.from].decimals),
    recipient: EXAMPLE.account,
    recipientType: "INTENTS",
  };
}

export async function quote(ask: QuoteAsk): Promise<QuoteResult> {
  try {
    const res = await fetch(`${BASE}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(await buildRequest(ask)),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json()) as {
      message?: string;
      quote?: Record<string, string | number>;
    };
    if (!res.ok || !data.quote) {
      const noOffer = /liquidity|too low|amount/i.test(data.message ?? "");
      return { ok: false, reason: noOffer ? "no-offer" : "unavailable" };
    }
    const q = data.quote;
    return {
      ok: true,
      amountIn: Number(q.amountInFormatted),
      amountInUsd: Number(q.amountInUsd),
      amountOut: Number(q.amountOutFormatted),
      amountOutUsd: Number(q.amountOutUsd),
      seconds: Number(q.timeEstimate),
    };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
