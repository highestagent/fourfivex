"use client";

import { useCallback, useRef, useState } from "react";
import { useDeviceMemory } from "@/lib/account/store";
import { useHoldings } from "@/lib/account/useHoldings";
import { ASSETS, HOLDINGS } from "@/lib/assets";
import { coin, usd } from "@/lib/format";
import { usePrices } from "@/lib/hooks";
import { VERBS, VERB_ORDER, type Standing, type Vals, type VerbKey } from "@/lib/verbs";
import { AccountSheet, short } from "./AccountSheet";
import { Card } from "./Card";
import { Composer, type Signed } from "./Composer";
import { Arrow, Chevron, Dot, Finger, Panel, Pill, Sep, StatusPill } from "./ui";

type View = "now" | "standing" | "said";
type SaidItem = { t: string; d: string };

const SEED: SaidItem[] = [
  { t: "You received 0.0089 bitcoin from Leo.", d: "12 October" },
  { t: "You paid Dad $25.00.", d: "3 October" },
];

const GROUP_NAME = { usd: "dollars", btc: "bitcoin", eth: "ether", sol: "sol" } as const;

function Divider() {
  return (
    <span className="hidden sm:block">
      <Sep />
    </span>
  );
}

/**
 * The whole product is three places, and each is a tense.
 * Now: what you could say. Standing: what is still in force. Said: what you signed.
 *
 * With no account open, everything runs on a demo account with example balances.
 * Opening an account with a passkey replaces that with the real one.
 */
export default function Surface() {
  const { prices, live } = usePrices();
  const device = useDeviceMemory();
  const accountId = device.current;
  const holdings = useHoldings(accountId);
  const [view, setView] = useState<View>("now");
  const [open, setOpen] = useState<{ verb: VerbKey; vals?: Vals; id: number } | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [standing, setStanding] = useState<Standing[]>([]);
  const [said, setSaid] = useState<SaidItem[]>(SEED);
  const opener = useRef<HTMLElement | null>(null);
  const counter = useRef(0);

  const real = accountId !== null;
  const name = accountId ? (device.names[accountId] ?? "My account") : null;
  const demoTotal = HOLDINGS.usd + HOLDINGS.btc * prices.btc;
  const h = holdings.holdings;

  const say = (verb: VerbKey, vals?: Vals) => {
    opener.current = document.activeElement as HTMLElement | null;
    counter.current += 1;
    setOpen({ verb, vals, id: counter.current });
  };
  const close = useCallback(() => {
    setOpen(null);
    opener.current?.focus?.();
  }, []);
  const signed = useCallback((s: Signed) => {
    setSaid((prev) => [{ t: s.past, d: "Just now" }, ...prev]);
    if (s.standing) setStanding((prev) => [s.standing as Standing, ...prev]);
  }, []);
  const showAccount = () => {
    opener.current = document.activeElement as HTMLElement | null;
    setAccountOpen(true);
  };
  const hideAccount = useCallback(() => {
    setAccountOpen(false);
    opener.current?.focus?.();
  }, []);

  const tabs: { key: View; label: string; count?: number }[] = [
    { key: "now", label: "Now" },
    { key: "standing", label: "Standing", count: real ? 0 : standing.length },
    { key: "said", label: "Said" },
  ];
  const pill = "flex-wrap justify-center !gap-x-3 !gap-y-1 !px-4 !py-2 text-[13px]";

  return (
    <div className="mx-auto w-full max-w-[1000px] px-4 pb-16 sm:px-6">
      <header className="flex flex-col items-center gap-5 pb-8 pt-10">
        <p className="mono rounded-full bg-card px-3.5 py-2 text-ink-2">Intuite · say it, see it, sign it</p>

        {real ? (
          <button type="button" onClick={showAccount} className="cursor-pointer rounded-full" aria-label={`${name}’s account. Open account details.`}>
            <Pill className={pill}>
              <span className="flex items-center gap-2">
                <span className="grid size-5 place-items-center rounded-full bg-ink text-[10px] font-semibold uppercase text-white">
                  {(name ?? "?").slice(0, 1)}
                </span>
                <span className="font-medium">{name}</span>
              </span>
              <Divider />
              <span>
                <span className="text-ink-2">You have</span>{" "}
                <span className="font-medium tabular-nums">{h ? usd(h.total) : "…"}</span>
              </span>
              {h &&
                (Object.keys(GROUP_NAME) as (keyof typeof GROUP_NAME)[])
                  .filter((g) => h.groups[g].usd > 0)
                  .map((g) => (
                    <span key={g} className="flex items-center gap-1.5 tabular-nums">
                      <Dot color={ASSETS[g].color} />
                      {g === "usd" ? usd(h.groups[g].amount) : coin(h.groups[g].amount)}{" "}
                      <span className="text-ink-2">{GROUP_NAME[g]}</span>
                    </span>
                  ))}
              <StatusPill tone={holdings.status === "ready" ? "live" : holdings.status === "error" ? "warn" : "muted"}>
                {holdings.status === "ready" ? "Your account" : holdings.status === "error" ? "Unreachable" : "Reading"}
              </StatusPill>
              <Chevron size={14} className="text-ink-3" />
            </Pill>
          </button>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <Pill className={pill}>
              <span className="mono text-ink-3">Demo</span>
              <Divider />
              <span>
                <span className="text-ink-2">You have</span>{" "}
                <span className="font-medium tabular-nums">{usd(demoTotal)}</span>
              </span>
              <Divider />
              <span className="flex items-center gap-1.5 tabular-nums">
                <Dot color={ASSETS.usd.color} />
                {usd(HOLDINGS.usd)} <span className="text-ink-2">dollars</span>
              </span>
              <Divider />
              <span className="flex items-center gap-1.5 tabular-nums">
                <Dot color={ASSETS.btc.color} />
                {HOLDINGS.btc} <span className="text-ink-2">bitcoin</span>
              </span>
              <StatusPill tone={live ? "live" : "muted"}>{live ? "Live prices" : "Example prices"}</StatusPill>
            </Pill>
            <button
              type="button"
              onClick={showAccount}
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full bg-ink px-5 text-[14px] font-medium text-white shadow-pill"
            >
              <Finger size={16} />
              {device.passkeys.length ? "Open your account" : "Open a real account"}
            </button>
          </div>
        )}

        <nav aria-label="Places" className="inline-flex rounded-full bg-card p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setView(t.key)}
              aria-current={view === t.key ? "page" : undefined}
              className={`mono cursor-pointer rounded-full px-4 py-2 transition-colors ${
                view === t.key ? "bg-white text-ink shadow-chip" : "text-ink-3 hover:text-ink-2"
              }`}
            >
              {t.label}
              {t.count ? <span className="ml-1.5 text-blue">{t.count}</span> : null}
            </button>
          ))}
        </nav>
      </header>

      {view === "now" && (
        <main>
          <div className="mb-6 flex justify-center">
            {real ? (
              <button
                type="button"
                onClick={showAccount}
                className="group flex cursor-pointer items-center gap-3 rounded-full bg-white py-1.5 pl-4 pr-1.5 text-[14px] shadow-chip"
              >
                <span className="size-2 rounded-full bg-green-2 text-green-2 animate-pulse-dot" />
                <span>
                  Your account is open
                  <span className="hidden text-ink-2 sm:inline">{accountId ? ` at ${short(accountId)}` : ""}</span>
                </span>
                <span className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-ink px-3.5 text-[13px] font-medium text-white transition-transform group-hover:translate-x-0.5">
                  Add a backup <Arrow size={13} />
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => say("pay", { who: "maya", amt: 40 })}
                className="group flex cursor-pointer items-center gap-3 rounded-full bg-white py-1.5 pl-4 pr-1.5 text-[14px] shadow-chip"
              >
                <span className="size-2 rounded-full bg-blue text-blue animate-pulse-dot" />
                Maya asked you for $40
                <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-ink px-3.5 text-[13px] font-medium text-white transition-transform group-hover:translate-x-0.5">
                  Pay Maya <Arrow size={13} />
                </span>
              </button>
            )}
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            {VERB_ORDER.map((k) => (
              <Card key={k} verb={VERBS[k]} prices={prices} paused={open !== null || accountOpen} onOpen={() => say(k)} />
            ))}
          </div>
        </main>
      )}

      {view === "standing" && (
        <main className="rounded-[28px] bg-card p-5 sm:p-8">
          <p className="mono mb-3 text-ink-3">Still in force</p>
          {real || standing.length === 0 ? (
            <div className="py-10 text-center">
              <h2 className="text-[20px] font-medium tracking-[-0.015em]">Nothing is standing yet.</h2>
              <p className="mx-auto mt-3 max-w-[44ch] text-[14.5px] leading-[1.55] text-ink-2">
                Anything you sign that keeps going lives here until you stop it: money at work, a loan, a request
                waiting to be paid, or a sentence with “every” or “when”.
              </p>
              {!real && (
                <button
                  type="button"
                  onClick={() => say("change", { from: "usd", to: "btc", when: "fri" })}
                  className="mt-6 inline-flex h-10 cursor-pointer items-center gap-2 rounded-full bg-ink px-5 text-[14px] font-medium text-white shadow-pill"
                >
                  Try “every Friday” <Arrow size={13} />
                </button>
              )}
            </div>
          ) : (
            <Panel className="divide-y divide-line/70 px-5">
              {standing.map((s, i) => (
                <div key={`${s.t}-${i}`} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-4">
                  <div className="min-w-0">
                    <p className="text-[16px] font-medium leading-snug tracking-[-0.01em]">{s.t}</p>
                    <p className="mono mt-1.5 text-ink-3">{s.m}</p>
                  </div>
                  <button
                    type="button"
                    className="mono h-8 cursor-pointer rounded-full bg-card px-3.5 hover:bg-ink hover:text-white"
                    onClick={() => {
                      setStanding((prev) => prev.filter((_, j) => j !== i));
                      setSaid((prev) => [{ t: s.ended, d: "Just now" }, ...prev]);
                    }}
                  >
                    {s.stop}
                  </button>
                </div>
              ))}
            </Panel>
          )}
          {!real && standing.length > 0 && (
            <p className="mt-4 text-[13px] text-ink-3">In the product, stopping is itself a sentence you see and sign.</p>
          )}
        </main>
      )}

      {view === "said" && (
        <main className="rounded-[28px] bg-card p-5 sm:p-8">
          <p className="mono mb-3 text-ink-3">What you signed</p>
          {real ? (
            <div className="py-10 text-center">
              <h2 className="text-[20px] font-medium tracking-[-0.015em]">Nothing signed yet.</h2>
              <p className="mx-auto mt-3 max-w-[44ch] text-[14.5px] leading-[1.55] text-ink-2">
                Everything this account signs will be listed here in the past tense. Sentences are not connected to
                real accounts yet.
              </p>
            </div>
          ) : (
            <Panel className="divide-y divide-line/70 px-5">
              {said.map((s, i) => (
                <div key={`${s.t}-${i}`} className="py-4">
                  <p className="text-[16px] font-medium leading-snug tracking-[-0.01em]">{s.t}</p>
                  <p className="mono mt-1.5 text-ink-3">{s.d}</p>
                </div>
              ))}
            </Panel>
          )}
        </main>
      )}

      <footer className="mono mx-auto mt-10 max-w-[70ch] text-center leading-[1.7] text-ink-3">
        {real
          ? "Your account and its balance are real and read from NEAR Intents. Sentences are not connected to it yet, so nothing can be sent."
          : "A demo account with example balances. Prices and quotes are live dry runs from NEAR Intents. Signing is simulated and nothing is ever sent."}
      </footer>

      {open && (
        <Composer
          key={open.id}
          verbKey={open.verb}
          initial={open.vals}
          prices={prices}
          pricesLive={live}
          real={real}
          onClose={close}
          onSigned={signed}
        />
      )}
      {accountOpen && <AccountSheet holdings={holdings} onClose={hideAccount} />}
    </div>
  );
}
