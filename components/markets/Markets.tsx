"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { displayName, defaultChartView, id, type ChartPresentation, type ChartSettings, type Item, type Mutation, type Point } from "@intuite/markets-protocol/protocol";
import type { Market } from "@intuite/markets-protocol/markets";
import { api, ApiError, type Transient } from "./client";
import { Dialog } from "./controls";
import { money, timeLabel } from "./format";
import { MarketPicker, useMarketCatalog } from "./market-picker";
import { CommentForm } from "./room-forms";
import { MarketsFooter, MarketsHeader, ShellMessage } from "./shell";
import { Workspace } from "./Workspace";

const TradingChart = dynamic(() => import("./chart").then(module => module.TradingChart), {
  ssr: false,
  loading: () => <div className="chart-panel chart-loading" role="status">Loading chart…</div>,
});
const recentRoomKey = "intuite:markets:recent-room";
const offline = () => false;
type ChartComment = Extract<Item, { kind: "comment" }>;
type MarketsModal = { type: "market" | "room" | "clear" }
  | { type: "comment"; point: Point }
  | { type: "read-comment"; item: ChartComment };

function RoomEntry({ roomId, token, onJoined }: { roomId?: string; token?: string; onJoined: (room: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
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
        const room = await api<{ roomId: string }>("/rooms", { name: name.data });
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
      <p className="sentence">{roomId ? "Join a private trading room." : "Create a private trading room."}</p>
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

export function Markets() {
  const router = useRouter();
  const [modal, setModal] = useState<MarketsModal>();
  const [view, setView] = useState<ChartPresentation["view"]>(defaultChartView);
  const [recent, setRecent] = useState<string>();
  const [annotations, setAnnotations] = useState<Item[]>([]);
  const transient = useRef(new Map<string, Transient>());
  const marketSearch = useRef<HTMLInputElement>(null);
  const marketSwitch = useRef<HTMLButtonElement>(null);
  const catalog = useMarketCatalog();
  const instrument = catalog.instruments.find(item => item.id === view.market);
  const items = useMemo(() => annotations.filter(item => item.market === view.market), [annotations, view.market]);

  useEffect(() => {
    const roomId = sessionStorage.getItem(recentRoomKey);
    if (!roomId || !id.safeParse(roomId).success) return;
    let active = true;
    void api(`/rooms/${roomId}/membership`).then(() => { if (active) setRecent(roomId); }, () => {});
    return () => { active = false; };
  }, []);

  const chooseMarket = () => {
    if (marketSearch.current?.getClientRects().length) marketSearch.current.focus();
    else setModal({ type: "market" });
  };
  const update = (settings: Partial<ChartSettings>) => setView(current => ({ ...current, ...settings, camera: null }));
  const close = () => setModal(undefined);
  const closePicker = () => {
    close();
    requestAnimationFrame(() => marketSwitch.current?.focus({ preventScroll: true }));
  };
  function saveAnnotation(change: Mutation) {
    const item = { ...change, author: "local", revision: change.expected + 1, updatedAt: Date.now() };
    setAnnotations(current => current.some(existing => existing.id === item.id)
      ? current.map(existing => existing.id === item.id ? item : existing)
      : [...current, item]);
  }

  return (
    <div className="markets-ui market-page">
      <MarketsHeader showMarketsLink={false} actions={<>
        {recent && <Link className="market-return" href={`/markets/${recent}`}>Return to room</Link>}
        <button type="button" className="action action-primary" onClick={() => setModal({ type: "room" })}>Create room</button>
      </>} />
      <main className="market-workspace">
        <aside className="market-browser" aria-labelledby="browse-markets">
          <h2 id="browse-markets">Browse markets</h2>
          <MarketPicker current={view.market} catalog={catalog} select={market => update({ market })} searchRef={marketSearch} sidebar />
        </aside>
        <div className="market-chart-column">
          {instrument ? <TradingChart key={view.market} instrument={instrument} chooseMarket={chooseMarket} marketSwitchRef={marketSwitch}
            view={view} presenting={false} following={false} connected={false} updateChart={update}
            items={items} members={[]} editable transient={transient} send={offline}
            saveDrawing={saveAnnotation}
            placeLevel={point => saveAnnotation({ kind: "level", market: view.market, id: crypto.randomUUID(), expected: 0, data: { ...point, label: "Level" } })}
            moveLevel={(level, point) => {
              if (level.data) saveAnnotation({ ...level, expected: level.revision, data: { ...point, label: level.data.label } });
            }}
            comment={point => setModal({ type: "comment", point })}
            showComment={id => {
              const item = items.find(item => item.id === id);
              if (item?.kind === "comment") setModal({ type: "read-comment", item });
            }}
            clearAnnotations={items.length ? () => setModal({ type: "clear" }) : undefined} />
            : <div className="chart-panel chart-loading"><button type="button" className="action action-secondary" onClick={chooseMarket}>Choose a market</button></div>}
        </div>
      </main>
      <MarketsFooter />
      {modal?.type === "market" && <Dialog title="Browse markets" close={closePicker}>
        <MarketPicker current={view.market} catalog={catalog} select={(market: Market) => { update({ market }); closePicker(); }} />
      </Dialog>}
      {modal?.type === "room" && <Dialog title="Create room" close={close}>
        <RoomEntry onJoined={room => router.push(`/markets/${room}`)} />
      </Dialog>}
      {instrument && modal?.type === "comment" && <Dialog title="Pin a chart comment" close={close}>
        <CommentForm context={`${money(modal.point.price, instrument)} · ${timeLabel(modal.point.time)}`} save={text => {
          saveAnnotation({ kind: "comment", market: view.market, id: crypto.randomUUID(), expected: 0, data: { ...modal.point, text } });
          close();
        }} />
      </Dialog>}
      {modal?.type === "read-comment" && <Dialog title="Chart comment" close={close}>
        <p className="wrap-anywhere whitespace-pre-wrap text-sm">{modal.item.data.text}</p>
      </Dialog>}
      {modal?.type === "clear" && <Dialog title="Clear chart annotations" close={close}>
        <p className="text-sm text-ink-2">Remove the drawings and pinned comments from this market?</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="action action-primary" type="button" onClick={() => {
            setAnnotations(current => current.filter(item => item.market !== view.market));
            close();
          }}>Clear annotations</button>
          <button className="action action-secondary" type="button" onClick={close}>Cancel</button>
        </div>
      </Dialog>}
    </div>
  );
}

export function RoomGate({ roomId }: { roomId: string }) {
  const [result, setResult] = useState<{ status: "joined" | "missing" | "error"; token?: string; error?: string }>();
  const [attempt, setAttempt] = useState(0);
  const markJoined = () => {
    sessionStorage.setItem(recentRoomKey, roomId);
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

  if (!result) return <ShellMessage title="Opening room…" text="" />;
  if (result.status === "joined") return <><Workspace roomId={roomId} /><MarketsFooter /></>;
  if (result.status === "error") return <>
    <ShellMessage title="Room unavailable" text={result.error ?? ""} />
    <div className="shell"><button className="action action-primary" type="button" onClick={() => { setResult(undefined); setAttempt(value => value + 1); }}>Retry</button></div>
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
