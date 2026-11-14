"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Sheet } from "@/components/Sheet";
import { marketLabel, type Instrument, type Market } from "@fourfivex/markets-protocol/markets";
import { prepareOrder, readOrderStatus, type OrderDraft, type OrderQuote, type Position } from "@/lib/markets/trade";
import { TradeApiError, tradeApi, type TradeAccount } from "@/lib/markets/api";
import { tradePayload } from "@/lib/markets/authorization";
import type { PreparedTrade, TradeResult } from "@/lib/markets/execution";
import { signPayload } from "@/lib/account/flows";
import { memory } from "@/lib/account/store";
import { Deposit } from "./Deposit";
import { money } from "./format";

const amount = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Dollars for USDC margin, like the rest of the app; other collateral keeps its own symbol. */
const inCollateral = (value: number, collateral: string) => collateral === "USDC"
  ? value > 0 && value < 0.01 ? "under 1¢" : usd.format(value)
  : `${amount.format(value)} ${collateral}`;
const pendingKey = (account: string) => `fourfivex:markets:pending-order:${account}`;
type Pending = { id: `0x${string}`; expires: number };

function pendingOrder(account: string | null): Pending | undefined {
  if (!account) return;
  try {
    const value = JSON.parse(localStorage.getItem(pendingKey(account)) ?? "null") as Pending | null;
    if (value && /^0x[0-9a-f]{32}$/.test(value.id) && Number.isFinite(value.expires)) return value;
  } catch {}
}

/** The host's fill a follower is copying, from a paid session's feed. */
export type TradeSignal = { room: string; price: string; time: number };

export function TradeReview({ market, instrument, draft, accountId, trading, position, openAccount, close, onRefresh, signal }: {
  market: Market;
  instrument: Instrument;
  draft: OrderDraft;
  accountId: string | null;
  trading?: TradeAccount;
  position?: Position;
  openAccount: () => void;
  close: () => void;
  onRefresh: () => void;
  signal?: TradeSignal;
}) {
  const { side, margin, leverage } = draft;
  const signalRoom = signal?.room;
  const signalPrice = signal?.price;
  const signalTime = signal?.time;
  const [quote, setQuote] = useState<OrderQuote>();
  const [prepared, setPrepared] = useState<PreparedTrade>();
  const [error, setError] = useState("");
  const [preparationError, setPreparationError] = useState<{ message: string; code?: string }>();
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState<TradeResult>();
  const [pending, setPending] = useState(() => pendingOrder(accountId));
  const [expiredQuote, setExpiredQuote] = useState<OrderQuote>();
  const [refresh, setRefresh] = useState(0);
  const task = useRef(false);
  const canTrade = Boolean(accountId && trading?.available);
  const [closing] = useState(position);
  const expired = Boolean(quote && expiredQuote === quote);
  const needsCollateral = preparationError?.code === "collateral" && quote?.market.collateral === "USDC";

  useEffect(() => {
    const controller = new AbortController();
    const draft = { side, margin, leverage };
    const load = async () => {
      if (accountId && canTrade) {
        try {
          const following = signalRoom && signalPrice && signalTime ? { signal: { room: signalRoom, price: signalPrice, time: signalTime } } : {};
          const review = await tradeApi<PreparedTrade>(accountId, "prepare", { ...draft, market, closing: Boolean(closing), ...following }, controller.signal);
          if (!controller.signal.aborted) {
            setPreparationError(undefined);
            setError("");
            setPrepared(review);
            setQuote(review.quote);
          }
          return;
        } catch (failure) {
          if (!controller.signal.aborted) setPreparationError({
            message: failure instanceof Error ? failure.message : "Trading is unavailable.",
            code: failure instanceof TradeApiError ? failure.code : undefined,
          });
        }
      }
      const next = await prepareOrder(market, draft, controller.signal, closing);
      if (!controller.signal.aborted) setQuote(next);
    };
    void load().catch(failure => {
      if (!controller.signal.aborted) {
        setError(failure instanceof Error ? failure.message.split("\n")[0] : "Could not get a price right now.");
      }
    });
    return () => controller.abort();
  }, [market, side, margin, leverage, refresh, accountId, canTrade, closing, signalRoom, signalPrice, signalTime]);

  useEffect(() => {
    if (!quote) return;
    const timer = window.setTimeout(() => setExpiredQuote(quote), Math.max(0, quote.expires - Date.now()));
    return () => window.clearTimeout(timer);
  }, [quote]);

  const reload = () => {
    setQuote(undefined);
    setPrepared(undefined);
    setPreparationError(undefined);
    setError("");
    setExpiredQuote(undefined);
    setRefresh(value => value + 1);
  };

  async function confirm() {
    if (!accountId || !prepared || task.current) return;
    task.current = true;
    setError("");
    setBusy("Waiting for your passkey…");
    try {
      const send = async () => {
        const existing = pendingOrder(accountId);
        if (existing) {
          setPending(existing);
          return;
        }
        if (Date.now() >= prepared.authorization.deadline) throw new Error("This quote expired. Review a fresh quote.");
        const signed = await signPayload(accountId, tradePayload(accountId, prepared.quote, prepared.authorization));
        if (memory.get().current !== accountId || Date.now() >= prepared.authorization.deadline) {
          throw new Error("This approval expired or your account changed. Review a fresh quote.");
        }
        const next = { id: prepared.authorization.id, expires: prepared.authorization.expiresAfter };
        localStorage.setItem(pendingKey(accountId), JSON.stringify(next));
        setPending(next);
        setBusy("Placing your order…");
        let response: TradeResult;
        try {
          response = await tradeApi<TradeResult>(accountId, "execute", { ticket: prepared.ticket, signed });
        } catch (failure) {
          if (failure instanceof TradeApiError && ["not_submitted", "collateral"].includes(failure.code ?? "")) {
            localStorage.removeItem(pendingKey(accountId));
            setPending(undefined);
            setPrepared(undefined);
            setPreparationError({ message: failure.message, code: failure.code });
            return;
          }
          throw failure;
        }
        if (response.state !== "unknown") {
          localStorage.removeItem(pendingKey(accountId));
          setPending(undefined);
        }
        setResult(response);
        onRefresh();
      };
      if (navigator.locks) await navigator.locks.request(pendingKey(accountId), send);
      else await send();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not submit this order.");
    } finally {
      setBusy("");
      task.current = false;
    }
  }

  async function check() {
    if (!pending || !accountId || !trading?.available || task.current) return;
    task.current = true;
    setBusy("Checking order status…");
    try {
      const status = await readOrderStatus(trading.address, pending.id);
      if (status.status === "unknownOid" && Date.now() <= pending.expires + 60_000) {
        setResult({ state: "unknown", message: "Hyperliquid has no confirmed record yet." });
        return;
      }
      if (status.status === "order" && ["open", "triggered"].includes(status.order.status)) {
        setResult({ state: "unknown", message: `Hyperliquid reports ${status.order.status}.` });
        return;
      }
      localStorage.removeItem(pendingKey(accountId));
      setPending(undefined);
      setResult(undefined);
      reload();
      if (status.status === "order") {
        const filled = Number(status.order.order.origSz) - Number(status.order.order.sz);
        setResult({ state: "reconciled", message: `Hyperliquid reports ${status.order.status}.${filled > 0 ? ` Filled ${amount.format(filled)} units of ${status.order.order.coin}.` : ""}` });
      }
      onRefresh();
    } catch {
      setError("Could not check this order. Try again.");
    } finally {
      setBusy("");
      task.current = false;
    }
  }

  return (
    <Sheet label={closing ? "Review close" : "Review order"} showTitle onClose={close} busy={Boolean(busy)}>
      <div className="markets-ui trade-review">
        <p className="trade-review-lead">{closing ? "Close the position" : `Open a ${side}`} on {marketLabel(instrument)}.</p>
        {!quote && !error && <p role="status">Getting a mainnet quote…</p>}
        {quote && <dl className="trade-review-details">
          {signal && <Detail label="Host filled at">{money(signal.price, instrument)} · now {money(quote.market.mark, instrument)}</Detail>}
          {!closing && <Detail label="Margin">{inCollateral(quote.margin, quote.market.collateral)} · {quote.leverage}×</Detail>}
          <Detail label="Order size">{quote.size} {instrument.symbol} · about {money(quote.value, { ...instrument, precision: 2 })}</Detail>
          <Detail label={quote.buy ? "Maximum buy price" : "Minimum sell price"}>{money(quote.limit, instrument)}</Detail>
          <Detail label="Fee">{quote.fee === undefined ? "Unavailable" : inCollateral(quote.fee, quote.market.collateral)}</Detail>
        </dl>}
        {accountId && trading && !trading.available && <p className="trade-review-note">Trading is unavailable on this deployment.</p>}
        {preparationError && !needsCollateral && preparationError.message !== error && <p className="trade-review-note">{preparationError.message}</p>}
        {needsCollateral && accountId && trading?.available && quote && !result && !pending
          && <Deposit accountId={accountId} trading={trading} required={quote.margin + (quote.fee ?? 0)} onReady={reload} />}
        {prepared && <p className="trade-review-note">Any quantity outside the reviewed price limit is canceled.</p>}
        {busy && <p role="status">{busy}</p>}
        {result && <p role="status">{'message' in result ? result.message
          : `${result.state === 'partial' ? 'Partially filled' : 'Filled'} · ${result.size} ${instrument.symbol} at ${money(result.average, instrument)} average.`}</p>}
        {error && <p role="alert" className="trade-notice">{error}</p>}
        <div className="flex flex-wrap gap-2">
          {pending ? <button type="button" className="action action-primary" onClick={() => void check()} disabled={Boolean(busy)}>Check order</button>
            : result ? null
            : needsCollateral ? <button type="button" className="action action-secondary" onClick={reload}>Try again</button>
            : expired || (!quote && error)
            ? <button type="button" className="action action-primary" onClick={reload}>{expired ? "Refresh expired quote" : "Get a new quote"}</button>
            : prepared ? <button type="button" className="action action-primary" disabled={Boolean(busy)} onClick={() => void confirm()}>Confirm with passkey</button>
            : !accountId ? <button type="button" className="action action-primary" onClick={openAccount}>Open account</button>
            : preparationError && <button type="button" className="action action-secondary" onClick={reload}>Get a new quote</button>}
          <button type="button" className="action action-secondary" disabled={Boolean(busy)} onClick={close}>{result ? "Done" : "Edit order"}</button>
        </div>
      </div>
    </Sheet>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}
