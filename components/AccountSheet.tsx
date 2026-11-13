"use client";

import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { NetworkError } from "@/lib/account/api";
import { addBackupPasskey, attachPasskey, countPasskeys, createAccount, openAccount, removePasskey, signOut } from "@/lib/account/flows";
import type { Holdings } from "@/lib/account/holdings";
import { isLocalDevelopment, PasskeyError, passkeysAvailable } from "@/lib/account/passkey";
import { AccountError } from "@/lib/account/session";
import { memory, useDeviceMemory } from "@/lib/account/store";
import { coin, usd } from "@/lib/format";
import { Sheet } from "./Sheet";
import { CopyButton, Finger } from "./ui";

const subscribeBrowser = () => () => {};
const onServer = () => false;

function message(error: unknown): string {
  return error instanceof PasskeyError || error instanceof AccountError || error instanceof NetworkError
    ? error.message
    : "Something went wrong. Try again.";
}

export function AccountSheet({ holdings, onClose }: { holdings: Holdings | null; onClose: () => void }) {
  const { current } = useDeviceMemory();
  const [step, setStep] = useState<string | null>(null);

  return (
    <Sheet label={current ? "Account settings" : "Open account"} onClose={onClose} busy={step !== null}>
      {current
        ? <Settings key={current} accountId={current} holdings={holdings} step={step} setStep={setStep} onClose={onClose} />
        : <Welcome step={step} setStep={setStep} />}
    </Sheet>
  );
}

type Progress = { step: string | null; setStep: (step: string | null) => void };

function Welcome({ step, setStep }: Progress) {
  const supported = useSyncExternalStore(subscribeBrowser, passkeysAvailable, onServer);
  const local = useSyncExternalStore(subscribeBrowser, isLocalDevelopment, onServer);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const run = async (kind: "create" | "open") => {
    if (step || !supported) return;
    setError(null);
    setStep("Waiting for your passkey…");
    try {
      if (kind === "create") await createAccount(name);
      else await openAccount(() => setStep("Confirm again to open your account on this device."));
    } catch (err) {
      setError(message(err));
    } finally {
      setStep(null);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run("create");
  };

  return (
    <form onSubmit={submit} className="grid gap-6">
      <p className="sentence">
        Open an account for{" "}
        <input
          className="field inline-block max-w-full rounded-full bg-surface align-middle text-[max(16px,0.8em)] font-medium sm:w-[10em]"
          placeholder="your name"
          aria-label="Account name"
          value={name}
          maxLength={24}
          autoComplete="given-name"
          disabled={step !== null}
          onChange={(event) => setName(event.target.value)}
        />.
      </p>
      <div className="rounded-[18px] border border-line bg-surface px-4 sm:px-5">
        <dl>
          <div className="detail-row">
            <dt>Access</dt>
            <dd>Sign in with a passkey using your fingerprint, face, or device PIN.</dd>
          </div>
          <div className="detail-row">
            <dt>Recovery</dt>
            <dd>Add a backup passkey after setup to keep access if you lose your first one.</dd>
          </div>
        </dl>
      </div>
      {local && <p className="text-sm text-ink-2">Passkeys created on localhost work only on localhost.</p>}
      <div className="flex flex-wrap gap-2.5">
        <button className="action action-primary grow sm:grow-0" type="submit" disabled={!supported || step !== null}>
          <Finger size={17} /> Create with a passkey
        </button>
        <button className="action action-secondary grow sm:grow-0" type="button" disabled={!supported || step !== null} onClick={() => void run("open")}>
          Use an existing passkey
        </button>
      </div>
      {step && <p role="status" className="text-sm text-ink-2">{step}</p>}
      {error && <p role="alert" className="text-sm text-rose">{error}</p>}
      {!supported && <p className="text-sm text-ink-2">Open Intuite in a browser that supports passkeys.</p>}
    </form>
  );
}

type KeyList = Awaited<ReturnType<typeof countPasskeys>>;

function Settings({ accountId, holdings, step, setStep, onClose }: Progress & {
  accountId: string;
  holdings: Holdings | null;
  onClose: () => void;
}) {
  const { names, passkeys } = useDeviceMemory();
  const name = names[accountId] ?? "My account";
  const [draft, setDraft] = useState(name);
  const [keys, setKeys] = useState<KeyList | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const mine = passkeys.filter((passkey) => passkey.accountId === accountId);
  const otherKeys = (keys?.added ?? []).filter((key) => !mine.some((passkey) => passkey.publicKey === key));
  const attachedCount = keys ? keys.added.length + Number(keys.founderAttached === true) : null;

  useEffect(() => {
    let active = true;
    countPasskeys(accountId).then(
      (result) => { if (active) setKeys(result); },
      () => { if (active) setKeys(null); },
    );
    return () => { active = false; };
  }, [accountId, version]);

  const run = async (work: (onStep: (step: string) => void) => Promise<void>) => {
    if (step) return;
    setError(null);
    setStep("Preparing…");
    try {
      await work(setStep);
    } catch (err) {
      setError(message(err));
    } finally {
      setStep(null);
      setVersion((value) => value + 1);
    }
  };

  const remove = (publicKey: string) => run(async (onStep) => {
    await removePasskey(accountId, publicKey, onStep);
    if (!memory.get().passkeys.some((passkey) => passkey.accountId === accountId && !passkey.pending)) signOut();
  });

  const saveName = () => {
    const updated = draft.trim() || "My account";
    setDraft(updated);
    if (updated !== name) memory.name(accountId, updated);
  };

  return (
    <div className="grid gap-6">
      <h1 className="sentence">Account settings</h1>
      <form onSubmit={(event) => { event.preventDefault(); saveName(); }}>
        <label className="grid gap-2 text-sm font-medium">
          Account name
          <input className="field bg-surface" value={draft} maxLength={24} onChange={(event) => setDraft(event.target.value)} onBlur={saveName} />
        </label>
      </form>

      <dl className="rounded-[18px] border border-line bg-surface px-4 sm:px-5">
        <div className="detail-row">
          <dt>Account ID</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="min-w-0 font-mono text-[13px] wrap-anywhere">{accountId}</span>
            <CopyButton text={accountId} label="Copy account ID" />
          </dd>
        </div>
        {holdings && holdings.parts.length > 0 && (
          <div className="detail-row">
            <dt>Holdings</dt>
            <dd>
              <ul className="space-y-1">
                {holdings.parts.map((part) => (
                  <li key={part.assetId} className="flex flex-wrap justify-between gap-x-2">
                    <span>{coin(part.amount)} {part.symbol} <span className="text-ink-2">· {part.network}</span></span>
                    <span className="tabular-nums">{usd(part.usd)}</span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
      </dl>

      <section aria-labelledby="passkey-heading">
        <h2 id="passkey-heading" className="mb-3 text-base font-semibold">Passkeys</h2>
        <ul className="divide-y divide-line rounded-[18px] border border-line bg-surface px-4 sm:px-5">
          {mine.map((passkey) => {
            const attached = !passkey.pending && (passkey.founder ? keys?.founderAttached !== false : !keys || keys.added.includes(passkey.publicKey));
            return (
              <li key={passkey.credentialId} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <span className="min-w-0 text-sm">
                  {passkey.label}
                  <span className="block text-xs text-ink-2">{passkey.pending ? "Setup incomplete" : attached ? "Available on this device" : "Detached"}</span>
                </span>
                <div className="flex gap-2">
                  {passkey.pending && (
                    <button className="action action-secondary" type="button" disabled={step !== null} onClick={() => void run((onStep) => attachPasskey(passkey, onStep))}>Finish setup</button>
                  )}
                  {attached ? (
                    <button className="action action-secondary" type="button" disabled={step !== null || attachedCount === 1} onClick={() => void remove(passkey.publicKey)}>Remove</button>
                  ) : (
                    <button className="action action-secondary" type="button" disabled={step !== null} onClick={() => memory.forget(passkey.credentialId)}>Forget</button>
                  )}
                </div>
              </li>
            );
          })}
          {otherKeys.map((key) => (
            <li key={key} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <span className="min-w-0 text-sm">Passkey on another device<span className="block font-mono text-xs text-ink-2">{key.slice(0, 18)}…</span></span>
              <button className="action action-secondary" type="button" disabled={step !== null} onClick={() => void remove(key)}>Remove</button>
            </li>
          ))}
          {mine.length === 0 && otherKeys.length === 0 && <li className="py-3 text-sm text-ink-2">No passkeys available on this device.</li>}
        </ul>
        <p className="mt-3 text-sm text-ink-2">Keep a backup on a separate device or security key.</p>
        {step && <p role="status" className="mt-3 text-sm text-ink-2">{step}</p>}
        {error && <p role="alert" className="mt-3 text-sm text-rose">{error}</p>}
        <button
          className="action action-primary mt-4"
          type="button"
          disabled={step !== null || !mine.some((passkey) => !passkey.pending)}
          onClick={() => void run((onStep) => addBackupPasskey(accountId, name, onStep))}
        >
          Add backup passkey
        </button>
      </section>

      <div className="border-t border-line pt-4">
        <button className="action action-secondary" type="button" disabled={step !== null} onClick={() => { signOut(); onClose(); }}>
          Sign out
        </button>
      </div>
    </div>
  );
}
