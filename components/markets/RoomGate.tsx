"use client";

import { useEffect, useState } from "react";
import { id } from "@fourfivex/markets-protocol/protocol";
import { api, ApiError } from "./client";
import { recentRoomKey, RoomEntry, roomJoinedEvent } from "./RoomEntry";
import { Workspace } from "./Workspace";
import { MarketsFooter, MarketsHeader, ShellMessage } from "./shell";

export function RoomGate({ roomId }: { roomId: string }) {
  const [result, setResult] = useState<{ status: "joined" | "missing" | "error"; token?: string; error?: string }>();
  const [attempt, setAttempt] = useState(0);
  const markJoined = () => {
    sessionStorage.setItem(recentRoomKey, roomId);
    window.dispatchEvent(new Event(roomJoinedEvent));
    if (location.hash) history.replaceState(null, "", location.pathname);
    setResult({ status: "joined" });
  };
  useEffect(() => {
    const fragment = new URLSearchParams(location.hash.slice(1)).get("invite");
    const token = id.safeParse(fragment).data;
    let active = true;
    void api(`/rooms/${roomId}/membership`).then(() => {
      if (!active) return;
      sessionStorage.setItem(recentRoomKey, roomId);
      window.dispatchEvent(new Event(roomJoinedEvent));
      if (location.hash) history.replaceState(null, "", location.pathname);
      setResult({ status: "joined" });
    }, (err: unknown) => {
      if (!active) return;
      setResult(err instanceof ApiError && (err.status === 401 || err.status === 403)
        ? { status: "missing", token }
        : { status: "error", error: err instanceof Error ? err.message : "Could not open this room." });
    });
    return () => { active = false; };
  }, [roomId, attempt]);

  if (!result) return <ShellMessage title="Opening room…" />;
  if (result.status === "joined") return <><Workspace roomId={roomId} /><MarketsFooter /></>;
  if (result.status === "error") return <ShellMessage title="Room unavailable" text={result.error}
    actions={<button className="action action-primary" type="button" onClick={() => { setResult(undefined); setAttempt(value => value + 1); }}>Retry</button>} />;
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
