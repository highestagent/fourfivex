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

const states: Record<SendStatus["state"], string> = {
  waiting: "Checking withdrawal status…",
  seen: "Transfer detected",
  short: "Amount was short",
  working: "Transfer processing",
  done: "Transfer complete",
  refunded: "Funds refunded",
  failed: "Transfer failed",
};

type Transfer = { quote: Prepared; destination: string };

/** Withdraws from the account to an address on another network. */
export function WalletTransfer({ accountId, holdings, step, setStep, back }: {
  accountId: string;
  holdings: Holdings | null;
  step: string | null;
  setStep: (step: string | null) => void;
  back: () => void;
}) {
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
  const [error, setError] = useState("");
  const history = useSent(accountId);
  const latest = history.find(entry => entry.id === tracking);
  const latestState = latest?.state;
  const pending = history.filter(entry => entry.kind === "withdraw" && ["waiting", "seen", "working", "short"].includes(entry.state));
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
          if (active) sent.update(id, { state: status.state, links: status.links });
        }).catch(() => {});
      }
    }
    poll();
    const timer = window.setInterval(poll, 6_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [latestState, tracked, tracking]);

  async function prepare(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step || !selected || !from) return;
    const family = familyOf(selected.blockchain);
    const destination = address.trim();
    const problem = family && addressProblem(family, destination);
    if (problem) { setError(problem); return; }
    const value = amount.trim().replace(",", ".");
    setError("");
    setStep("Getting a quote…");
    try {
      const quote = await prepareSend({ kind: "withdraw", accountId, fromAssetId: from.assetId, assetId: selected.assetId, amount: value, address: destination });
      if (memory.get().current !== accountId) return;
      if (quote.leaves.assetId !== from.assetId || quote.arrives.assetId !== selected.assetId
        || quote.arrives.units !== withdrawalUnits(value, quote.arrives.decimals)) throw new Error("The quote changed. Review a new transfer.");
      setTransfer({ quote, destination });
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

  return <div className="grid gap-4">
    <h2 className="hidden text-xl font-semibold sm:block">Withdraw money</h2>
    {quote ? <>
      <dl className="rounded-[18px] border border-line bg-surface px-4">
        <div className="detail-row"><dt>From balance</dt>
          <dd>{displayUnits(quote.leaves.units, quote.leaves.decimals)} {quote.leaves.symbol} · {networkName(quote.leaves.network)}</dd></div>
        <div className="detail-row"><dt>Receive</dt>
          <dd>{displayUnits(quote.arrives.units, quote.arrives.decimals)} {quote.arrives.symbol} · {networkName(quote.arrives.network)}</dd></div>
        <div className="detail-row"><dt>To address</dt>
          <dd className="font-mono text-sm wrap-anywhere">{transfer.destination}</dd></div>
        <div className="detail-row"><dt>Quote expires</dt><dd>{when(quote.deadline)}</dd></div>
      </dl>
      {latest && <p role="status" className="text-sm text-ink-2">{states[latest.state]}</p>}
      {!tracking && <div className="flex flex-wrap gap-2">
        <button className="action action-primary" type="button" disabled={Boolean(step)} onClick={() => void confirm()}>Confirm with passkey</button>
        <button className="action action-secondary" type="button" disabled={Boolean(step)} onClick={() => { setTransfer(undefined); setError(""); }}>Edit withdrawal</button>
      </div>}
    </> : !loaded ? <p role="status" className="text-sm text-ink-2">Loading assets…</p>
      : !catalog.length ? <div className="grid justify-items-start gap-2">
        <p role="status" className="text-sm text-ink-2">The asset list is temporarily unavailable.</p>
        <button className="action action-secondary" type="button" onClick={() => { setLoaded(false); setAttempt(value => value + 1); }}>Retry</button>
      </div>
      : !from ? <p className="text-sm text-ink-2">{holdings ? "Your fourfivex balance is empty." : "Your fourfivex balance is currently unavailable."}</p>
      : <form className="grid gap-4" onSubmit={prepare}>
        <div className="grid gap-1"><span className="text-sm">From balance</span>
          <Select label="Source balance" pickerTitle="Source balance" className="action action-secondary" value={from.assetId}
            onValueChange={setSource} options={parts.map(part => ({ value: part.assetId, label: `${part.symbol} · ${networkName(part.network)}` }))} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid min-w-0 gap-1"><span className="text-sm">Destination network</span>
            <Select label="Destination network" pickerTitle="Choose a network" className="action action-secondary"
              value={chain ?? ""} onValueChange={value => { setNetwork(value); setAsset(""); setAddress(""); }} options={networks} />
          </div>
          <div className="grid min-w-0 gap-1"><span className="text-sm">Asset to receive</span>
            <Select label="Asset to receive" pickerTitle="Choose an asset" className="action action-secondary"
              value={selected?.assetId ?? ""} onValueChange={setAsset} options={assets.map(item => ({ value: item.assetId, label: item.symbol }))} />
          </div>
        </div>
        <label className="grid gap-1 text-sm">Destination wallet address
          <input className="field" value={address} onChange={event => setAddress(event.target.value)} required autoComplete="off" spellCheck={false} />
        </label>
        <label className="grid gap-1 text-sm">{`Amount to receive in ${selected?.symbol ?? ""}`}
          <input className="field" inputMode="decimal" pattern="[0-9]{1,12}([.,][0-9]{1,24})?"
            value={amount} onChange={event => setAmount(event.target.value)} required />
        </label>
        <button className="action action-primary justify-self-start" type="submit" disabled={Boolean(step) || !selected}>Review withdrawal</button>
      </form>}
    {!quote && pending.length > 0 && <ul className="grid gap-2 text-sm text-ink-2">{pending.map(entry =>
      <li key={entry.id} className="rounded-[14px] border border-line p-3">{entry.waitingText ?? entry.text} · {states[entry.state]}</li>)}</ul>}
    {step && <p role="status" className="text-sm text-ink-2">{step}</p>}
    {error && <p role="alert" className="text-sm text-rose">{error}</p>}
    <button className="action action-secondary hidden justify-self-start sm:inline-flex" type="button" disabled={Boolean(step)} onClick={back}>Back to account</button>
  </div>;
}
