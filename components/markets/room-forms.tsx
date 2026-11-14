import { useState } from 'react';
import { price, type Item } from '@fourfivex/markets-protocol/protocol';

type TradeIdea = Extract<Item, { kind: 'idea' }>;

export function LevelForm({ initial, label, quote, save }: { initial: string; label?: string; quote: string; save: (label: string, value: string) => void }) {
  const [message, setMessage] = useState('');
  return <form className="dialog-form" onSubmit={event => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const parsed = price.safeParse(data.get('price'));
    const label = String(data.get('label')).trim();
    if (!parsed.success || !label) { setMessage('Enter a label and a positive price with up to eight decimals.'); return; }
    save(label, parsed.data);
  }}><label className="field">Label<input name="label" required maxLength={48} defaultValue={label} data-dialog-focus placeholder="e.g. Support"/></label>
    <label className="field">{quote ? `Price (${quote})` : 'Price'}<input name="price" required inputMode="decimal" defaultValue={initial}/></label>
    {message && <p role="alert" className="notice">{message}</p>}
    <button className="button primary" type="submit">Save level</button>
  </form>;
}

export function CommentForm({ context, disabled, save }: { context: string; disabled?: boolean; save: (text: string) => void }) {
  return <form className="dialog-form" onSubmit={event => {
    event.preventDefault();
    const text = String(new FormData(event.currentTarget).get('comment')).trim();
    if (text) save(text);
  }}>
    <p className="secondary">{context}</p>
    <label className="field">Comment
      <textarea name="comment" maxLength={500} required rows={4} data-dialog-focus placeholder="What are you watching at this level?" />
    </label>
    <button className="button primary" type="submit" disabled={disabled}>Pin comment</button>
  </form>;
}

export function IdeaForm({ idea, initial, save }: { idea?: TradeIdea; initial?: Partial<TradeIdea['data']>; save: (data: TradeIdea['data']) => void }) {
  const [message, setMessage] = useState('');
  return <form className="dialog-form" onSubmit={event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const get = (key: string) => String(form.get(key)).trim();
    const data = { title: get('title'), rationale: get('rationale'), entry: get('entry'), invalidation: get('invalidation'), target: get('target') };
    if (!data.title || !data.rationale || ![data.entry, data.invalidation, data.target].every(value => price.safeParse(value).success)) {
      setMessage('Enter a title, rationale, and three positive prices.'); return;
    }
    save(data);
  }}>
    <label className="field">Title<input name="title" maxLength={64} required defaultValue={idea?.data.title ?? initial?.title} data-dialog-focus placeholder="e.g. Support retest"/></label>
    <div className="form-prices">{(['entry', 'invalidation', 'target'] as const).map(key => <label className="field" key={key}>{key[0].toUpperCase() + key.slice(1)}<input name={key} inputMode="decimal" defaultValue={idea?.data[key] ?? initial?.[key]} required/></label>)}</div>
    <label className="field">Rationale<textarea name="rationale" rows={4} required maxLength={1200} defaultValue={idea?.data.rationale} placeholder="What would make this setup worth taking?"/></label>
    {message && <p role="alert" className="notice">{message}</p>}
    <button className="button primary" type="submit">{idea ? 'Publish revision' : 'Publish idea'}</button>
  </form>;
}
