"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Prices } from "@/lib/assets";
import { useQuote, type StageState } from "@/lib/hooks";
import { VERBS, type Outcome, type Standing, type Tone, type Vals, type VerbKey } from "@/lib/verbs";
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
 * and one pill to sign with. Nothing is sent: quotes are dry runs and signing is simulated.
 */
export function Composer({
  verbKey,
  initial,
  prices,
  pricesLive,
  real,
  onClose,
  onSigned,
}: {
  verbKey: VerbKey;
  initial?: Vals;
  prices: Prices;
  pricesLive: boolean;
  /** True when a real account is open. Sentences are not connected to real accounts yet. */
  real: boolean;
  onClose: () => void;
  onSigned: (s: Signed) => void;
}) {
  const verb = VERBS[verbKey];
  const Stage = STAGES[verbKey];
  const [vals, setVals] = useState<Vals>(() => ({ ...verb.def, ...initial }));
  const [phase, setPhase] = useState<Phase>("idle");
  const [step, setStep] = useState(0);
  const [failNext, setFailNext] = useState(false);
  const [ack, setAck] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [frozen, setFrozen] = useState<Outcome | null>(null);

  const ask = useMemo(() => verb.ask?.(vals) ?? null, [verb, vals]);
  const quote = useQuote(ask, phase !== "idle");
  const current = verb.out(vals, { prices, pricesLive, quote });
  const o = frozen ?? current;

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
    setVals((prev) => {
      const next = { ...prev, [key]: value };
      return verb.fix ? verb.fix(next, key) : next;
    });
    setAck(false);
    setHint(null);
  };

  const again = () => {
    setFrozen(null);
    setPhase("idle");
    setStep(0);
    setAck(false);
    setHint(null);
  };

  const stageState: StageState =
    phase === "working" ? "run" : phase === "done" ? "done" : phase === "failed" ? "fail" : "idle";
  const pricing = quote.status === "loading" && phase === "idle";
  const blocked = real
    ? "This sentence is not connected to your real account yet. You can read what it would do."
    : (o.blocked ?? (o.ack && !ack ? "Tick the box above first." : undefined));

  return (
    <Sheet title={verb.title} onClose={onClose}>
          <div className="mt-8">
            <SheetLabel>{phase === "done" ? "Said" : "Say"}</SheetLabel>
            {phase === "done" ? (
              <p className="animate-rise text-[clamp(22px,3.3vw,30px)] font-medium leading-[1.35] tracking-[-0.022em]">
                {o.past}
              </p>
            ) : (
              <Sentence verb={verb} vals={vals} prices={prices} disabled={phase !== "idle"} onChange={setVal} />
            )}
          </div>

          <div className="mt-8 grid gap-5 md:grid-cols-2">
            <div className="min-w-0">
              <SheetLabel>See</SheetLabel>
              <Panel className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <span className="mono">{phase === "done" ? "What happened" : "What will happen"}</span>
                  <StatusPill tone={o.status.tone}>{o.status.label}</StatusPill>
                </div>
                <dl className="mt-2">
                  {o.rows.map((row, i) => {
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
                  vals={vals}
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
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <SignButton
                phase={phase}
                label={o.cta}
                hold={o.hold}
                blocked={blocked}
                working={o.steps[Math.min(step, o.steps.length - 1)]}
                done={o.doneLabel}
                onSigned={() => {
                  setFrozen(current);
                  setHint(null);
                  setPhase("auth");
                }}
                onHint={setHint}
              />
              <p className="min-h-5 text-[13.5px] leading-snug text-ink-2" aria-live="polite">
                {phase === "idle" &&
                  (hint ??
                    (real || o.blocked
                      ? blocked
                      : o.hold
                        ? "Hold, then confirm with your fingerprint."
                        : "Nothing leaves your account, so a tap is enough."))}
                {(phase === "auth" || phase === "working") && "You can leave this screen. It finishes without you."}
                {phase === "done" && (o.after ?? "It is recorded under Said.")}
                {phase === "failed" && (
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
                    {real ? "Your account · sending is not connected yet" : "Demo account · nothing is sent"}
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
