"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import type { Holdings } from "@/lib/account/holdings";
import type { Prices } from "@/lib/assets";
import { exact, when } from "@/lib/format";
import { useMobileSheet, useQuote } from "@/lib/hooks";
import { prepareSend } from "@/lib/send/api";
import { sent, useSent } from "@/lib/send/history";
import { payInOf } from "@/lib/send/payin";
import type { Person } from "@/lib/send/people";
import type { Prepared, SendState } from "@/lib/send/types";
import { useSend } from "@/lib/send/useSend";
import { VERBS, type Ctx, type Outcome, type SlotCtx, type Tone, type Vals, type VerbKey } from "@/lib/verbs";
import { NewPerson } from "./NewPerson";
import { Sentence } from "./Sentence";
import { Sheet } from "./Sheet";
import { CopyButton, Finger } from "./ui";

export type ActionKey = Extract<VerbKey, "pay" | "getpaid" | "change">;

type Deposit = { prepared: Prepared; amount: string; symbol: string; network: string };
type Detail = { k: string; v: ReactNode; sub?: string; tone?: Tone };

const LABELS = { pay: "Pay", getpaid: "Add money", change: "Change" };
const ACTIONS = { pay: "Approve payment", getpaid: "Get deposit address", change: "Approve swap" };
const REFUND_HINT = { evm: "0x…", sol: "", near: "name.near", btc: "bc1…" };
const DEPOSIT_STATUS: Record<SendState, string> = {
  waiting: "Waiting for deposit",
  seen: "Deposit detected",
  working: "Adding money",
  done: "Added",
  short: "Deposit was short",
  refunded: "Returned to the refund address",
  failed: "Deposit failed",
};

function CopyValue({ value, label, children }: { value: string; label: string; children?: ReactNode }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="min-w-0 wrap-anywhere">{children ?? value}</span>
      <CopyButton text={value} label={label} />
    </span>
  );
}

function depositDetails(deposit: Deposit): Detail[] {
  const { prepared, amount, symbol, network } = deposit;
  const { depositAddress, depositMemo, deadline } = prepared;
  return [
    { k: "Send exactly", v: <CopyValue value={amount} label="Copy amount">{amount} {symbol}</CopyValue> },
    { k: "Network", v: network, sub: `Send only ${symbol} on this network.`, tone: "warn" },
    { k: "Address", v: <CopyValue value={depositAddress} label="Copy address"><span className="font-mono text-[13px]">{depositAddress}</span></CopyValue> },
    ...(depositMemo ? [{ k: "Required memo", v: <CopyValue value={depositMemo} label="Copy memo" /> }] : []),
    { k: "Deadline", v: when(deadline) },
  ];
}

export function Composer({
  action,
  prices,
  pricesLive,
  holdings,
  people,
  accountId,
  now,
  onClose,
  onOpenAccount,
}: {
  action: ActionKey;
  prices: Prices;
  pricesLive: boolean;
  holdings: Holdings | null;
  people: Person[];
  accountId: string | null;
  now: number | null;
  onClose: () => void;
  onOpenAccount: () => void;
}) {
  const verb = VERBS[action];
  const variant = verb.real!;
  const demo = accountId === null;
  const mobile = useMobileSheet();
  const form = demo && action !== "getpaid" ? verb : variant;
  const [edits, setEdits] = useState<Vals>({});
  const previousRecipient = useRef<string | number>("");
  const [initialHoldings, setInitialHoldings] = useState(holdings);
  if (!initialHoldings && holdings) setInitialHoldings(holdings);
  const slots = useMemo<SlotCtx>(() => ({
    prices,
    holdings: initialHoldings ?? holdings,
    people,
  }), [prices, holdings, initialHoldings, people]);
  const defaults = demo && action !== "getpaid" ? verb.def : variant.def(slots);
  if (mobile && !demo && action === "pay" && defaults.who === "__new") defaults.who = "";
  const vals = { ...defaults, ...edits };
  const [frozen, setFrozen] = useState<Outcome | null>(null);
  const [deposit, setDeposit] = useState<Deposit | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [depositError, setDepositError] = useState<string | null>(null);
  const engine = useSend();
  const mine = useSent(accountId);
  const depositEntry = mine.find((entry) => entry.id === deposit?.prepared.depositAddress);
  const depositState = depositEntry?.state ?? "waiting";
  const depositExpired = deposit !== null && depositState === "waiting" && now !== null && now >= Date.parse(deposit.prepared.deadline);
  const busy = requesting || engine.phase === "working";
  const receipt = engine.receipt;
  const activity = mine.find((entry) => entry.id === receipt?.depositAddress);
  const sendState = activity?.state ?? receipt?.state;
  const links = depositEntry?.links ?? activity?.links ?? receipt?.links ?? [];
  const complete = receipt !== null || deposit !== null;
  const addingPerson = !demo && action === "pay" && vals.who === "__new";
  const recipientStep = mobile && addingPerson;
  const recipient = action === "pay" && !demo ? people.find((person) => person.id === vals.who) : undefined;
  const payIn = action === "getpaid" ? payInOf(vals.with) : null;

  const quoteCtx: Ctx = { prices, pricesLive, quote: { status: "none" }, holdings, people, accountId, moved: null };
  const sameAsset = action === "change" && vals.from === vals.to;
  const ask = demo && action !== "getpaid" ? (sameAsset ? null : verb.ask?.(vals) ?? null) : variant.ask(vals, quoteCtx);
  const quote = useQuote(ask, busy || complete);
  const ctx: Ctx = { ...quoteCtx, quote, moved: receipt?.prepared ?? engine.moved };
  const current = form.out(vals, ctx);
  const outcome = busy && frozen ? frozen : current;
  const blocked = !demo && !complete ? current.blocked : undefined;
  const error = depositError ?? engine.error;
  const showDetails = deposit !== null || (
    !receipt && !addingPerson && !sameAsset && Number(vals.amt) >= 1 &&
    (demo || busy || quote.status === "live" || engine.moved !== null)
  );
  const rows: Detail[] = deposit
    ? depositDetails(deposit)
    : outcome.rows.filter(({ k }) => k !== "If the price moves" && k !== "Afterwards" && (!demo || k !== "Seen by")).map((row) => (
      row.k === "Sent to" && recipient
        ? { ...row, v: <CopyValue value={recipient.address} label="Copy recipient address"><span className="font-mono text-[13px]">{recipient.address}</span></CopyValue> }
        : row
    ));

  const change = (key: string, value: string | number) => {
    if (key === "who" && value === "__new" && vals.who !== "__new") {
      previousRecipient.current = vals.who ?? "";
    }
    const next = variant.fix?.({ ...vals, [key]: value }, key) ?? { ...vals, [key]: value };
    const changes = Object.fromEntries(Object.entries(next).filter(([name, val]) => val !== vals[name]));
    setEdits((previous) => ({ ...previous, ...changes }));
    setDepositError(null);
    engine.clearPreview();
  };
  const cancelRecipient = () => change("who", mobile ? previousRecipient.current : people[0]?.id ?? "");

  const approve = async () => {
    if (busy || blocked || demo || complete) return;
    if (variant.request && payIn) {
      const request = variant.request(vals, ctx);
      if (!request) return;
      setRequesting(true);
      setDepositError(null);
      setFrozen(current);
      try {
        const prepared = await prepareSend(request);
        const amount = exact(prepared.leaves.units, prepared.leaves.decimals);
        sent.add({
          id: prepared.depositAddress,
          accountId: request.accountId,
          kind: "add",
          text: current.past,
          waitingText: current.waiting,
          at: Date.now(),
          state: "waiting",
          links: [],
          deadline: prepared.deadline,
          deposit: {
            address: prepared.depositAddress,
            memo: prepared.depositMemo,
            amount,
            word: payIn.word,
            symbol: prepared.leaves.symbol,
            networkName: payIn.networkName,
          },
        });
        setDeposit({ prepared, amount, symbol: prepared.leaves.symbol, network: payIn.networkName });
      } catch (err) {
        setDepositError(err instanceof Error ? err.message : "Could not get a deposit address. Try again.");
      } finally {
        setRequesting(false);
      }
    } else {
      const plan = variant.plan?.(vals, ctx);
      if (!plan) return;
      setFrozen(current);
      engine.start(plan, { kind: plan.ask.kind, text: current.past, waitingText: current.waiting ?? current.past });
    }
  };

  const summary = deposit
    ? depositState === "done" ? outcome.past
      : depositState === "waiting" && !depositExpired ? "Send money from another wallet."
        : depositExpired ? "The deposit address expired."
          : DEPOSIT_STATUS[depositState]
    : sendState === "done" ? outcome.past
      : sendState === "refunded" ? "The funds were returned."
        : sendState === "failed" ? "The transaction failed."
          : receipt ? outcome.waiting : null;
  const needsDeposit = deposit !== null && depositState === "waiting" && !depositExpired;

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

        {payIn && !demo && !deposit && (
          <label className="grid gap-2 text-sm font-medium">
            Refund address on {payIn.networkName}
            <input
              id="add-refund"
              className="field bg-white font-mono"
              placeholder={REFUND_HINT[payIn.family]}
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              disabled={busy}
              value={String(vals.refund ?? "")}
              onChange={(event) => change("refund", event.target.value)}
              aria-describedby="refund-note"
            />
            <span id="refund-note" className="text-sm font-normal text-ink-2">Use an address you control for any refund.</span>
          </label>
        )}

        {showDetails && (!deposit || needsDeposit) && (
          <dl className="rounded-[18px] border border-line bg-white px-4 sm:px-5">
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
            {links.map(({ hash, url }, index) => (
              <a key={hash} href={url} target="_blank" rel="noreferrer" className="text-blue underline underline-offset-2">
                {links.length === 1 ? "View transaction" : `View transaction ${index + 1}`}
              </a>
            ))}
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
              <p role="status" className="text-sm font-medium">{requesting ? "Getting deposit address…" : engine.step ?? "Preparing transaction…"}</p>
            ) : (
              <button
                type="button"
                className="action action-primary w-full sm:w-fit"
                disabled={!!blocked}
                onClick={complete ? onClose : demo ? onOpenAccount : () => void approve()}
              >
                {!complete && !payIn && !demo && <Finger size={17} />}
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
