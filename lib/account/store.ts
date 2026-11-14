"use client";

/**
 * What this device remembers: which passkeys it has seen and which account is open.
 * All of it is public information. Nothing here can sign anything, and clearing it
 * loses nothing that a passkey cannot bring back.
 */
import { useSyncExternalStore } from "react";
import { parseWatchedWallet, walletKey, type WatchedWallet } from "./portfolio";
import type { Known } from "./session";

export type Passkey = Known & {
  label: string;
  addedAt: number;
  /** The passkey the account was derived from. */
  founder: boolean;
  /** Created on this device but not yet confirmed as attached to the account. */
  pending?: boolean;
};

export type DeviceMemory = {
  current: string | null;
  passkeys: Passkey[];
  names: Record<string, string>;
  wallets: Record<string, WatchedWallet[]>;
};

const KEY = "fourfivex.account.v1";
const EMPTY: DeviceMemory = { current: null, passkeys: [], names: {}, wallets: {} };
const listeners = new Set<() => void>();
let cache: { raw: string | null; value: DeviceMemory } = { raw: null, value: EMPTY };

function parse(raw: string | null): DeviceMemory {
  if (!raw) return EMPTY;
  try {
    const v = JSON.parse(raw) as Partial<DeviceMemory>;
    const wallets: DeviceMemory["wallets"] = {};
    for (const [id, list] of Object.entries(v.wallets ?? {})) {
      if (!/^0x[a-f0-9]{40}$/.test(id) || !Array.isArray(list)) continue;
      const parsed = list.map(parseWatchedWallet).filter(wallet => wallet !== null);
      wallets[id] = [...new Map(parsed.map(wallet => [walletKey(wallet), wallet])).values()];
    }
    return {
      current: typeof v.current === "string" ? v.current : null,
      passkeys: Array.isArray(v.passkeys) ? v.passkeys.filter((p) => p && p.credentialId && p.publicKey && p.accountId) : [],
      names: v.names && typeof v.names === "object" ? v.names : {},
      wallets,
    };
  } catch {
    return EMPTY;
  }
}

function read(): DeviceMemory {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    /* storage blocked: behave as a device with no memory */
  }
  if (raw !== cache.raw) cache = { raw, value: parse(raw) };
  return cache.value;
}

function write(next: DeviceMemory): void {
  const raw = JSON.stringify(next);
  cache = { raw, value: next };
  try {
    window.localStorage.setItem(KEY, raw);
  } catch {
    /* kept in memory for this visit only */
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useDeviceMemory(): DeviceMemory {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

export const memory = {
  get: read,
  recall: (credentialId: string) => read().passkeys.find((p) => p.credentialId === credentialId && !p.pending),
  remember(passkey: Passkey): void {
    const m = read();
    write({ ...m, passkeys: [...m.passkeys.filter((p) => p.credentialId !== passkey.credentialId), passkey] });
  },
  confirm(credentialId: string): void {
    const m = read();
    write({ ...m, passkeys: m.passkeys.map((p) => (p.credentialId === credentialId ? { ...p, pending: false } : p)) });
  },
  forget(credentialId: string): void {
    const m = read();
    write({ ...m, passkeys: m.passkeys.filter((p) => p.credentialId !== credentialId) });
  },
  open(accountId: string | null): void {
    write({ ...read(), current: accountId });
  },
  name(accountId: string, name: string): void {
    const m = read();
    write({ ...m, names: { ...m.names, [accountId]: name } });
  },
  watchWallet(accountId: string, wallet: WatchedWallet): void {
    const m = read();
    const wallets = m.wallets[accountId] ?? [];
    if (wallets.some(entry => walletKey(entry) === walletKey(wallet))) return;
    write({ ...m, wallets: { ...m.wallets, [accountId]: [...wallets, wallet] } });
  },
  unwatchWallet(accountId: string, wallet: WatchedWallet): void {
    const m = read();
    const wallets = (m.wallets[accountId] ?? []).filter(entry => walletKey(entry) !== walletKey(wallet));
    write({ ...m, wallets: { ...m.wallets, [accountId]: wallets } });
  },
};
