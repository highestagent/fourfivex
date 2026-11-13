"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import { useContext, type ReactNode } from "react";
import { MobilePicker } from "./Sheet";
import { Arrow, Check, Chevron } from "./ui";

type SelectOption<Value extends string | number> = {
  value: Value;
  label: string;
  marker?: ReactNode;
};

export function Select<Value extends string | number>({
  id,
  name,
  label,
  labelledBy,
  value,
  options,
  onValueChange,
  className,
  placeholder,
  pickerTitle,
  triggerLabel,
  triggerIcon,
  title,
}: {
  id?: string;
  name?: string;
  label?: string;
  labelledBy?: string;
  value: Value;
  options: readonly SelectOption<Value>[];
  onValueChange: (value: Value) => void;
  className: string;
  placeholder?: string;
  pickerTitle: string;
  triggerLabel?: string;
  triggerIcon?: ReactNode;
  title?: string;
}) {
  const openPicker = useContext(MobilePicker);
  const selected = options.find((option) => option.value === value);
  const triggerClass = `inline-flex cursor-pointer items-center gap-2 text-left ${className}`;
  const choose = (next: string) => {
    const option = options.find((option) => String(option.value) === next);
    if (option) onValueChange(option.value);
  };

  if (openPicker) {
    return (
      <button
        type="button"
        id={id}
        aria-label={label}
        aria-labelledby={labelledBy ? `${labelledBy} ${id}-value` : undefined}
        title={title}
        className={triggerClass}
        onClick={(event) => openPicker({
          title: pickerTitle,
          value: String(value),
          options: options.map((option) => ({ ...option, value: String(option.value) })),
          onSelect: choose,
        }, event.currentTarget)}
      >
        {triggerIcon ?? <>
          {selected?.marker}
          <span id={id ? `${id}-value` : undefined} className="min-w-0 truncate">{triggerLabel ?? selected?.label ?? placeholder}</span>
          <Arrow size={14} className="ml-auto shrink-0 text-ink-2" />
        </>}
      </button>
    );
  }

  return (
    <SelectPrimitive.Root
      name={name}
      value={String(value)}
      onValueChange={choose}
    >
      <SelectPrimitive.Trigger
        id={id}
        aria-label={label}
        aria-labelledby={labelledBy}
        title={title}
        className={triggerClass}
      >
        {triggerIcon ?? <>
          {selected?.marker}
          <span className="min-w-0 truncate">
            <SelectPrimitive.Value placeholder={placeholder}>{triggerLabel ?? selected?.label}</SelectPrimitive.Value>
          </span>
          <SelectPrimitive.Icon asChild>
            <Chevron size={14} className="ml-auto shrink-0 text-ink-2" />
          </SelectPrimitive.Icon>
        </>}
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="z-[60] max-h-[var(--radix-select-content-available-height)] min-w-[min(9rem,var(--radix-select-content-available-width))] max-w-[var(--radix-select-content-available-width)] w-[var(--radix-select-trigger-width)] overflow-hidden rounded-[14px] border border-line bg-surface text-ink shadow-sheet"
        >
          <SelectPrimitive.ScrollUpButton className="grid h-6 place-items-center text-ink-2">
            <Chevron size={14} className="rotate-180" />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={String(option.value)}
                className="grid min-h-11 cursor-pointer grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 rounded-[9px] px-2.5 py-2 text-sm leading-snug outline-none focus-visible:-outline-offset-2 data-[highlighted]:bg-blue-4 data-[highlighted]:text-blue"
              >
                <span className="grid place-items-center text-blue">
                  <SelectPrimitive.ItemIndicator><Check size={14} /></SelectPrimitive.ItemIndicator>
                </span>
                <span className="flex min-w-0 items-center gap-1.5 wrap-anywhere">
                  {option.marker}
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                </span>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="grid h-6 place-items-center text-ink-2">
            <Chevron size={14} />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
