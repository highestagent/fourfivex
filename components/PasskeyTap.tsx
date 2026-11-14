"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useSyncExternalStore } from "react";
import { tapRequests } from "@/lib/account/tap";
import { Finger } from "./ui";

const onServer = () => null;

/** The tap some browsers need before they open a passkey prompt. It sits above any open sheet. */
export function PasskeyTap() {
  const request = useSyncExternalStore(tapRequests.subscribe, tapRequests.current, onServer);
  return (
    <Dialog.Root open={request !== null} onOpenChange={(open) => { if (!open) request?.cancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-60 bg-scrim" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-61 grid w-[calc(100%-2rem)] max-w-[360px] -translate-x-1/2 gap-5 rounded-[24px] border border-line bg-card p-6 text-ink shadow-sheet sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2"
        >
          <Dialog.Title className="text-lg font-semibold tracking-tight">Continue with your passkey</Dialog.Title>
          <div className="grid gap-2.5">
            {/* Starts the passkey request inside this tap, so the browser lets the prompt open. */}
            <button type="button" className="action action-primary" onClick={() => request?.start()}>
              <Finger size={17} /> Continue
            </button>
            <Dialog.Close className="action action-secondary">Cancel</Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
