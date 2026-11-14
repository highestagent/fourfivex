"use client";

/**
 * What an account has sent or is waiting for, kept on this device. Public details only.
 * Same pattern as lib/account/store.ts.
 */
import { useSyncExternalStore } from "react";
import type { SendState } from "./types";

export type SentEntry = {
  /** The deposit address. */
  id: string;
  accountId: string;
  kind: "change" | "pay" | "add" | "withdraw";
  /** Past tense, for when it is done. */
  text: string;
  /** Shown while it is still in progress. */
  waitingText?: string;
  at: number;
  state: SendState;
  intentHash?: string;
  links: { hash: string; url: string }[];
  deadline?: string;
  /** For an add: where and how much to send. */
  deposit?: { address: string; memo?: string; amount: string; word: string; symbol?: string; networkName: string };
};

const KEY = "intuite.sent.v1";
const PER_ACCOUNT = 200;
const EMPTY: SentEntry[] = [];
const listeners = new Set<() => void>();
let cache: { raw: string | null; value: SentEntry[] } = { raw: null, value: EMPTY };

function parse(raw: string | null): SentEntry[] {
  if (!raw) return EMPTY;
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v)
      ? v.filter((e): e is SentEntry => !!e && typeof e.id === "string" && typeof e.accountId === "string" && typeof e.at === "number")
      : EMPTY;
  } catch {
    return EMPTY;
  }
}

function read(): SentEntry[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    /* storage blocked: behave as a device with no memory */
  }
  if (raw !== cache.raw) cache = { raw, value: parse(raw) };
  return cache.value;
}

function write(next: SentEntry[]): void {
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

/** The newest entries of one account stay; older ones beyond the limit are dropped. */
function trim(all: SentEntry[]): SentEntry[] {
  const seen = new Map<string, number>();
  return [...all]
    .sort((a, b) => b.at - a.at)
    .filter((e) => {
      const n = (seen.get(e.accountId) ?? 0) + 1;
      seen.set(e.accountId, n);
      return n <= PER_ACCOUNT;
    });
}

const mine = new Map<string, { source: SentEntry[]; value: SentEntry[] }>();

/** Newest first, for one account. The same array comes back until something changes. */
function forAccount(accountId: string | null): SentEntry[] {
  if (!accountId) return EMPTY;
  const all = read();
  const hit = mine.get(accountId);
  if (hit && hit.source === all) return hit.value;
  const value = all.filter((e) => e.accountId === accountId).sort((a, b) => b.at - a.at);
  mine.set(accountId, { source: all, value });
  return value;
}

export function useSent(accountId: string | null): SentEntry[] {
  return useSyncExternalStore(
    subscribe,
    () => forAccount(accountId),
    () => EMPTY,
  );
}

export const sent = {
  add(entry: Omit<SentEntry, "at"> & { at?: number }): void {
    write(trim([...read().filter((e) => e.id !== entry.id), { ...entry, at: entry.at ?? Date.now() }]));
  },
  update(id: string, patch: Partial<Omit<SentEntry, "id">>): void {
    const all = read();
    const entry = all.find((item) => item.id === id);
    if (!entry) return;
    const next = { ...entry, ...patch };
    if (JSON.stringify(next) !== JSON.stringify(entry)) write(all.map((item) => item.id === id ? next : item));
  },
  remove(id: string): void {
    write(read().filter((e) => e.id !== id));
  },
};
