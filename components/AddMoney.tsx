"use client";

import { useEffect, useState } from "react";
import {
  DEPOSIT_NETWORKS, depositAddress, depositAmount, leadingSymbols, rememberAddress, rememberedAddress, supportedTokens, type DepositNetworkId,
} from "@/lib/account/deposits";
import { useDeposits } from "@/lib/account/useDeposits";
import { coin } from "@/lib/format";
import { Address } from "./Address";
import { QrCode } from "./QrCode";
import { CopyButton } from "./ui";

type Tokens = Awaited<ReturnType<typeof supportedTokens>>;
const RECENT = 30 * 60_000;
const RETRY = 15_000;
type Lookup = { address?: string; checked: boolean; failed: boolean };

/** One lasting address per network. Whatever arrives there shows up below and in the balance. */
export function AddMoney({ accountId, onDone }: { accountId: string; onDone: () => void }) {
  const [network, setNetwork] = useState<DepositNetworkId>("evm");
  // Each network starts from the address this device last saw for it, then checks with the bridge.
  const [lookups, setLookups] = useState<Partial<Record<DepositNetworkId, Lookup>>>(() => Object.fromEntries(DEPOSIT_NETWORKS.map(option =>
    [option.id, { address: rememberedAddress(accountId, option.chain), checked: false, failed: false }])));
  const [attempt, setAttempt] = useState(0);
  const [tokens, setTokens] = useState<Tokens>();
  const [openedAt] = useState(() => Date.now());
  const { deposits } = useDeposits(accountId, 10_000);
  const selected = DEPOSIT_NETWORKS.find(option => option.id === network) ?? DEPOSIT_NETWORKS[0];
  const lookup = lookups[network] ?? { checked: false, failed: false };
  const address = lookup.address;
  const unreachable = lookup.failed && !address;

  useEffect(() => {
    if (lookup.checked) return;
    const controller = new AbortController();
    let retry: number | undefined;
    depositAddress(accountId, selected.chain, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      rememberAddress(accountId, selected.chain, value);
      setLookups(previous => ({ ...previous, [network]: { address: value, checked: true, failed: false } }));
    }, () => {
      if (controller.signal.aborted) return;
      setLookups(previous => ({ ...previous, [network]: { ...previous[network], checked: false, failed: true } }));
      // The bridge was unreachable. Keep asking while this screen is open, so the address appears once it's back.
      retry = window.setTimeout(() => setAttempt(value => value + 1), RETRY);
    });
    return () => { controller.abort(); window.clearTimeout(retry); };
  }, [accountId, lookup.checked, network, selected.chain, attempt]);

  useEffect(() => {
    let active = true;
    supportedTokens().then(list => { if (active) setTokens(list); }, () => {});
    return () => { active = false; };
  }, []);

  const accepted = tokens ? leadingSymbols(tokens, selected) : undefined;
  const bitcoinMinimum = network === "btc" ? [...(tokens?.values() ?? [])].find(token => token.symbol === "BTC")?.min : undefined;
  const incoming = deposits.filter(deposit => deposit.status === "pending" || (deposit.at ?? 0) >= openedAt - RECENT);

  return (
    <div className="grid gap-5 pt-2">
      <div className="grid grid-cols-4 gap-1 rounded-full border border-line p-1" aria-label="Network" role="group">
        {DEPOSIT_NETWORKS.map(option => (
          <button key={option.id} type="button" aria-pressed={network === option.id} onClick={() => setNetwork(option.id)}
            className={`mono min-h-10 cursor-pointer rounded-full px-1 ${network === option.id ? "bg-surface font-semibold text-ink shadow-chip" : "text-ink-2 hover:text-ink"}`}>
            {option.label}
          </button>
        ))}
      </div>

      <div className={`grid gap-4 rounded-[18px] border border-line bg-surface p-5 ${unreachable ? "" : "sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center"}`}>
        {address ? <QrCode value={address} label={`QR code for your ${selected.label} address`} />
          : !unreachable && <span aria-hidden="true" className="size-36 animate-pulse rounded-xl bg-card motion-reduce:animate-none" />}
        <div className="grid min-w-0 gap-3">
          <span className="mono text-ink-2">Your {selected.label} address</span>
          {address ? <div className="flex min-w-0 items-center gap-3">
            <Address value={address} className="flex-1 text-[15px]" />
            <CopyButton text={address} label={`Copy ${selected.label} address`} />
          </div> : unreachable ? <div className="flex flex-wrap items-center gap-3 text-sm text-ink-2">
            <span role="status">Deposits are unreachable right now. Retrying…</span>
            <button type="button" className="action action-secondary" onClick={() => setAttempt(value => value + 1)}>Try now</button>
          </div> : <span className="h-12 animate-pulse rounded-lg bg-card motion-reduce:animate-none" aria-label="Loading address" />}
        </div>
      </div>

      <div className="grid gap-1 text-sm text-ink-2">
        {selected.detail && <p>{selected.detail}</p>}
        {lookup.failed && address && <p className="text-amber">Deposits may take longer than usual to show.</p>}
        {accepted && accepted.symbols.length > 0 && <p>
          {accepted.symbols.join(", ")}{accepted.more && " and more"} · {bitcoinMinimum ? `min ${coin(bitcoinMinimum)}` : "any amount"}
        </p>}
      </div>

      {incoming.length ? (
        <ul className="divide-y divide-line rounded-[18px] border border-line" aria-live="polite">
          {incoming.map(deposit => (
            <li key={deposit.id} className="flex items-center justify-between gap-3 p-4 text-sm">
              <span className="font-medium tabular-nums">{depositAmount(deposit)}</span>
              <span className={deposit.status === "done" ? "text-green" : deposit.status === "failed" ? "text-rose" : "text-ink-2"}>
                {deposit.status === "done" ? "Added" : deposit.status === "failed" ? "Failed" : "Arriving…"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p role="status" className="flex items-center gap-2 text-sm text-ink-2">
          <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-green motion-reduce:animate-none" />
          Waiting for deposits…
        </p>
      )}

      <div><button type="button" className="action action-primary" onClick={onDone}>Done</button></div>
    </div>
  );
}
