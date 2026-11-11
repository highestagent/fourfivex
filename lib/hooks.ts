"use client";

import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";
import { FALLBACK_PRICES, type Prices } from "./assets";
import type { QuoteAsk, QuoteResult } from "./oneclick";
import type { QuoteState } from "./verbs";

export type StageState = "idle" | "run" | "done" | "fail";

function subscribeMotion(cb: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

/** Live prices, refreshed while the page is open. Falls back to fixed figures if unreachable. */
export function usePrices(): { prices: Prices; live: boolean } {
  const [s, setS] = useState<{ prices: Prices; live: boolean }>({ prices: FALLBACK_PRICES, live: false });
  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const res = await fetch("/api/prices");
        const data = (await res.json()) as { ok: boolean; prices?: Prices };
        if (alive && data.ok && data.prices) setS({ prices: data.prices, live: true });
      } catch {
        /* keep the last known prices */
      }
    };
    run();
    const t = setInterval(run, 45_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return s;
}

/** A dry quote for the current sentence, re-priced whenever a word changes. */
export function useQuote(ask: QuoteAsk | null, paused: boolean): QuoteState {
  const key = ask ? JSON.stringify(ask) : "";
  const [state, setState] = useState<{ key: string; q: QuoteState }>({ key: "", q: { status: "none" } });

  useEffect(() => {
    if (!key || paused) return;
    let alive = true;
    const ctrl = new AbortController();
    const run = async () => {
      try {
        const res = await fetch("/api/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: key,
          signal: ctrl.signal,
        });
        const data = (await res.json()) as QuoteResult;
        if (!alive) return;
        setState({
          key,
          q: data.ok
            ? { status: "live", data }
            : { status: data.reason === "no-offer" ? "no-offer" : "unavailable" },
        });
      } catch {
        if (alive) setState({ key, q: { status: "unavailable" } });
      }
    };
    const first = setTimeout(run, 250);
    const every = setInterval(run, 25_000);
    return () => {
      alive = false;
      ctrl.abort();
      clearTimeout(first);
      clearInterval(every);
    };
  }, [key, paused]);

  if (!key) return { status: "none" };
  return state.key === key ? state.q : { status: "loading" };
}

export function useInView(ref: RefObject<Element | null>): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return inView;
}

const ORDER: StageState[] = ["idle", "run", "done"];

/** Drives a card's self-playing demo: rest, run, hold the result, start over. */
export function useAutoLoop(
  enabled: boolean,
  ms: readonly [number, number, number],
): { state: StageState; cycle: number } {
  const reduced = useReducedMotion();
  const [s, setS] = useState<{ state: StageState; cycle: number }>({ state: "idle", cycle: 0 });
  useEffect(() => {
    if (!enabled || reduced) return;
    const i = ORDER.indexOf(s.state);
    const t = setTimeout(
      () =>
        setS((prev) =>
          i >= 2 ? { state: "idle", cycle: prev.cycle + 1 } : { state: ORDER[i + 1], cycle: prev.cycle },
        ),
      ms[Math.max(0, i)],
    );
    return () => clearTimeout(t);
  }, [enabled, reduced, s, ms]);
  // With motion reduced, show the finished state and leave it still.
  return reduced ? { state: "done", cycle: 0 } : s;
}

/** Text that types itself in. Remount with a new key to restart. */
export function useTyped(text: string, active: boolean, perChar = 46): string {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active || n >= text.length) return;
    const t = setTimeout(() => setN((x) => x + 1), perChar);
    return () => clearTimeout(t);
  }, [active, n, text, perChar]);
  return active ? text.slice(0, n) : text;
}
