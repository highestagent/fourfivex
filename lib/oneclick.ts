/**
 * Server-side access to NEAR Intents (the 1Click API).
 *
 * `quote` only ever asks for DRY quotes, which create no deposit address. `realQuote` asks for
 * a live one, which still moves nothing: money moves only when a passkey signs and the
 * signed transfer is submitted. The app holds no keys.
 */
import { ASSETS, USDC_ON_BASE, type AssetKey, type Prices } from "./assets";
import type { Network, SendAsk, SendState } from "./send/types";

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

export type Token = { assetId: string; symbol: string; blockchain: string; decimals: number; price: number };

/** The partner key is optional. It is sent only when set. */
function headers(json = false): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h["Content-Type"] = "application/json";
  if (process.env.NEAR_INTENTS_API_KEY) h["X-API-Key"] = process.env.NEAR_INTENTS_API_KEY;
  return h;
}

let tokenMemo: { at: number; tokens: Token[] } | null = null;

/** Every asset NEAR Intents can hold, with its current price. */
export async function getTokens(): Promise<Token[]> {
  const now = Date.now();
  if (tokenMemo && now - tokenMemo.at < 30_000) return tokenMemo.tokens;
  const res = await fetch(`${BASE}/tokens`, { headers: headers(), signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`tokens ${res.status}`);
  const tokens = (await res.json()) as Token[];
  tokenMemo = { at: now, tokens };
  return tokens;
}

export async function getPrices(): Promise<Prices> {
  const byId = new Map((await getTokens()).map((t) => [t.assetId, t.price]));
  const prices = {} as Prices;
  for (const key of Object.keys(ASSETS) as AssetKey[]) {
    const p = byId.get(ASSETS[key].id);
    if (typeof p !== "number" || !(p > 0)) throw new Error(`no price for ${key}`);
    prices[key] = p;
  }
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
      headers: headers(true),
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

export async function findToken(assetId: string): Promise<Token | undefined> {
  return (await getTokens()).find((t) => t.assetId === assetId);
}

/** USDC on one of the networks people can be paid on. */
export async function usdcOn(network: Network): Promise<Token | undefined> {
  return (await getTokens()).find((t) => t.blockchain === network && t.symbol === "USDC");
}

/** 1Click turned the request down. The message is its own. */
export class OneClickError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type RealQuote = {
  depositAddress: string;
  depositMemo?: string;
  amountIn: string;
  amountInFormatted: string;
  amountInUsd: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd: string;
  deadline: string;
  timeEstimate: number;
  /** The tokens the request used, for building both sides. */
  originAsset: string;
  destinationAsset: string;
};

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const message = (data as { message?: unknown } | null)?.message;
    throw new OneClickError(typeof message === "string" ? message : `1Click ${res.status}`, res.status);
  }
  return data as T;
}

/** A live quote: it carries a deposit address, but moves nothing by itself. */
export async function realQuote(ask: SendAsk): Promise<RealQuote> {
  const minutes = ask.kind === "add" ? 120 : 15;
  const common = {
    dry: false,
    slippageTolerance: 100,
    deadline: new Date(Date.now() + minutes * 60_000).toISOString(),
    quoteWaitingTimeMs: 3000,
  };
  let request: Record<string, unknown>;
  if (ask.kind === "change") {
    const from = await findToken(ask.fromAssetId);
    if (!from || !(from.price > 0)) throw new OneClickError("Unknown asset", 400);
    request = {
      ...common,
      swapType: "EXACT_INPUT",
      originAsset: ask.fromAssetId,
      depositType: "INTENTS",
      destinationAsset: ASSETS[ask.to].id,
      amount: toUnits(ask.usd / from.price, from.decimals),
      refundTo: ask.accountId,
      refundType: "INTENTS",
      recipient: ask.accountId,
      recipientType: "INTENTS",
    };
  } else if (ask.kind === "pay") {
    const usdc = await usdcOn(ask.to.network);
    if (!usdc) throw new OneClickError("No dollars on that network", 400);
    request = {
      ...common,
      swapType: "EXACT_OUTPUT",
      originAsset: ask.fromAssetId,
      depositType: "INTENTS",
      destinationAsset: usdc.assetId,
      amount: toUnits(ask.usd, usdc.decimals),
      refundTo: ask.accountId,
      refundType: "INTENTS",
      recipient: ask.to.address,
      recipientType: "DESTINATION_CHAIN",
    };
  } else {
    request = {
      ...common,
      swapType: "EXACT_OUTPUT",
      originAsset: ask.payAssetId,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: ASSETS.usd.id,
      amount: toUnits(ask.usd, 6),
      refundTo: ask.refundTo,
      refundType: "ORIGIN_CHAIN",
      recipient: ask.accountId,
      recipientType: "INTENTS",
    };
  }
  const data = await call<{ quote?: Omit<RealQuote, "originAsset" | "destinationAsset"> }>("/quote", {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify(request),
  });
  if (!data.quote?.depositAddress) throw new OneClickError("No deposit address in the quote", 502);
  return { ...data.quote, originAsset: String(request.originAsset), destinationAsset: String(request.destinationAsset) };
}

/** The unsigned payload a passkey must sign to move the origin token to a deposit address. */
export async function generateIntent(depositAddress: string, signerId: string): Promise<string> {
  const data = await call<{ intent?: { standard?: unknown; payload?: unknown } }>("/generate-intent", {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({ type: "swap_transfer", standard: "webauthn", signerId, depositAddress }),
  });
  if (data.intent?.standard !== "webauthn" || typeof data.intent.payload !== "string")
    throw new OneClickError("Unexpected reply to generate-intent", 502);
  return data.intent.payload;
}

/** Sends a passkey-signed transfer. Callers must have checked it first (see lib/send/server.ts). */
export async function submitIntent(signed: unknown): Promise<string> {
  const data = await call<{ intentHash?: unknown }>("/submit-intent", {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({ type: "swap_transfer", signedData: signed }),
  });
  if (typeof data.intentHash !== "string") throw new OneClickError("Unexpected reply to submit-intent", 502);
  return data.intentHash;
}

export type ApiStatus =
  | "PENDING_DEPOSIT"
  | "KNOWN_DEPOSIT_TX"
  | "INCOMPLETE_DEPOSIT"
  | "PROCESSING"
  | "SUCCESS"
  | "REFUNDED"
  | "FAILED";

type TxLink = { hash: string; explorerUrl: string };

export type SwapStatus = {
  status: ApiStatus;
  updatedAt?: string;
  quoteResponse?: {
    quoteRequest?: { depositType?: string; refundTo?: string; originAsset?: string; [k: string]: unknown };
    quote?: { amountIn?: string; [k: string]: unknown };
  };
  swapDetails?: {
    amountOutFormatted?: string;
    amountOutUsd?: string;
    refundedAmountFormatted?: string;
    refundReason?: string;
    originChainTxHashes?: TxLink[];
    destinationChainTxHashes?: TxLink[];
    [k: string]: unknown;
  };
};

export const swapStatus = (depositAddress: string) =>
  call<SwapStatus>(`/status?depositAddress=${encodeURIComponent(depositAddress)}`, { headers: headers() });

export const STATE_OF: Record<ApiStatus, SendState> = {
  PENDING_DEPOSIT: "waiting",
  KNOWN_DEPOSIT_TX: "seen",
  INCOMPLETE_DEPOSIT: "short",
  PROCESSING: "working",
  SUCCESS: "done",
  REFUNDED: "refunded",
  FAILED: "failed",
};
