"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { FALLBACK_PRICES, type Prices } from "./assets";
import type { QuoteAsk, QuoteResult } from "./oneclick";
import type { QuoteState } from "./verbs";

// Matches the desktop layout's Tailwind sm breakpoint.
const MOBILE_SHEET = "(width < 40rem)";

function subscribeToSheetWidth(listener: () => void) {
  const query = window.matchMedia(MOBILE_SHEET);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

export function useMobileSheet() {
  return useSyncExternalStore(
    subscribeToSheetWidth,
    () => window.matchMedia(MOBILE_SHEET).matches,
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
