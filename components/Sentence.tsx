"use client";

import { useEffect, useRef, useState } from "react";
import { ASSETS, type AssetKey, type Prices } from "@/lib/assets";
import type { Vals, Verb } from "@/lib/verbs";
import { Check, Chevron, Dot } from "./ui";

/** The dot hangs beside the word so the chip keeps the sentence's baseline. */
function ChipLabel({ asset, label }: { asset?: AssetKey; label: string }) {
  if (!asset) return <span>{label}</span>;
  return (
    <span className="relative pl-[0.85em]">
      <Dot color={ASSETS[asset].color} className="absolute left-0 top-1/2 -translate-y-1/2" />
      {label}
    </span>
  );
}

/**
 * The sentence. Fixed words are print. Each word the person can choose is a white chip,
 * and a chip only ever offers what is possible.
 */
export function Sentence({
  verb,
  vals,
  prices,
  disabled,
  onChange,
}: {
  verb: Verb;
  vals: Vals;
  prices: Prices;
  disabled?: boolean;
  onChange: (key: string, value: string | number) => void;
}) {
  const [open, setOpen] = useState<{ key: string; right: boolean } | null>(null);
  const root = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  return (
    <p
      ref={root}
      className="text-[clamp(22px,3.3vw,30px)] font-medium leading-[1.8] tracking-[-0.022em]"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(null);
        }
      }}
    >
      {verb.parts.map((part, i) => {
        if (typeof part === "string") return <span key={i}>{part}</span>;
        const key = part.slot;
        const slot = verb.slots[key];
        const opts = slot.opts(prices);
        const current = opts.find((o) => o.v === vals[key]) ?? opts[0];
        const fixed = opts.length < 2 || disabled;
        const isOpen = open?.key === key;
        const chip =
          "inline-flex items-baseline gap-2 rounded-full bg-white py-[0.12em] pl-[0.62em] align-baseline text-[0.84em] leading-[1.45] tracking-[-0.015em] shadow-chip transition-shadow";
        return (
          <span key={i} className="relative inline-block">
            {fixed ? (
              <span className={`${chip} pr-[0.62em]`}>
                <ChipLabel asset={current.asset} label={current.label} />
              </span>
            ) : (
              <button
                type="button"
                className={`${chip} cursor-pointer pr-[0.4em] hover:ring-2 hover:ring-blue-3 ${isOpen ? "ring-2 ring-blue" : ""}`}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                aria-label={`${slot.cap}: ${current.label}. Change`}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setOpen(isOpen ? null : { key, right: r.left + 260 > window.innerWidth });
                }}
              >
                <ChipLabel asset={current.asset} label={current.label} />
                <Chevron size={14} className="self-center text-ink-3" />
              </button>
            )}
            {isOpen && (
              <span
                role="listbox"
                aria-label={slot.cap}
                className={`absolute top-[calc(100%+8px)] z-30 block w-max min-w-[210px] max-w-[min(320px,calc(100vw-40px))] animate-rise rounded-[16px] bg-white p-1.5 text-[15px] font-normal leading-snug tracking-normal shadow-[0_0_0_1px_rgb(0_0_0/0.05),0_18px_40px_-12px_rgb(0_0_0/0.28)] ${
                  open.right ? "right-0" : "left-0"
                }`}
              >
                <span className="mono block px-3 pb-1.5 pt-2 text-ink-3">{slot.cap}</span>
                {opts.map((o) => {
                  const selected = o.v === vals[key];
                  return (
                    <button
                      key={String(o.v)}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className="flex w-full cursor-pointer items-center gap-2.5 rounded-[10px] px-3 py-2 text-left hover:bg-black/[0.045]"
                      onClick={() => {
                        onChange(key, o.v);
                        setOpen(null);
                      }}
                    >
                      {o.asset && <Dot color={ASSETS[o.asset].color} />}
                      <span className="flex-1">{o.label}</span>
                      {selected && <Check size={15} className="text-blue" strokeWidth={2} />}
                    </button>
                  );
                })}
              </span>
            )}
          </span>
        );
      })}
    </p>
  );
}
