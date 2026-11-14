import type { SendStatus } from "./types";

const FINISHED = new Set(["done", "refunded", "failed"]);

/**
 * One status for a send split across networks. It is done when every part arrived, partial when
 * some arrived and the rest came back, and otherwise as far along as its slowest part.
 */
export function combinedStatus(parts: readonly SendStatus[]): SendStatus {
  const links = parts.flatMap((part) => part.links);
  const states = parts.map((part) => part.state);
  if (!states.every((state) => FINISHED.has(state))) {
    const state = states.includes("short") ? "short" : states.some((s) => s === "working" || s === "seen" || FINISHED.has(s)) ? "working" : "waiting";
    return { state, links };
  }
  const arrived = parts.flatMap((part) => (part.arrived ? [part.arrived] : []));
  const refunded = parts.flatMap((part) => (part.refunded ? [part.refunded] : []));
  const done = states.filter((state) => state === "done").length;
  const state = done === parts.length ? "done" : done > 0 ? "partial" : states.includes("failed") ? "failed" : "refunded";
  return {
    state,
    links,
    ...(arrived.length ? { arrived: { amount: sum(arrived.map((a) => a.amount)), usd: sum(arrived.map((a) => a.usd)) } } : {}),
    ...(refunded.length ? { refunded: { amount: sum(refunded.map((r) => r.amount)) } } : {}),
  };
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
