"use client";

/** People this device has saved to pay again. Public details only. Same pattern as lib/account/store.ts. */
import { useSyncExternalStore } from "react";
import type { Network } from "./types";

export type Person = { id: string; name: string; address: string; network: Network };

const KEY = "fourfivex.people.v1";
const EMPTY: Person[] = [];
const listeners = new Set<() => void>();
let cache: { raw: string | null; value: Person[] } = { raw: null, value: EMPTY };

function parse(raw: string | null): Person[] {
  if (!raw) return EMPTY;
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v)
      ? v.filter((p): p is Person => !!p && typeof p.id === "string" && typeof p.name === "string" && typeof p.address === "string" && typeof p.network === "string")
      : EMPTY;
  } catch {
    return EMPTY;
  }
}

function read(): Person[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    /* storage blocked: behave as a device with no memory */
  }
  if (raw !== cache.raw) cache = { raw, value: parse(raw) };
  return cache.value;
}

function write(next: Person[]): void {
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

export function usePeople(): Person[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

export const people = {
  add(person: Omit<Person, "id">): Person {
    const name = person.name.trim();
    if (!name) throw new Error("Give them a name.");
    const all = read();
    const same = all.find((p) => p.address === person.address && p.network === person.network);
    if (same) return same;
    const made: Person = { id: crypto.randomUUID(), name, address: person.address, network: person.network };
    write([...all, made]);
    return made;
  },
  remove(id: string): void {
    write(read().filter((p) => p.id !== id));
  },
};
