"use client";

import { useEffect, useId, useRef, useState, type SubmitEvent } from "react";
import { Address } from "@/components/Address";
import { Sheet } from "@/components/Sheet";
import { signPayload } from "@/lib/account/flows";
import { memory } from "@/lib/account/store";
import { TradeApiError, tradeApi } from "@/lib/markets/api";
import { withdrawalPayload, type TradeAuthorization, type Withdrawal } from "@/lib/markets/authorization";
import { WITHDRAWAL_FEE, withdrawalLimit, withdrawalProblems } from "@/lib/markets/funds";
import { readWithdrawable, readWithdrawal, type TradingAddress } from "@/lib/markets/trade";
import { Callout, dollars, saved } from "./funds-ui";

type WithdrawalQuote = { withdrawal: Withdrawal; authorization: TradeAuthorization; ticket: string };
type PendingWithdrawal = Withdrawal & { submitted?: boolean };
type Outcome = { ok: boolean; text: string };

const amountDraft = /^\d{0,7}([.,]\d{0,2})?$/;
const afterFee = (amount: string | number) => dollars.format(Math.max(0, Number(amount) - WITHDRAWAL_FEE));

/** Moves money from the trading balance to a wallet on Arbitrum. */
export function Withdraw({ accountId, address, close }: { accountId: string; address: TradingAddress; close: () => void }) {
  const withdrawKey = `fourfivex:markets:withdrawal:${accountId}`;
  const ids = useId();
  const [withdrawal, setWithdrawal] = useState(() => saved<PendingWithdrawal>(withdrawKey));
  const [review, setReview] = useState<WithdrawalQuote>();
  const [balance, setBalance] = useState<string>();
  const [balanceFailed, setBalanceFailed] = useState(false);
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ amount?: string; destination?: string }>({});
  const [working, setWorking] = useState("");
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
      } catch {
        if (!controller.signal.aborted) setBalanceFailed(true);
      }
    }
    void update();
    const timer = window.setInterval(update, 5_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [address]);

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

  const maxWithdrawal = withdrawalLimit(balance);
  const canWithdraw = maxWithdrawal === undefined || maxWithdrawal > WITHDRAWAL_FEE;

  function prepare(event: SubmitEvent<HTMLFormElement>) {
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
      async function send() {
        const prior = saved<PendingWithdrawal>(withdrawKey);
        if (prior) {
          setWithdrawal(prior);
          return;
        }
        if (!review) return;
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
      if (navigator.locks) await navigator.locks.request(withdrawKey, send);
      else await send();
    });
  }

  return <Sheet label="Withdraw from trading" showTitle busy={busy} onClose={close}>
    <div className="funds">
      <div className="funds-balance">
        <span>Available</span>
        <strong>
          {balance !== undefined ? dollars.format(Number(balance))
            : balanceFailed ? "Unavailable"
            : <span className="funds-skeleton"><span className="sr-only">Loading balance</span></span>}
        </strong>
      </div>
      {withdrawal ? <div className="funds-panel">
        <dl className="funds-details">
          <div><dt>You receive</dt><dd>{afterFee(withdrawal.amount)}</dd></div>
          <div><dt>To Arbitrum</dt><dd className="funds-address-value"><Address value={withdrawal.destination} className="justify-end" /></dd></div>
        </dl>
        <p className="funds-waiting" role="status">{withdrawal.submitted ? "Processing…" : "Checking…"}</p>
      </div>
        : outcome ? <div className="funds-panel">
          <Callout tone={outcome.ok ? "ok" : "warn"} role="status">{outcome.text}</Callout>
          <div className="funds-actions"><button type="button" className="action action-primary" onClick={close}>Done</button></div>
        </div>
        : review ? <div className="funds-panel">
          <dl className="funds-details">
            <div><dt>Withdraw</dt><dd>{dollars.format(Number(review.withdrawal.amount))}</dd></div>
            <div><dt>Fee</dt><dd>{dollars.format(WITHDRAWAL_FEE)}</dd></div>
            <div><dt>You receive</dt><dd><strong>{afterFee(review.withdrawal.amount)}</strong></dd></div>
            <div><dt>To Arbitrum</dt><dd className="funds-address-value"><Address value={review.withdrawal.destination} className="justify-end" /></dd></div>
          </dl>
          <p className="funds-note">Withdrawals can&rsquo;t be reversed.</p>
          <div className="funds-actions">
            <button type="button" className="action action-primary" disabled={busy} onClick={submit}>Confirm with passkey</button>
            <button type="button" className="action action-secondary" disabled={busy} onClick={() => { setReview(undefined); setFailure(""); }}>Edit</button>
          </div>
        </div>
        : <form className="funds-form" noValidate onSubmit={prepare}>
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
              {fieldErrors.amount ?? (Number(amount.replace(",", ".")) > WITHDRAWAL_FEE ? `You receive ${afterFee(amount.replace(",", "."))}` : "$1 fee")}
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
        </form>}
      {busy && <p className="funds-waiting" role="status">{working}</p>}
      {failure && <Callout tone="error" role="alert">{failure}</Callout>}
    </div>
  </Sheet>;
}
