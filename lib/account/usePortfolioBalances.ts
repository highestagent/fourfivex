"use client";

import { useEffect, useState } from "react";
import { tradeApi } from "../markets/api";
import { walletKey, type TradingBalance, type WalletAsset, type WatchedWallet } from "./portfolio";

type Balance<T> = { value: T; failed: false } | { value: null; failed: true };

async function fetchWallet(wallet: WatchedWallet, signal: AbortSignal) {
  const response = await fetch("/api/wallet-balances", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(wallet),
    signal,
  });
  if (!response.ok) throw new Error("Wallet balance unavailable.");
  return (await response.json() as { assets: WalletAsset[] }).assets;
}

export function usePortfolioBalances(accountId: string, wallets: readonly WatchedWallet[]) {
  const [trading, setTrading] = useState<Balance<TradingBalance | null>>();
  const [walletBalances, setWalletBalances] = useState<Record<string, Balance<WalletAsset[]>>>({});

  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const { balance } = await tradeApi<{ balance: TradingBalance | null }>(accountId, "balance", {}, controller.signal);
        if (!controller.signal.aborted) setTrading({ value: balance, failed: false });
      } catch {
        if (!controller.signal.aborted) setTrading({ value: null, failed: true });
      }
    };
    void refresh();
    const timer = setInterval(refresh, 30_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [accountId]);

  useEffect(() => {
    if (!wallets.length) return;
    const controller = new AbortController();
    const refresh = () => {
      for (const wallet of wallets) {
        const save = (result: Balance<WalletAsset[]>) => {
          if (!controller.signal.aborted) setWalletBalances(previous => ({ ...previous, [walletKey(wallet)]: result }));
        };
        void fetchWallet(wallet, controller.signal).then(
          value => save({ value, failed: false }), () => save({ value: null, failed: true }),
        );
      }
    };
    refresh();
    const timer = setInterval(refresh, 30_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [wallets]);

  function forgetWalletBalance(wallet: WatchedWallet) {
    setWalletBalances(previous => {
      const next = { ...previous };
      delete next[walletKey(wallet)];
      return next;
    });
  }

  return { trading, walletBalances, forgetWalletBalance };
}
