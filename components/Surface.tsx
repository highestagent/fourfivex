"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { countPasskeys } from "@/lib/account/flows";
import { useDeviceMemory } from "@/lib/account/store";
import { useHoldings } from "@/lib/account/useHoldings";
import { ASSETS, HOLDINGS } from "@/lib/assets";
import { coin, usd, when } from "@/lib/format";
import { usePrices } from "@/lib/hooks";
import { sendStatus } from "@/lib/send/api";
import { sent, useSent, type SentEntry } from "@/lib/send/history";
import { usePeople } from "@/lib/send/people";
import { VERBS, VERB_ORDER, type Standing, type Vals, type VerbKey } from "@/lib/verbs";
import { AccountSheet } from "./AccountSheet";
import { Card } from "./Card";
import { Composer, type Signed } from "./Composer";
import { Arrow, Chevron, CopyButton, Dot, Finger, Panel, StatusPill } from "./ui";

type View = "now" | "standing" | "said";
type SaidItem = { t: string; d: string };

const SEED: SaidItem[] = [
  { t: "You received 0.0089 bitcoin from Leo.", d: "12 October" },
  { t: "You paid Dad $25.00.", d: "3 October" },
];

const STATE_WORD: Record<SentEntry["state"], string> = {
  done: "Delivered",
  waiting: "On its way",
  seen: "On its way",
  working: "On its way",
  refunded: "Returned to you",
  failed: "Didn’t go through",
  short: "Short",
};

const GROUPS = ["usd", "btc", "eth", "sol"] as const;
const GROUP_NAME = { usd: "dollars", btc: "bitcoin", eth: "ether", sol: "sol" } as const;

/** One column, one gutter. The bar, the header of each place and the cards all share it. */
const WRAP = "mx-auto w-full max-w-[1000px] px-4 sm:px-6";

/* ───────────────────────────── the bar ───────────────────────────── */

/** A blank waiting to be filled in. */
function Mark() {
  return (
    <span className="grid size-6 place-items-end rounded-[8px] bg-ink p-[5px]" aria-hidden="true">
      <span className="h-[3px] w-full rounded-full bg-white" />
    </span>
  );
}

type Place = { key: View; label: string; count?: number };

/** The three places. A segmented control in the bar on wide screens, a thumb-reach bar on phones. */
function Places({
  places,
  view,
  onView,
  layout,
}: {
  places: Place[];
  view: View;
  onView: (v: View) => void;
  layout: "segment" | "bar";
}) {
  if (layout === "segment")
    return (
      <div className="inline-flex rounded-full bg-card p-1">
        {places.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => onView(p.key)}
            aria-current={view === p.key ? "page" : undefined}
            className={`mono cursor-pointer rounded-full px-4 py-2 transition-colors ${
              view === p.key ? "bg-white text-ink shadow-chip" : "text-ink-3 hover:text-ink-2"
            }`}
          >
            {p.label}
            {p.count ? <span className="ml-1.5 text-blue">{p.count}</span> : null}
          </button>
        ))}
      </div>
    );
  return (
    <div className="mx-auto grid max-w-[520px] grid-cols-3 px-2">
      {places.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => onView(p.key)}
          aria-current={view === p.key ? "page" : undefined}
          className="grid h-14 cursor-pointer place-items-center"
        >
          <span
            className={`mono rounded-full px-4 py-2 transition-colors ${
              view === p.key ? "bg-card text-ink" : "text-ink-3"
            }`}
          >
            {p.label}
            {p.count ? <span className="ml-1.5 text-blue">{p.count}</span> : null}
          </span>
        </button>
      ))}
    </div>
  );
}

/* ─────────────────────── the top of each place ─────────────────────── */

function Holding({ color, amount, name }: { color: string; amount: string; name: string }) {
  return (
    <span className="inline-flex h-8 items-center gap-2 rounded-full bg-card px-3 text-[13.5px] tabular-nums">
      <Dot color={color} />
      <span className="font-medium">{amount}</span>
      <span className="text-ink-2">{name}</span>
    </span>
  );
}

/** What you have, as the one large figure on the page. */
function Balance({
  label,
  status,
  total,
  children,
}: {
  label: string;
  status: ReactNode;
  total: number | null;
  children: ReactNode;
}) {
  const text = total === null ? null : usd(total);
  const [whole, cents] = text ? text.split(".") : ["", ""];
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className="mono text-ink-3">{label}</h1>
        {status}
      </div>
      <p
        className="mt-3 text-[clamp(44px,9vw,68px)] font-medium leading-none tracking-[-0.045em] tabular-nums"
        aria-label={text ?? "Reading your balance"}
      >
        {text ? (
          <>
            {whole}
            <span className="text-ink-3">.{cents}</span>
          </>
        ) : (
          <span className="text-ink-3">$ —</span>
        )}
      </p>
      <div className="mt-5 flex min-h-8 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** The one thing worth doing right now, already written out. */
function Moment({
  tone,
  text,
  action,
  onAction,
}: {
  tone: "info" | "warn";
  text: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="@container flex h-full items-center rounded-[22px] bg-card p-5">
      {/* Side by side only when this card itself is wide enough, whatever the screen. */}
      <div className="flex w-full flex-col gap-4 @[26rem]:flex-row @[26rem]:items-center @[26rem]:justify-between @[26rem]:gap-6">
      <div className="min-w-0">
        <p className="mono flex items-center gap-2 text-ink-3">
          <span
            className={`size-1.5 rounded-full animate-pulse-dot ${
              tone === "warn" ? "bg-amber-2 text-amber-2" : "bg-blue text-blue"
            }`}
          />
          Right now
        </p>
        <p className="mt-2 text-[16px] font-medium leading-snug tracking-[-0.01em] text-pretty">{text}</p>
      </div>
      <button
        type="button"
        onClick={onAction}
        className="inline-flex h-10 shrink-0 cursor-pointer items-center gap-2 self-start whitespace-nowrap rounded-full bg-ink px-4 text-[14px] font-medium text-white shadow-pill @[26rem]:self-center"
      >
        {action}
        <Arrow size={13} />
      </button>
      </div>
    </div>
  );
}

function PlaceHead({ label, title, note }: { label: string; title: string; note: string }) {
  return (
    <header className="pb-7 pt-8 md:pb-9 md:pt-12">
      <p className="mono text-ink-3">{label}</p>
      <h1 className="mt-3 text-[clamp(30px,5.5vw,44px)] font-medium leading-[1.05] tracking-[-0.035em]">{title}</h1>
      <p className="mt-3 max-w-[54ch] text-[15px] leading-[1.55] text-ink-2 text-pretty">{note}</p>
    </header>
  );
}

function Empty({ title, note, children }: { title: string; note: string; children?: ReactNode }) {
  return (
    <div className="rounded-[28px] bg-card px-6 py-14 text-center">
      <h2 className="text-[19px] font-medium tracking-[-0.015em]">{title}</h2>
      <p className="mx-auto mt-2.5 max-w-[46ch] text-[14.5px] leading-[1.55] text-ink-2 text-pretty">{note}</p>
      {children}
    </div>
  );
}

/* ───────────────────────────── the page ───────────────────────────── */

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
  const mine = useSent(accountId);
  const landed = mine.filter((e) => e.state === "done" || e.state === "refunded").length;
  const holdings = useHoldings(accountId, landed);
  const people = usePeople();
  const [view, setView] = useState<View>("now");
  const [open, setOpen] = useState<{ verb: VerbKey; vals?: Vals; id: number } | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [standing, setStanding] = useState<Standing[]>([]);
  const [said, setSaid] = useState<SaidItem[]>(SEED);
  const [keys, setKeys] = useState<{ id: string; count: number } | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const counter = useRef(0);

  // Keep unfinished sends fresh, even when they were started in another visit.
  const unfinished = mine.filter((e) => e.state === "waiting" || e.state === "seen" || e.state === "working" || e.state === "short");
  const watching = unfinished.map((e) => e.id).join(",");
  useEffect(() => {
    if (!watching) return;
    const check = () =>
      watching.split(",").forEach((id) => {
        sendStatus(id)
          .then((s) => sent.update(id, { state: s.state, links: s.links }))
          .catch(() => {});
      });
    const t = setInterval(check, 5000);
    return () => clearInterval(t);
  }, [watching]);

  // Money being waited for: an address was given and the money has not landed or been sent back.
  const waitingFor = mine.filter(
    (e) => e.kind === "add" && (e.state === "waiting" || e.state === "seen" || e.state === "working" || e.state === "short"),
  );
  // The clock is read after the page loads, so the first paint matches the server's.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!waitingFor.length) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const every = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [waitingFor.length]);

  const real = accountId !== null;
  const name = accountId ? (device.names[accountId] ?? "My account") : null;
  const h = holdings.holdings;

  // How many passkeys open the account, re-read whenever the account sheet closes.
  useEffect(() => {
    if (!accountId || accountOpen) return;
    let alive = true;
    countPasskeys(accountId)
      .then((c) => alive && setKeys({ id: accountId, count: c.added.length + (c.founderAttached === false ? 0 : 1) }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [accountId, accountOpen]);
  const onePasskey = real && keys?.id === accountId && keys.count === 1;

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
  const go = (v: View) => {
    setView(v);
    window.scrollTo({ top: 0 });
  };

  const places: Place[] = [
    { key: "now", label: "Now" },
    { key: "standing", label: "Standing", count: real ? waitingFor.length : standing.length },
    { key: "said", label: "Said" },
  ];

  return (
    <div className="min-h-dvh pb-24 md:pb-16">
      <header className="sticky top-0 z-40 border-b border-line/70 bg-white/85 backdrop-blur-md">
        <div className={`${WRAP} relative flex h-14 items-center justify-between gap-3 md:h-16`}>
          <button
            type="button"
            onClick={() => go("now")}
            className="flex cursor-pointer items-center gap-2.5 rounded-[10px]"
            aria-label="Intuite, go to Now"
          >
            <Mark />
            <span className="text-[16px] font-semibold tracking-[-0.02em]">Intuite</span>
          </button>

          <nav aria-label="Places" className="absolute left-1/2 hidden -translate-x-1/2 md:block">
            <Places places={places} view={view} onView={go} layout="segment" />
          </nav>

          {real ? (
            <button
              type="button"
              onClick={showAccount}
              className="flex h-10 min-w-0 cursor-pointer items-center gap-2 rounded-full bg-white pl-1.5 pr-2.5 shadow-chip"
              aria-label={`${name}’s account. Open account details.`}
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ink text-[11px] font-semibold uppercase text-white">
                {(name ?? "?").slice(0, 1)}
              </span>
              <span className="max-w-[12ch] truncate text-[14px] font-medium">{name}</span>
              <Chevron size={14} className="shrink-0 text-ink-3" />
            </button>
          ) : (
            <button
              type="button"
              onClick={showAccount}
              className="inline-flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-full bg-ink px-4 text-[14px] font-medium text-white shadow-pill"
            >
              <Finger size={16} />
              {device.passkeys.length ? "Sign in" : "Open account"}
            </button>
          )}
        </div>
      </header>

      <div className={WRAP}>
        {view === "now" && (
          <main>
            <section className="grid items-stretch gap-x-5 gap-y-7 pb-8 pt-8 md:grid-cols-2 md:pb-10 md:pt-12">
              {real ? (
                <Balance
                  label="You have"
                  total={h ? h.total : null}
                  status={
                    <StatusPill tone={holdings.status === "ready" ? "live" : holdings.status === "error" ? "warn" : "muted"}>
                      {holdings.status === "ready" ? "Live" : holdings.status === "error" ? "Unreachable" : "Reading"}
                    </StatusPill>
                  }
                >
                  {h && h.parts.length === 0 && <p className="text-[14.5px] text-ink-2">Nothing here yet.</p>}
                  {holdings.status === "error" && (
                    <p className="text-[14.5px] text-ink-2">The network could not be reached. Trying again.</p>
                  )}
                  {h &&
                    GROUPS.filter((g) => h.groups[g].usd > 0).map((g) => (
                      <Holding
                        key={g}
                        color={ASSETS[g].color}
                        amount={g === "usd" ? usd(h.groups[g].amount) : coin(h.groups[g].amount)}
                        name={GROUP_NAME[g]}
                      />
                    ))}
                  {h && h.groups.other.usd > 0 && <Holding color="#9a9aa4" amount={usd(h.groups.other.usd)} name="other" />}
                </Balance>
              ) : (
                <Balance
                  label="Demo account · you have"
                  total={HOLDINGS.usd + HOLDINGS.btc * prices.btc}
                  status={<StatusPill tone={live ? "live" : "muted"}>{live ? "Live prices" : "Example prices"}</StatusPill>}
                >
                  <Holding color={ASSETS.usd.color} amount={usd(HOLDINGS.usd)} name="dollars" />
                  <Holding color={ASSETS.btc.color} amount={String(HOLDINGS.btc)} name="bitcoin" />
                </Balance>
              )}

              {!real && (
                <Moment
                  tone="info"
                  text="Maya asked you for $40."
                  action="Pay Maya"
                  onAction={() => say("pay", { who: "maya", amt: 40 })}
                />
              )}
              {real && h && h.total === 0 ? (
                <Moment
                  tone="info"
                  text="Your account is empty. Add money to start using it."
                  action="Add money"
                  onAction={() => say("getpaid")}
                />
              ) : (
                onePasskey && (
                <Moment
                  tone="warn"
                  text="One passkey opens this account. Add a backup so a lost device doesn’t lose it."
                  action="Add a backup"
                  onAction={showAccount}
                />
                )
              )}
            </section>

            <div className="grid gap-5 md:grid-cols-2">
              {VERB_ORDER.map((k) => (
                <Card key={k} verb={VERBS[k]} prices={prices} paused={open !== null || accountOpen} onOpen={() => say(k)} />
              ))}
            </div>
          </main>
        )}

        {view === "standing" && (
          <main>
            <PlaceHead
              label="Standing"
              title="Still in force"
              note="Anything you sign that keeps going lives here until you stop it: money at work, a loan, a request waiting to be paid, or a sentence with “every” or “when”."
            />
            {(real ? waitingFor.length === 0 : standing.length === 0) ? (
              <Empty
                title="Nothing is standing yet."
                note={
                  real
                    ? "Money you are waiting for is listed here until it arrives."
                    : "Sign a sentence that keeps going and it will wait here."
                }
              >
                {!real && (
                  <button
                    type="button"
                    onClick={() => say("change", { from: "usd", to: "btc", when: "fri" })}
                    className="mt-6 inline-flex h-10 cursor-pointer items-center gap-2 rounded-full bg-ink px-5 text-[14px] font-medium text-white shadow-pill"
                  >
                    Try “every Friday” <Arrow size={13} />
                  </button>
                )}
              </Empty>
            ) : real ? (
              <div className="rounded-[28px] bg-card p-3 sm:p-5">
                <Panel className="divide-y divide-line/70 px-5">
                  {waitingFor.map((e) => {
                    const expired = e.state === "waiting" && !!e.deadline && now !== null && new Date(e.deadline).getTime() < now;
                    const meta = expired
                      ? "Expired"
                      : e.state === "waiting"
                        ? e.deadline
                          ? `Send before ${when(e.deadline)}`
                          : "Waiting for your money"
                        : e.state === "short"
                          ? "Too little arrived"
                          : "Seen. Adding it now.";
                    const d = e.deposit;
                    return (
                      <div key={e.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4">
                        <div className="min-w-0">
                          <p className="text-[16px] font-medium leading-snug tracking-[-0.01em]">{e.waitingText ?? e.text}</p>
                          <p className="mono mt-1.5 text-ink-3">{meta}</p>
                          {d && (
                            <div className="mt-3 text-[13px] leading-snug text-ink-3">
                              <p>
                                Send exactly {d.amount} {d.symbol ?? d.word} on {d.networkName} to
                              </p>
                              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                <span className="break-all font-mono text-[12.5px] text-ink-2">{d.address}</span>
                                <CopyButton text={d.address} label="Copy the address" />
                              </div>
                              {d.memo && (
                                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                  <span>
                                    Memo <span className="break-all font-mono text-[12.5px] text-ink-2">{d.memo}</span>
                                  </span>
                                  <CopyButton text={d.memo} label="Copy the memo" />
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          className="mono h-8 cursor-pointer rounded-full bg-card px-3.5 hover:bg-ink hover:text-white"
                          onClick={() => sent.remove(e.id)}
                        >
                          Forget
                        </button>
                      </div>
                    );
                  })}
                </Panel>
              </div>
            ) : (
              <div className="rounded-[28px] bg-card p-3 sm:p-5">
                <Panel className="divide-y divide-line/70 px-5">
                  {standing.map((s, i) => (
                    <div key={`${s.t}-${i}`} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4">
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
                <p className="px-2 pb-1 pt-4 text-[13px] text-ink-3">
                  In the product, stopping is itself a sentence you see and sign.
                </p>
              </div>
            )}
          </main>
        )}

        {view === "said" && (
          <main>
            <PlaceHead label="Said" title="What you signed" note="Every sentence you sign is kept here in the past tense, as its own receipt." />
            {real && mine.length === 0 ? (
              <Empty title="Nothing signed yet." note="Everything this account signs is listed here." />
            ) : real ? (
              <div className="rounded-[28px] bg-card p-3 sm:p-5">
                <Panel className="divide-y divide-line/70 px-5">
                  {mine.map((e) => (
                    <div key={e.id} className="py-4">
                      <p className="text-[16px] font-medium leading-snug tracking-[-0.01em]">
                        {e.state === "done" ? e.text : (e.waitingText ?? e.text)}
                      </p>
                      <p className="mono mt-1.5 text-ink-3">
                        {when(e.at)} · {STATE_WORD[e.state]}
                        {e.links[0] && (
                          <>
                            {" · "}
                            <a href={e.links[0].url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                              See the transaction
                            </a>
                          </>
                        )}
                      </p>
                    </div>
                  ))}
                </Panel>
              </div>
            ) : (
              <div className="rounded-[28px] bg-card p-3 sm:p-5">
                <Panel className="divide-y divide-line/70 px-5">
                  {said.map((s, i) => (
                    <div key={`${s.t}-${i}`} className="py-4">
                      <p className="text-[16px] font-medium leading-snug tracking-[-0.01em]">{s.t}</p>
                      <p className="mono mt-1.5 text-ink-3">{s.d}</p>
                    </div>
                  ))}
                </Panel>
              </div>
            )}
          </main>
        )}

        <footer className="mono mt-12 max-w-[72ch] border-t border-line pt-6 leading-[1.7] text-ink-3">
          {real
            ? "Your account and its balance are real. Change, pay and add really move money. Grow, borrow and ask are still examples."
            : "A demo account with example balances. Prices and quotes are live dry runs from NEAR Intents. Signing is simulated and nothing is ever sent."}
        </footer>
      </div>

      <nav
        aria-label="Places"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line/70 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      >
        <Places places={places} view={view} onView={go} layout="bar" />
      </nav>

      {open && (
        <Composer
          key={open.id}
          verbKey={open.verb}
          initial={open.vals}
          prices={prices}
          pricesLive={live}
          real={real}
          holdings={h}
          people={people}
          accountId={accountId}
          onClose={close}
          onSigned={signed}
        />
      )}
      {accountOpen && <AccountSheet holdings={holdings} onClose={hideAccount} />}
    </div>
  );
}
