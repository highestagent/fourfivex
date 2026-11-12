"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { NetworkError } from "@/lib/account/api";
import {
  addBackupPasskey,
  attachPasskey,
  countPasskeys,
  createAccount,
  openAccount,
  removePasskey,
  signOut,
} from "@/lib/account/flows";
import { isLocalDevelopment, PasskeyError, passkeysAvailable } from "@/lib/account/passkey";
import { AccountError } from "@/lib/account/session";
import { memory, useDeviceMemory, type Passkey } from "@/lib/account/store";
import type { HoldingsState } from "@/lib/account/useHoldings";
import { coin, usd } from "@/lib/format";
import { Sheet, SheetLabel } from "./Sheet";
import { Finger, Panel, Spinner, StatusPill, Tick } from "./ui";

const noop = () => () => {};

/** Browser facts that are unknown on the server. False until the page is live. */
function useBrowser(read: () => boolean): boolean {
  return useSyncExternalStore(noop, read, () => false);
}

function reason(err: unknown): string {
  if (err instanceof PasskeyError || err instanceof AccountError || err instanceof NetworkError) return err.message;
  return "Something went wrong. Nothing was changed.";
}

function short(accountId: string): string {
  return `${accountId.slice(0, 6)}…${accountId.slice(-4)}`;
}

type RowTone = "ok" | "stop";

function Row({ k, v, sub, tone }: { k: string; v: ReactNode; sub?: ReactNode; tone?: RowTone }) {
  const color = tone === "ok" ? "text-green" : tone === "stop" ? "font-medium text-rose" : "";
  const dot = tone === "ok" ? "bg-green-2" : "bg-rose";
  return (
    <div className="grid grid-cols-[minmax(0,112px)_minmax(0,1fr)] gap-3 border-t border-line/70 py-2.5 first:border-t-0">
      <dt className="mono pt-[3px] text-ink-3">{k}</dt>
      <dd className="min-w-0 text-[14.5px] leading-snug">
        <span className={`flex items-baseline gap-2 ${color}`}>
          {tone && <span className={`size-1.5 shrink-0 -translate-y-px rounded-full ${dot}`} />}
          <span className="min-w-0">{v}</span>
        </span>
        {sub && <span className={`block text-[12.5px] leading-snug text-ink-3 ${tone ? "pl-3.5" : ""}`}>{sub}</span>}
      </dd>
    </div>
  );
}

const SENTENCE = "text-[clamp(22px,3.3vw,30px)] font-medium leading-[1.8] tracking-[-0.022em]";
const BLANK =
  "rounded-full bg-white px-[0.62em] py-[0.12em] align-baseline text-[0.84em] leading-[1.45] tracking-[-0.015em] shadow-chip outline-none placeholder:text-ink-3 focus:ring-2 focus:ring-blue";
const BLACK =
  "inline-flex h-14 items-center justify-center gap-2.5 rounded-full bg-ink px-7 text-[15px] font-medium text-white shadow-pill transition-[transform,opacity] duration-200 enabled:cursor-pointer enabled:active:scale-[0.985] disabled:opacity-40";
const WHITE =
  "inline-flex h-14 items-center justify-center gap-2 rounded-full bg-white px-6 text-[15px] font-medium shadow-chip enabled:cursor-pointer disabled:opacity-40";

function LocalWarning() {
  return (
    <p className="mt-5 rounded-[16px] bg-amber-3 px-4 py-3 text-[13.5px] leading-snug text-amber">
      You are on localhost. A passkey made here only works at localhost, yet the account it opens is a real one on
      the network. Don’t send money to it.
    </p>
  );
}

/* ───────────────────────── no account open ───────────────────────── */

function Welcome() {
  const supported = useBrowser(passkeysAvailable);
  const local = useBrowser(isLocalDevelopment);
  const m = useDeviceMemory();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<null | "create" | "open">(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (kind: "create" | "open") => {
    setBusy(kind);
    setError(null);
    setNote(null);
    try {
      if (kind === "create") await createAccount(name);
      else await openAccount(() => setNote("One more touch. This device is meeting your passkey for the first time."));
    } catch (err) {
      setError(reason(err));
    } finally {
      setBusy(null);
      setNote(null);
    }
  };

  return (
    <>
      <div className="mt-8">
        <SheetLabel>Say</SheetLabel>
        <p className={SENTENCE}>
          Open an account for{" "}
          <input
            id="account-name"
            className={`${BLANK} w-[9.5em] max-w-full`}
            placeholder="your name"
            aria-label="Your name"
            value={name}
            maxLength={24}
            autoComplete="given-name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && supported && !busy) run("create");
            }}
          />
          .
        </p>
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-2">
        <div className="min-w-0">
          <SheetLabel>See</SheetLabel>
          <Panel className="p-5">
            <div className="flex items-center justify-between gap-3">
              <span className="mono">What will happen</span>
              <StatusPill tone="muted">Nothing is sent</StatusPill>
            </div>
            <dl className="mt-2">
              <Row k="Opens with" v="your fingerprint, face or device PIN" />
              <Row k="To remember" v="nothing" sub="no password, no seed phrase, no key to copy down" tone="ok" />
              <Row k="Kept by" v="your passkey manager" sub="iCloud Keychain, Google Password Manager, or a security key" />
              <Row k="We store" v="nothing" sub="the account is worked out from the passkey itself" />
              <Row
                k="If you lose it"
                v="the account cannot be recovered"
                sub="add a backup passkey as soon as you are in"
                tone="stop"
              />
            </dl>
          </Panel>
        </div>
        <div className="flex min-w-0 flex-col">
          <SheetLabel>In picture</SheetLabel>
          <div className="flex min-h-[300px] flex-1 flex-col items-center justify-center gap-0 rounded-[22px] bg-black/[0.028] px-4 py-6">
            <span className="mono mb-2 rounded-full bg-white px-2.5 py-1.5 shadow-chip">Your passkey</span>
            <span className={`grid size-14 place-items-center rounded-[18px] bg-white text-ink shadow-chip ${busy ? "ring-2 ring-blue" : ""}`}>
              {busy ? <Spinner size={22} /> : <Finger size={26} />}
            </span>
            <span
              className="my-2 h-9 w-0.5 animate-stream"
              style={{ backgroundImage: "linear-gradient(#2553e6 50%, transparent 50%)", backgroundSize: "2px 12px" }}
            />
            <Panel className="w-full max-w-[290px] p-4">
              <div className="flex items-center justify-between">
                <span className="mono">Your account</span>
                <span className="mono text-ink-3">NEAR Intents</span>
              </div>
              <p className="mt-2.5 flex flex-wrap gap-1.5" aria-hidden="true">
                <span className="mono rounded-md bg-black/[0.05] px-1.5 py-1 text-ink-2">0x</span>
                {[5, 4, 5, 4, 5].map((w, i) => (
                  <span key={i} className="h-[22px] rounded-md bg-black/[0.05]" style={{ width: w * 8 }} />
                ))}
              </p>
              <p className="mono mt-3 text-ink-3">Exists the moment the passkey does</p>
            </Panel>
          </div>
        </div>
      </div>

      <div className="mt-8">
        <SheetLabel>Sign</SheetLabel>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={`${BLACK} w-full sm:w-auto sm:min-w-[260px]`} disabled={!supported || !!busy} onClick={() => run("create")}>
            {busy === "create" ? <Spinner size={16} /> : <Finger size={18} />}
            {busy === "create" ? "Waiting for your passkey" : "Create with a passkey"}
          </button>
          <button type="button" className={`${WHITE} w-full sm:w-auto`} disabled={!supported || !!busy} onClick={() => run("open")}>
            {busy === "open" && <Spinner size={15} />}
            {m.passkeys.length ? "Use my passkey" : "I already have one"}
          </button>
        </div>
        <p className="mt-4 min-h-5 text-[13.5px] leading-snug text-ink-2" aria-live="polite">
          {!supported ? (
            "This browser cannot use passkeys. Try a current Safari, Chrome, Edge or Firefox."
          ) : error ? (
            <span className="text-rose">{error}</span>
          ) : (
            (note ?? "Your device will ask for your fingerprint, face or PIN. That is the whole sign-up.")
          )}
        </p>
        {local && <LocalWarning />}
      </div>
    </>
  );
}

/* ─────────────────────────── account open ─────────────────────────── */

type Chain = { added: string[]; founderAttached: boolean | null } | null;

function You({ accountId, holdings, onClose }: { accountId: string; holdings: HoldingsState; onClose: () => void }) {
  const m = useDeviceMemory();
  const local = useBrowser(isLocalDevelopment);
  const name = m.names[accountId] ?? "My account";
  const mine = m.passkeys.filter((p) => p.accountId === accountId);
  const [draft, setDraft] = useState(name);
  const [chain, setChain] = useState<Chain>(null);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    countPasskeys(accountId)
      .then((c) => alive && setChain(c))
      .catch(() => alive && setChain(null));
    return () => {
      alive = false;
    };
  }, [accountId, version]);

  const act = useCallback(async (work: (onStep: (s: string) => void) => Promise<void>) => {
    setError(null);
    setStep("Preparing");
    try {
      await work(setStep);
    } catch (err) {
      setError(reason(err));
    } finally {
      setStep(null);
      setVersion((v) => v + 1);
    }
  }, []);

  const remove = (publicKey: string) =>
    act(async (onStep) => {
      await removePasskey(accountId, publicKey, onStep);
      // If this device no longer holds a passkey for the account, it can no longer act for it.
      if (!memory.get().passkeys.some((p) => p.accountId === accountId && !p.pending)) signOut();
    });

  const elsewhere = (chain?.added ?? []).filter((k) => !mine.some((p) => p.publicKey === k));
  const attachedCount = chain ? chain.added.length + (chain.founderAttached === false ? 0 : 1) : null;
  const h = holdings.holdings;

  return (
    <>
      <div className="mt-8">
        <SheetLabel>You</SheetLabel>
        <p className={SENTENCE}>
          This is{" "}
          <input
            id="account-rename"
            className={`${BLANK} max-w-full`}
            style={{ width: `calc(${Math.max(3, draft.length)}ch + 1.5em)` }}
            aria-label="Account name, kept on this device"
            value={draft}
            maxLength={24}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => memory.name(accountId, draft.trim() || "My account")}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
          ’s account.
        </p>
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-2">
        <div className="min-w-0">
          <SheetLabel>About it</SheetLabel>
          <Panel className="p-5">
            <div className="flex items-center justify-between gap-3">
              <span className="mono">Read from the network</span>
              <StatusPill tone={holdings.status === "ready" ? "live" : holdings.status === "error" ? "warn" : "muted"}>
                {holdings.status === "ready" ? "Live" : holdings.status === "error" ? "Unreachable" : "Reading"}
              </StatusPill>
            </div>
            <dl className="mt-2">
              <Row
                k="Account"
                v={
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[13px]">{short(accountId)}</span>
                    <button
                      type="button"
                      className="mono cursor-pointer rounded-full bg-card px-2.5 py-1 hover:bg-ink hover:text-white"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(accountId);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1600);
                        } catch {
                          /* clipboard refused: the id is still visible below */
                        }
                      }}
                    >
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </span>
                }
                sub={<span className="break-all font-mono text-[11px]">{accountId}</span>}
              />
              <Row
                k="Holds"
                v={h ? <span className="tabular-nums">{usd(h.total)}</span> : holdings.status === "error" ? "could not be read" : "reading…"}
                sub={
                  h && h.parts.length === 0 ? (
                    "nothing yet"
                  ) : h ? (
                    <span className="grid gap-0.5 pt-0.5">
                      {h.parts.slice(0, 6).map((p) => (
                        <span key={`${p.symbol}-${p.network}`} className="tabular-nums">
                          {coin(p.amount)} {p.symbol} on {p.network} · {usd(p.usd)}
                        </span>
                      ))}
                    </span>
                  ) : undefined
                }
              />
              <Row
                k="Opens with"
                v={attachedCount === null ? "your passkey" : attachedCount === 1 ? "1 passkey" : `${attachedCount} passkeys`}
                sub="no password, no seed phrase"
              />
              <Row k="We store" v="nothing" sub="this device remembers which passkeys it has seen, and that is all" />
              {attachedCount === 1 && (
                <Row k="If you lose it" v="the account cannot be recovered" sub="add a backup passkey" tone="stop" />
              )}
            </dl>
          </Panel>
        </div>

        <div className="min-w-0">
          <SheetLabel>Passkeys</SheetLabel>
          <Panel className="px-5 py-2">
            {mine.map((p) => (
              <PasskeyRow
                key={p.credentialId}
                p={p}
                busy={!!step}
                attached={p.pending ? false : p.founder ? chain?.founderAttached !== false : chain ? chain.added.includes(p.publicKey) : true}
                onFinish={() => act((onStep) => attachPasskey(p, onStep))}
                onRemove={() => remove(p.publicKey)}
                onDiscard={() => {
                  memory.forget(p.credentialId);
                  setVersion((v) => v + 1);
                }}
              />
            ))}
            {elsewhere.map((k) => (
              <div key={k} className="flex items-center justify-between gap-3 border-t border-line/70 py-3.5 first:border-t-0">
                <div className="min-w-0">
                  <p className="text-[15px] font-medium leading-snug">A passkey on another device</p>
                  <p className="mono mt-1 truncate text-ink-3">{k.slice(0, 18)}…</p>
                </div>
                <button type="button" disabled={!!step} className="mono h-8 shrink-0 rounded-full bg-card px-3.5 enabled:cursor-pointer enabled:hover:bg-rose enabled:hover:text-white disabled:opacity-40" onClick={() => remove(k)}>
                  Remove
                </button>
              </div>
            ))}
          </Panel>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={`${BLACK} !h-12 !px-5 !text-[14px]`}
              disabled={!!step || !mine.some((p) => !p.pending)}
              onClick={() => act((onStep) => addBackupPasskey(accountId, name, onStep))}
            >
              {step ? <Spinner size={15} /> : <Finger size={16} />}
              {step ?? "Add a backup passkey"}
            </button>
          </div>
          <p className="mt-3 min-h-5 text-[13.5px] leading-snug text-ink-2" aria-live="polite">
            {error ? (
              <span className="text-rose">{error}</span>
            ) : step ? (
              "Two touches: one to make the new passkey, one for a passkey you already have to approve it."
            ) : (
              "Keep the backup somewhere else than the first: another phone, or a security key."
            )}
          </p>
        </div>
      </div>

      {local && <LocalWarning />}

      <div className="mt-7 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-5">
        <span className="mono text-ink-3">Signing out forgets nothing a passkey cannot bring back</span>
        <button
          type="button"
          className="h-10 cursor-pointer rounded-full bg-white px-5 text-[14px] font-medium shadow-chip"
          onClick={() => {
            signOut();
            onClose();
          }}
        >
          Sign out
        </button>
      </div>
    </>
  );
}

function PasskeyRow({
  p,
  attached,
  busy,
  onFinish,
  onRemove,
  onDiscard,
}: {
  p: Passkey;
  attached: boolean;
  busy: boolean;
  onFinish: () => void;
  onRemove: () => void;
  onDiscard: () => void;
}) {
  const small = "mono h-8 shrink-0 rounded-full bg-card px-3.5 enabled:cursor-pointer disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-line/70 py-3.5 first:border-t-0">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-[15px] font-medium leading-snug">
          {attached ? <Tick size={15} /> : <span className="size-2 rounded-full bg-amber-2" />}
          {p.label}
        </p>
        <p className="mono mt-1 text-ink-3">
          {p.founder ? "Created the account" : "Backup"} · seen on this device
          {p.pending ? " · not attached yet" : !attached ? " · no longer attached" : ""}
        </p>
      </div>
      <div className="flex gap-2">
        {p.pending ? (
          <>
            <button type="button" disabled={busy} className={`${small} enabled:hover:bg-ink enabled:hover:text-white`} onClick={onFinish}>
              Finish
            </button>
            <button type="button" disabled={busy} className={small} onClick={onDiscard}>
              Discard
            </button>
          </>
        ) : attached ? (
          <button type="button" disabled={busy} className={`${small} enabled:hover:bg-rose enabled:hover:text-white`} onClick={onRemove}>
            Remove
          </button>
        ) : (
          <button type="button" disabled={busy} className={small} onClick={onDiscard}>
            Forget
          </button>
        )}
      </div>
    </div>
  );
}

export function AccountSheet({ holdings, onClose }: { holdings: HoldingsState; onClose: () => void }) {
  const m = useDeviceMemory();
  return (
    <Sheet title={m.current ? "Your account" : "Open an account"} onClose={onClose}>
      {m.current ? <You key={m.current} accountId={m.current} holdings={holdings} onClose={onClose} /> : <Welcome />}
    </Sheet>
  );
}
