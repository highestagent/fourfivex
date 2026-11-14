"use client";

import { useEffect, useState } from "react";
import { recentDeposits, type IncomingDeposit } from "./deposits";

/** Incoming deposits on every network, refreshed while the page is visible. */
export function useDeposits(accountId: string | null, every: number) {
  const [state, setState] = useState<{ accountId: string; deposits: IncomingDeposit[]; failed: boolean }>();

  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    const read = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const deposits = await recentDeposits(accountId, controller.signal);
        if (!controller.signal.aborted) setState({ accountId, deposits, failed: false });
      } catch {
        if (!controller.signal.aborted) {
          setState(previous => ({ accountId, deposits: previous?.accountId === accountId ? previous.deposits : [], failed: true }));
        }
      }
    };
    void read();
    const timer = window.setInterval(read, every);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [accountId, every]);

  const current = accountId && state?.accountId === accountId ? state : undefined;
  return { deposits: current?.deposits ?? [], failed: current?.failed ?? false, loaded: Boolean(current) };
}
