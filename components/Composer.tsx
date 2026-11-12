"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Holdings } from "@/lib/account/holdings";
import type { Prices } from "@/lib/assets";
import { exact, when } from "@/lib/format";
import { useQuote, type StageState } from "@/lib/hooks";
import { prepareSend } from "@/lib/send/api";
import { sent, useSent } from "@/lib/send/history";
import { payInOf } from "@/lib/send/payin";
import type { Person } from "@/lib/send/people";
import type { Prepared } from "@/lib/send/types";
import { useSend } from "@/lib/send/useSend";
import { VERBS, type Ctx, type Outcome, type SlotCtx, type Standing, type Tone, type Vals, type VerbKey } from "@/lib/verbs";
import { INPUT, LABEL, NewPerson } from "./NewPerson";
import { Sentence } from "./Sentence";
import { SignButton, type Phase } from "./SignButton";
import { STAGES } from "./stages";
import { Sheet, SheetLabel } from "./Sheet";
import { CopyButton, Panel, StatusPill } from "./ui";

export type Signed = { past: string; standing?: Standing };

/** What a person is asked to send, once an address has been requested. */
type Requested = { prepared: Prepared; amount: string; word: string; networkName: string };

const REFUND_HINT: Record<string, string> = { evm: "0x…", sol: "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T", near: "name.near", btc: "bc1…" };
const FAILED_ADD = ["short", "refunded", "failed"];

const TONE: Record<Tone, { text: string; dot: string }> = {
  ok: { text: "text-green", dot: "bg-green-2" },
  warn: { text: "text-amber", dot: "bg-amber-2" },
  stop: { text: "font-medium text-rose", dot: "bg-rose" },
};

/**
 * Say, see, sign. The sentence at the top, the outcome in words and in dots beneath it,
 * and one pill to sign with. With no account open nothing is sent: quotes are dry runs and
 * signing is simulated. With a real account, a sentence that has a real variant really sends.
 */
export function Composer({
  verbKey,
  initial,
  prices,
  pricesLive,
  real,
  holdings,
  people,
  accountId,
  onClose,
  onSigned,
}: {
  verbKey: VerbKey;
  initial?: Vals;
  prices: Prices;
  pricesLive: boolean;
  /** True when a real account is open. */
  real: boolean;
  holdings: Holdings | null;
  people: Person[];
  accountId: string | null;
  onClose: () => void;
  onSigned: (s: Signed) => void;
}) {
  const verb = VERBS[verbKey];
  const Stage = STAGES[verbKey];
  const variant = real ? (verb.real ?? null) : null;
  const slotCtx = useMemo<SlotCtx>(() => ({ prices, holdings, people }), [prices, holdings, people]);
  const engine = useSend();
  const [vals, setVals] = useState<Vals>(() => (variant ? variant.def(slotCtx) : { ...verb.def, ...initial }));
  // The account may still be loading when this opens. Start over once it arrives, if nothing was touched.
  const [seeded, setSeeded] = useState(!variant || holdings !== null);
  const [touched, setTouched] = useState(false);
  if (!seeded && holdings) {
    setSeeded(true);
    if (variant && !touched) setVals(variant.def(slotCtx));
  }
  const [localPhase, setPhase] = useState<Phase>("idle");
  // A variant that asks for an address instead of signing. Nothing leaves the account.
  const asking = !!variant?.request;
  const [requesting, setRequesting] = useState(false);
  const [requested, setRequested] = useState<Requested | null>(null);
  const [reqError, setReqError] = useState<string | null>(null);
  const mine = useSent(accountId);
  const entry = requested ? mine.find((e) => e.id === requested.prepared.depositAddress) : undefined;
  const entryState = entry?.state ?? "waiting";
  const addDone = requested !== null && entryState === "done";
  const addFailed = requested !== null && FAILED_ADD.includes(entryState);
  const askPhase: Phase = requested ? (addDone ? "done" : addFailed ? "failed" : "working") : requesting ? "working" : "idle";
  const phase: Phase = asking ? askPhase : variant ? engine.phase : localPhase;
  const [step, setStep] = useState(0);
  const [failNext, setFailNext] = useState(false);
  const [ack, setAck] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [frozen, setFrozen] = useState<Outcome | null>(null);

  const ask = useMemo(() => {
    if (!variant) return verb.ask?.(vals) ?? null;
    const c: Ctx = { prices, pricesLive, quote: { status: "none" }, holdings, people, accountId, moved: null };
    return variant.ask(vals, c);
  }, [verb, variant, vals, prices, pricesLive, holdings, people, accountId]);
  const quote = useQuote(ask, phase !== "idle");
  // Once something has been signed, the numbers shown are the ones that were signed.
  const ctx: Ctx = { prices, pricesLive, quote, holdings, people, accountId, moved: engine.receipt?.prepared ?? engine.moved };
  const current = (variant ?? verb).out(vals, ctx);
  // The demo freezes what was on screen when it was signed. A real send does the same while it
  // runs, then shows the numbers that were actually signed once there is a receipt.
  const o = variant && (engine.phase === "idle" || engine.receipt) ? current : (frozen ?? current);

  const signedRef = useRef(onSigned);
  useEffect(() => {
    signedRef.current = onSigned;
  });

  // After the signature: confirm it's you, run each step, then settle.
  useEffect(() => {
    if (phase === "auth") {
      const t = setTimeout(() => {
        setStep(0);
        setPhase("working");
      }, 850);
      return () => clearTimeout(t);
    }
    if (phase === "working" && frozen) {
      const t = setTimeout(() => {
        if (failNext && step === 0) {
          setPhase("failed");
        } else if (step + 1 >= frozen.steps.length) {
          setPhase("done");
          signedRef.current({ past: frozen.past, standing: frozen.standing });
        } else {
          setStep(step + 1);
        }
      }, 1300);
      return () => clearTimeout(t);
    }
  }, [phase, step, failNext, frozen]);

  const setVal = (key: string, value: string | number) => {
    const fix = (variant ?? verb).fix;
    setVals((prev) => {
      const next = { ...prev, [key]: value };
      return fix ? fix(next, key) : next;
    });
    setTouched(true);
    setReqError(null);
    engine.clearMoved();
    setAck(false);
    setHint(null);
  };

  const again = () => {
    setFrozen(null);
    engine.reset();
    setRequested(null);
    setRequesting(false);
    setReqError(null);
    setPhase("idle");
    setStep(0);
    setAck(false);
    setHint(null);
  };

  // The picture names the person being paid, which only the sentence's own list knows.
  const payIn = asking ? payInOf(vals.with) : null;
  const stageVals: Vals =
    variant && verbKey === "pay"
      ? { ...vals, whoName: people.find((p) => p.id === vals.who)?.name ?? "them" }
      : payIn
        ? { ...vals, payer: payIn.word === "dollars" ? "usd" : payIn.family === "sol" ? "sol" : payIn.family === "btc" ? "btc" : "eth", word: payIn.word }
        : vals;
  const stageState: StageState =
    phase === "working" ? "run" : phase === "done" ? "done" : phase === "failed" ? "fail" : "idle";
  const pricing = quote.status === "loading" && phase === "idle";
  const blocked = variant
    ? current.blocked
    : real
      ? "This sentence is not connected to your real account yet. You can read what it would do."
      : (o.blocked ?? (o.ack && !ack ? "Tick the box above first." : undefined));

  // What happened, plus a link to each transaction once there are any.
  const links = engine.receipt?.links ?? [];
  const rows: { k: string; v: ReactNode; sub?: string; tone?: Tone }[] = [...o.rows];
  if (variant && phase === "done" && links.length)
    rows.push({
      k: "On the network",
      v: (
        <span className="flex flex-wrap gap-x-3">
          {links.map((l, i) => (
            <a key={l.hash} href={l.url} target="_blank" rel="noreferrer" className="text-blue underline underline-offset-2">
              {links.length > 1 ? `See the transaction ${i + 1}` : "See the transaction"}
            </a>
          ))}
        </span>
      ),
    });
  const delivered = engine.receipt?.state === "done";

  // Once an address has been given, the rows say what to do and how it is going.
  if (requested) {
    const { prepared, amount, word, networkName } = requested;
    const copyable = (text: string, label: string, mono = false): ReactNode => (
      <span className="flex flex-wrap items-center gap-2">
        <span className={mono ? "break-all font-mono text-[13px]" : undefined}>{mono ? text : `${text} ${word}`}</span>
        <CopyButton text={text} label={label} />
      </span>
    );
    const status: Record<string, { v: string; tone?: Tone }> = {
      waiting: { v: "Waiting for your money" },
      seen: { v: "Seen. Adding it now." },
      working: { v: "Seen. Adding it now." },
      done: { v: "Added", tone: "ok" },
      short: { v: "Too little arrived. It is being sent back.", tone: "stop" },
      refunded: { v: "Sent back to you", tone: "stop" },
      failed: { v: "It didn’t go through", tone: "stop" },
    };
    rows.length = 0;
    rows.push(
      { k: "Send exactly", v: copyable(amount, "Copy the amount") },
      { k: "To this address", v: copyable(prepared.depositAddress, "Copy the address", true) },
      { k: "On", v: networkName },
      { k: "Before", v: when(prepared.deadline) },
    );
    if (prepared.depositMemo)
      rows.push({
        k: "Memo",
        v: copyable(prepared.depositMemo, "Copy the memo", true),
        sub: "the money cannot be matched without it",
        tone: "warn",
      });
    rows.push({ k: "Status", v: status[entryState].v, tone: status[entryState].tone });
  }

  const request = async () => {
    setHint(null);
    const ask = variant?.request?.(vals, ctx);
    if (!ask || !payIn) {
      setHint(blocked ?? "This can’t be asked for right now.");
      return;
    }
    setRequesting(true);
    setReqError(null);
    try {
      const prepared = await prepareSend(ask);
      const deposit = {
        address: prepared.depositAddress,
        memo: prepared.depositMemo,
        amount: exact(prepared.leaves.units, prepared.leaves.decimals),
        word: payIn.word,
        networkName: payIn.networkName,
      };
      sent.add({
        id: prepared.depositAddress,
        accountId: ask.accountId,
        kind: "add",
        text: current.past,
        waitingText: current.waiting ?? current.past,
        at: Date.now(),
        state: "waiting",
        links: [],
        deadline: prepared.deadline,
        deposit,
      });
      setRequested({ prepared, amount: deposit.amount, word: deposit.word, networkName: deposit.networkName });
    } catch (e) {
      setReqError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setRequesting(false);
    }
  };

  return (
    <Sheet title={variant?.title ?? verb.title} onClose={onClose}>
          <div className="mt-8">
            <SheetLabel>{phase === "done" ? "Said" : requested ? "Do" : "Say"}</SheetLabel>
            {requested && !addDone ? (
              <p className="animate-rise text-[clamp(22px,3.3vw,30px)] font-medium leading-[1.35] tracking-[-0.022em]">
                Send {requested.amount} {requested.word} to the address below.
              </p>
            ) : phase === "done" ? (
              <p className="animate-rise text-[clamp(22px,3.3vw,30px)] font-medium leading-[1.35] tracking-[-0.022em]">
                {variant && !asking && !delivered ? (o.waiting ?? o.past) : o.past}
              </p>
            ) : (
              <Sentence verb={variant ? { ...verb, parts: variant.parts, slots: variant.slots } : verb} vals={vals} ctx={slotCtx} disabled={phase !== "idle"} onChange={setVal} />
            )}
          </div>

          {variant && phase === "idle" && vals.who === "__new" && (
            <div className="mt-5">
              <NewPerson onSave={(person) => setVal("who", person.id)} onCancel={() => setVal("who", people[0]?.id ?? "")} />
            </div>
          )}

          {asking && payIn && !requested && (
            <div className="mt-5">
              <Panel className="p-5">
                <label className={LABEL} htmlFor="add-refund">
                  {payIn.family === "btc" ? "The bitcoin address you are sending from" : `The address you are sending from, on ${payIn.networkName}`}
                </label>
                <input
                  id="add-refund"
                  className={`${INPUT} font-mono text-[13px]`}
                  placeholder={REFUND_HINT[payIn.family]}
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="off"
                  disabled={requesting}
                  value={String(vals.refund ?? "")}
                  onChange={(e) => setVal("refund", e.target.value)}
                />
                <p className="mt-3 text-[13px] leading-snug text-ink-3">If the money can&apos;t be added, it is sent back here.</p>
              </Panel>
            </div>
          )}

          <div className="mt-8 grid gap-5 md:grid-cols-2">
            <div className="min-w-0">
              <SheetLabel>See</SheetLabel>
              <Panel className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <span className="mono">{requested ? "What to do now" : phase === "done" ? "What happened" : "What will happen"}</span>
                  {!requested && <StatusPill tone={o.status.tone}>{o.status.label}</StatusPill>}
                </div>
                <dl className="mt-2">
                  {rows.map((row, i) => {
                    const tone = row.tone ? TONE[row.tone] : null;
                    return (
                      <div
                        key={row.k}
                        className={`grid grid-cols-[minmax(0,112px)_minmax(0,1fr)] gap-3 border-t border-line/70 py-2.5 transition-opacity duration-300 first:border-t-0 ${
                          pricing && i < 3 ? "opacity-40" : ""
                        }`}
                      >
                        <dt className="mono pt-[3px] text-ink-3">{row.k}</dt>
                        <dd className="text-[14.5px] leading-snug">
                          <span className={`flex items-baseline gap-2 ${tone ? tone.text : ""}`}>
                            {tone && <span className={`size-1.5 shrink-0 -translate-y-px rounded-full ${tone.dot}`} />}
                            <span className="tabular-nums">{row.v}</span>
                          </span>
                          {row.sub && (
                            <span className={`block text-[12.5px] leading-snug text-ink-3 ${tone ? "pl-3.5" : ""}`}>
                              {row.sub}
                            </span>
                          )}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </Panel>
            </div>
            <div className="flex min-w-0 flex-col">
              <SheetLabel>In picture</SheetLabel>
              <div className="min-h-[318px] flex-1 rounded-[22px] bg-black/[0.028] px-4 py-5">
                <Stage
                  state={stageState}
                  cycle={0}
                  vals={stageVals}
                  prices={prices}
                  quote={quote}
                  live
                  onVal={phase === "idle" ? setVal : undefined}
                />
              </div>
            </div>
          </div>

          <div className="mt-8">
            <SheetLabel>Sign</SheetLabel>
            {o.ack && phase === "idle" && !real && (
              <label className="mb-4 flex max-w-[520px] cursor-pointer items-start gap-3 rounded-[16px] bg-rose-3 px-4 py-3 text-[14px] leading-snug">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-rose"
                  checked={ack}
                  onChange={(e) => {
                    setAck(e.target.checked);
                    setHint(null);
                  }}
                />
                <span>{o.ack}</span>
              </label>
            )}
            {variant && engine.moved && phase === "idle" && (
              <p className="mb-4 max-w-[520px] rounded-[16px] bg-amber-3 px-4 py-3 text-[14px] leading-snug text-amber">
                The price moved before you signed. The numbers above are the new ones. Hold again if you still want it.
              </p>
            )}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <SignButton
                phase={phase}
                label={o.cta}
                hold={o.hold}
                blocked={blocked}
                working={asking ? (requested ? "Waiting for your money" : "Getting your address") : variant ? (engine.step ?? "Working") : o.steps[Math.min(step, o.steps.length - 1)]}
                done={variant && !asking ? (delivered ? o.doneLabel : "Sent. Still being delivered.") : o.doneLabel}
                onSigned={() => {
                  setHint(null);
                  if (asking) {
                    void request();
                    return;
                  }
                  if (variant && variant.plan) {
                    const plan = variant.plan(vals, ctx);
                    if (!plan) {
                      setHint(blocked ?? "This can't be sent right now.");
                      return;
                    }
                    setFrozen(current);
                    engine.start(plan, { kind: verb.key as "change" | "pay", text: current.past, waitingText: current.waiting ?? current.past });
                    return;
                  }
                  setFrozen(current);
                  setPhase("auth");
                }}
                onHint={setHint}
              />
              <p className="min-h-5 text-[13.5px] leading-snug text-ink-2" aria-live="polite">
                {phase === "idle" &&
                  (variant ? (
                    (hint ??
                      (asking ? reqError : engine.error) ? (
                        <span className="text-rose">{asking ? reqError : engine.error}</span>
                      ) : (
                        (blocked ?? (asking ? "Nothing leaves your account, so a tap is enough." : "Hold, then confirm with your fingerprint."))
                      ))
                  ) : (
                    (hint ??
                    (real || o.blocked
                      ? blocked
                      : o.hold
                        ? "Hold, then confirm with your fingerprint."
                        : "Nothing leaves your account, so a tap is enough."))
                  ))}
                {phase === "auth" && "You can leave this screen. It finishes without you."}
                {asking && phase === "working" && requested && "You can close this. Standing keeps the address, and Said will show when it lands."}
                {asking && phase === "done" && "It is recorded under Said."}
                {asking && phase === "failed" && (
                  <>
                    <span className="text-ink">{o.fail}</span> {o.why}
                  </>
                )}
                {!asking && phase === "working" &&
                  (variant ? "Keep this open if you like. It finishes without you." : "You can leave this screen. It finishes without you.")}
                {!asking && phase === "done" &&
                  (variant
                    ? delivered
                      ? (o.after ?? "It is recorded under Said.")
                      : "It is on its way. Said will show when it lands."
                    : (o.after ?? "It is recorded under Said."))}
                {!asking && phase === "failed" && variant &&
                  (engine.receipt?.state === "refunded" ? (
                    "It didn't go through. Your money is back in your account."
                  ) : (
                    <>It didn&apos;t go through. {o.why}</>
                  ))}
                {!asking && phase === "failed" && !variant && (
                  <>
                    <span className="text-ink">{o.fail}</span> {o.why} You were not charged.
                  </>
                )}
              </p>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-5">
              <div className="flex flex-wrap gap-2">
                {phase === "done" && (
                  <>
                    <button type="button" onClick={onClose} className="h-10 cursor-pointer rounded-full bg-ink px-5 text-[14px] font-medium text-white shadow-pill">
                      Done
                    </button>
                    <button type="button" onClick={again} className="h-10 cursor-pointer rounded-full bg-white px-5 text-[14px] font-medium shadow-chip">
                      Say it again
                    </button>
                  </>
                )}
                {asking && requested && phase === "working" && (
                  <button type="button" onClick={onClose} className="h-10 cursor-pointer rounded-full bg-ink px-5 text-[14px] font-medium text-white shadow-pill">
                    Done
                  </button>
                )}
                {asking && phase === "failed" && (
                  <>
                    <button type="button" onClick={onClose} className="h-10 cursor-pointer rounded-full bg-ink px-5 text-[14px] font-medium text-white shadow-pill">
                      Done
                    </button>
                    <button type="button" onClick={again} className="h-10 cursor-pointer rounded-full bg-white px-5 text-[14px] font-medium shadow-chip">
                      Try again
                    </button>
                  </>
                )}
                {!asking && phase === "failed" && (
                  <button type="button" onClick={again} className="h-10 cursor-pointer rounded-full bg-ink px-5 text-[14px] font-medium text-white shadow-pill">
                    {verb.ask ? "See a fresh price" : "Try again"}
                  </button>
                )}
                {(phase === "idle" || phase === "auth" || (phase === "working" && !requested)) && (
                  <span className="mono text-ink-3">
                    {asking
                      ? "Your account · this gives you an address to send to"
                      : variant
                      ? "Your account · this really sends"
                      : real
                        ? "Your account · sending is not connected yet"
                        : "Demo account · nothing is sent"}
                  </span>
                )}
              </div>
              {phase === "idle" && !real && (
                <label className="mono flex cursor-pointer items-center gap-2.5 text-ink-3">
                  Make this one fail
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={failNext}
                    onChange={(e) => setFailNext(e.target.checked)}
                  />
                  <span className="relative h-5 w-9 rounded-full bg-black/10 transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-white after:shadow-chip after:transition-transform peer-checked:bg-rose peer-checked:after:translate-x-4 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blue" />
                </label>
              )}
            </div>
          </div>
    </Sheet>
  );
}
