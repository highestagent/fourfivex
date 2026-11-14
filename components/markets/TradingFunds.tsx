"use client";

import { useEffect, useId, useRef, useState, type ReactNode, type SubmitEvent } from "react";
import { ArrowUpRight, CircleCheck, TriangleAlert } from "lucide-react";
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
import { WITHDRAWAL_FEE, withdrawalLimit, withdrawalProblems } from "@/lib/markets/funds";
import { readWithdrawable, readWithdrawal } from "@/lib/markets/trade";

type WithdrawalQuote = { withdrawal: Withdrawal; authorization: TradeAuthorization; ticket: string };
type FundingTransfer = { deposit: string; expires: number };
type PendingWithdrawal = Withdrawal & { submitted?: boolean };
type Method = "relay" | "hyperliquid" | "fourfivex";
type Outcome = { ok: boolean; text: string };

const usdc = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hyperliquidPortfolio = "https://app.hyperliquid.xyz/portfolio";
const amountDraft = /^\d{0,7}([.,]\d{0,2})?$/;

const transferProgress: Record<string, string> = {
  waiting: "Waiting for 1Click to receive your transfer…",
  seen: "1Click received your transfer.",
  short: "1Click received less than the quoted amount.",
  working: "Converting to USDC on Hyperliquid…",
};
const transferOutcome: Record<string, Outcome> = {
  done: { ok: true, text: "Your USDC arrived in your trading account." },
  refunded: { ok: false, text: "The transfer was refunded to your fourfivex balance." },
  failed: { ok: false, text: "1Click couldn't complete the transfer." },
};

function saved<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem(key) ?? "null"); }
  catch { return null; }
}

const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const afterFee = (amount: string | number) => usdc.format(Math.max(0, Number(amount) - WITHDRAWAL_FEE));

function Callout({ tone, role, children }: { tone: "ok" | "warn" | "error"; role?: "status" | "alert"; children: ReactNode }) {
  const Icon = tone === "ok" ? CircleCheck : TriangleAlert;
  return (
    <div className={`funds-callout funds-callout-${tone}`} role={role}>
      <Icon size={16} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

function Steps({ children }: { children: ReactNode[] }) {
  return <ol className="funds-steps">{children.map((step, index) => <li key={index}><span>{step}</span></li>)}</ol>;
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
        const ended = expired ? { ok: false, text: "The quote expired before 1Click received the transfer." } : transferOutcome[result.state];
        if (ended) {
          localStorage.removeItem(fundKey);
          setFundTransfer(null);
          setReview(undefined);
          setOutcome(ended);
          setProgress("");
        } else {
          setProgress(transferProgress[result.state] ?? "Checking your transfer…");
        }
      } catch {
        if (active) setProgress("Transfer status is unavailable right now. Checking again shortly…");
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
          ? { ok: true, text: "Hyperliquid processed your withdrawal. The USDC should reach your Arbitrum wallet within a few minutes." }
          : { ok: false, text: "The withdrawal expired without a record on Hyperliquid, so nothing was withdrawn." });
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
  const methods: { id: Method; title: string; detail: string }[] = [
    { id: "relay", title: "Another wallet or chain", detail: "Bridge from most chains and tokens with Relay." },
    { id: "hyperliquid", title: "A Hyperliquid account", detail: "Send USDC you already hold on Hyperliquid." },
    ...(trading.funding ? [{ id: "fourfivex" as const, title: "Your fourfivex balance", detail: "Convert a balance in this account to USDC." }] : []),
  ];
  const fourfivexBusy = method === "fourfivex" && (fundTransfer || review);

  const fundingView = <>
    {arrived && <Callout tone="ok" role="status"><strong>{usdc.format(received)} USDC arrived.</strong> You can trade now.</Callout>}
    {!fourfivexBusy && !outcome && <fieldset className="funds-methods">
      <legend>Add USDC from</legend>
      {methods.map(option => (
        <label key={option.id} className="funds-method">
          <input type="radio" name={`${ids}-method`} value={option.id} checked={method === option.id} onChange={() => {
            setMethod(option.id);
            setFailure("");
          }} />
          <span>
            <strong>{option.title}</strong>
            <span>{option.detail}</span>
          </span>
        </label>
      ))}
    </fieldset>}
    {method === "relay" && <div className="funds-panel">
      <Steps>{[
        "Open Relay and connect the wallet you’re paying from.",
        <>Choose a token and amount. Relay already has your trading address, <code className="funds-mono">{shortAddress(address)}</code>, as the recipient.</>,
        "Confirm in your wallet. Funds usually arrive within a few minutes.",
      ]}</Steps>
      <div className="funds-actions">
        {!arrived && <OutLink primary href={bridge}>Open Relay</OutLink>}
        {doneButton}
      </div>
    </div>}
    {method === "hyperliquid" && <div className="funds-panel">
      <Steps>{[
        "On Hyperliquid, open Portfolio and choose Send.",
        "Pick USDC from your Perps balance, not Spot.",
        "Paste your trading address below and confirm.",
      ]}</Steps>
      <div className="funds-address">
        <span id={`${ids}-address`} className="funds-address-label">Your trading address</span>
        <div className="funds-address-row">
          <code aria-labelledby={`${ids}-address`} className="funds-mono select-text">{address}</code>
          <CopyButton text={address} label="Copy trading address" />
        </div>
      </div>
      <Callout tone="warn">
        Send only on Hyperliquid. USDC sent to this address on Arbitrum, Ethereum or any other network won&rsquo;t reach your trading account.
      </Callout>
      <p className="funds-note">Hyperliquid may charge 1 USDC for the first transfer to a new address.</p>
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
            <div><dt>You receive</dt><dd><strong>{review.to} USDC</strong></dd></div>
            <div><dt>Arrives in</dt><dd>Your trading account</dd></div>
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
          </div> : <p className="funds-note">{status === "loading" ? "Loading your fourfivex balances…" : "Your fourfivex account has no balance to convert."}</p>}
          <div className="funds-field">
            <label htmlFor={`${ids}-fund-amount`}>USDC to receive</label>
            <input id={`${ids}-fund-amount`} name="amount" className="field" inputMode="decimal" autoComplete="off" placeholder="0.00"
              pattern="[0-9]{1,7}([.,][0-9]{1,2})?" required />
          </div>
          <div className="funds-actions">
            <button className="action action-primary" type="submit" disabled={busy || !parts.length}>Review transfer</button>
            {doneButton}
          </div>
        </form>}
    </div>}
    {!arrived && method !== "fourfivex" && <p className="funds-waiting" role="status">Waiting for your deposit. This updates on its own.</p>}
  </>;

  const withdrawView = withdrawal ? <div className="funds-panel">
    <dl className="trade-review-details">
      <div><dt>Withdrawing</dt><dd>{usdc.format(Number(withdrawal.amount))} USDC</dd></div>
      <div><dt>You receive</dt><dd>{afterFee(withdrawal.amount)} USDC</dd></div>
      <div><dt>Network</dt><dd>Arbitrum One</dd></div>
      <div><dt>To</dt><dd className="funds-mono funds-break">{withdrawal.destination}</dd></div>
    </dl>
    <p className="funds-waiting" role="status">
      {withdrawal.submitted ? "Submitted. Waiting for Hyperliquid to process it…" : "Checking whether Hyperliquid received your withdrawal…"}
    </p>
  </div>
    : outcome ? <div className="funds-panel">
      <Callout tone={outcome.ok ? "ok" : "warn"} role="status">{outcome.text}</Callout>
      <div className="funds-actions">{doneButton}</div>
    </div>
    : review && !("payload" in review) ? <div className="funds-panel">
      <dl className="trade-review-details">
        <div><dt>Withdraw</dt><dd>{usdc.format(Number(review.withdrawal.amount))} USDC</dd></div>
        <div><dt>Hyperliquid fee</dt><dd>{usdc.format(WITHDRAWAL_FEE)} USDC</dd></div>
        <div><dt>You receive</dt><dd><strong>{afterFee(review.withdrawal.amount)} USDC</strong></dd></div>
        <div><dt>Network</dt><dd>Arbitrum One</dd></div>
        <div><dt>To</dt><dd className="funds-mono funds-break">{review.withdrawal.destination}</dd></div>
      </dl>
      <p className="funds-note">Check the address. A withdrawal can&rsquo;t be reversed once it&rsquo;s sent.</p>
      <div className="funds-actions">
        <button type="button" className="action action-primary" disabled={busy} onClick={submit}>Confirm with passkey</button>
        <button type="button" className="action action-secondary" disabled={busy} onClick={edit}>Edit</button>
      </div>
    </div>
    : <form className="funds-form" noValidate onSubmit={prepareWithdrawal}>
      {!canWithdraw && <p className="funds-note">You need more than 1 USDC available to withdraw.</p>}
      <div className="funds-field">
        <label htmlFor={`${ids}-amount`}>Amount</label>
        <div className="funds-input">
          <input id={`${ids}-amount`} name="amount" inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount}
            aria-invalid={Boolean(fieldErrors.amount)} aria-describedby={`${ids}-amount-help`}
            onChange={event => {
              if (!amountDraft.test(event.target.value)) return;
              setAmount(event.target.value);
              setFieldErrors(errors => ({ ...errors, amount: undefined }));
            }} />
          <span aria-hidden="true">USDC</span>
          <button type="button" className="funds-max" disabled={!maxWithdrawal || !canWithdraw} onClick={() => {
            if (!maxWithdrawal) return;
            setAmount(maxWithdrawal.toFixed(2));
            setFieldErrors(errors => ({ ...errors, amount: undefined }));
          }}>Max</button>
        </div>
        <p id={`${ids}-amount-help`} className={fieldErrors.amount ? "funds-error" : "funds-note"}>
          {fieldErrors.amount ?? (Number(amount.replace(",", ".")) > WITHDRAWAL_FEE
            ? `You receive ${afterFee(amount.replace(",", "."))} USDC after Hyperliquid's 1 USDC fee.`
            : "Hyperliquid keeps 1 USDC of every withdrawal as a fee.")}
        </p>
      </div>
      <div className="funds-field">
        <label htmlFor={`${ids}-destination`}>Arbitrum address</label>
        <input id={`${ids}-destination`} name="destination" className="field funds-mono" placeholder="0x…" value={destination}
          autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
          aria-invalid={Boolean(fieldErrors.destination)} aria-describedby={`${ids}-destination-help`}
          onChange={event => {
            setDestination(event.target.value);
            setFieldErrors(errors => ({ ...errors, destination: undefined }));
          }} />
        <p id={`${ids}-destination-help`} className={fieldErrors.destination ? "funds-error" : "funds-note"}>
          {fieldErrors.destination ?? "A wallet you control on Arbitrum One. Withdrawals can't be reversed."}
        </p>
      </div>
      <div className="funds-actions">
        <button type="submit" className="action action-primary" disabled={busy || !canWithdraw}>Review withdrawal</button>
        <button type="button" className="action action-secondary" disabled={busy} onClick={close}>Cancel</button>
      </div>
    </form>;

  return <Sheet label={funding ? "Add funds" : "Withdraw"} showTitle busy={busy} onClose={close}>
    <div className="markets-ui funds">
      <p className="funds-lead">
        {funding ? "Trades use USDC in your trading account on Hyperliquid." : "Move USDC from your trading account to a wallet on Arbitrum."}
      </p>
      <div className="funds-balance">
        <span>{funding ? "Available to trade" : "Available to withdraw"}</span>
        <strong>
          {balance !== undefined ? `${usdc.format(Number(balance))} USDC`
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
