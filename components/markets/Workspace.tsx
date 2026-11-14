'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { ArrowUpRight, ChartNoAxesCombined, Crosshair, MessageCircle, Pencil, Plus, Trash2 } from 'lucide-react';
import { defaultChartView, overlayTools, setupRatio, type ChartPresentation, type ChartSettings, type Item, type Point } from '@fourfivex/markets-protocol/protocol';
import { defaultMarket, isMarket, marketLabel, marketQuote, type Market, type MarketQuote } from '@fourfivex/markets-protocol/markets';
import type { DrawingItem } from './drawings';
import { useRoom } from './client';
import { Dialog } from './controls';
import { money, timeLabel } from './format';
import { MarketPicker, useMarketCatalog } from './market-picker';
import { Invite } from './Invite';
import { CommentForm, IdeaForm, LevelForm } from './room-forms';
import { RoomHeader } from './RoomHeader';
import { ShellMessage } from './shell';

const ChartLoading = () => <div className="chart-panel chart-loading" role="status">Loading chart…</div>;
const TradingChart = dynamic(() => import('./chart').then(module => module.TradingChart), { ssr: false, loading: ChartLoading });
type Level = Extract<Item, { kind: 'level' }>;
type Idea = Extract<Item, { kind: 'idea' }>;
type Anchor = Point & { levelId?: string };

type Modal =
  | { type: 'share' | 'market' }
  | ({ type: 'level'; point: Point; level?: Level }
    | { type: 'comment'; point: Anchor }
    | { type: 'idea'; idea?: Idea; initial?: Partial<Idea['data']> }) & { market: Market };

export function Workspace({ roomId }: { roomId: string }) {
  const { room, online, connected, revoked, error, edit, send, transient } = useRoom(roomId);
  const [modal, setModal] = useState<Modal>();
  const [pausedFor, setPausedFor] = useState<string>();
  const [localView, setLocalView] = useState<ChartPresentation['view']>(() => {
    const saved = sessionStorage.getItem('intuite:markets:view:' + roomId) ?? '';
    return { ...defaultChartView, market: isMarket(saved) ? saved : defaultMarket };
  });
  const presentation = room?.presentation;
  const presenting = Boolean(presentation && room?.me.id === presentation.presenter);
  const following = Boolean(presentation && !presenting && pausedFor !== presentation.presenter);
  const view = presenting || following ? presentation!.view : localView;
  const { market } = view;
  const dialogMarket = modal && 'market' in modal ? modal.market : market;
  const catalog = useMarketCatalog();
  const instrument = catalog.instruments.find(item => item.id === market);
  const quote = instrument ?? marketQuote(market);
  const dialogQuote = dialogMarket === market ? quote :
    catalog.instruments.find(item => item.id === dialogMarket) ?? marketQuote(dialogMarket);
  const chooseMarket = () => setModal({ type: 'market' });
  const items = useMemo(() => room?.items.filter(item => item.market === market) ?? [], [room?.items, market]);

  function updateChart(settings: Partial<ChartSettings>) {
    if (presenting) {
      send({ type: 'chart-settings', settings });
      return;
    }
    if (following) setPausedFor(presentation?.presenter);
    const next = { ...view, ...settings };
    if (next.market !== view.market || next.interval !== view.interval) next.camera = null;
    setLocalView(next);
    sessionStorage.setItem('intuite:markets:view:' + roomId, next.market);
  }

  function pauseFollowing() {
    setLocalView(view);
    setPausedFor(presentation?.presenter);
  }

  const [tab, setTab] = useState<'ideas' | 'comments' | 'levels'>('ideas');
  const [highlight, setHighlight] = useState('');
  if (revoked) return <ShellMessage title="Room access ended" text="Ask the room owner if you need access again."/>;
  if (!room) return <ShellMessage title="Connecting to the room…" text="Your shared chart will appear here."/>;
  const { me, members } = room;
  const presenter = members.find(member => member.id === presentation?.presenter);
  const drawings = items.filter((item): item is DrawingItem => (item.kind === 'trendline' || item.kind === 'setup' || item.kind === 'overlay') && item.data !== null);
  const formatPrice = (value: string) => money(value, quote);
  const editable = Boolean(instrument && connected && me.role !== 'viewer');
  const ideas = items.filter((item): item is Idea => item.kind === 'idea').sort((a, b) => b.updatedAt - a.updatedAt);
  const levels = items.filter((item): item is Level => item.kind === 'level' && item.data !== null);
  const comments = items.filter(item => item.kind === 'comment').sort((a, b) => b.updatedAt - a.updatedAt);
  const author = (member: string) => members.find(item => item.id === member)?.name ?? 'Former member';
  const close = () => setModal(undefined);
  const dialogContext = dialogMarket !== market &&
    <p className="secondary">{marketLabel(dialogQuote)} · {dialogQuote.venue}</p>;
  const updateLevel = (level: Level, point: Point) => {
    if (!level.data) return;
    edit({ market, kind: 'level', id: level.id, expected: level.revision, data: { ...point, label: level.data.label } });
  };
  const pin = (point: Anchor) => setModal({ type: 'comment', market, point });

  return <div className="markets-ui room-page">
    <RoomHeader roomId={roomId} me={me} members={members} presenter={presenter} online={online} connected={connected} following={following}
      onInvite={() => setModal({ type: 'share' })}
      onToggleFollowing={following ? pauseFollowing : () => setPausedFor(undefined)}
      onPresenterChange={member => send({ type: 'chart-presenter', member })} />
    <main>
      {error && <p role="alert" className="markets-container notice room-error">{error}</p>}
      <div className="workspace-grid">
        <div className="min-w-0">
          {instrument ? <TradingChart key={market} instrument={instrument} chooseMarket={chooseMarket}
            view={view} presenting={presenting} following={following} presenter={presenter?.id} connected={connected} updateChart={updateChart}
            saveDrawing={drawing => { edit(drawing); setTab('levels'); }} items={items} members={members} editable={editable} transient={transient} send={send}
            placeLevel={point => {
              edit({ market, kind: 'level', id: crypto.randomUUID(), expected: 0, data: { ...point, label: 'Level' } });
              setTab('levels');
            }}
            addLevel={point => setModal({ type: 'level', market, point })} moveLevel={updateLevel} comment={pin}
            showComment={comment => { setHighlight(comment); setTab('comments'); requestAnimationFrame(() => document.getElementById('comment-' + comment)?.scrollIntoView({ block: 'nearest' })); }}/>
          : <div className="chart-panel chart-loading">
            <p role="status">{catalog.status === 'loading'
              ? 'Loading selected market…' : 'This listing is currently unavailable.'}</p>
            <button className="button" onClick={chooseMarket}>Change market</button>
          </div>}
        </div>
        <section className="discussion" aria-labelledby="room-activity">
          <div className="discussion-heading"><h2 id="room-activity">Room activity</h2></div>
          <div className="tabs" role="group" aria-label="Workspace section">
            <button type="button" aria-pressed={tab === 'ideas'} onClick={() => setTab('ideas')}>Trade ideas <span>{ideas.length}</span></button>
            <button type="button" aria-pressed={tab === 'comments'} onClick={() => setTab('comments')}>Comments <span>{comments.length}</span></button>
            <button type="button" aria-pressed={tab === 'levels'} onClick={() => setTab('levels')}>Drawings <span>{levels.length + drawings.length}</span></button>
          </div>
          <div className="discussion-content">
            {tab === 'ideas' && <>
              {editable && <button className="button full new-idea" onClick={() => setModal({ type: 'idea', market })}><Plus size={16}/> New trade idea</button>}
              {!ideas.length && <p className="empty"><ChartNoAxesCombined size={17} aria-hidden="true"/>No trade ideas yet</p>}
              {ideas.map(idea => <article className="idea-card" key={idea.id}>
                <div className="card-meta"><span>{marketLabel(quote)} · {quote.venue}</span><span>REV {String(idea.revision).padStart(2, '0')}</span></div>
                <h3>{idea.data.title}</h3><p>{idea.data.rationale}</p>
                <div className="idea-prices"><div><span>Entry</span><b>{formatPrice(idea.data.entry)}</b></div><div><span>Invalidation</span><b>{formatPrice(idea.data.invalidation)}</b></div><div><span>Target</span><b>{formatPrice(idea.data.target)}</b></div></div>
                {editable && <div className="idea-footer"><button type="button" className="button small" aria-label={`Revise ${idea.data.title}`} onClick={() => setModal({ type: 'idea', market, idea })}><Pencil size={14}/> Revise idea</button></div>}
              </article>)}
            </>}
            {tab === 'comments' && <>
              {!comments.length && <p className="empty"><MessageCircle size={17} aria-hidden="true"/>No comments yet</p>}
              {comments.map(comment => <article id={'comment-' + comment.id} key={comment.id} className={`comment-card ${highlight === comment.id ? 'highlight' : ''}`}>
                <div className="card-meta"><strong>{author(comment.author)}</strong><span>{timeLabel(comment.data.time)}</span></div><p>{comment.data.text}</p><span className="anchor"><Crosshair size={12}/> {formatPrice(comment.data.price)}</span>
              </article>)}
            </>}
            {tab === 'levels' && <>
              {editable && <button className="button full" onClick={() => setModal({ type: 'level', market, point: { price: '', time: Math.floor(Date.now() / 1000) } })}><Plus size={16}/> Add level</button>}
              {!levels.length && !drawings.length && <p className="empty"><Crosshair size={17} aria-hidden="true"/>No drawings yet</p>}
              {levels.map(level => <article className="level-card" key={level.id}><span><strong>{level.data!.label}</strong><b>{formatPrice(level.data!.price)}</b></span>
                {editable && <div><button className="icon-button" aria-label={'Comment on ' + level.data!.label} onClick={() => pin({ ...level.data!, levelId: level.id })}><MessageCircle size={15}/></button>
                  <button className="icon-button" aria-label={'Edit ' + level.data!.label} onClick={() => setModal({ type: 'level', market, point: level.data!, level })}><Pencil size={15}/></button>
                  <button className="icon-button danger" aria-label={'Delete ' + level.data!.label} onClick={() => edit({ market, kind: 'level', id: level.id, expected: level.revision, data: null })}><Trash2 size={15}/></button></div>}
              </article>)}
              {drawings.map(item => <DrawingCard key={item.id} item={item} market={quote} editable={editable}
                remove={() => edit({ ...item, market, expected: item.revision, data: null })}
                onUseSetup={initial => setModal({ type: 'idea', market, initial })}/>)}
            </>}
          </div>
          {me.role === 'viewer' && <p className="discussion-foot">Viewer access</p>}
        </section>
      </div>
    </main>
    {modal?.type === 'market' && <Dialog title="Choose a market" close={close}><MarketPicker current={market} catalog={catalog} select={next => {
      if (next !== market) updateChart({ market: next });
      setHighlight('');
      close();
    }}/></Dialog>}
    {modal?.type === 'share' && <Dialog title="Invite traders" close={close}><Invite roomId={roomId} members={members} me={me}/></Dialog>}
    {modal?.type === 'level' && <Dialog title={modal.level ? 'Edit price level' : 'Add a price level'} close={close}>{dialogContext}<LevelForm initial={modal.point.price} quote={dialogQuote.quote} label={modal.level?.data?.label} save={(label, price) => {
      edit({ market: modal.market, kind: 'level', id: modal.level?.id ?? crypto.randomUUID(), expected: modal.level?.revision ?? 0, data: { ...modal.point, price, label } }); setTab('levels'); close();
    }}/></Dialog>}
    {modal?.type === 'comment' && <Dialog title="Pin a chart comment" close={close}>
      <CommentForm context={`${money(modal.point.price, dialogQuote)} · ${timeLabel(modal.point.time)}`} disabled={!editable} save={text => {
        edit({ market: modal.market, kind: 'comment', id: crypto.randomUUID(), expected: 0, data: { ...modal.point, text } }); setTab('comments'); close();
      }} />
    </Dialog>}
    {modal?.type === 'idea' && <Dialog title={modal.idea ? 'Revise trade idea' : 'New trade idea'} close={close}>{dialogContext}<IdeaForm idea={modal.idea} initial={modal.initial} save={data => {
      edit({ market: modal.market, kind: 'idea', id: modal.idea?.id ?? crypto.randomUUID(), expected: modal.idea?.revision ?? 0, data }); close();
    }}/></Dialog>}
  </div>;
}

function DrawingCard({ item, market, editable, remove, onUseSetup }: {
  item: DrawingItem; market: MarketQuote; editable: boolean;
  remove: () => void; onUseSetup: (initial: Partial<Idea['data']>) => void;
}) {
  if (!item.data) return null;
  if (item.kind === 'trendline') {
    return <article className="level-card"><span><strong>Trendline</strong>
      <b>{money(item.data.start.price, market)} → {money(item.data.end.price, market)}</b></span>
      {editable && <button className="icon-button danger" aria-label="Delete trendline" onClick={remove}><Trash2 size={15}/></button>}
    </article>;
  }
  if (item.kind === 'overlay') {
    const { shape, points } = item.data;
    const label = overlayTools[shape].label;
    const summary = shape === 'verticalStraightLine' ? timeLabel(points[0].time) :
      points.slice(0, 2).map(point => money(point.price, market)).join(' → ');
    return <article className="level-card"><span><strong>{label}</strong><b>{summary}</b></span>
      {editable && <button className="icon-button danger" aria-label={'Delete ' + label.toLowerCase()} onClick={remove}><Trash2 size={15}/></button>}
    </article>;
  }
  const { entry, stop, target } = item.data;
  const ratio = setupRatio(entry.price, stop, target);
  const side = Number(target) > Number(entry.price) ? 'Long' : 'Short';
  return <article className="idea-card setup-card">
    <div className="card-meta"><span>{side} setup</span><span>{ratio?.toFixed(2)}R</span></div>
    <div className="idea-prices"><div><span>Entry</span><b>{money(entry.price, market)}</b></div>
      <div><span>Stop</span><b>{money(stop, market)}</b></div><div><span>Target</span><b>{money(target, market)}</b></div></div>
    {editable && <div className="idea-footer">
      <button className="button small" onClick={() => onUseSetup({ title: side + ' ' + market.symbol, entry: entry.price, invalidation: stop, target })}>Use in trade idea <ArrowUpRight size={14}/></button>
      <button className="icon-button danger" aria-label="Delete trade setup" onClick={remove}><Trash2 size={15}/></button>
    </div>}
  </article>;
}
