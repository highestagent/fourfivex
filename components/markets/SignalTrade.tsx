"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { Instrument } from "@fourfivex/markets-protocol/markets";
import { signalProblem, type FeedFill } from "@fourfivex/markets-protocol/sessions";
import { Select } from "@/components/Select";
import { tradeApi, type TradeAccount } from "@/lib/markets/api";
import { readPerpetual, type Perpetual } from "@/lib/markets/trade";
import { Dialog } from "./controls";
import { money } from "./format";

const TradeReview = dynamic(() => import("./TradeReview").then(module => module.TradeReview));
const amountDraft = /^\d{0,7}([.,]\d{0,2})?$/;
const ago = (time: number, now: number) => {
  const minutes = Math.floor((now - time) / 60_000);
  return minutes < 1 ? "just now" : `${minutes}m ago`;
};

/**
 * "Use this trade": the host's fill and the price now, side by side. The follower picks their own size and
 * leverage, then reviews a fresh order and approves it with their own passkey. A stale fill, or a price
 * that has moved too far from it, can't be used.
 */
export function SignalTrade({ roomId, fill, instrument, accountId, openAccount, close }: {
  roomId: string;
  fill: FeedFill;
  instrument: Instrument;
  accountId: string | null;
  openAccount: () => void;
  close: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [leverage, setLeverage] = useState(1);
  const [perp, setPerp] = useState<Perpetual>();
  const [now, setNow] = useState(() => Date.now());
  const [reviewing, setReviewing] = useState(false);
  const [trading, setTrading] = useState<TradeAccount>();
  const margin = Number(amount.replace(",", "."));
  const problem = perp ? signalProblem(fill, perp.mark, now) : undefined;
  const drift = perp ? (perp.mark - Number(fill.price)) / Number(fill.price) * 100 : undefined;
  const market = fill.market!;

  useEffect(() => {
    const controller = new AbortController();
    let timer: number;
    const load = () => void readPerpetual(market, controller.signal).then(next => { if (!controller.signal.aborted) setPerp(next); }, () => {})
      .finally(() => { if (!controller.signal.aborted) timer = window.setTimeout(load, 5000); });
    load();
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { controller.abort(); window.clearTimeout(timer); window.clearInterval(clock); };
  }, [market]);

  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    void tradeApi<TradeAccount>(accountId, "account", {}, controller.signal).then(setTrading, () => setTrading({ available: false, funding: false }));
    return () => controller.abort();
  }, [accountId]);

  if (reviewing) return <TradeReview market={market} instrument={instrument} draft={{ side: fill.side, margin, leverage: Math.min(leverage, perp?.maxLeverage ?? 1) }}
    accountId={accountId} trading={trading} openAccount={openAccount} close={() => setReviewing(false)} onRefresh={() => {}}
    signal={{ room: roomId, price: fill.price, time: fill.time }} />;

  return <Dialog title="Use this trade" close={close}>
    <form className="grid gap-4" onSubmit={event => { event.preventDefault(); if (margin > 0 && !problem) setReviewing(true); }}>
      <dl className="signal-compare">
        <div><dt>Host filled · {ago(fill.time, now)}</dt><dd>{money(fill.price, instrument)}</dd></div>
        <div><dt>Now</dt><dd>{perp ? <>{money(perp.mark, instrument)} <small className="text-xs font-normal text-ink-2">{drift! >= 0 ? "+" : ""}{drift!.toFixed(2)}%</small></> : "…"}</dd></div>
      </dl>
      <p className="trade-sentence">
        Open a <strong className={fill.side === "long" ? "trade-long" : "trade-short"}>{fill.side}</strong> on {instrument.symbol} using{" "}
        <label className="trade-field trade-amount">
          <span className="sr-only">Margin in US dollars</span>
          <span className="trade-currency" aria-hidden="true">$</span>
          <input name="margin" inputMode="decimal" autoComplete="off" required placeholder="0" value={amount} style={{ width: `${Math.max(2, amount.length)}ch` }}
            onChange={event => { if (amountDraft.test(event.target.value)) setAmount(event.target.value); }} />
        </label>{" "}at{" "}
        <Select id="signal-leverage" label="Leverage" pickerTitle="Choose leverage" value={Math.min(leverage, perp?.maxLeverage ?? 1)}
          options={Array.from({ length: perp?.maxLeverage ?? 1 }, (_, index) => ({ value: index + 1, label: `${index + 1}×` }))}
          onValueChange={setLeverage} className="trade-field trade-number" />.
      </p>
      {problem && <p role="alert" className="notice">{problem}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="action action-primary" disabled={!(margin > 0) || Boolean(problem) || !perp}>Review order</button>
        <button type="button" className="action action-secondary" onClick={close}>Cancel</button>
      </div>
    </form>
  </Dialog>;
}
