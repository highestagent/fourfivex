"use client";

import Link from "next/link";
import { useId, useRef, useState, type SubmitEvent } from "react";
import type { Holdings } from "@/lib/account/holdings";
import { parseWatchedWallet, walletKey, walletNetworks, type WalletAsset, type WalletNetwork, type WatchedWallet } from "@/lib/account/portfolio";
import { memory } from "@/lib/account/store";
import type { HoldingsState } from "@/lib/account/useHoldings";
import { usePortfolioBalances } from "@/lib/account/usePortfolioBalances";
import { HOLDINGS } from "@/lib/assets";
import { coin, pct } from "@/lib/format";
import { networkName } from "@/lib/send/address";
import { Arrow, Chevron, CopyButton, Plus } from "./ui";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const card = "mt-7 rounded-[24px] border border-line bg-card px-5 py-6 sm:mt-9 sm:px-8 sm:py-8";
const heading = "mt-2 text-[clamp(2rem,7vw,3.65rem)] leading-none font-medium tracking-[-0.065em] tabular-nums";
const row = "flex min-h-11 min-w-0 items-center justify-between gap-3 rounded-lg text-sm";
const disclosure = `${row} w-full list-none cursor-pointer text-left hover:bg-card [&::-webkit-details-marker]:hidden`;
const expandable = "[&[open]>summary_.balance-chevron]:rotate-180";

function summarize(assets: readonly WalletAsset[]) {
  return assets.reduce((sum, { usd }) => sum + (usd ?? 0), 0);
}

function groupByNetwork(holdings: Holdings | null) {
  const groups = new Map<string, (WalletAsset & { id: string })[]>();
  for (const part of holdings?.parts ?? []) {
    const assets = groups.get(part.network) ?? [];
    assets.push({ id: part.assetId, symbol: part.symbol, amount: part.amount, usd: part.unpriced ? null : part.usd });
    groups.set(part.network, assets);
  }
  return [...groups].sort(([, a], [, b]) => summarize(b) - summarize(a));
}

function AssetList({ assets }: { assets: readonly (WalletAsset & { id?: string })[] }) {
  return <ul className="ml-1 border-l border-line pl-3 sm:pl-4">
    {assets.map(asset => <li key={asset.id ?? asset.symbol} className={`${row} border-b border-line px-2 last:border-b-0`}>
      <span className="wrap-anywhere"><span className="tabular-nums">{asset.amount > 0 && asset.amount < 1e-8 ? "<0.00000001" : coin(asset.amount)}</span> {asset.symbol}</span>
      <span className="shrink-0 text-ink-2 tabular-nums">{asset.usd === null ? "Unpriced" : money.format(asset.usd)}</span>
    </li>)}
  </ul>;
}

function WatchedWalletForm({ accountId, wallets }: { accountId: string; wallets: readonly WatchedWallet[] }) {
  const [network, setNetwork] = useState<WalletNetwork>("base");
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const addressId = useId();

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const wallet = parseWatchedWallet({ network, address });
    if (!wallet) return setError(`Enter a valid ${networkName(network)} address.`);
    if (wallets.some(entry => walletKey(entry) === walletKey(wallet))) return setError("You already track this address on this network.");
    memory.watchWallet(accountId, wallet);
    setAddress("");
    setError("");
  }

  return <details className={`${expandable} mt-2 border-t border-line`}>
    <summary className={`${disclosure} justify-start px-2 font-medium text-blue`}><Plus size={15} /> Track a wallet <Chevron size={14} className="balance-chevron ml-auto" /></summary>
    <form onSubmit={submit} className="grid gap-3 px-2 pb-3">
      <p className="text-sm text-ink-2">Track ETH or SOL and USDC by public address. Saved on this device.</p>
      <div className="grid gap-2 sm:grid-cols-[minmax(7rem,auto)_minmax(0,1fr)_auto] sm:items-end">
        <label className="grid gap-1 text-sm font-medium">
          Network
          <select value={network} onChange={event => {
            setNetwork(event.target.value as WalletNetwork);
            setError("");
          }} className="field w-full bg-surface">
            {walletNetworks.map(value => <option key={value} value={value}>{networkName(value)}</option>)}
          </select>
        </label>
        <label className="grid min-w-0 gap-1 text-sm font-medium" htmlFor={addressId}>
          Public address
          <input id={addressId} value={address} onChange={event => { setAddress(event.target.value); setError(""); }} required
            autoComplete="off" autoCapitalize="none" spellCheck={false} aria-invalid={Boolean(error)}
            aria-describedby={error ? `${addressId}-error` : undefined} className="field w-full bg-surface font-mono" />
        </label>
        <button type="submit" className="action action-primary">Track wallet</button>
      </div>
      {error && <p id={`${addressId}-error`} role="alert" className="text-sm text-rose">{error}</p>}
    </form>
  </details>;
}

function SourceAmount({ value, total, color }: { value: number | null; total: number | null; color: string }) {
  return <span className="flex shrink-0 items-center gap-2 tabular-nums">
    {total !== null && value !== null && value > 0 && <span className="flex items-center gap-1.5 text-xs text-ink-2">
      <span aria-hidden="true" className={`size-2 rounded-full ${color}`} />{pct(value / total)}
    </span>}
    <span className="font-semibold">{value === null ? "—" : money.format(value)}</span>
  </span>;
}

export function PortfolioBalance({ accountId, holdings, wallets }: {
  accountId: string; holdings: HoldingsState; wallets: readonly WatchedWallet[];
}) {
  const [expanded, setExpanded] = useState(true);
  const breakdownId = useId();
  const linkedSummary = useRef<HTMLElement>(null);
  const { trading, walletBalances, forgetWalletBalance } = usePortfolioBalances(accountId, wallets);
  const walletStatuses = wallets.map(wallet => ({ wallet, result: walletBalances[walletKey(wallet)] }));
  const networks = groupByNetwork(holdings.holdings);
  const intentsValue = holdings.holdings?.total ?? null;
  const linkedValue = walletStatuses.some(({ result }) => result?.value) || !wallets.length
    ? walletStatuses.reduce((sum, { result }) => sum + summarize(result?.value ?? []), 0) : null;
  const tradingValue = trading?.value?.equity ?? null;
  const waiting = holdings.status === "loading" || !trading || walletStatuses.some(({ result }) => !result);
  const unavailable = holdings.status === "error" || trading?.failed || walletStatuses.some(({ result }) => result?.failed);
  const unpriced = holdings.holdings?.parts.some(part => part.unpriced) ||
    walletStatuses.some(({ result }) => result?.value?.some(asset => asset.usd === null));
  const partial = waiting || unavailable || unpriced;
  const total = intentsValue !== null || (wallets.length > 0 && linkedValue !== null) || tradingValue !== null
    ? (intentsValue ?? 0) + (linkedValue ?? 0) + (tradingValue ?? 0) : null;
  const sources = [
    { label: "NEAR Intents", value: intentsValue ?? 0, color: "bg-blue" },
    { label: "Linked wallets", value: linkedValue ?? 0, color: "bg-ink-2" },
    { label: "Hyperliquid", value: tradingValue ?? 0, color: "bg-ink" },
  ];
  const showAllocation = expanded && !partial && holdings.status !== "stale" && total !== null && total > 0 &&
    sources.every(source => source.value >= 0) && sources.filter(source => source.value > 0).length > 1;
  const allocationTotal = showAllocation ? total : null;

  return <section aria-labelledby="balance-label" className={card}>
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 id="balance-label" className="mono text-ink-2">{total !== null && partial ? "Priced holdings" : "Portfolio value"}</h1>
        <p className={`${heading} wrap-anywhere`}>{total === null ? "—" : money.format(total)}</p>
      </div>
      <button type="button" className="action action-secondary" aria-expanded={expanded} aria-controls={breakdownId}
        onClick={() => setExpanded(open => !open)}>
        {expanded ? "Hide breakdown" : "Show breakdown"}<Chevron className={expanded ? "rotate-180" : ""} />
      </button>
    </div>
    {(partial || holdings.status === "stale") && <p role="status" className="mt-3 text-sm text-ink-2">
      {waiting ? "Checking balances…" : unavailable ? "Some balances are unavailable. Retrying…" :
        holdings.status === "stale" ? "Showing the last known NEAR Intents balance. Retrying…" : "Some assets have no USD price."}
    </p>}

    <div id={breakdownId} hidden={!expanded} className="mt-5">
      {allocationTotal !== null && <div className="mb-4 flex h-1.5 overflow-hidden rounded-full bg-surface" aria-hidden="true">
        {sources.filter(source => source.value > 0).map(source => <span key={source.label} className={source.color}
          style={{ flexGrow: source.value }} />)}
      </div>}
      <div className="divide-y divide-line rounded-2xl border border-line bg-surface px-3 sm:px-4">
        <details open className={`${expandable} py-1.5`}>
          <summary className={`${disclosure} px-2`}>
            <span className="flex min-w-0 items-center gap-2 font-semibold"><Chevron className="balance-chevron shrink-0 text-ink-2" />NEAR Intents</span>
            <SourceAmount value={intentsValue} total={allocationTotal} color="bg-blue" />
          </summary>
          <div className="px-2 pb-2">
            <p className="mb-2 text-sm text-ink-2">Used for payments and swaps. Grouped by token network.</p>
            {!networks.length && <p className="py-2 text-sm text-ink-2">{holdings.holdings ? "No holdings yet." : holdings.status === "error" ? "Balance unavailable." : "Loading holdings…"}</p>}
            {networks.map(([network, assets]) => <details key={network} className={`${expandable} border-t border-line`}>
              <summary className={`${disclosure} px-2`}>
                <span className="flex min-w-0 items-center gap-2"><Chevron size={14} className="balance-chevron shrink-0 text-ink-2" />{networkName(network)}</span>
                <span className="shrink-0 tabular-nums">{assets.some(asset => asset.usd !== null) ? money.format(summarize(assets)) : "Unpriced"}</span>
              </summary>
              <AssetList assets={assets} />
            </details>)}
          </div>
        </details>

        <details open className={`${expandable} py-1.5`}>
          <summary ref={linkedSummary} className={`${disclosure} px-2`}>
            <span className="flex min-w-0 items-center gap-2 font-semibold"><Chevron className="balance-chevron shrink-0 text-ink-2" />Linked wallets</span>
            {wallets.length > 0 && <SourceAmount value={linkedValue} total={allocationTotal} color="bg-ink-2" />}
          </summary>
          <div className="px-2 pb-1">
            {walletStatuses.map(({ wallet, result }) => {
              const network = networkName(wallet.network);
              const shortAddress = `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`;
              return <details key={walletKey(wallet)} className={`${expandable} border-t border-line`}>
                <summary className={`${disclosure} px-2`}>
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2"><Chevron size={14} className="balance-chevron shrink-0 text-ink-2" />
                    <span>{network}</span><span className="font-mono text-xs text-ink-2">{shortAddress}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">{result?.value ? result.value.length > 0 && result.value.every(asset => asset.usd === null)
                    ? "Unpriced" : money.format(summarize(result.value)) : "—"}</span>
                </summary>
                {result?.value?.length ? <AssetList assets={result.value} /> : <p className="px-2 py-1 text-sm text-ink-2">
                  {result?.failed ? "Balance unavailable." : result ? "No supported assets at this address." : "Loading wallet…"}
                </p>}
                <div className="flex flex-wrap gap-x-2 px-2 py-1">
                  <CopyButton text={wallet.address} label={`Copy ${network} address ${shortAddress}`} />
                  <button type="button" className="action action-secondary" aria-label={`Remove ${network} wallet ${shortAddress}`}
                    onClick={() => {
                      forgetWalletBalance(wallet);
                      memory.unwatchWallet(accountId, wallet);
                      linkedSummary.current?.focus();
                    }}>Remove</button>
                </div>
              </details>;
            })}
            <WatchedWalletForm accountId={accountId} wallets={wallets} />
          </div>
        </details>

        {(!trading || trading.failed || trading.value) && <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-2 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">Hyperliquid</p>
            <p className="mt-0.5 text-sm text-ink-2">{trading?.value ? `Perpetuals equity · ${money.format(trading.value.withdrawable)} withdrawable` :
              trading?.failed ? "Trading balance unavailable." : "Checking trading balance…"}</p>
          </div>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-sm">
            <SourceAmount value={tradingValue} total={allocationTotal} color="bg-ink" />
            <Link href="/markets" className="action action-secondary" aria-label="Open Hyperliquid trading in Markets">Markets <Arrow size={14} /></Link>
          </div>
        </div>}
      </div>
    </div>
  </section>;
}

export function DemoBalance({ bitcoinPrice }: { bitcoinPrice: number }) {
  return <section aria-labelledby="balance-label" className={card}>
    <h1 id="balance-label" className="mono text-ink-2">Demo balance</h1>
    <p className={heading}>{money.format(HOLDINGS.usd + HOLDINGS.btc * bitcoinPrice)}</p>
    <p className="mt-3 text-sm text-ink-2">{money.format(HOLDINGS.usd)} in dollars · {HOLDINGS.btc} bitcoin</p>
  </section>;
}
