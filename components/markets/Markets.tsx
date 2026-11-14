"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { defaultMarket, marketLabel, type Market } from "@fourfivex/markets-protocol/markets";
import { id } from "@fourfivex/markets-protocol/protocol";
import { AccountButton } from "@/components/AccountButton";
import { AccountSheet } from "@/components/AccountSheet";
import { memory, useDeviceMemory } from "@/lib/account/store";
import { useHoldings } from "@/lib/account/useHoldings";
import { api, ApiError } from "./client";
import { Dialog } from "./controls";
import { TradeComposer } from "./TradeComposer";
import { useMarketCatalog } from "./market-picker";
import { HostSession } from "./HostSession";
import { recentRoomKey, RoomEntry, roomJoinedEvent } from "./RoomEntry";
import { MarketsFooter, MarketsHeader } from "./shell";

export function Markets() {
  const router = useRouter();
  const [market, setMarket] = useState<Market>(defaultMarket);
  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useState<"free" | "paid">("free");
  // Paid sessions show only where the markets service can take payment for them.
  const [paidSessions, setPaidSessions] = useState(false);
  useEffect(() => {
    if (!creating || paidSessions) return;
    let active = true;
    void api<{ available: boolean }>("/sessions").then(({ available }) => { if (active) setPaidSessions(available); }, () => {});
    return () => { active = false; };
  }, [creating, paidSessions]);
  const [recent, setRecent] = useState<string>();
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountFromReview, setAccountFromReview] = useState(false);
  // Creating a room needs an account; signing in for it carries straight on to the room form.
  const [roomAfterSignIn, setRoomAfterSignIn] = useState(false);
  const { current: accountId } = useDeviceMemory();
  const { holdings } = useHoldings(accountOpen ? accountId : null);
  const accountButton = useRef<HTMLButtonElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const catalog = useMarketCatalog();

  // Opening a room keeps this form up until the room replaces the page. The page then stays mounted but
  // hidden, which runs this cleanup, so the form is gone when someone comes back.
  useEffect(() => () => setCreating(false), []);

  useEffect(() => {
    let active = true;
    let request = 0;
    function sync() {
      const sequence = ++request;
      const roomId = sessionStorage.getItem(recentRoomKey);
      if (!roomId || !id.safeParse(roomId).success) return;
      void api(`/rooms/${roomId}/membership`).then(() => {
        if (active && sequence === request) setRecent(roomId);
      }, (err: unknown) => {
        if (err instanceof ApiError && err.status === 410) sessionStorage.removeItem(recentRoomKey);
        if (active && sequence === request) setRecent(undefined);
      });
    }
    sync();
    window.addEventListener(roomJoinedEvent, sync);
    return () => {
      active = false;
      window.removeEventListener(roomJoinedEvent, sync);
    };
  }, []);

  return (
    <div className="markets-ui market-page trade-page">
      <MarketsHeader current="markets" actions={<>
        {recent && <Link className="market-return" href={`/markets/${recent}`}>Return to room</Link>}
        <button ref={createButton} type="button" className="action action-secondary" onClick={() => {
          if (accountId) setCreating(true);
          else { setRoomAfterSignIn(true); setAccountOpen(true); }
        }}>Create room</button>
        <AccountButton buttonRef={accountButton} onClick={() => setAccountOpen(true)} />
      </>} />
      <main className="trade-main markets-container">
        <h1 className="sr-only">Markets</h1>
        <TradeComposer market={market} selectMarket={setMarket} catalog={catalog} accountId={accountId}
          accountOpen={accountOpen} openAccount={() => {
            setAccountFromReview(true);
            setAccountOpen(true);
          }} />
      </main>
      <MarketsFooter />
      {accountOpen && <AccountSheet holdings={holdings} onClose={() => {
        setAccountOpen(false);
        if (roomAfterSignIn && memory.get().current) setCreating(true);
        else if (!accountFromReview) requestAnimationFrame(() => accountButton.current?.focus());
        setAccountFromReview(false);
        setRoomAfterSignIn(false);
      }} />}
      {creating && <Dialog title="Create room" close={() => {
        setCreating(false);
        requestAnimationFrame(() => createButton.current?.focus());
      }}>
        {paidSessions && <div className="room-kind" role="group" aria-label="Room type">
          <button type="button" aria-pressed={kind === "free"} onClick={() => setKind("free")}>Free room</button>
          <button type="button" aria-pressed={kind === "paid"} onClick={() => setKind("paid")}>Paid session</button>
        </div>}
        {paidSessions && kind === "paid" && accountId ? <HostSession accountId={accountId} market={market} />
          : <RoomEntry market={market} accountId={accountId} marketName={marketLabel(catalog.instruments.find(item => item.id === market) ?? catalog.instruments[0])}
            onJoined={room => {
              sessionStorage.setItem(recentRoomKey, room);
              setRecent(room);
              router.push(`/markets/${room}`);
            }} />}
      </Dialog>}
    </div>
  );
}
