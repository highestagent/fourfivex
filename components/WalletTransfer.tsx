"use client";

import { useEffect, useState, type SubmitEvent } from "react";
import { signPayload } from "@/lib/account/flows";
import type { Holdings } from "@/lib/account/holdings";
import { memory } from "@/lib/account/store";
import { addressProblem, familyOf, networkName } from "@/lib/send/address";
import { displayUnits, withdrawalUnits } from "@/lib/send/amount";
import { fetchTransferAssets, prepareSend, sendStatus, submitSend } from "@/lib/send/api";
import { payloadProblem } from "@/lib/send/guard";
import { sent, useSent } from "@/lib/send/history";
import type { Prepared, SendStatus, TransferAsset } from "@/lib/send/types";
import { when } from "@/lib/format";
import { Select } from "./Select";
import { CopyButton } from "./ui";

const states: Record<SendStatus["state"], string> = {
  waiting: "Waiting for funds",
  seen: "Transfer detected",
  short: "Deposit amount was short",
  working: "Transfer processing",
  done: "Transfer complete",
  refunded: "Funds refunded",
  failed: "Transfer failed",
};

type Transfer = { quote: Prepared; destination: string };

export function WalletTransfer({ mode, accountId, holdings, step, setStep, back }: {
  mode: "add" | "withdraw";
  accountId: string;
  holdings: Holdings | null;
  step: string | null;
  setStep: (step: string | null) => void;
  back: () => void;
}) {
  const deposit = mode === "add";
  const [catalog, setCatalog] = useState<TransferAsset[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [network, setNetwork] = useState("");
  const [asset, setAsset] = useState("");
  const [source, setSource] = useState("");
  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [transfer, setTransfer] = useState<Transfer>();
  const [tracking, setTracking] = useState("");
  const [checkedAt, setCheckedAt] = useState(0);
  const [error, setError] = useState("");
  const history = useSent(accountId);
  const latest = history.find(entry => entry.id === tracking);
  const latestState = latest?.state;
  const pending = history.filter(entry => entry.kind === mode && ["waiting", "seen", "working", "short"].includes(entry.state));
  const tracked = tracking || pending.map(entry => entry.id).join(",");
  const parts = holdings?.parts ?? [];
  const networks = [...new Set(catalog.map(item => item.blockchain))]
    .map(value => ({ value, label: networkName(value) })).sort((a, b) => a.label.localeCompare(b.label));
  const chain = network || (catalog.some(item => item.blockchain === "base") ? "base" : networks[0]?.value);
  const assets = catalog.filter(item => item.blockchain === chain);
  const selected = assets.find(item => item.assetId === asset) ?? assets.find(item => item.symbol === "USDC") ?? assets[0];
  const from = parts.find(part => part.assetId === source) ?? parts[0];

  useEffect(() => {
    let active = true;
    void fetchTransferAssets().then(result => {
      if (active) { setCatalog(result); setLoaded(true); }
    }).catch(() => {
      if (active) { setCatalog([]); setLoaded(true); }
    });
    return () => { active = false; };
  }, [attempt]);

  useEffect(() => {
    if (!tracked || (tracking && latestState && ["done", "refunded", "failed"].includes(latestState))) return;
    let active = true;
    function poll() {
      for (const id of tracked.split(",")) {
        void sendStatus(id).then(status => {
          if (!active) return;
          setCheckedAt(Date.now());
          sent.update(id, { state: status.state, links: status.links });
        }).catch(() => {});
      }
    }
    poll();
    const timer = window.setInterval(poll, 6_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [latestState, tracked, tracking]);

  async function prepare(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step || !selected) return;
    const family = familyOf(selected.blockchain);
    const destination = address.trim();
    const problem = family && addressProblem(family, destination);
    if (problem) { setError(problem); return; }
    const value = amount.trim().replace(",", ".");
    setError("");
    setStep("Getting a quote…");
    try {
      const quote = deposit
        ? await prepareSend({ kind: "add", accountId, payAssetId: selected.assetId, usd: Number(value), refundTo: destination })
        : from && await prepareSend({ kind: "withdraw", accountId, fromAssetId: from.assetId, assetId: selected.assetId, amount: value, address: destination });
      if (memory.get().current !== accountId || !quote) return;
      if (deposit ? quote.leaves.assetId !== selected.assetId
        : quote.leaves.assetId !== from?.assetId || quote.arrives.assetId !== selected.assetId
          || quote.arrives.units !== withdrawalUnits(value, quote.arrives.decimals)) throw new Error("The quote changed. Review a new transfer.");
      setTransfer({ quote, destination });
      if (deposit) {
        const { depositAddress, depositMemo, leaves, arrives, deadline } = quote;
        sent.add({
          id: depositAddress, accountId, kind: "add", state: "waiting", links: [], deadline,
          text: `Added ${displayUnits(arrives.units, arrives.decimals)} ${arrives.symbol}`,
          waitingText: `Adding ${displayUnits(arrives.units, arrives.decimals)} ${arrives.symbol}`,
          deposit: { address: depositAddress, memo: depositMemo, amount: displayUnits(leaves.units, leaves.decimals),
            word: leaves.symbol, symbol: leaves.symbol, networkName: networkName(leaves.network) },
        });
        setTracking(depositAddress);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not get a quote.");
    } finally { setStep(null); }
  }

  async function confirm() {
    if (step || !transfer) return;
    const { quote } = transfer;
    const { depositAddress, leaves, arrives, payload } = quote;
    if (!payload) return;
    setError("");
    setStep("Waiting for your passkey…");
    try {
      if (Date.now() >= Date.parse(quote.deadline)) throw new Error("This quote expired. Review a new withdrawal.");
      const problem = payloadProblem(payload, { accountId, depositAddress, assetId: leaves.assetId, maxUnits: leaves.units });
      if (problem) throw new Error(problem);
      const signed = await signPayload(accountId, payload);
      if (memory.get().current !== accountId) throw new Error("Your account changed. Review the withdrawal again.");
      setStep("Submitting withdrawal…");
      const summary = `${displayUnits(arrives.units, arrives.decimals)} ${arrives.symbol} on ${networkName(arrives.network)}`;
      sent.add({ id: depositAddress, accountId, kind: "withdraw", state: "waiting", deadline: quote.deadline,
        links: [], text: `Withdrew ${summary}`, waitingText: `Withdrawing ${summary}` });
      setTracking(depositAddress);
      const intentHash = await submitSend(depositAddress, signed);
      sent.update(depositAddress, { intentHash });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not submit the withdrawal.");
    } finally { setStep(null); }
  }

  const quote = transfer?.quote;
  const expiredDeposit = deposit && quote && latestState === "waiting" && checkedAt >= Date.parse(quote.deadline);

  return <div className="grid gap-4">
    <h2 className="hidden text-xl font-semibold sm:block">{deposit ? "Add money" : "Withdraw money"}</h2>
    {quote ? <>
      <dl className="rounded-[18px] border border-line bg-surface px-4">
        <div className="detail-row"><dt>{deposit ? "Send exactly" : "From balance"}</dt>
          <dd>{displayUnits(quote.leaves.units, quote.leaves.decimals)} {quote.leaves.symbol} · {networkName(quote.leaves.network)}</dd></div>
        <div className="detail-row"><dt>{deposit ? "Receive in fourfivex" : "Receive"}</dt>
          <dd>{displayUnits(quote.arrives.units, quote.arrives.decimals)} {quote.arrives.symbol}{!deposit && ` · ${networkName(quote.arrives.network)}`}</dd></div>
        {!expiredDeposit && <div className="detail-row"><dt>{deposit ? "Deposit address" : "To address"}</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-mono text-sm wrap-anywhere">{deposit ? quote.depositAddress : transfer.destination}</span>
            {deposit && <CopyButton text={quote.depositAddress} label="Copy deposit address" />}
          </dd></div>}
        {deposit && !expiredDeposit && quote.depositMemo && <div className="detail-row"><dt>Required memo</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-mono text-sm wrap-anywhere">{quote.depositMemo}</span>
            <CopyButton text={quote.depositMemo} label="Copy deposit memo" />
          </dd></div>}
        <div className="detail-row"><dt>{deposit ? "Send by" : "Quote expires"}</dt><dd>{when(quote.deadline)}</dd></div>
      </dl>
      {latest && <p role="status" className="text-sm text-ink-2">
        {expiredDeposit ? "Deposit quote expired." : latest.state === "waiting" && !deposit ? "Checking withdrawal status…" : states[latest.state]}
      </p>}
      {expiredDeposit && <button className="action action-secondary justify-self-start" type="button" onClick={() => { setTransfer(undefined); setTracking(""); }}>Get a new quote</button>}
      {!deposit && !tracking && <div className="flex flex-wrap gap-2">
        <button className="action action-primary" type="button" disabled={Boolean(step)} onClick={() => void confirm()}>Confirm with passkey</button>
        <button className="action action-secondary" type="button" disabled={Boolean(step)} onClick={() => { setTransfer(undefined); setError(""); }}>Edit withdrawal</button>
      </div>}
    </> : !loaded ? <p role="status" className="text-sm text-ink-2">Loading assets…</p>
      : !catalog.length ? <div className="grid justify-items-start gap-2">
        <p role="status" className="text-sm text-ink-2">The asset list is temporarily unavailable.</p>
        <button className="action action-secondary" type="button" onClick={() => { setLoaded(false); setAttempt(value => value + 1); }}>Retry</button>
      </div>
      : !deposit && !from ? <p className="text-sm text-ink-2">{holdings ? "Your fourfivex balance is empty." : "Your fourfivex balance is currently unavailable."}</p>
      : <form className="grid gap-4" onSubmit={prepare}>
        {!deposit && <div className="grid gap-1"><span className="text-sm">From balance</span>
          <Select label="Source balance" pickerTitle="Source balance" className="action action-secondary" value={from?.assetId ?? ""}
            onValueChange={setSource} options={parts.map(part => ({ value: part.assetId, label: `${part.symbol} · ${networkName(part.network)}` }))} />
        </div>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid min-w-0 gap-1"><span className="text-sm">{deposit ? "Sending network" : "Destination network"}</span>
            <Select label={deposit ? "Sending network" : "Destination network"} pickerTitle="Choose a network" className="action action-secondary"
              value={chain ?? ""} onValueChange={value => { setNetwork(value); setAsset(""); setAddress(""); }} options={networks} />
          </div>
          <div className="grid min-w-0 gap-1"><span className="text-sm">{deposit ? "Asset to send" : "Asset to receive"}</span>
            <Select label={deposit ? "Asset to send" : "Asset to receive"} pickerTitle="Choose an asset" className="action action-secondary"
              value={selected?.assetId ?? ""} onValueChange={setAsset} options={assets.map(item => ({ value: item.assetId, label: item.symbol }))} />
          </div>
        </div>
        <label className="grid gap-1 text-sm">{deposit ? "Refund wallet address" : "Destination wallet address"}
          <input className="field" value={address} onChange={event => setAddress(event.target.value)} required autoComplete="off" spellCheck={false} />
        </label>
        <label className="grid gap-1 text-sm">{deposit ? "Amount to receive in USD" : `Amount to receive in ${selected?.symbol ?? ""}`}
          <input className="field" inputMode="decimal" pattern={deposit ? "[0-9]{1,7}([.,][0-9]{1,2})?" : "[0-9]{1,12}([.,][0-9]{1,24})?"}
            value={amount} onChange={event => setAmount(event.target.value)} required />
        </label>
        <button className="action action-primary justify-self-start" type="submit" disabled={Boolean(step) || !selected}>
          {deposit ? "Get deposit address" : "Review withdrawal"}
        </button>
      </form>}
    {!quote && pending.length > 0 && <ul className="grid gap-2 text-sm text-ink-2">{pending.map(entry =>
      <li key={entry.id} className="grid gap-1 rounded-[14px] border border-line p-3">
        <span>{entry.waitingText ?? entry.text} · {entry.state === "waiting" && entry.deposit && entry.deadline && checkedAt >= Date.parse(entry.deadline) ? "Quote expired" : states[entry.state]}</span>
        {entry.state === "waiting" && entry.deposit && entry.deadline && checkedAt > 0 && checkedAt < Date.parse(entry.deadline) && <details>
          <summary className="cursor-pointer">Deposit instructions</summary>
          <p>Send {entry.deposit.amount} {entry.deposit.symbol ?? entry.deposit.word} on {entry.deposit.networkName} by {when(entry.deadline)}.</p>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-mono wrap-anywhere">{entry.deposit.address}</span>
            <CopyButton text={entry.deposit.address} label="Copy deposit address" />
          </div>
          {entry.deposit.memo && <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="wrap-anywhere">Required memo {entry.deposit.memo}</span>
            <CopyButton text={entry.deposit.memo} label="Copy deposit memo" />
          </div>}
        </details>}
      </li>)}</ul>}
    {step && <p role="status" className="text-sm text-ink-2">{step}</p>}
    {error && <p role="alert" className="text-sm text-rose">{error}</p>}
    <button className="action action-secondary hidden justify-self-start sm:inline-flex" type="button" disabled={Boolean(step)} onClick={back}>Back to account</button>
  </div>;
}
