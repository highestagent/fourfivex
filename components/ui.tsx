"use client";

import Image from "next/image";
import { useState, type ReactNode, type SVGProps } from "react";

export function FourfivexBrand({ markOnly = false }: { markOnly?: boolean }) {
  return (
    <>
      <Image src="/icon.svg" alt="" width={28} height={28} className="size-7 shrink-0 rounded-[8px]" unoptimized />
      {!markOnly && <span className="text-[17px] font-semibold tracking-[-0.035em]">fourfivex</span>}
    </>
  );
}

export function Dot({ color, className = "" }: { color: string; className?: string }) {
  return <span className={`inline-block size-[7px] shrink-0 rounded-full ${className}`} style={{ background: color }} />;
}

/** A small pill that copies some text. It says "Copied" for a moment. */
export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : label}
      className="mono cursor-pointer min-h-9 rounded-full border border-line bg-card px-3 hover:bg-ink hover:text-inverse"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          /* clipboard refused: the text is still visible */
        }
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const Arrow = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8h10M9 4l4 4-4 4" />
  </Svg>
);
export const Check = (p: IconProps) => (
  <Svg {...p}>
    <path d="m3.5 8.5 3 3 6-7" />
  </Svg>
);
export const Close = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
);
export const Plus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3.5v9M3.5 8h9" />
  </Svg>
);
export const Chevron = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 6.5L8 10l3.5-3.5" />
  </Svg>
);
export const Finger = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 8.6V7.5a4.5 4.5 0 0 1 9 0v1.3" />
    <path d="M5.7 12.9c.5-1.5.7-3.2.7-5.2a1.6 1.6 0 0 1 3.2 0c0 2.300-.4 4.300-1.100 6" />
    <path d="M12.400 11c-.1.800-.3 1.600-.6 2.400M3.700 10.900c.1-.5.2-1 .2-1.500M8 7.800c0 2-.3 3.800-.9 5.400" />
  </Svg>
);
