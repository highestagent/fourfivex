"use client";

import Link from "next/link";
import { useId, useState, type SubmitEvent } from "react";
import { Shuffle } from "lucide-react";
import { proveAccount } from "@/lib/account/flows";
import { displayName } from "@fourfivex/markets-protocol/protocol";
import type { Market } from "@fourfivex/markets-protocol/markets";
import { lastDisplayName, rememberDisplayName, suggestName } from "@/lib/markets/names";
import { api, ApiError } from "./client";

export const recentRoomKey = "fourfivex:markets:recent-room";
export const roomJoinedEvent = "fourfivex:markets:room-joined";

export function RoomEntry({ roomId, token, market, marketName, accountId, onJoined }: {
  roomId?: string; token?: string; market?: Market; marketName?: string;
  /** Creating a room needs the account opening it. Joining with an invite doesn't. */
  accountId?: string | null;
  onJoined: (room: string) => void;
}) {
  const nameId = useId();
  // Ready to go: the name last used here, or a suggestion. Either can be edited or shuffled.
  const [name, setName] = useState(() => lastDisplayName() ?? suggestName());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [openRoom, setOpenRoom] = useState<{ roomId: string; endsAt: number }>();
  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = displayName.safeParse(name);
    if (!parsed.success) { setError("Enter a display name up to 32 characters."); return; }
    setBusy(true);
    setError("");
    setOpenRoom(undefined);
    try {
      if (roomId && token) {
        await api(`/rooms/${roomId}/join`, { name: parsed.data, token });
        rememberDisplayName(parsed.data);
        onJoined(roomId);
      } else {
        if (!accountId) throw new Error("Open your account to create a room.");
        const { challenge } = await api<{ challenge: string }>("/rooms/challenge", { accountId });
        const proof = await proveAccount(accountId, challenge);
        const room = await api<{ roomId: string }>("/rooms", { name: parsed.data, market, proof });
        rememberDisplayName(parsed.data);
        onJoined(room.roomId);
      }
      // Stays "Opening room…" until the room replaces this form.
    } catch (err) {
      const open = err instanceof ApiError && err.status === 409 ? err.data : undefined;
      if (open && typeof open.roomId === "string" && typeof open.endsAt === "number") setOpenRoom({ roomId: open.roomId, endsAt: open.endsAt });
      else setError(err instanceof Error ? err.message : "Could not open the room.");
      setBusy(false);
    }
  };

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <p className="sentence">{roomId ? "Join a private trading room." : marketName ? `Open a private room on ${marketName}.` : "Create a private trading room."}</p>
      <div className="grid gap-2">
        <label htmlFor={nameId} className="text-sm font-medium">Display name</label>
        <div className="flex gap-2">
          <input id={nameId} className="field min-w-0 flex-1 bg-surface" name="name" maxLength={32} required autoComplete="nickname"
            value={name} onChange={(event) => { setName(event.target.value); setError(""); }} />
          <button type="button" className="action action-secondary w-11 shrink-0 px-0" aria-label="Suggest another name" title="Suggest another name"
            onClick={() => { setName((current) => suggestName(current)); setError(""); }}>
            <Shuffle size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-rose">{error}</p>}
      {openRoom && <p role="alert" className="text-sm">
        Your room is open until {new Date(openRoom.endsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.{" "}
        <Link className="text-blue underline underline-offset-2" href={`/markets/${openRoom.roomId}`}>Return to it</Link>
      </p>}
      <button className="action action-primary" disabled={busy} type="submit">
        {busy ? "Opening room…" : roomId ? "Join room" : "Create room"}
      </button>
    </form>
  );
}
