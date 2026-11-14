"use client";

import { useEffect, useId, useRef, useState } from "react";
import { sessionRule, type Booking } from "@fourfivex/markets-protocol/sessions";
import { lastDisplayName, rememberDisplayName, suggestName } from "@/lib/markets/names";
import { api } from "./client";
import { buySeat, enterSession } from "./sessions";
import { SessionRecord, usdc } from "./SessionRecord";

const when = (time: number) => new Date(time).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const clock = (time: number) => new Date(time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/**
 * What a session's link shows before the room opens for this device: the host's record, the terms, and one
 * button. Pay, enter a seat already held, sign in, or why none of those apply.
 */
export function BookingCard({ booking, accountId, openAccount, onJoined, refresh }: {
  booking: Booking;
  accountId: string | null;
  openAccount: () => void;
  onJoined: () => void;
  refresh: () => void;
}) {
  const nameId = useId();
  const [name, setName] = useState(() => lastDisplayName() ?? suggestName());
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [report, setReport] = useState<"closed" | "open" | "sent">("closed");
  const tried = useRef(false);
  const [now] = useState(() => Date.now());
  const held = booking.seat === "paid" || booking.seat === "host";
  const open = booking.state === "open";
  const ongoing = booking.state === "open" || booking.state === "full" || booking.state === "closed" || booking.state === "live";
  const left = Math.max(0, booking.seats - booking.sold);
  const reportable = booking.seat === "paid" && now < booking.endsAt + sessionRule.exceptionMinutes * 60_000
    && (booking.state === "live" || booking.state === "ended");

  async function run(label: string, work: () => Promise<void>) {
    setBusy(label);
    setError("");
    try {
      await work();
      rememberDisplayName(name.trim());
      onJoined();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Something went wrong. Try again.");
      setBusy("");
      refresh();
    }
  }
  const enter = () => run("Opening room…", () => enterSession(accountId!, booking.roomId, name.trim()));

  // A seat already held opens the room straight away: the passkey asks once, and the room replaces this card.
  useEffect(() => {
    if (!accountId || !held || !ongoing || tried.current) return;
    tried.current = true;
    void enter();
    // Runs once per page for the account that holds the seat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, held, ongoing]);

  const status = booking.state === "canceled" ? "Canceled. Every seat is refunded."
    : booking.state === "ended" ? booking.seat === "released" ? "Ended. Your fee went to the host." : booking.seat === "refunded" ? "Ended. Your fee was refunded." : "This session has ended."
      : booking.state === "full" && !held ? "Sold out."
        : (booking.state === "closed" || booking.state === "live") && !held ? "Booking has closed." : "";

  return (
    <div className="markets-ui booking-card">
      <div className="booking-head">
        <p className="booking-host">{booking.host}</p>
        <p className="booking-time">{when(booking.startsAt)} – {clock(booking.endsAt)}</p>
      </div>
      <SessionRecord record={booking.record} />
      <dl className="booking-terms">
        <div><dt>Seat</dt><dd>{usdc(booking.fee)} USDC</dd></div>
        <div><dt>Seats left</dt><dd>{left} of {booking.seats}</dd></div>
      </dl>
      {status && <p className="booking-status" role="status">{status}</p>}
      {ongoing && (!held || error) && (open || held) && <div className="grid gap-2">
        <label htmlFor={nameId} className="text-sm font-medium">Display name</label>
        <input id={nameId} className="field bg-surface" maxLength={32} autoComplete="nickname" value={name} onChange={event => setName(event.target.value)} />
      </div>}
      {error && <p role="alert" className="text-sm text-rose">{error}</p>}
      {busy ? <p role="status" className="booking-busy">{busy}</p> : ongoing && <div className="flex flex-wrap gap-2">
        {!accountId && (open || held) && <button type="button" className="action action-primary" onClick={openAccount}>Sign in to book</button>}
        {accountId && held && <button type="button" className="action action-primary" disabled={!name.trim()} onClick={() => void enter()}>Enter room</button>}
        {accountId && !held && open && <button type="button" className="action action-primary" disabled={!name.trim()}
          onClick={() => void run("Booking your seat…", () => buySeat(accountId, booking, name.trim()))}>Pay {usdc(booking.fee)}</button>}
      </div>}
      {open && !held && <p className="booking-note">Refunded automatically if the host cancels, doesn’t show, or the room goes down.</p>}
      {reportable && report === "closed" && <button type="button" className="text-button" onClick={() => setReport("open")}>Report a problem</button>}
      {report === "open" && <form className="grid gap-2" onSubmit={event => {
        event.preventDefault();
        const text = String(new FormData(event.currentTarget).get("problem") ?? "").trim();
        if (!text) return;
        void api(`/rooms/${booking.roomId}/report`, { text }).then(() => setReport("sent"), (failure: unknown) => {
          setError(failure instanceof Error ? failure.message : "The report couldn’t be sent.");
        });
      }}>
        <label htmlFor={nameId + "-problem"} className="text-sm font-medium">What went wrong?</label>
        <textarea id={nameId + "-problem"} name="problem" className="field bg-surface" rows={3} maxLength={500} required />
        <div><button type="submit" className="action action-secondary">Send report</button></div>
      </form>}
      {report === "sent" && <p role="status" className="booking-note">Reported. Your fee waits for review instead of going to the host.</p>}
    </div>
  );
}
