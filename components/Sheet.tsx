"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Close } from "./ui";

export function Sheet({
  label,
  onClose,
  busy = false,
  children,
}: {
  label: string;
  onClose: () => void;
  busy?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  const close = () => {
    if (busy) return;
    ref.current?.close();
    onClose();
  };

  return (
    <dialog
      ref={ref}
      aria-label={label}
      className="sheet m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-1.5rem)] max-w-[640px] overflow-y-auto overscroll-contain rounded-[24px] border border-line bg-card p-5 text-ink shadow-sheet sm:p-8"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="mb-1 flex justify-end">
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          disabled={busy}
          className="grid size-11 shrink-0 place-items-center rounded-full border border-line bg-white text-ink-2 enabled:cursor-pointer enabled:hover:text-ink disabled:opacity-50"
        >
          <Close size={17} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
