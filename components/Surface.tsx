"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { useDeviceMemory } from "@/lib/account/store";
import { useHoldings } from "@/lib/account/useHoldings";
import { when } from "@/lib/format";
import { usePrices } from "@/lib/hooks";
import { sendStatus } from "@/lib/send/api";
import { describePosition, type TradingEvent } from "@/lib/markets/activity";
import { useTradingActivity } from "@/lib/markets/useTradingActivity";
import { sent, useSent, type SentEntry } from "@/lib/send/history";
import { usePeople } from "@/lib/send/people";
import { AccountButton } from "./AccountButton";
import { AccountSheet } from "./AccountSheet";
import { AppNavigation } from "./AppNavigation";
import { Composer, type ActionKey } from "./Composer";
import { DemoBalance, PortfolioBalance } from "./PortfolioBalance";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { Arrow, CopyButton, Plus } from "./ui";

const VIEWS = [
  { key: "now", label: "Now" },
  { key: "standing", label: "Standing" },
  { key: "said", label: "Said" },
] as const;

const ACTIONS = [
  { key: "pay", label: "Pay someone", description: "Send dollars to anyone.", mark: "↗" },
  { key: "getpaid", label: "Add money", description: "From another wallet.", mark: "+" },
  { key: "change", label: "Change currency", description: "Swap what you hold.", mark: "⇄" },
] as const;

const PREVIEWS = [
  { label: "Grow", description: "Earn on idle money.", mark: "↗" },
  { label: "Borrow", description: "Borrow against bitcoin.", mark: "−" },
  { label: "Ask privately", description: "Ask in private.", mark: "?" },
] as const;

const CARD = "grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] content-start items-center gap-x-3 rounded-[18px] border border-line p-4 text-left sm:grid-cols-[1fr_auto] sm:items-start sm:gap-y-4 sm:p-5";
const CARD_MARK = "grid size-9 place-items-center rounded-full text-lg font-medium sm:col-start-1";

const NO_WALLETS = [] as const;
const STATE_LABEL: Record<SentEntry["state"], string> = {
  done: "Complete",
  waiting: "Pending",
  seen: "Processing",
  working: "Processing",
  refunded: "Refunded",
  failed: "Failed",
  short: "Deposit short",
};

type View = (typeof VIEWS)[number]["key"];
type Overlay = ActionKey | "account" | null;

function isPending(entry: SentEntry): boolean {
  return entry.state === "waiting" || entry.state === "seen" || entry.state === "working" || entry.state === "short";
}

function isExpired(entry: SentEntry, now: number | null): boolean {
  return entry.kind === "add" && entry.state === "waiting" && !!entry.deadline && now !== null && now >= Date.parse(entry.deadline);
}

function Deposit({ entry }: { entry: SentEntry }) {
  const deposit = entry.deposit;
  const status = entry.state === "waiting" && entry.deadline
    ? `Send by ${when(entry.deadline)}`
    : STATE_LABEL[entry.state];

  return (
    <li className="p-5 sm:p-6">
      <p className="font-medium">{entry.waitingText ?? entry.text}</p>
      <p className="mt-1 text-sm text-ink-2">{status}</p>
      {deposit && (
        <dl className="mt-4 border-t border-line">
          <div className="detail-row">
            <dt>Send exactly</dt>
            <dd>{deposit.amount} {deposit.symbol ?? deposit.word} on {deposit.networkName}</dd>
          </div>
          <div className="detail-row">
            <dt>Address</dt>
            <dd className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="min-w-0 font-mono text-[13px] wrap-anywhere select-text">{deposit.address}</span>
              <CopyButton text={deposit.address} label="Copy deposit address" />
            </dd>
          </div>
          {deposit.memo && (
            <div className="detail-row">
              <dt>Required memo</dt>
              <dd className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="min-w-0 font-mono text-[13px] wrap-anywhere select-text">{deposit.memo}</span>
                <CopyButton text={deposit.memo} label="Copy memo" />
              </dd>
            </div>
          )}
        </dl>
      )}
    </li>
  );
}

export default function Surface() {
  const { prices, live } = usePrices();
  const device = useDeviceMemory();
  const accountId = device.current;
  const history = useSent(accountId);
  const settled = history.filter((entry) => entry.state === "done" || entry.state === "refunded").length;
  const holdings = useHoldings(accountId, settled);
  const people = usePeople();
  const [view, setView] = useState<View>("now");
  const [overlay, setOverlay] = useState<Overlay>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const [now, setNow] = useState<number | null>(null);

  const trading = useTradingActivity(accountId, view === "said");
  const activity: ({ at: number } & ({ entry: SentEntry } | { event: TradingEvent }))[] = [
    ...history.map((entry) => ({ at: entry.at, entry })),
    ...trading.events.map((event) => ({ at: event.at, event })),
  ].sort((a, b) => b.at - a.at);

  const pending = history.filter(isPending);
  const deposits = pending.filter((entry) => entry.kind === "add" && !isExpired(entry, now));
  const standing = deposits.length + trading.positions.length;
  const watch = pending.map(({ id }) => id).join(",");
  useEffect(() => {
    if (!watch) return;
    let active = true;
    const poll = () => {
      setNow(Date.now());
      for (const id of watch.split(",")) {
        sendStatus(id).then((status) => {
          if (active) sent.update(id, { state: status.state, links: status.links });
        }).catch(() => {});
      }
    };
    const first = setTimeout(poll, 0);
    const interval = setInterval(poll, 5_000);
    return () => {
      active = false;
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [watch]);

  const open = (next: Overlay, event: MouseEvent<HTMLButtonElement>) => {
    opener.current = event.currentTarget;
    setOverlay(next);
  };
  const close = useCallback(() => {
    setOverlay(null);
    requestAnimationFrame(() => opener.current?.focus());
  }, []);

  return (
    <div className="min-h-dvh bg-page pb-12 sm:pb-20">
      <header className="border-b border-line">
        <div className="shell flex min-h-14 flex-wrap items-center justify-between gap-x-2 sm:min-h-[60px]">
          <AppNavigation onWalletNavigate={() => setView("now")} />
          <AccountButton onClick={(event) => open("account", event)} />
        </div>
      </header>

      <main className="shell pt-6 sm:pt-9">
        <nav aria-label="Wallet views" className="grid grid-cols-3 gap-1 rounded-full bg-card p-1 sm:inline-grid">
          {VIEWS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              aria-pressed={view === key}
              onClick={() => setView(key)}
              className={`mono min-h-11 cursor-pointer rounded-full px-4 sm:px-6 ${view === key ? "bg-surface font-semibold text-ink shadow-chip" : "text-ink-2 hover:text-ink"}`}
            >
              {label}{key === "standing" && standing > 0 && <span className="ml-1.5 text-blue">{standing}</span>}
            </button>
          ))}
        </nav>

        {view === "now" && (
          <>
            {accountId
              ? <PortfolioBalance key={accountId} accountId={accountId} holdings={holdings} wallets={device.wallets[accountId] ?? NO_WALLETS} />
              : <DemoBalance bitcoinPrice={prices.btc} />}

            <div className="mt-5 grid gap-3 sm:mt-6 sm:grid-cols-3" aria-label="Money actions">
              {ACTIONS.map(({ key, label, description, mark }) => (
                <button
                  key={key}
                  type="button"
                  onClick={(event) => open(key, event)}
                  className={`group ${CARD} cursor-pointer hover:bg-card`}
                >
                  <span aria-hidden="true" className={`${CARD_MARK} bg-blue-4 text-blue`}>
                    {key === "getpaid" ? <Plus size={17} /> : mark}
                  </span>
                  <CardCopy label={label} description={description} />
                  <Arrow size={16} className="text-ink-2 group-hover:text-blue sm:col-start-2 sm:row-start-1 sm:self-center" />
                </button>
              ))}
              <Link href="/markets" className={`group ${CARD} hover:bg-card`}>
                <span aria-hidden="true" className={`${CARD_MARK} bg-blue-4 text-blue`}>⌁</span>
                <CardCopy label="Markets" description="Charts, trading and rooms." />
                <Arrow size={16} className="text-ink-2 group-hover:text-blue sm:col-start-2 sm:row-start-1 sm:self-center" />
              </Link>
              {PREVIEWS.map(({ label, description, mark }) => (
                <article key={label} className={CARD} aria-label={label}>
                  <span aria-hidden="true" className={`${CARD_MARK} bg-card text-ink-2`}>{mark}</span>
                  <CardCopy label={label} description={description} />
                  <span className="mono text-ink-2 sm:col-start-2 sm:row-start-1 sm:self-center">Unavailable</span>
                </article>
              ))}
            </div>
          </>
        )}

        {view === "standing" && (
          <section className="mt-8 sm:mt-11">
            <h1 className="sr-only">Standing</h1>
            {trading.positions.length > 0 && (
              <>
                <h2 className="mb-5 text-[30px] font-medium tracking-[-0.04em]">Open positions</h2>
                <ul className="mb-10 divide-y divide-line rounded-[18px] border border-line">
                  {trading.positions.map((position) => {
                    const { text, detail } = describePosition(position);
                    return (
                      <li key={position.coin} className="p-5 sm:p-6">
                        <p className="font-medium">{text}</p>
                        <p className="mt-1 text-sm text-ink-2 tabular-nums">{detail}</p>
                        <Link href="/markets" className="mt-3 inline-block text-sm text-blue underline underline-offset-2">Manage</Link>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            <h2 className="mb-5 text-[30px] font-medium tracking-[-0.04em]">Pending deposits</h2>
            {deposits.length ? (
              <ul className="divide-y divide-line rounded-[18px] border border-line">
                {deposits.map((entry) => <Deposit key={entry.id} entry={entry} />)}
              </ul>
            ) : (
              <p className="rounded-[18px] bg-card p-5 text-sm text-ink-2">No pending deposits.</p>
            )}
          </section>
        )}

        {view === "said" && (
          <section className="mt-8 sm:mt-11">
            <h1 className="mb-5 text-[30px] font-medium tracking-[-0.04em]">Activity</h1>
            {trading.historyFailed && <p role="status" className="mb-4 text-sm text-ink-2">Trading history unavailable. Retrying…</p>}
            {activity.length ? (
              <ul className="divide-y divide-line rounded-[18px] border border-line">
                {activity.map((item) => "entry" in item ? (
                  <li key={item.entry.id} className="p-5">
                    <p className="font-medium">{item.entry.state === "done" ? item.entry.text : item.entry.waitingText ?? item.entry.text}</p>
                    <p className="mt-1.5 text-sm text-ink-2">
                      {when(item.entry.at)} · {isExpired(item.entry, now) ? "Expired" : STATE_LABEL[item.entry.state]}
                    </p>
                    {item.entry.links[0] && (
                      <a href={item.entry.links[0].url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-blue underline underline-offset-2">View transaction</a>
                    )}
                  </li>
                ) : (
                  <li key={item.event.id} className="p-5">
                    <p className="font-medium">{item.event.text}</p>
                    <p className="mt-1.5 text-sm text-ink-2">{when(item.event.at)}</p>
                    {item.event.url && (
                      <a href={item.event.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-blue underline underline-offset-2">View transaction</a>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-[18px] bg-card p-5 text-sm text-ink-2">No transactions yet.</p>
            )}
          </section>
        )}
      </main>

      <footer className="shell mt-4 flex justify-end sm:mt-5">
        <ThemeSwitcher />
      </footer>

      {overlay === "account" && <AccountSheet holdings={holdings.holdings} onClose={close} />}
      {overlay && overlay !== "account" && (
        <Composer
          key={`${overlay}:${accountId ?? "demo"}`}
          action={overlay}
          prices={prices}
          pricesLive={live}
          holdings={holdings.holdings}
          people={people}
          accountId={accountId}
          now={now}
          onClose={close}
          onOpenAccount={() => setOverlay("account")}
        />
      )}
    </div>
  );
}

function CardCopy({ label, description }: { label: string; description: string }) {
  return (
    <span className="min-w-0 sm:col-span-2 sm:row-start-2">
      <span className="block text-[16px] font-semibold tracking-[-0.02em]">{label}</span>
      <span className="mt-0.5 block text-sm leading-snug text-ink-2 sm:mt-1.5">{description}</span>
    </span>
  );
}
