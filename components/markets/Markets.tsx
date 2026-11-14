"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { defaultMarket, marketLabel, type Market } from "@fourfivex/markets-protocol/markets";
import { id } from "@fourfivex/markets-protocol/protocol";
import { AccountButton } from "@/components/AccountButton";
import { AccountSheet } from "@/components/AccountSheet";
import { useDeviceMemory } from "@/lib/account/store";
import { useHoldings } from "@/lib/account/useHoldings";
import { api } from "./client";
import { Dialog } from "./controls";
import { TradeComposer } from "./TradeComposer";
import { useMarketCatalog } from "./market-picker";
import { recentRoomKey, RoomEntry, roomJoinedEvent } from "./RoomEntry";
import { MarketsFooter, MarketsHeader } from "./shell";

export function Markets() {
  const router = useRouter();
  const [market, setMarket] = useState<Market>(defaultMarket);
  const [creating, setCreating] = useState(false);
  const [recent, setRecent] = useState<string>();
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountFromReview, setAccountFromReview] = useState(false);
  const { current: accountId } = useDeviceMemory();
  const { holdings } = useHoldings(accountOpen ? accountId : null);
  const accountButton = useRef<HTMLButtonElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const catalog = useMarketCatalog();

  useEffect(() => {
    let active = true;
    let request = 0;
    function sync() {
      const sequence = ++request;
      const roomId = sessionStorage.getItem(recentRoomKey);
      if (!roomId || !id.safeParse(roomId).success) return;
      void api(`/rooms/${roomId}/membership`).then(() => {
        if (active && sequence === request) setRecent(roomId);
      }, () => {
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
        <button ref={createButton} type="button" className="action action-secondary" onClick={() => setCreating(true)}>Create room</button>
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
        if (!accountFromReview) requestAnimationFrame(() => accountButton.current?.focus());
        setAccountFromReview(false);
      }} />}
      {creating && <Dialog title="Create room" close={() => {
        setCreating(false);
        requestAnimationFrame(() => createButton.current?.focus());
      }}>
        <RoomEntry market={market} marketName={marketLabel(catalog.instruments.find(item => item.id === market) ?? catalog.instruments[0])}
          onJoined={room => {
            sessionStorage.setItem(recentRoomKey, room);
            setRecent(room);
            setCreating(false);
            router.push(`/markets/${room}`);
          }} />
      </Dialog>}
    </div>
  );
}
