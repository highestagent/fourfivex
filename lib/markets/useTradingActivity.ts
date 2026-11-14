"use client";

import { useEffect, useState } from "react";
import { tradeApi, type TradeAccount } from "./api";
import { readOpenPositions, readTradingHistory, type TradingEvent } from "./activity";
import type { Position, TradingAddress } from "./trade";

const REFRESH = 30_000;

type Loaded<T> = { address: TradingAddress; value: T; failed: boolean };

/** Polls while the page is visible, so a background tab doesn't keep asking Hyperliquid. */
function poll(read: (signal: AbortSignal) => Promise<void>) {
  const controller = new AbortController();
  const run = () => {
    if (document.visibilityState === "visible") void read(controller.signal);
  };
  run();
  const timer = window.setInterval(run, REFRESH);
  return () => {
    controller.abort();
    window.clearInterval(timer);
  };
}

/**
 * The account's trading positions and history, so the wallet can show them next to everything else.
 * History is only read while someone is looking at it.
 */
export function useTradingActivity(accountId: string | null, withHistory: boolean) {
  const [account, setAccount] = useState<{ accountId: string; address: TradingAddress | null }>();
  const [positions, setPositions] = useState<Loaded<Position[]>>();
  const [history, setHistory] = useState<Loaded<TradingEvent[]>>();

  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    tradeApi<TradeAccount>(accountId, "account", {}, controller.signal).then(data => {
      if (!controller.signal.aborted) setAccount({ accountId, address: data.available ? data.address : null });
    }, () => {
      if (!controller.signal.aborted) setAccount({ accountId, address: null });
    });
    return () => controller.abort();
  }, [accountId]);

  const address = account && account.accountId === accountId ? account.address : null;

  useEffect(() => {
    if (!address) return;
    return poll(async signal => {
      try {
        const value = await readOpenPositions(address, signal);
        if (!signal.aborted) setPositions({ address, value, failed: false });
      } catch {
        if (!signal.aborted) setPositions(previous => ({ address, value: previous?.address === address ? previous.value : [], failed: true }));
      }
    });
  }, [address]);

  useEffect(() => {
    if (!address || !withHistory) return;
    return poll(async signal => {
      try {
        const value = await readTradingHistory(address, signal);
        if (!signal.aborted) setHistory({ address, value, failed: false });
      } catch {
        if (!signal.aborted) setHistory(previous => ({ address, value: previous?.address === address ? previous.value : [], failed: true }));
      }
    });
  }, [address, withHistory]);

  const current = <T,>(loaded: Loaded<T> | undefined) => (address && loaded?.address === address ? loaded : undefined);
  return {
    trading: address !== null,
    address,
    positions: current(positions)?.value ?? [],
    events: current(history)?.value ?? [],
    historyFailed: current(history)?.failed ?? false,
  };
}
