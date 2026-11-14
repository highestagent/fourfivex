"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import type { Holdings } from "@/lib/account/holdings";
import type { Prices } from "@/lib/assets";
import { useMobileSheet, useQuote } from "@/lib/hooks";
import { sendAddresses } from "@/lib/send/explorer";
import { useSent } from "@/lib/send/history";
import type { Person } from "@/lib/send/people";
import { useSend } from "@/lib/send/useSend";
import { VERBS, type Ctx, type Outcome, type SlotCtx, type Tone, type Vals, type VerbKey } from "@/lib/verbs";
import { Address } from "./Address";
import { NewPerson } from "./NewPerson";
import { SendLinks } from "./SendLinks";
import { Sentence } from "./Sentence";
import { Sheet } from "./Sheet";
import { CopyButton, Finger } from "./ui";

export type ActionKey = Extract<VerbKey, "pay" | "change">;

type Detail = { k: string; v: ReactNode; sub?: string; tone?: Tone };

const LABELS = { pay: "Pay", change: "Change" };
const ACTIONS = { pay: "Approve payment", change: "Approve swap" };
function CopyAddress({ value, label }: { value: string; label: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Address value={value} className="flex-1 text-[13px]" />
      <CopyButton text={value} label={label} />
    </span>
  );
}

export function Composer({
  action,
  prices,
  pricesLive,
  holdings,
  people,
  accountId,
  onClose,
  onOpenAccount,
}: {
  action: ActionKey;
  prices: Prices;
  pricesLive: boolean;
  holdings: Holdings | null;
  people: Person[];
  accountId: string | null;
  onClose: () => void;
  onOpenAccount: () => void;
}) {
  const verb = VERBS[action];
  const variant = verb.real!;
  const demo = accountId === null;
  const mobile = useMobileSheet();
  const form = demo ? verb : variant;
  const [edits, setEdits] = useState<Vals>({});
  const previousRecipient = useRef<string | number>("");
  const [initialHoldings, setInitialHoldings] = useState(holdings);
  if (!initialHoldings && holdings) setInitialHoldings(holdings);
  const slots = useMemo<SlotCtx>(() => ({
    prices,
    holdings: initialHoldings ?? holdings,
    people,
  }), [prices, holdings, initialHoldings, people]);
  const defaults = demo ? verb.def : variant.def(slots);
  if (mobile && !demo && action === "pay" && defaults.who === "__new") defaults.who = "";
  const vals = { ...defaults, ...edits };
  const [frozen, setFrozen] = useState<Outcome | null>(null);
  const engine = useSend();
  const mine = useSent(accountId);
  const busy = engine.phase === "working";
  const receipt = engine.receipt;
  const activity = mine.find((entry) => entry.id === receipt?.depositAddress);
  const sendState = activity?.state ?? receipt?.state;
  // The explorer's page exists from the moment a send is submitted, so the link shows while it travels too.
  const links = activity ? sendAddresses(activity) : receipt ? sendAddresses({ id: receipt.depositAddress, legs: receipt.legs }) : [];
  const complete = receipt !== null;
  const addingPerson = !demo && action === "pay" && vals.who === "__new";
  const recipientStep = mobile && addingPerson;
  const recipient = action === "pay" && !demo ? people.find((person) => person.id === vals.who) : undefined;

  const quoteCtx: Ctx = { prices, pricesLive, quote: { status: "none" }, holdings, people, accountId, moved: null };
  const sameAsset = action === "change" && vals.from === vals.to;
  const ask = demo ? (sameAsset ? null : verb.ask?.(vals) ?? null) : variant.ask(vals, quoteCtx);
  const quote = useQuote(ask, busy || complete);
  const ctx: Ctx = { ...quoteCtx, quote, moved: receipt?.prepared ?? engine.moved };
  const current = form.out(vals, ctx);
  const outcome = busy && frozen ? frozen : current;
  const blocked = !demo && !complete ? current.blocked : undefined;
  const error = engine.error;
  const showDetails = !receipt && !addingPerson && !sameAsset && Number(vals.amt) >= 1 &&
    (demo || busy || quote.status === "live" || engine.moved !== null);
  const rows: Detail[] = outcome.rows.filter(({ k }) => k !== "If the price moves" && k !== "Afterwards" && (!demo || k !== "Seen by")).map((row) => (
      row.k === "Sent to" && recipient
        ? { ...row, v: <CopyAddress value={recipient.address} label="Copy recipient address" /> }
        : row
    ));

  const change = (key: string, value: string | number) => {
    if (key === "who" && value === "__new" && vals.who !== "__new") {
      previousRecipient.current = vals.who ?? "";
    }
    const next = variant.fix?.({ ...vals, [key]: value }, key) ?? { ...vals, [key]: value };
    const changes = Object.fromEntries(Object.entries(next).filter(([name, val]) => val !== vals[name]));
    setEdits((previous) => ({ ...previous, ...changes }));
    engine.clearPreview();
  };
  const cancelRecipient = () => change("who", mobile ? previousRecipient.current : people[0]?.id ?? "");

  const approve = async () => {
    if (busy || blocked || demo || complete) return;
    const plan = variant.plan?.(vals, ctx);
    if (!plan) return;
    setFrozen(current);
    engine.start(plan, { kind: plan.legs[0].ask.kind, text: current.past, waitingText: current.waiting ?? current.past });
  };

  const summary = sendState === "done" ? outcome.past
    : sendState === "partial" ? "Only part went through. The rest is back in your account."
    : sendState === "refunded" ? "The funds were returned."
      : sendState === "failed" ? "The transaction failed."
        : receipt ? outcome.waiting : null;

  return (
    <Sheet
      label={LABELS[action]}
      onClose={onClose}
      busy={busy && !engine.submitted}
      step={recipientStep ? { title: "New recipient", onBack: cancelRecipient, returnFocusId: "blank-who" } : undefined}
    >
      <div className={recipientStep ? "hidden" : "grid gap-6"}>
        {summary ? <p className="sentence" role="status">{summary}</p> : (
          <Sentence parts={variant.parts} slots={form.slots} vals={vals} ctx={slots} disabled={busy} allowNewRecipient={mobile && !demo} onChange={change} />
        )}

        {addingPerson && !mobile && <NewPerson onSave={(person) => change("who", person.id)} onCancel={cancelRecipient} />}

        {showDetails && (
          <dl className="rounded-[18px] border border-line bg-surface px-4 sm:px-5">
            {rows.map(({ k, v, sub, tone }) => (
              <div key={k} className="detail-row">
                <dt>{k}</dt>
                <dd className="min-w-0 wrap-anywhere">
                  <span className={tone === "ok" ? "font-medium text-green" : tone === "stop" ? "text-rose" : tone === "warn" ? "text-amber" : "text-ink"}>{v}</span>
                  {sub && <span className="mt-0.5 block text-[13px] text-ink-2">{sub}</span>}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {links.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            <SendLinks addresses={links} />
          </div>
        )}

        {!addingPerson && (
          <div className="grid gap-3">
            {demo && sameAsset && <p role="status" className="text-sm text-ink-2">Choose a different asset to receive.</p>}
            {demo && quote.status !== "live" && showDetails && <p className="text-sm text-ink-2">Estimated amounts</p>}
            {engine.moved && !busy && !complete && (
              <p role="status" className="rounded-xl bg-amber-3 px-3 py-2 text-sm text-amber">The quote changed. Review the updated amounts before approving.</p>
            )}
            {error && <p role="alert" className="text-sm text-rose">{error}</p>}
            {blocked && !error && !busy && <p role="status" className="text-sm text-ink-2">{quote.status === "unavailable" && blocked === "Getting a price…" ? "Quote unavailable. Retrying…" : blocked}</p>}
            {busy ? (
              <p role="status" className="text-sm font-medium">{engine.step ?? "Preparing transaction…"}</p>
            ) : (
              <button
                type="button"
                className="action action-primary w-full sm:w-fit"
                disabled={!!blocked}
                onClick={complete ? onClose : demo ? onOpenAccount : () => void approve()}
              >
                {!complete && !demo && <Finger size={17} />}
                {complete ? "Done" : demo ? "Open account to continue" : ACTIONS[action]}
              </button>
            )}
          </div>
        )}
      </div>
      {recipientStep && <NewPerson onSave={(person) => change("who", person.id)} />}
    </Sheet>
  );
}
