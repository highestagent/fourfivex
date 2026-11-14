"use client";

import { useState, type SubmitEvent } from "react";
import { displayName } from "@fourfivex/markets-protocol/protocol";
import type { Market } from "@fourfivex/markets-protocol/markets";
import { api } from "./client";

export const recentRoomKey = "intuite:markets:recent-room";
export const roomJoinedEvent = "fourfivex:markets:room-joined";

export function RoomEntry({ roomId, token, market, marketName, onJoined }: { roomId?: string; token?: string; market?: Market; marketName?: string; onJoined: (room: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = displayName.safeParse(new FormData(event.currentTarget).get("name"));
    if (!name.success) { setError("Enter a display name up to 32 characters."); return; }
    setBusy(true);
    setError("");
    try {
      if (roomId && token) {
        await api(`/rooms/${roomId}/join`, { name: name.data, token });
        onJoined(roomId);
      } else {
        const room = await api<{ roomId: string }>("/rooms", { name: name.data, market });
        onJoined(room.roomId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the room.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <p className="sentence">{roomId ? "Join a private trading room." : marketName ? `Open a private room on ${marketName}.` : "Create a private trading room."}</p>
      <label className="grid gap-2 text-sm font-medium">Display name
        <input className="field bg-surface" name="name" maxLength={32} required autoComplete="nickname" />
      </label>
      {error && <p role="alert" className="text-sm text-rose">{error}</p>}
      <button className="action action-primary" disabled={busy} type="submit">
        {busy ? "Opening room…" : roomId ? "Join room" : "Create room"}
      </button>
    </form>
  );
}
