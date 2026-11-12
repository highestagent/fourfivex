"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Holdings } from "@/lib/account/holdings";
import type { Prices } from "@/lib/assets";
import { useQuote, type StageState } from "@/lib/hooks";
import type { Person } from "@/lib/send/people";
import { useSend } from "@/lib/send/useSend";
import { VERBS, type Ctx, type Outcome, type SlotCtx, type Standing, type Tone, type Vals, type VerbKey } from "@/lib/verbs";
import { NewPerson } from "./NewPerson";
import { Sentence } from "./Sentence";
import { SignButton, type Phase } from "./SignButton";
import { STAGES } from "./stages";
import { Sheet, SheetLabel } from "./Sheet";
import { Panel, StatusPill } from "./ui";

export type Signed = { past: string; standing?: Standing };

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
  const phase: Phase = variant ? engine.phase : localPhase;
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
    engine.clearMoved();
    setAck(false);
    setHint(null);
  };

  const again = () => {
    setFrozen(null);
    engine.reset();
    setPhase("idle");
    setStep(0);
    setAck(false);
    setHint(null);
  };

  // The picture names the person being paid, which only the sentence's own list knows.
  const stageVals: Vals = variant && verbKey === "pay" ? { ...vals, whoName: people.find((p) => p.id === vals.who)?.name ?? "them" } : vals;
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

  return (
    <Sheet title={verb.title} onClose={onClose}>
          <div className="mt-8">
            <SheetLabel>{phase === "done" ? "Said" : "Say"}</SheetLabel>
            {phase === "done" ? (
              <p className="animate-rise text-[clamp(22px,3.3vw,30px)] font-medium leading-[1.35] tracking-[-0.022em]">
                {variant && !delivered ? (o.waiting ?? o.past) : o.past}
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

          <div className="mt-8 grid gap-5 md:grid-cols-2">
            <div className="min-w-0">
              <SheetLabel>See</SheetLabel>
              <Panel className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <span className="mono">{phase === "done" ? "What happened" : "What will happen"}</span>
                  <StatusPill tone={o.status.tone}>{o.status.label}</StatusPill>
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
                working={variant ? (engine.step ?? "Working") : o.steps[Math.min(step, o.steps.length - 1)]}
                done={variant ? (delivered ? o.doneLabel : "Sent. Still being delivered.") : o.doneLabel}
                onSigned={() => {
                  setHint(null);
                  if (variant) {
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
                      (engine.error ? (
                        <span className="text-rose">{engine.error}</span>
                      ) : (
                        (blocked ?? "Hold, then confirm with your fingerprint.")
                      )))
                  ) : (
                    (hint ??
                    (real || o.blocked
                      ? blocked
                      : o.hold
                        ? "Hold, then confirm with your fingerprint."
                        : "Nothing leaves your account, so a tap is enough."))
                  ))}
                {phase === "auth" && "You can leave this screen. It finishes without you."}
                {phase === "working" &&
                  (variant ? "Keep this open if you like. It finishes without you." : "You can leave this screen. It finishes without you.")}
                {phase === "done" &&
                  (variant
                    ? delivered
                      ? (o.after ?? "It is recorded under Said.")
                      : "It is on its way. Said will show when it lands."
                    : (o.after ?? "It is recorded under Said."))}
                {phase === "failed" && variant &&
                  (engine.receipt?.state === "refunded" ? (
                    "It didn't go through. Your money is back in your account."
                  ) : (
                    <>It didn&apos;t go through. {o.why}</>
                  ))}
                {phase === "failed" && !variant && (
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
                {phase === "failed" && (
                  <button type="button" onClick={again} className="h-10 cursor-pointer rounded-full bg-ink px-5 text-[14px] font-medium text-white shadow-pill">
                    {verb.ask ? "See a fresh price" : "Try again"}
                  </button>
                )}
                {(phase === "idle" || phase === "auth" || phase === "working") && (
                  <span className="mono text-ink-3">
                    {variant
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
