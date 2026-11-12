"use client";

import { useEffect, useState } from "react";
import { fetchHoldings } from "./api";
import type { Holdings } from "./holdings";

export type HoldingsState = { holdings: Holdings | null; status: "none" | "loading" | "ready" | "error" };

/** The open account's real balances, read from the network and refreshed while the page is open. */
export function useHoldings(accountId: string | null, refreshKey?: unknown): HoldingsState {
  const [state, setState] = useState<{ id: string; holdings: Holdings | null; failed: boolean } | null>(null);

  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    const run = async () => {
      try {
        const holdings = await fetchHoldings(accountId);
        if (alive) setState({ id: accountId, holdings, failed: false });
      } catch {
        if (alive) setState((prev) => ({ id: accountId, holdings: prev?.id === accountId ? prev.holdings : null, failed: true }));
      }
    };
    run();
    const t = setInterval(run, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [accountId, refreshKey]);

  if (!accountId) return { holdings: null, status: "none" };
  if (!state || state.id !== accountId) return { holdings: null, status: "loading" };
  if (state.holdings) return { holdings: state.holdings, status: "ready" };
  return { holdings: null, status: state.failed ? "error" : "loading" };
}
