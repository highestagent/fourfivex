"use client";

import { useEffect, useId, useRef, useState, type SubmitEvent } from "react";
import { Address } from "@/components/Address";
import { Select } from "@/components/Select";
import { CopyButton } from "@/components/ui";
import { signPayload } from "@/lib/account/flows";
import { memory } from "@/lib/account/store";
import { useHoldings } from "@/lib/account/useHoldings";
import { TradeApiError, tradeApi, type TradeAccount } from "@/lib/markets/api";
import type { FundingQuote } from "@/lib/markets/funding";
import { readWithdrawable } from "@/lib/markets/trade";
import { sendStatus } from "@/lib/send/api";
import { payloadProblem } from "@/lib/send/guard";
import { Callout, dollars, OutLink, saved } from "./funds-ui";

const wholeDollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

type Method = "relay" | "hyperliquid" | "fourfivex";
type FundingTransfer = { deposit: string; expires: number };

const hyperliquidPortfolio = "https://app.hyperliquid.xyz/portfolio";
const transferProgress: Record<string, string> = {
  waiting: "Waiting for your transfer…",
  seen: "Transfer received…",
  short: "Less than quoted arrived.",
  working: "Moving to trading…",
};
const transferFailed: Record<string, string> = {
  refunded: "Refunded to your balance.",
  failed: "Transfer failed.",
};

/**
 * How much to ask for: what the order is short by, rounded up to whole dollars, plus a dollar for
 * deposit costs such as Hyperliquid's charge on a first transfer to a new address.
 */
export const toAdd = (short: number) => Math.ceil(short) + 1;

/**
 * Inside the order review when the trading balance can't cover the order: add money from any
 * wallet or chain, watch it arrive, and hand back to the review once the order is covered.
 */
export function Deposit({ accountId, trading, required, onReady }: {
  accountId: string;
  trading: Extract<TradeAccount, { available: true }>;
  /** Margin plus fee for the order under review. */
  required: number;
  /** Called once, when the trading balance covers the order. */
  onReady: () => void;
}) {
  const { address } = trading;
  const fundKey = `fourfivex:markets:funding:${accountId}`;
  const bridge = `https://relay.link/bridge/hyperliquid?${new URLSearchParams({ toAddress: address, toCurrency: "0x00000000000000000000000000000000" })}`;
  const ids = useId();
  const { holdings, status } = useHoldings(trading.funding ? accountId : null);
  const parts = holdings?.parts ?? [];
  const [available, setAvailable] = useState<number>();
  const [selected, setSelected] = useState("");
  const [fundTransfer, setFundTransfer] = useState(() => trading.funding ? saved<FundingTransfer>(fundKey) : null);
  const [method, setMethod] = useState<Method>(fundTransfer ? "fourfivex" : "relay");
  const [review, setReview] = useState<FundingQuote>();
  const [working, setWorking] = useState("");
  const [progress, setProgress] = useState("");
  const [failure, setFailure] = useState("");
  const task = useRef(false);
  const ready = useRef(onReady);
  const busy = working !== "";

  useEffect(() => {
    ready.current = onReady;
  });

  useEffect(() => {
    const controller = new AbortController();
    let done = false;
    // Carry on only once money arrives after this opened, so a reading that already looks enough
    // (while the server's own check still says no) can't send the review round in a loop.
    let opening: number | undefined;
    async function update() {
      if (done || document.visibilityState !== "visible") return;
      try {
        const value = Number(await readWithdrawable(address, controller.signal));
        if (controller.signal.aborted) return;
        setAvailable(value);
        opening ??= value;
        if (value >= required && value > opening) {
          done = true;
          ready.current();
        }
      } catch {}
    }
    void update();
    const timer = window.setInterval(update, 5_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [address, required]);

  useEffect(() => {
    if (!fundTransfer || busy) return;
    const { deposit, expires } = fundTransfer;
    let active = true;
    async function update() {
      try {
        const result = await sendStatus(deposit);
        if (!active) return;
        const expired = result.state === "waiting" && Date.now() > expires + 60_000;
        if (expired || result.state === "done" || transferFailed[result.state]) {
          localStorage.removeItem(fundKey);
          setFundTransfer(null);
          setReview(undefined);
          setProgress("");
          if (expired) setFailure("Quote expired. Nothing was sent.");
          else if (transferFailed[result.state]) setFailure(transferFailed[result.state]);
        } else {
          setProgress(transferProgress[result.state] ?? "Checking…");
        }
      } catch {
        if (active) setProgress("Status unavailable. Retrying…");
      }
    }
    void update();
    const timer = window.setInterval(update, 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [busy, fundKey, fundTransfer]);

  async function run(label: string, work: () => Promise<void>) {
    if (task.current) return;
    task.current = true;
    setWorking(label);
    setFailure("");
    try { await work(); }
    catch (error) { setFailure(error instanceof Error ? error.message : "Could not complete this request."); }
    finally { task.current = false; setWorking(""); }
  }

  function quoteFunding(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("amount")).trim().replace(",", ".");
    void run("Getting a quote…", async () => {
      const part = parts.find(part => part.assetId === selected) ?? parts[0];
      if (!part) throw new Error("Your fourfivex account has no balance to transfer.");
      setReview(await tradeApi<FundingQuote>(accountId, "fund-quote", { asset: part.assetId, amount: Number(value) }));
    });
  }

  function confirmFunding() {
    if (!review) return;
    void run("Waiting for your passkey…", async () => {
      async function send() {
        const prior = saved<FundingTransfer>(fundKey);
        if (prior) {
          setFundTransfer(prior);
          return;
        }
        if (!review) return;
        if (Date.now() >= review.expires) throw new Error("This quote expired. Review a new transfer.");
        const problem = payloadProblem(review.payload, { accountId, depositAddress: review.deposit, assetId: review.asset, maxUnits: review.maxUnits });
        if (problem) throw new Error(problem);
        const signed = await signPayload(accountId, review.payload);
        if (memory.get().current !== accountId || Date.now() >= review.expires) throw new Error("Your account changed or the quote expired. Review a new transfer.");
        setWorking("Sending your transfer…");
        const transfer = { deposit: review.deposit, expires: review.expires };
        localStorage.setItem(fundKey, JSON.stringify(transfer));
        setFundTransfer(transfer);
        try {
          await tradeApi(accountId, "fund-submit", { deposit: review.deposit, signed });
        } catch (error) {
          if (error instanceof TradeApiError && error.code === "not_submitted") {
            localStorage.removeItem(fundKey);
            setFundTransfer(null);
            setReview(undefined);
          }
          throw error;
        }
      }
      if (navigator.locks) await navigator.locks.request(fundKey, send);
      else await send();
    });
  }

  const short = available === undefined ? undefined : Math.max(0, required - available);
  const amount = short === undefined ? undefined : toAdd(short);
  const methods: { id: Method; title: string }[] = [
    { id: "relay", title: "Another wallet or chain" },
    { id: "hyperliquid", title: "Hyperliquid" },
    ...(trading.funding ? [{ id: "fourfivex" as const, title: "Your balance" }] : []),
  ];

  return (
    <section className="funds" aria-label="Add money">
      <p className="funds-need" role="status">
        {short === undefined ? "Checking your trading balance…"
          : short > 0 ? <><strong>Add {wholeDollars.format(toAdd(short))}</strong> to place this order.</>
          : "Your money is arriving. Try again in a moment."}
      </p>
      {!(method === "fourfivex" && (fundTransfer || review)) && <fieldset className="funds-methods">
        <legend>From</legend>
        {methods.map(option => (
          <label key={option.id} className="funds-method">
            <input type="radio" name={`${ids}-method`} value={option.id} checked={method === option.id} onChange={() => {
              setMethod(option.id);
              setFailure("");
            }} />
            <strong>{option.title}</strong>
          </label>
        ))}
      </fieldset>}
      {method === "relay" && <div className="funds-panel">
        <p className="funds-note">Pay with any token. Arrives at <code className="funds-mono">{address.slice(0, 6)}…{address.slice(-4)}</code>.</p>
        <div className="funds-actions"><OutLink primary href={bridge}>Open Relay</OutLink></div>
      </div>}
      {method === "hyperliquid" && <div className="funds-panel">
        <p className="funds-note">Send USDC (Perps) to this address.</p>
        <div className="funds-address">
          <span className="funds-address-label">Trading address</span>
          <div className="funds-address-row">
            <Address value={address} className="flex-1 text-sm" />
            <CopyButton text={address} label="Copy trading address" />
          </div>
        </div>
        <Callout tone="warn">Hyperliquid only. Other networks won&rsquo;t arrive.</Callout>
        <div className="funds-actions"><OutLink primary href={hyperliquidPortfolio}>Open Hyperliquid</OutLink></div>
      </div>}
      {method === "fourfivex" && <div className="funds-panel">
        {fundTransfer ? <p className="funds-waiting" role="status">{progress || "Checking your transfer…"}</p>
          : review ? <>
            <dl className="funds-details">
              <div><dt>You send</dt><dd>Up to {review.from} {review.symbol}</dd></div>
              <div><dt>You receive</dt><dd><strong>{dollars.format(Number(review.to))}</strong></dd></div>
            </dl>
            <div className="funds-actions">
              <button type="button" className="action action-primary" disabled={busy} onClick={confirmFunding}>Confirm with passkey</button>
              <button type="button" className="action action-secondary" disabled={busy} onClick={() => { setReview(undefined); setFailure(""); }}>Edit</button>
            </div>
          </>
          : <form className="funds-form" onSubmit={quoteFunding}>
            {parts.length > 0 ? <div className="funds-field">
              <span id={`${ids}-source`}>Pay with</span>
              <Select label="Balance to convert" labelledBy={`${ids}-source`} pickerTitle="Choose a balance" className="action action-secondary"
                value={selected || parts[0].assetId} onValueChange={setSelected} options={parts.map(part => ({
                  value: part.assetId, label: `${part.symbol} · ${part.network}`,
                }))} />
            </div> : <p className="funds-note">{status === "loading" ? "Loading…" : "No balance to use."}</p>}
            <div className="funds-field">
              <label htmlFor={`${ids}-fund-amount`}>Amount</label>
              <input id={`${ids}-fund-amount`} name="amount" className="field" inputMode="decimal" autoComplete="off" placeholder="0.00"
                defaultValue={amount} pattern="[0-9]{1,7}([.,][0-9]{1,2})?" required />
            </div>
            <div className="funds-actions">
              <button className="action action-primary" type="submit" disabled={busy || !parts.length}>Review</button>
            </div>
          </form>}
      </div>}
      {method !== "fourfivex" && <p className="funds-waiting" role="status">Waiting for your deposit…</p>}
      {busy && <p className="funds-waiting" role="status">{working}</p>}
      {failure && <Callout tone="error" role="alert">{failure}</Callout>}
    </section>
  );
}
