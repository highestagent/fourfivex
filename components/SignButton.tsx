"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Finger, Spinner, Tick } from "./ui";

export type Phase = "idle" | "auth" | "working" | "done" | "failed";

/**
 * One pill that carries the whole act of signing. It is held, not tapped, whenever something
 * leaves the account, and the hold is longer the harder the act is to undo. Then it becomes
 * its own progress and its own receipt.
 */
export function SignButton({
  phase,
  label,
  hold,
  blocked,
  working,
  done,
  onSigned,
  onHint,
}: {
  phase: Phase;
  label: string;
  /** Milliseconds to hold. Zero means a tap. */
  hold: number;
  /** Why signing is off, if it is. */
  blocked?: string;
  working: string;
  done: string;
  onSigned: () => void;
  onHint: (text: string | null) => void;
}) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const base =
    "relative flex h-14 w-full max-w-[380px] items-center justify-center gap-2.5 overflow-hidden rounded-full px-7 text-[15px] font-medium";

  if (phase === "done")
    return (
      <div role="status" className={`${base} animate-pop bg-white text-green shadow-chip`}>
        <Tick size={18} />
        {done}
      </div>
    );
  if (phase === "failed")
    return (
      <div role="status" className={`${base} animate-pop bg-rose-3 text-rose ring-1 ring-rose-2`}>
        Did not go through
      </div>
    );
  if (phase !== "idle")
    return (
      <div role="status" className={`${base} bg-ink text-white shadow-pill`}>
        <Spinner size={16} className="text-white/80" />
        {phase === "auth" ? "Confirming it’s you" : working}
      </div>
    );

  const start = () => {
    if (blocked) {
      onHint(blocked);
      return;
    }
    if (timer.current) return;
    onHint(null);
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      onSigned();
    }, hold);
  };
  const stop = () => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
    onHint("Keep holding to sign.");
  };

  const cls = `${base} select-none bg-ink text-white shadow-pill transition-[transform,opacity] duration-200 ${
    blocked ? "cursor-not-allowed opacity-40" : "cursor-pointer active:scale-[0.985]"
  }`;

  if (hold === 0)
    return (
      <button
        type="button"
        className={cls}
        aria-disabled={!!blocked}
        onClick={() => (blocked ? onHint(blocked) : onSigned())}
      >
        <Check size={16} strokeWidth={2} />
        {label}
      </button>
    );

  return (
    <button
      type="button"
      className={`${cls} touch-none`}
      aria-disabled={!!blocked}
      onPointerDown={(e) => {
        e.preventDefault();
        start();
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat) {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") stop();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span
        className="absolute inset-y-0 left-0 bg-blue"
        style={{
          width: holding ? "100%" : "0%",
          transition: `width ${holding ? hold : 180}ms linear`,
        }}
      />
      <span className="relative flex items-center gap-2.5">
        <Finger size={18} />
        {label}
      </span>
    </button>
  );
}
