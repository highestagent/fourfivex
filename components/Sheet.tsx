"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { createContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useMobileSheet } from "@/lib/hooks";
import { Arrow, Check, Close } from "./ui";

type Choice = { value: string; label: string; marker?: ReactNode };
type Picker = {
  title: string;
  options: readonly Choice[];
  value: string;
  onSelect: (value: string) => void;
};

export const MobilePicker = createContext<((picker: Picker, trigger: HTMLButtonElement) => void) | null>(null);

export function Sheet({
  label,
  onClose,
  busy = false,
  showTitle = false,
  step,
  children,
}: {
  label: string;
  onClose: () => void;
  busy?: boolean;
  showTitle?: boolean;
  step?: { title: string; onBack: () => void; returnFocusId: string };
  children: ReactNode;
}) {
  const mobile = useMobileSheet();
  const [picker, setPicker] = useState<Picker | null>(null);
  const choices = mobile ? picker : null;
  const substep = mobile ? step : undefined;
  const title = choices?.title ?? substep?.title ?? label;
  const back = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const pickerTrigger = useRef<HTMLButtonElement>(null);
  const view = choices ? "choices" : substep ? "step" : "main";
  const previous = useRef({ view, returnFocusId: substep?.returnFocusId });

  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = { view, returnFocusId: substep?.returnFocusId };
    if (view === from.view) return;
    if (body.current) body.current.scrollTop = 0;

    const target = view === "choices"
      ? back.current
      : from.view === "choices"
        ? pickerTrigger.current
        : from.returnFocusId && document.getElementById(from.returnFocusId);
    if (from.view === "choices") pickerTrigger.current = null;
    if (target && target.getClientRects().length) {
      target.focus();
    } else if (view === "step") {
      back.current?.focus();
    }
  }, [view, substep?.returnFocusId]);

  const openPicker = (next: Picker, trigger: HTMLButtonElement) => {
    pickerTrigger.current = trigger;
    setPicker(next);
  };
  const canGoBack = view !== "main";
  const goBack = () => {
    if (choices) setPicker(null);
    else substep?.onBack();
  };

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 hidden bg-scrim sm:block" />
        <Dialog.Content
          aria-describedby={undefined}
          onPointerDownOutside={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            if (!canGoBack) return;
            event.preventDefault();
            goBack();
          }}
          className="fixed inset-0 z-50 grid grid-rows-[auto_minmax(0,1fr)] bg-card text-ink sm:inset-auto sm:top-1/2 sm:left-1/2 sm:block sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100%-1.5rem)] sm:max-w-[640px] sm:-translate-1/2 sm:overflow-y-auto sm:overscroll-contain sm:rounded-[24px] sm:border sm:border-line sm:p-8 sm:shadow-sheet"
        >
          <header className="wallet-sheet-header flex min-h-11 items-center gap-3 sm:mb-1 sm:justify-end">
            {canGoBack && (
              <button ref={back} type="button" className="action action-secondary shrink-0" onClick={goBack}>
                <Arrow size={16} className="rotate-180" />
                Back
              </button>
            )}
            <Dialog.Title className={canGoBack ? "min-w-0 text-base font-semibold" : showTitle ? "mr-auto min-w-0 text-xl font-semibold tracking-tight" : "sr-only"}>{title}</Dialog.Title>
            {!canGoBack && (
              <Dialog.Close
                aria-label="Close"
                disabled={busy}
                className="ml-auto inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full border border-line bg-surface px-3 text-sm font-medium text-ink-2 enabled:cursor-pointer enabled:hover:text-ink disabled:opacity-50 sm:size-11 sm:px-0"
              >
                <Close size={17} />
                <span className="sm:hidden">Close</span>
              </Dialog.Close>
            )}
          </header>
          <div ref={body} className="wallet-sheet-body min-h-0 overflow-y-auto overscroll-contain sm:overflow-visible">
            <div hidden={!!choices}>
              <MobilePicker value={mobile ? openPicker : null}>{children}</MobilePicker>
            </div>
            {choices && (
              <ul aria-label={choices.title} className="divide-y divide-line rounded-[18px] border border-line bg-surface px-2">
                {choices.options.map((option) => (
                  <li key={option.value}>
                    <button
                      type="button"
                      aria-pressed={option.value === choices.value}
                      onClick={() => {
                        setPicker(null);
                        choices.onSelect(option.value);
                      }}
                      className="flex min-h-12 w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2.5 text-left text-base hover:bg-blue-4 aria-pressed:font-medium aria-pressed:text-blue"
                    >
                      {option.marker}
                      <span className="min-w-0 flex-1 wrap-anywhere">{option.label}</span>
                      {option.value === choices.value && <Check size={17} className="shrink-0" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
