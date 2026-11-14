"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Select } from "@/components/Select";
import { Sheet } from "@/components/Sheet";
import { CopyButton } from "@/components/ui";
import { useHoldings } from "@/lib/account/useHoldings";
import { signPayload } from "@/lib/account/flows";
import { memory } from "@/lib/account/store";
import { payloadProblem } from "@/lib/send/guard";
import { sendStatus } from "@/lib/send/api";
import { TradeApiError, tradeApi, type TradeAccount } from "@/lib/markets/api";
import { withdrawalPayload, type TradeAuthorization, type Withdrawal } from "@/lib/markets/authorization";
import type { FundingQuote } from "@/lib/markets/funding";
import { readWithdrawable, readWithdrawal } from "@/lib/markets/trade";

type WithdrawalQuote = { withdrawal: Withdrawal; authorization: TradeAuthorization; ticket: string };
type FundingTransfer = { deposit: string; expires: number };
type PendingWithdrawal = Withdrawal & { submitted?: boolean };
const format = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function saved<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem(key) ?? "null"); }
  catch { return null; }
}

export function TradingFunds({ accountId, trading, mode, returnToReview, close }: {
  accountId: string;
  trading: Extract<TradeAccount, { available: true }>;
  mode: "fund" | "withdraw";
  returnToReview: boolean;
  close: () => void;
}) {
  const funding = mode === "fund";
  const fundKey = `intuite:markets:funding:${accountId}`;
  const withdrawKey = `intuite:markets:withdrawal:${accountId}`;
  const { address } = trading;
  const bridge = `https://relay.link/bridge/hyperliquid?${new URLSearchParams({ toAddress: address, toCurrency: "0x00000000000000000000000000000000" })}`;
  const { holdings, status } = useHoldings(funding && trading.funding ? accountId : null);
  const parts = holdings?.parts ?? [];
  const [selected, setSelected] = useState("");
  const [fundTransfer, setFundTransfer] = useState(() => funding && trading.funding ? saved<FundingTransfer>(fundKey) : null);
  const [withdrawal, setWithdrawal] = useState(() => funding ? null : saved<PendingWithdrawal>(withdrawKey));
  const [fromWallet, setFromWallet] = useState(Boolean(fundTransfer));
  const [review, setReview] = useState<FundingQuote | WithdrawalQuote>();
  const [balance, setBalance] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState("");
  const [finished, setFinished] = useState(false);
  const task = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    async function update() {
      if (document.visibilityState !== "visible") return;
      try {
        const value = await readWithdrawable(address, controller.signal);
        if (!controller.signal.aborted) setBalance(value);
      } catch {}
    }
    void update();
    const timer = window.setInterval(update, 10_000);
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
        if (expired || ["done", "refunded", "failed"].includes(result.state)) {
          localStorage.removeItem(fundKey);
          setFundTransfer(null);
          setFinished(true);
        }
        setMessage(expired ? "The quote expired before 1Click received the transfer." : {
          waiting: "Waiting for 1Click to receive the transfer.", seen: "Transfer detected.",
          short: "1Click received less than the quoted amount.", working: "1Click is settling the transfer.",
          done: "Collateral arrived on Hyperliquid.", refunded: "The transfer was refunded to fourfivex.",
          failed: "1Click reported that the transfer failed.",
        }[result.state]);
      } catch {
        if (active) setMessage("Transfer status is temporarily unavailable. Checking again shortly.");
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
        setFinished(true);
        setMessage(record ? "Hyperliquid recorded the withdrawal. Check your Arbitrum wallet for arrival."
          : "The withdrawal expired without a record on Hyperliquid.");
      } catch {}
    }
    void update();
    const timer = window.setInterval(update, 10_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [address, busy, withdrawal, withdrawKey]);

  async function run(work: () => Promise<void>) {
    if (task.current) return;
    task.current = true;
    setBusy(true);
    setFailure("");
    try { await work(); }
    catch (error) { setFailure(error instanceof Error ? error.message : "Could not complete this request."); }
    finally { task.current = false; setBusy(false); }
  }

  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const amount = String(data.get("amount")).trim().replace(",", ".");
    void run(async () => {
      if (funding) {
        const part = parts.find(part => part.assetId === selected) ?? parts[0];
        if (!part) throw new Error("Your fourfivex account has no available balance.");
        setReview(await tradeApi<FundingQuote>(accountId, "fund-quote", { asset: part.assetId, amount: Number(amount) }));
      } else {
        setReview(await tradeApi<WithdrawalQuote>(accountId, "withdraw-quote", { amount, destination: data.get("destination") }));
      }
    });
  }

  function submit() {
    if (!review) return;
    void run(async () => {
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
          if (Date.now() >= review.authorization.deadline) throw new Error("This quote expired. Review a new withdrawal.");
          const signed = await signPayload(accountId, withdrawalPayload(accountId, review.withdrawal, review.authorization));
          if (memory.get().current !== accountId || Date.now() >= review.authorization.deadline) throw new Error("Your account changed or the quote expired. Review a new withdrawal.");
          localStorage.setItem(withdrawKey, JSON.stringify(review.withdrawal));
          setWithdrawal(review.withdrawal);
          try {
            const result = await tradeApi<{ state: string; message?: string }>(accountId, "withdraw-submit", { ticket: review.ticket, signed });
            if (result.state === "rejected") throw new TradeApiError(result.message || "Hyperliquid rejected the withdrawal.", "not_submitted");
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

  function reset() {
    setReview(undefined);
    setFinished(false);
    setFailure("");
    setMessage("");
  }

  return <Sheet label={funding ? "Add trading collateral" : "Withdraw trading collateral"} showTitle busy={busy} onClose={close}>
    <div className="markets-ui trade-review">
      {balance !== undefined && <p className="trade-review-note">Withdrawable balance <strong>{format.format(Number(balance))} USDC</strong></p>}
      {funding && !fromWallet ? <>
        <p>Bridge from another chain or send USDC from an existing Hyperliquid perps balance.</p>
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 font-mono text-sm wrap-anywhere">{address}</span>
          <CopyButton text={address} label="Copy trading address" />
        </div>
        <p className="trade-review-note">Choose Send USDC (Perps Wallet) on Hyperliquid. The first transfer may incur a 1 USDC activation fee.</p>
        <div className="flex flex-wrap gap-2">
          <a className="action action-primary" href={bridge} target="_blank" rel="noopener noreferrer">Bridge with Relay</a>
          {trading.funding && <button type="button" className="action action-secondary" onClick={() => setFromWallet(true)}>Transfer from fourfivex</button>}
          <button type="button" className="action action-secondary" onClick={close}>{returnToReview ? "Back to order" : "Done"}</button>
        </div>
      </> : withdrawal ? <>
        <p>Withdraw {withdrawal.amount} USDC to Arbitrum.</p>
        <p className="trade-review-note wrap-anywhere">{withdrawal.destination}</p>
        <p role="status">{withdrawal.submitted ? "Withdrawal submitted. Checking Hyperliquid for confirmation…" : "Checking whether Hyperliquid received the withdrawal…"}</p>
      </> : finished ? <button type="button" className="action action-primary" onClick={close}>{returnToReview ? "Back to order" : "Done"}</button>
        : review || fundTransfer ? <>
          {review && ("payload" in review
            ? <p>Send up to {review.from} {review.symbol} from fourfivex to receive {review.to} USDC on Hyperliquid.</p>
            : <><p>Withdraw {review.withdrawal.amount} USDC from Hyperliquid to Arbitrum.</p>
              <p className="trade-review-note wrap-anywhere">{review.withdrawal.destination}</p>
              <p className="trade-review-note">Hyperliquid charges a 1 USDC withdrawal fee.</p></>)}
          {review && !fundTransfer && <div className="flex flex-wrap gap-2">
            <button type="button" className="action action-primary" disabled={busy} onClick={submit}>Confirm with passkey</button>
            <button type="button" className="action action-secondary" disabled={busy} onClick={reset}>Edit transfer</button>
          </div>}
        </> : <form className="grid w-full gap-4" onSubmit={prepare}>
          {funding && parts.length > 0 && <div className="grid gap-1 text-sm"><span>From fourfivex</span>
            <Select label="Source balance" pickerTitle="Choose a balance" className="action action-secondary"
              value={selected || parts[0].assetId} onValueChange={setSelected} options={parts.map(part => ({
                value: part.assetId, label: `${part.symbol} · ${part.network}`,
              }))} />
          </div>}
          {funding && parts.length === 0 && <p className="trade-review-note">{status === "loading" ? "Loading fourfivex balances…" : "No fourfivex balance is available to transfer."}</p>}
          {!funding && <label className="grid gap-1 text-sm">Arbitrum wallet address<input name="destination" className="field" required autoComplete="off" spellCheck={false} /></label>}
          <label className="grid gap-1 text-sm">Amount in USDC<input name="amount" className="field" inputMode="decimal" pattern="[0-9]{1,7}([.,][0-9]{1,2})?" required /></label>
          <div className="flex flex-wrap gap-2">
            <button className="action action-primary" type="submit" disabled={busy || (funding && !parts.length)}>Review transfer</button>
            {funding && <button type="button" className="action action-secondary" disabled={busy} onClick={() => setFromWallet(false)}>Use trading address</button>}
          </div>
        </form>}
      {busy && <p role="status">Working…</p>}
      {message && <p role="status">{message}</p>}
      {failure && <p role="alert" className="trade-notice">{failure}</p>}
    </div>
  </Sheet>;
}
