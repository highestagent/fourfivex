"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Close } from "./ui";

/** A card that takes over the page: one thing to read, decide and sign. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = before;
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);

  const away = (e: React.PointerEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-white/80 backdrop-blur-md"
      style={{ animation: "fade .2s ease-out both" }}
      onPointerDown={away}
    >
      <div className="mx-auto w-full max-w-[960px] px-3 py-4 sm:px-6 sm:py-10" onPointerDown={away}>
        <div role="dialog" aria-modal="true" aria-label={title} className="animate-rise rounded-[28px] bg-card p-5 shadow-sheet sm:p-8">
          <div className="flex items-center justify-between gap-4">
            <span className="mono rounded-full bg-white px-3 py-2 shadow-chip">{title}</span>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full bg-white text-ink-2 shadow-chip hover:text-ink"
            >
              <Close size={15} />
            </button>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

export function SheetLabel({ children }: { children: string }) {
  return <p className="mono mb-2.5 text-ink-3">{children}</p>;
}
