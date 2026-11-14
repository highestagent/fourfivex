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
import styles from "./PortfolioBalance.module.css";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const card = "mt-7 rounded-[24px] border border-line bg-card sm:mt-9";
const inset = "px-5 sm:px-8";
const heading = "mt-2 text-[clamp(2rem,7vw,3.65rem)] leading-none font-medium tracking-[-0.065em] tabular-nums";
const row = "flex min-w-0 items-center gap-3 rounded-lg text-sm";
const disclosure = `${row} min-h-11 w-full list-none cursor-pointer text-left hover:text-blue focus-visible:outline-offset-[-2px] [&::-webkit-details-marker]:hidden`;
const balanceRow = `${disclosure} justify-between`;
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
  return <ul className="mb-2 ml-1.5 border-l border-line pl-3 sm:pl-4">
    {assets.map(asset => <li key={asset.id ?? asset.symbol} className={`${row} min-h-8 justify-between`}>
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

  return <details className={`${expandable} w-full`}>
    <summary className={`${disclosure} gap-2 font-medium text-blue`}><Plus size={15} /> Track a wallet</summary>
    <form onSubmit={submit} className="grid gap-3 pb-3">
      <p className="text-sm text-ink-2">Tracks ETH, SOL, and USDC. Addresses stay on this device.</p>
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
  const [expanded, setExpanded] = useState(false);
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
  const showAllocation = !partial && holdings.status !== "stale" && total !== null && total > 0 &&
    sources.every(source => source.value >= 0) && sources.filter(source => source.value > 0).length > 1;
  const allocationTotal = showAllocation ? total : null;
  const status = waiting ? "Checking balances…" : unavailable ? "Some balances are unavailable. Retrying…" :
    holdings.status === "stale" ? "Showing the last known NEAR Intents balance. Retrying…" : unpriced ? "Some assets have no USD price." : "";

  return <section aria-labelledby="balance-label" className={`${card} ${styles.card}`}>
    <h1>
      <button type="button" aria-expanded={expanded} aria-controls={breakdownId}
        className={`${inset} group flex w-full cursor-pointer items-center justify-between gap-3 rounded-[23px] py-6 text-left focus-visible:outline-offset-[-3px] sm:py-8`}
        onClick={() => setExpanded(open => !open)}>
        <span className="min-w-0">
          <span id="balance-label" className="mono block text-ink-2">{total !== null && partial ? "Priced holdings" : "Portfolio value"}</span>
          <span className={`${heading} block wrap-anywhere`}>{total === null ? "—" : money.format(total)}</span>
          {status && <span className="mt-3 block text-sm text-ink-2" aria-hidden="true">{status}</span>}
        </span>
        <Chevron size={22} className="balance-chevron shrink-0 text-ink-2 group-hover:text-blue group-aria-expanded:rotate-180" />
      </button>
    </h1>
    <p role="status" className="sr-only">{status}</p>

    <div id={breakdownId} inert={!expanded} data-expanded={expanded} className={styles.panel}>
      <div className="min-h-0 overflow-clip">
        <div className={`${inset} border-t border-line pt-2 pb-4 sm:pb-6`}>
          {allocationTotal !== null && <div className="mt-2 mb-1 flex h-1 overflow-hidden rounded-full" aria-hidden="true">
            {sources.filter(source => source.value > 0).map(source => <span key={source.label} className={source.color}
              style={{ flexGrow: source.value }} />)}
          </div>}
          <div className="divide-y divide-line">
            <details open className={`${expandable} py-1.5`}>
              <summary className={balanceRow}>
                <span className="flex min-w-0 items-center gap-2 font-semibold"><Chevron className="balance-chevron shrink-0 text-ink-2" />NEAR Intents</span>
                <SourceAmount value={intentsValue} total={allocationTotal} color="bg-blue" />
              </summary>
              <div className="pl-6">
                {!networks.length && <p className="pb-2 text-sm text-ink-2">{holdings.holdings ? "No holdings yet." : holdings.status === "error" ? "Balance unavailable." : "Loading holdings…"}</p>}
                {networks.map(([network, assets]) => <details key={network} className={expandable}>
                  <summary className={`${balanceRow} text-ink-2`}>
                    <span className="flex min-w-0 items-center gap-2"><Chevron size={14} className="balance-chevron shrink-0 text-ink-2" />{networkName(network)}</span>
                    <span className="shrink-0 tabular-nums">{assets.some(asset => asset.usd !== null) ? money.format(summarize(assets)) : "Unpriced"}</span>
                  </summary>
                  <AssetList assets={assets} />
                </details>)}
              </div>
            </details>

            <details open className={`${expandable} py-1.5`}>
              <summary ref={linkedSummary} className={balanceRow}>
                <span className="flex min-w-0 items-center gap-2 font-semibold"><Chevron className="balance-chevron shrink-0 text-ink-2" />Linked wallets</span>
                {wallets.length > 0 && <SourceAmount value={linkedValue} total={allocationTotal} color="bg-ink-2" />}
              </summary>
              <div className="pl-6">
                {walletStatuses.map(({ wallet, result }) => {
                  const network = networkName(wallet.network);
                  const shortAddress = `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`;
                  return <details key={walletKey(wallet)} className={expandable}>
                    <summary className={`${balanceRow} text-ink-2`}>
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

            {(!trading || trading.failed || trading.value) && <Link href="/markets"
              className="group flex min-h-11 min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg py-3 text-sm hover:text-blue">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-semibold"><Arrow size={16} className="text-ink-2 group-hover:text-blue" />Hyperliquid</p>
                <p className="mt-1 pl-6 text-xs text-ink-2">{trading?.value ? `${money.format(trading.value.withdrawable)} withdrawable` :
                  trading?.failed ? "Balance unavailable" : "Checking balance…"}</p>
              </div>
              <SourceAmount value={tradingValue} total={allocationTotal} color="bg-ink" />
            </Link>}
          </div>
        </div>
      </div>
    </div>
  </section>;
}

export function DemoBalance({ bitcoinPrice }: { bitcoinPrice: number }) {
  return <section aria-labelledby="balance-label" className={`${card} ${inset} py-6 sm:py-8`}>
    <h1 id="balance-label" className="mono text-ink-2">Demo balance</h1>
    <p className={heading}>{money.format(HOLDINGS.usd + HOLDINGS.btc * bitcoinPrice)}</p>
    <p className="mt-3 text-sm text-ink-2">{money.format(HOLDINGS.usd)} in dollars · {HOLDINGS.btc} bitcoin</p>
  </section>;
}
