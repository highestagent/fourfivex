"use client";

import { useCallback, useEffect, useState } from "react";
import { id } from "@fourfivex/markets-protocol/protocol";
import type { Booking } from "@fourfivex/markets-protocol/sessions";
import { AccountSheet } from "@/components/AccountSheet";
import { useDeviceMemory } from "@/lib/account/store";
import { useHoldings } from "@/lib/account/useHoldings";
import { api, ApiError } from "./client";
import { BookingCard } from "./BookingCard";
import { recentRoomKey, RoomEntry, roomJoinedEvent } from "./RoomEntry";
import { readBooking } from "./sessions";
import { Workspace } from "./Workspace";
import { MarketsFooter, MarketsHeader, RoomLoading, ShellMessage } from "./shell";

/** Starts loading the chart while access is checked, so it is ready when the room opens. */
const preloadChart = () => void import("./chart").catch(() => {});

type Result =
  | { status: "joined" }
  | { status: "missing"; token?: string }
  | { status: "booking"; booking: Booking }
  | { status: "ended"; error?: string }
  | { status: "error"; error?: string };

export function RoomGate({ roomId }: { roomId: string }) {
  const [result, setResult] = useState<Result>();
  const [attempt, setAttempt] = useState(0);
  const [accountOpen, setAccountOpen] = useState(false);
  const { current: accountId } = useDeviceMemory();
  const { holdings } = useHoldings(accountOpen ? accountId : null);
  const markJoined = useCallback(() => {
    sessionStorage.setItem(recentRoomKey, roomId);
    window.dispatchEvent(new Event(roomJoinedEvent));
    if (location.hash) history.replaceState(null, "", location.pathname);
    setResult({ status: "joined" });
  }, [roomId]);
  useEffect(() => {
    const fragment = new URLSearchParams(location.hash.slice(1)).get("invite");
    const token = id.safeParse(fragment).data;
    let active = true;
    preloadChart();
    void api(`/rooms/${roomId}/membership`).then(() => {
      if (active) markJoined();
    }, async (err: unknown) => {
      if (!active) return;
      const shut = err instanceof ApiError && [401, 403, 410].includes(err.status);
      // A paid session's link: its booking shows to anyone, and decides what this device can do.
      if (shut && !token) {
        const booking = await readBooking(roomId, accountId).catch(() => undefined);
        if (!active) return;
        if (booking) { setResult({ status: "booking", booking }); return; }
      }
      if (err instanceof ApiError && err.status === 410) {
        if (sessionStorage.getItem(recentRoomKey) === roomId) sessionStorage.removeItem(recentRoomKey);
        setResult({ status: "ended", error: err.message });
        return;
      }
      setResult(shut
        ? { status: "missing", token }
        : { status: "error", error: err instanceof Error ? err.message : "Could not open this room." });
    });
    return () => { active = false; };
  }, [roomId, attempt, accountId, markJoined]);

  if (!result) return <RoomLoading />;
  if (result.status === "ended") return <ShellMessage title={result.error ?? "This room has ended"} />;
  if (result.status === "joined") return <><Workspace roomId={roomId} /><MarketsFooter /></>;
  if (result.status === "error") return <ShellMessage title="Room unavailable" text={result.error}
    actions={<button className="action action-primary" type="button" onClick={() => { setResult(undefined); setAttempt(value => value + 1); }}>Retry</button>} />;
  if (result.status === "booking") return <>
    <MarketsHeader />
    <main className="shell py-8">
      <div className="max-w-lg rounded-[24px] border border-line bg-card p-5 sm:p-8">
        <BookingCard key={accountId ?? "signed-out"} booking={result.booking} accountId={accountId} openAccount={() => setAccountOpen(true)}
          onJoined={markJoined} refresh={() => setAttempt(value => value + 1)} />
      </div>
    </main>
    {accountOpen && <AccountSheet holdings={holdings} onClose={() => setAccountOpen(false)} />}
  </>;
  if (!result.token) return <ShellMessage title="This room needs an invite" text="Ask the owner for an invite link." />;
  return <>
    <MarketsHeader />
    <main className="shell py-8">
      <div className="max-w-lg rounded-[24px] border border-line bg-card p-5 sm:p-8">
        <RoomEntry roomId={roomId} token={result.token} onJoined={markJoined} />
      </div>
    </main>
  </>;
}
