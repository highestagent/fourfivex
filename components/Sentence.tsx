"use client";

import { useState } from "react";
import { ASSETS } from "@/lib/assets";
import type { SlotCtx, Vals, Verb } from "@/lib/verbs";
import { Select } from "./Select";
import { Dot } from "./ui";

const CHIP = "inline-flex min-h-11 max-w-full items-center rounded-full border border-line bg-white px-3 align-middle text-[0.84em] leading-tight tracking-[-0.015em]";
const FOCUS = "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-blue";
const TYPED = /^\d{0,7}([.,]\d{0,2})?$/;

function AmountBlank({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  disabled: boolean;
  onChange: (n: number) => void;
}) {
  const [text, setText] = useState(value ? String(value) : "");
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setText(value ? String(value) : "");
  }

  return (
    <span className={`${CHIP} ${FOCUS} gap-0.5`}>
      <span aria-hidden="true" className="text-ink-2">$</span>
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        aria-label={`${label} in dollars`}
        disabled={disabled}
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          if (!TYPED.test(next)) return;
          const amount = Number(next.replace(",", ".")) || 0;
          setText(next);
          setSeen(amount);
          onChange(amount);
        }}
        style={{ width: `${Math.max(3, text.length)}ch` }}
        className="min-w-0 bg-transparent text-[max(16px,1em)] tabular-nums focus-visible:outline-none disabled:text-ink"
      />
    </span>
  );
}

export function Sentence({
  parts,
  slots,
  vals,
  ctx,
  disabled,
  onChange,
}: Pick<Verb, "parts" | "slots"> & {
  vals: Vals;
  ctx: SlotCtx;
  disabled: boolean;
  onChange: (key: string, value: string | number) => void;
}) {
  return (
    <p className="sentence">
      {parts.map((part, index) => {
        if (typeof part === "string") return part;
        const key = part.slot;
        const slot = slots[key];
        const id = `blank-${key}`;
        if (slot.kind === "amount") {
          return (
            <AmountBlank key={index} id={id} label={slot.cap} value={Number(vals[key]) || 0} disabled={disabled} onChange={(amount) => onChange(key, amount)} />
          );
        }

        const options = slot.opts(ctx);
        const current = options.find((option) => option.v === vals[key]) ??
          (slot.kind === "person" ? { v: "", label: "someone" } : options[0]);
        if (!current) return null;
        const dot = current.asset && <Dot color={ASSETS[current.asset].color} className="mr-1.5" />;
        if (disabled || (options.length === 1 && current.v === options[0].v)) {
          return <span key={index} className={CHIP}>{dot}<span className="truncate">{current.label}</span></span>;
        }

        return (
          <Select
            key={index}
            id={id}
            label={`${slot.cap}: ${current.label}`}
            value={current.v}
            placeholder={current.label}
            options={options.map(({ v, label, asset }) => ({
              value: v,
              label,
              marker: asset && <Dot color={ASSETS[asset].color} />,
            }))}
            onValueChange={(value) => onChange(key, value)}
            className={CHIP}
          />
        );
      })}
    </p>
  );
}
