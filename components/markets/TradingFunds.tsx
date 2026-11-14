"use client";

import { useEffect, useId, useRef, useState, type ReactNode, type SubmitEvent } from "react";
import { ArrowUpRight, CircleCheck, TriangleAlert } from "lucide-react";
import { Select } from "@/components/Select";
import { Sheet } from "@/components/Sheet";
import { Address } from "@/components/Address";
import { CopyButton } from "@/components/ui";
import { useHoldings } from "@/lib/account/useHoldings";
import { signPayload } from "@/lib/account/flows";
import { memory } from "@/lib/account/store";
import { payloadProblem } from "@/lib/send/guard";
import { sendStatus } from "@/lib/send/api";
import { TradeApiError, tradeApi, type TradeAccount } from "@/lib/markets/api";
import { withdrawalPayload, type TradeAuthorization, type Withdrawal } from "@/lib/markets/authorization";
import type { FundingQuote } from "@/lib/markets/funding";
import { WITHDRAWAL_FEE, withdrawalLimit, withdrawalProblems } from "@/lib/markets/funds";
import { readWithdrawable, readWithdrawal } from "@/lib/markets/trade";

type WithdrawalQuote = { withdrawal: Withdrawal; authorization: TradeAuthorization; ticket: string };
type FundingTransfer = { deposit: string; expires: number };
type PendingWithdrawal = Withdrawal & { submitted?: boolean };
type Method = "relay" | "hyperliquid" | "fourfivex";
type Outcome = { ok: boolean; text: string };

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const hyperliquidPortfolio = "https://app.hyperliquid.xyz/portfolio";
const amountDraft = /^\d{0,7}([.,]\d{0,2})?$/;

const transferProgress: Record<string, string> = {
  waiting: "Waiting for your transfer…",
  seen: "Transfer received…",
  short: "Less than quoted arrived.",
  working: "Moving to trading…",
};
const transferOutcome: Record<string, Outcome> = {
  done: { ok: true, text: "Arrived in trading." },
  refunded: { ok: false, text: "Refunded to your balance." },
  failed: { ok: false, text: "Transfer failed." },
};

function saved<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem(key) ?? "null"); }
  catch { return null; }
}

const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const afterFee = (amount: string | number) => dollars.format(Math.max(0, Number(amount) - WITHDRAWAL_FEE));

function Callout({ tone, role, children }: { tone: "ok" | "warn" | "error"; role?: "status" | "alert"; children: ReactNode }) {
  const Icon = tone === "ok" ? CircleCheck : TriangleAlert;
  return (
    <div className={`funds-callout funds-callout-${tone}`} role={role}>
      <Icon size={16} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

function OutLink({ href, primary = false, children }: { href: string; primary?: boolean; children: ReactNode }) {
  return (
    <a className={`action ${primary ? "action-primary" : "action-secondary"}`} href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <ArrowUpRight size={16} aria-hidden="true" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

export function TradingFunds({ accountId, trading, mode, returnToReview, close }: {
  accountId: string;
  trading: Extract<TradeAccount, { available: true }>;
  mode: "fund" | "withdraw";
  returnToReview: boolean;
  close: () => void;
}) {
  const funding = mode === "fund";
  const fundKey = `fourfivex:markets:funding:${accountId}`;
  const withdrawKey = `fourfivex:markets:withdrawal:${accountId}`;
  const { address } = trading;
  const bridge = `https://relay.link/bridge/hyperliquid?${new URLSearchParams({ toAddress: address, toCurrency: "0x00000000000000000000000000000000" })}`;
  const { holdings, status } = useHoldings(funding && trading.funding ? accountId : null);
  const parts = holdings?.parts ?? [];
  const ids = useId();
  const [selected, setSelected] = useState("");
  const [fundTransfer, setFundTransfer] = useState(() => funding && trading.funding ? saved<FundingTransfer>(fundKey) : null);
  const [withdrawal, setWithdrawal] = useState(() => funding ? null : saved<PendingWithdrawal>(withdrawKey));
  const [method, setMethod] = useState<Method>(fundTransfer ? "fourfivex" : "relay");
  const [review, setReview] = useState<FundingQuote | WithdrawalQuote>();
  const [balance, setBalance] = useState<string>();
  const [balanceFailed, setBalanceFailed] = useState(false);
  const [startBalance, setStartBalance] = useState<number>();
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ amount?: string; destination?: string }>({});
  const [working, setWorking] = useState("");
  const [progress, setProgress] = useState("");
  const [outcome, setOutcome] = useState<Outcome>();
  const [failure, setFailure] = useState("");
  const task = useRef(false);
  const busy = working !== "";

  useEffect(() => {
    const controller = new AbortController();
    async function update() {
      if (document.visibilityState !== "visible") return;
      try {
        const value = await readWithdrawable(address, controller.signal);
        if (controller.signal.aborted) return;
        setBalance(value);
        setBalanceFailed(false);
        setStartBalance(start => start ?? Number(value));
      } catch {
        if (!controller.signal.aborted) setBalanceFailed(true);
      }
    }
    void update();
    const timer = window.setInterval(update, 5_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [address]);

  useEffect(() => {
    if (!fundTransfer || busy) return;
    const { deposit, expires } = fundTransfer;
    let active = true;
    async function update() {
      try {
        const result = await sendStatus(deposit);
        if (!active) return;
        const expired = result.state === "waiting" && Date.now() > expires + 60_000;
        const ended = expired ? { ok: false, text: "Quote expired. Nothing was sent." } : transferOutcome[result.state];
        if (ended) {
          localStorage.removeItem(fundKey);
          setFundTransfer(null);
          setReview(undefined);
          setOutcome(ended);
          setProgress("");
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

  useEffect(() => {
    if (!withdrawal || busy) return;
    const { time } = withdrawal;
    const controller = new AbortController();
    async function update() {
      try {
        const record = await readWithdrawal(address, time, controller.signal);
        if (controller.signal.aborted || (!record && Date.now() < time + 2 * 86_400_000 + 120_000)) return;
        localStorage.removeItem(withdrawKey);
        setWithdrawal(null);
        setReview(undefined);
        setOutcome(record
          ? { ok: true, text: "Sent. Arrives on Arbitrum in a few minutes." }
          : { ok: false, text: "Expired. Nothing was withdrawn." });
      } catch {}
    }
    void update();
    const timer = window.setInterval(update, 10_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [address, busy, withdrawal, withdrawKey]);

  async function run(label: string, work: () => Promise<void>) {
    if (task.current) return;
    task.current = true;
    setWorking(label);
    setFailure("");
    try { await work(); }
    catch (error) { setFailure(error instanceof Error ? error.message : "Could not complete this request."); }
    finally { task.current = false; setWorking(""); }
  }

  function prepareFunding(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("amount")).trim().replace(",", ".");
    void run("Getting a quote…", async () => {
      const part = parts.find(part => part.assetId === selected) ?? parts[0];
      if (!part) throw new Error("Your fourfivex account has no balance to transfer.");
      setReview(await tradeApi<FundingQuote>(accountId, "fund-quote", { asset: part.assetId, amount: Number(value) }));
    });
  }

  const maxWithdrawal = withdrawalLimit(balance);
  const canWithdraw = maxWithdrawal === undefined || maxWithdrawal > WITHDRAWAL_FEE;

  function prepareWithdrawal(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const { value, to, problems: errors } = withdrawalProblems(amount, destination, maxWithdrawal, address);
    setFieldErrors(errors);
    if (errors.amount || errors.destination) {
      document.getElementById(`${ids}-${errors.amount ? "amount" : "destination"}`)?.focus();
      return;
    }
    void run("Preparing your withdrawal…", async () => {
      setReview(await tradeApi<WithdrawalQuote>(accountId, "withdraw-quote", { amount: value, destination: to }));
    });
  }

  function submit() {
    if (!review) return;
    void run("Waiting for your passkey…", async () => {
      const key = "payload" in review ? fundKey : withdrawKey;
      async function send() {
        const prior = saved<FundingTransfer | PendingWithdrawal>(key);
        if (prior) {
          if ("deposit" in prior) setFundTransfer(prior);
          else setWithdrawal(prior);
          return;
        }
        if (review && "payload" in review) {
          if (Date.now() >= review.expires) throw new Error("This quote expired. Review a new transfer.");
          const problem = payloadProblem(review.payload, {
            accountId, depositAddress: review.deposit, assetId: review.asset, maxUnits: review.maxUnits,
          });
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
        } else if (review) {
          if (Date.now() >= review.authorization.deadline) throw new Error("This review expired. Review the withdrawal again.");
          const signed = await signPayload(accountId, withdrawalPayload(accountId, review.withdrawal, review.authorization));
          if (memory.get().current !== accountId || Date.now() >= review.authorization.deadline) throw new Error("Your account changed or the review expired. Review the withdrawal again.");
          setWorking("Sending your withdrawal…");
          localStorage.setItem(withdrawKey, JSON.stringify(review.withdrawal));
          setWithdrawal(review.withdrawal);
          try {
            const result = await tradeApi<{ state: string; message?: string }>(accountId, "withdraw-submit", { ticket: review.ticket, signed });
            if (result.state === "rejected") throw new TradeApiError(result.message || "The withdrawal was rejected.", "not_submitted");
            if (result.state === "submitted") {
              const submitted = { ...review.withdrawal, submitted: true };
              localStorage.setItem(withdrawKey, JSON.stringify(submitted));
              setWithdrawal(submitted);
            }
          } catch (error) {
            if (error instanceof TradeApiError && error.code === "not_submitted") {
              localStorage.removeItem(withdrawKey);
              setWithdrawal(null);
              setReview(undefined);
            }
            throw error;
          }
        }
      }
      if (navigator.locks) await navigator.locks.request(key, send);
      else await send();
    });
  }

  function edit() {
    setReview(undefined);
    setFailure("");
  }

  const received = funding && balance !== undefined && startBalance !== undefined ? Number(balance) - startBalance : 0;
  const arrived = received >= 0.01;
  const doneLabel = returnToReview ? "Back to order" : arrived ? "Start trading" : "Done";
  const doneButton = (
    <button type="button" className={`action ${arrived || outcome ? "action-primary" : "action-secondary"}`} disabled={busy} onClick={close}>
      {doneLabel}
    </button>
  );
  const methods: { id: Method; title: string }[] = [
    { id: "relay", title: "Another wallet or chain" },
    { id: "hyperliquid", title: "Hyperliquid" },
    ...(trading.funding ? [{ id: "fourfivex" as const, title: "Your balance" }] : []),
  ];
  const fourfivexBusy = method === "fourfivex" && (fundTransfer || review);

  const fundingView = <>
    {arrived && <Callout tone="ok" role="status"><strong>{dollars.format(received)} arrived.</strong></Callout>}
    {!fourfivexBusy && !outcome && <fieldset className="funds-methods">
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
      <p className="funds-note">Pay with any token. Arrives at <code className="funds-mono">{shortAddress(address)}</code>.</p>
      <div className="funds-actions">
        {!arrived && <OutLink primary href={bridge}>Open Relay</OutLink>}
        {doneButton}
      </div>
    </div>}
    {method === "hyperliquid" && <div className="funds-panel">
      <p className="funds-note">Send USDC (Perps) to this address.</p>
      <div className="funds-address">
        <span id={`${ids}-address`} className="funds-address-label">Trading address</span>
        <div className="funds-address-row">
          <Address value={address} className="flex-1 text-sm" />
          <CopyButton text={address} label="Copy trading address" />
        </div>
      </div>
      <Callout tone="warn">Hyperliquid only. Other networks won&rsquo;t arrive.</Callout>
      <div className="funds-actions">
        {!arrived && <OutLink primary href={hyperliquidPortfolio}>Open Hyperliquid</OutLink>}
        {doneButton}
      </div>
    </div>}
    {method === "fourfivex" && <div className="funds-panel">
      {fundTransfer ? <p className="funds-waiting" role="status">{progress || "Checking your transfer…"}</p>
        : outcome ? <>
          <Callout tone={outcome.ok ? "ok" : "warn"} role="status">{outcome.text}</Callout>
          <div className="funds-actions">{doneButton}</div>
        </>
        : review && "payload" in review ? <>
          <dl className="trade-review-details">
            <div><dt>You send</dt><dd>Up to {review.from} {review.symbol}</dd></div>
            <div><dt>You receive</dt><dd><strong>{dollars.format(Number(review.to))}</strong></dd></div>
          </dl>
          <div className="funds-actions">
            <button type="button" className="action action-primary" disabled={busy} onClick={submit}>Confirm with passkey</button>
            <button type="button" className="action action-secondary" disabled={busy} onClick={edit}>Edit</button>
          </div>
        </>
        : <form className="funds-form" onSubmit={prepareFunding}>
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
              pattern="[0-9]{1,7}([.,][0-9]{1,2})?" required />
          </div>
          <div className="funds-actions">
            <button className="action action-primary" type="submit" disabled={busy || !parts.length}>Review</button>
            {doneButton}
          </div>
        </form>}
    </div>}
    {!arrived && method !== "fourfivex" && <p className="funds-waiting" role="status">Waiting for your deposit…</p>}
  </>;

  const withdrawView = withdrawal ? <div className="funds-panel">
    <dl className="trade-review-details">
      <div><dt>You receive</dt><dd>{afterFee(withdrawal.amount)}</dd></div>
      <div><dt>To Arbitrum</dt><dd className="funds-address-value"><Address value={withdrawal.destination} className="justify-end" /></dd></div>
    </dl>
    <p className="funds-waiting" role="status">
      {withdrawal.submitted ? "Processing…" : "Checking…"}
    </p>
  </div>
    : outcome ? <div className="funds-panel">
      <Callout tone={outcome.ok ? "ok" : "warn"} role="status">{outcome.text}</Callout>
      <div className="funds-actions">{doneButton}</div>
    </div>
    : review && !("payload" in review) ? <div className="funds-panel">
      <dl className="trade-review-details">
        <div><dt>Withdraw</dt><dd>{dollars.format(Number(review.withdrawal.amount))}</dd></div>
        <div><dt>Fee</dt><dd>{dollars.format(WITHDRAWAL_FEE)}</dd></div>
        <div><dt>You receive</dt><dd><strong>{afterFee(review.withdrawal.amount)}</strong></dd></div>
        <div><dt>To Arbitrum</dt><dd className="funds-address-value"><Address value={review.withdrawal.destination} className="justify-end" /></dd></div>
      </dl>
      <p className="funds-note">Withdrawals can&rsquo;t be reversed.</p>
      <div className="funds-actions">
        <button type="button" className="action action-primary" disabled={busy} onClick={submit}>Confirm with passkey</button>
        <button type="button" className="action action-secondary" disabled={busy} onClick={edit}>Edit</button>
      </div>
    </div>
    : <form className="funds-form" noValidate onSubmit={prepareWithdrawal}>
      {!canWithdraw && <p className="funds-note">Nothing to withdraw yet.</p>}
      <div className="funds-field">
        <label htmlFor={`${ids}-amount`}>Amount</label>
        <div className="funds-input">
          <span aria-hidden="true">$</span>
          <input id={`${ids}-amount`} name="amount" inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount}
            aria-invalid={Boolean(fieldErrors.amount)} aria-describedby={`${ids}-amount-help`}
            onChange={event => {
              if (!amountDraft.test(event.target.value)) return;
              setAmount(event.target.value);
              setFieldErrors(errors => ({ ...errors, amount: undefined }));
            }} />
          <button type="button" className="funds-max" disabled={!maxWithdrawal || !canWithdraw} onClick={() => {
            if (!maxWithdrawal) return;
            setAmount(maxWithdrawal.toFixed(2));
            setFieldErrors(errors => ({ ...errors, amount: undefined }));
          }}>Max</button>
        </div>
        <p id={`${ids}-amount-help`} className={fieldErrors.amount ? "funds-error" : "funds-note"}>
          {fieldErrors.amount ?? (Number(amount.replace(",", ".")) > WITHDRAWAL_FEE
            ? `You receive ${afterFee(amount.replace(",", "."))}`
            : "$1 fee")}
        </p>
      </div>
      <div className="funds-field">
        <label htmlFor={`${ids}-destination`}>Arbitrum address</label>
        <input id={`${ids}-destination`} name="destination" className="field funds-mono" placeholder="0x…" value={destination}
          autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
          aria-invalid={Boolean(fieldErrors.destination)} aria-describedby={fieldErrors.destination ? `${ids}-destination-help` : undefined}
          onChange={event => {
            setDestination(event.target.value);
            setFieldErrors(errors => ({ ...errors, destination: undefined }));
          }} />
        {fieldErrors.destination && <p id={`${ids}-destination-help`} className="funds-error">{fieldErrors.destination}</p>}
      </div>
      <div className="funds-actions">
        <button type="submit" className="action action-primary" disabled={busy || !canWithdraw}>Review</button>
        <button type="button" className="action action-secondary" disabled={busy} onClick={close}>Cancel</button>
      </div>
    </form>;

  return <Sheet label={funding ? "Add money to trading" : "Withdraw from trading"} showTitle busy={busy} onClose={close}>
    <div className="markets-ui funds">
      <div className="funds-balance">
        <span>Available</span>
        <strong>
          {balance !== undefined ? dollars.format(Number(balance))
            : balanceFailed ? "Unavailable"
            : <span className="funds-skeleton"><span className="sr-only">Loading balance</span></span>}
        </strong>
      </div>
      {funding ? fundingView : withdrawView}
      {busy && <p className="funds-waiting" role="status">{working}</p>}
      {failure && <Callout tone="error" role="alert">{failure}</Callout>}
    </div>
  </Sheet>;
}
