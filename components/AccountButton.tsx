"use client";

import type { MouseEventHandler, Ref } from "react";
import { useDeviceMemory } from "@/lib/account/store";
import { Chevron, Finger } from "./ui";

export function AccountButton({ onClick, buttonRef }: {
  onClick: MouseEventHandler<HTMLButtonElement>;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  const { current, names, passkeys } = useDeviceMemory();
  const name = current ? names[current] ?? "My account" : null;

  return (
    <button ref={buttonRef} type="button" onClick={onClick} aria-haspopup="dialog"
      className={`action ${current ? "action-secondary" : "action-primary"} min-w-0`}>
      {name
        ? <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center rounded-full bg-ink text-[10px] font-semibold uppercase text-inverse">{name.slice(0, 1)}</span>
        : <Finger size={16} className="shrink-0" />}
      <span className="max-w-32 truncate">{name ?? (passkeys.length ? "Sign in" : "Open account")}</span>
      {current && <Chevron size={14} className="shrink-0 text-ink-2" />}
    </button>
  );
}
