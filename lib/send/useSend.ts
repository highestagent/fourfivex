"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SendPlan } from "../verbs";
import { PriceMoved, send, sendMany, type Receipt } from "./flow";
import { sent } from "./history";
import type { Prepared } from "./types";

export type SendPhase = "idle" | "working" | "done" | "failed";

/** Runs one real send for the composer. The send carries on even if the sheet is closed. */
export function useSend() {
  const [phase, setPhase] = useState<SendPhase>("idle");
  const [step, setStep] = useState<string | null>(null);
  const [moved, setMoved] = useState<Prepared | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const start = useCallback(
    (plan: SendPlan, record: { kind: "change" | "pay"; text: string; waitingText: string }) => {
      setPhase("working");
      setStep(null);
      setError(null);
      setReceipt(null);
      setSubmitted(false);
      const [first] = plan.legs;
      const onStep = (s: string) => {
        if (alive.current) setStep(s);
      };
      const remember = (addresses: string[], intentHash: string) => {
        sent.add({
          id: addresses[0],
          ...(addresses.length > 1 ? { legs: addresses } : {}),
          accountId: first.ask.accountId,
          kind: record.kind,
          text: record.text,
          waitingText: record.waitingText,
          at: Date.now(),
          state: "waiting",
          intentHash,
          links: addresses.length > 1 ? [{ hash: intentHash, url: `https://nearblocks.io/txns/${intentHash}` }] : [],
        });
        if (alive.current) setSubmitted(true);
      };
      const running = plan.legs.length === 1
        ? send(first.ask, {
          shown: plan.shown,
          source: first.source,
          onStep,
          onSubmitted: ({ depositAddress, intentHash }) => remember([depositAddress], intentHash),
        })
        : sendMany(plan.legs, {
          shown: plan.shown,
          shownUsd: plan.shownUsd,
          onStep,
          onSubmitted: ({ depositAddresses, intentHash }) => remember(depositAddresses, intentHash),
        });
      running.then(
        (r) => {
          // Always recorded: the send went ahead whether or not anyone is watching.
          sent.update(r.depositAddress, { state: r.state, links: r.links });
          if (!alive.current) return;
          setReceipt(r);
          setPhase(r.state === "refunded" || r.state === "failed" ? "failed" : "done");
        },
        (e: unknown) => {
          if (!alive.current) return;
          if (e instanceof PriceMoved) {
            setMoved(e.prepared);
            setError(null);
          } else {
            // Once a send is accepted it no longer throws, so this means nothing was sent.
            setError(e instanceof Error ? e.message : "Something went wrong. Nothing was sent.");
          }
          setPhase("idle");
        },
      );
    },
    [],
  );

  const clearPreview = useCallback(() => {
    setMoved(null);
    setError(null);
  }, []);

  return { phase, step, moved, receipt, error, submitted, start, clearPreview };
}
