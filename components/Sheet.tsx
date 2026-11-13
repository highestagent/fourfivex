"use client";

import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
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
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/25" />
        <Dialog.Content
          aria-describedby={undefined}
          onPointerDownOutside={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-1.5rem)] max-w-[640px] -translate-1/2 overflow-y-auto overscroll-contain rounded-[24px] border border-line bg-card p-5 text-ink shadow-sheet sm:p-8"
        >
          <Dialog.Title className="sr-only">{label}</Dialog.Title>
          <div className="mb-1 flex justify-end">
            <Dialog.Close
              aria-label="Close"
              disabled={busy}
              className="grid size-11 shrink-0 place-items-center rounded-full border border-line bg-white text-ink-2 enabled:cursor-pointer enabled:hover:text-ink disabled:opacity-50"
            >
              <Close size={17} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
