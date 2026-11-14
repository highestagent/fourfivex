"use client";

import { useEffect, useId, useState, type SubmitEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy } from "lucide-react";
import type { Market } from "@fourfivex/markets-protocol/markets";
import { recordRule, sessionRule, type TrackRecord } from "@fourfivex/markets-protocol/sessions";
import { Select } from "@/components/Select";
import { lastDisplayName, rememberDisplayName, suggestName } from "@/lib/markets/names";
import { ApiError } from "./client";
import { recentRoomKey } from "./RoomEntry";
import { listSession, readRecord } from "./sessions";
import { SessionRecord } from "./SessionRecord";

const lengths = sessionRule.durations.map(minutes => ({ value: minutes, label: minutes < 60 ? `${minutes} min` : `${minutes / 60} h` }));
const pad = (value: number) => String(value).padStart(2, "0");
/** The next whole hour at least an hour away, in the form a datetime-local field takes. */
function defaultStart() {
  const start = new Date(Date.now() + 60 * 60_000);
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  return `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}T${pad(start.getHours())}:00`;
}

/** Lists a paid session: the host's record decides whether they can, then fee, time, length and seats. */
export function HostSession({ accountId, market }: { accountId: string; market?: Market }) {
  const router = useRouter();
  const ids = useId();
  const [record, setRecord] = useState<TrackRecord>();
  const [loadError, setLoadError] = useState("");
  const [name, setName] = useState(() => lastDisplayName() ?? suggestName());
  const [fee, setFee] = useState("25");
  const [start, setStart] = useState(defaultStart);
  const [minutes, setMinutes] = useState<number>(60);
  const [seats, setSeats] = useState("5");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [listed, setListed] = useState<string>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    void readRecord(accountId).then(next => { if (active) setRecord(next); },
      (failure: unknown) => { if (active) setLoadError(failure instanceof Error ? failure.message : "Your record couldn’t be read."); });
    return () => { active = false; };
  }, [accountId]);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { roomId, record: checked } = await listSession(accountId, {
        name: name.trim(), fee: fee.replace(",", "."), startsAt: new Date(start).getTime(), minutes, seats: Number(seats), market,
      });
      setRecord(checked);
      rememberDisplayName(name.trim());
      sessionStorage.setItem(recentRoomKey, roomId);
      setListed(roomId);
    } catch (failure) {
      if (failure instanceof ApiError && failure.data?.record) setRecord(failure.data.record as TrackRecord);
      setError(failure instanceof Error ? failure.message : "The session couldn’t be listed.");
    } finally {
      setBusy(false);
    }
  }

  if (listed) {
    const link = `${location.origin}/markets/${listed}`;
    return <div className="grid gap-4">
      <p className="sentence">Your session is open for booking.</p>
      <div className="copy-field">
        <input aria-label="Booking link" value={link} readOnly onFocus={event => event.currentTarget.select()} />
        <button type="button" className="button" onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true), () => {})}>
          {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div><button type="button" className="action action-primary" onClick={() => router.push(`/markets/${listed}`)}>Open room</button></div>
    </div>;
  }

  return <form className="grid gap-4" onSubmit={submit}>
    {!record && !loadError && <p role="status" className="text-sm text-ink-2">Reading your last {recordRule.windowDays} days…</p>}
    {loadError && <p role="alert" className="text-sm text-rose">{loadError}</p>}
    {record && <SessionRecord record={record} />}
    {record && !record.eligible && <ul className="session-reasons">{record.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
    {record?.eligible && <>
      <div className="session-fields">
        <label className="grid gap-1.5"><span className="text-sm font-medium">Room name</span>
          <input className="field bg-surface" required maxLength={32} autoComplete="nickname" value={name} onChange={event => setName(event.target.value)} /></label>
        <label className="grid gap-1.5"><span className="text-sm font-medium">Seat price (USDC)</span>
          <input className="field bg-surface" required inputMode="decimal" pattern="[0-9]{1,3}([.,][0-9]{1,2})?" value={fee}
            onChange={event => setFee(event.target.value)} /></label>
        <label className="grid gap-1.5"><span className="text-sm font-medium">Starts</span>
          <input className="field bg-surface" type="datetime-local" required value={start} onChange={event => setStart(event.target.value)} /></label>
        <div className="grid gap-1.5"><label htmlFor={ids + "-length"} className="text-sm font-medium">Length</label>
          <Select id={ids + "-length"} label="Length" pickerTitle="Session length" className="field bg-surface text-left" value={minutes}
            options={lengths} onValueChange={setMinutes} /></div>
        <label className="grid gap-1.5"><span className="text-sm font-medium">Seats</span>
          <input className="field bg-surface" type="number" required min={1} max={sessionRule.maxSeats} value={seats} onChange={event => setSeats(event.target.value)} /></label>
      </div>
      {error && <p role="alert" className="text-sm text-rose">{error}</p>}
      <button className="action action-primary" disabled={busy} type="submit">{busy ? "Listing…" : "List session"}</button>
    </>}
  </form>;
}
