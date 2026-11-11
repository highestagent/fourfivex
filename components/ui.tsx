import type { ReactNode, SVGProps } from "react";
import type { StatusTone } from "@/lib/verbs";

export function Panel({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-[18px] bg-white shadow-panel ${className}`}>{children}</div>;
}

/** A white floating pill, used for legends and counts. */
export function Pill({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={`inline-flex items-center gap-3 rounded-full bg-white px-3.5 py-1.5 text-[12.5px] text-ink shadow-chip ${className}`}
    >
      {children}
    </div>
  );
}

export function Dot({ color, className = "" }: { color: string; className?: string }) {
  return <span className={`inline-block size-[7px] shrink-0 rounded-full ${className}`} style={{ background: color }} />;
}

export function Sep() {
  return <span className="h-3 w-px bg-line" aria-hidden="true" />;
}

const STATUS: Record<StatusTone, string> = {
  live: "bg-green-3 text-green",
  muted: "bg-black/[0.045] text-ink-2",
  warn: "bg-amber-3 text-amber",
};

export function StatusPill({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span className={`mono inline-flex items-center gap-1.5 rounded-full px-2 py-1 !text-[9.5px] ${STATUS[tone]}`}>
      {tone === "live" && <span className="size-[5px] rounded-full bg-current animate-pulse-dot" />}
      {children}
    </span>
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

export const Check = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 8.5l3 3 6-7" />
  </Svg>
);
export const Arrow = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8h10M9 4l4 4-4 4" />
  </Svg>
);
export const ArrowUp = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 13V3M4 7l4-4 4 4" />
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
export const Lock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="7" width="9" height="6.5" rx="1.8" />
    <path d="M5.5 7V5.2a2.5 2.5 0 015 0V7" />
  </Svg>
);
export const Finger = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 8.6V7.5a4.5 4.5 0 0 1 9 0v1.3" />
    <path d="M5.7 12.9c.5-1.5.7-3.2.7-5.2a1.6 1.6 0 0 1 3.2 0c0 2.300-.4 4.300-1.100 6" />
    <path d="M12.400 11c-.1.800-.3 1.600-.6 2.400M3.700 10.900c.1-.5.2-1 .2-1.500M8 7.800c0 2-.3 3.800-.9 5.400" />
  </Svg>
);
export const Shield = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 2l5 1.8v4c0 3-2 5.2-5 6.2-3-1-5-3.2-5-6.2v-4z" />
    <path d="M5.8 8.2l1.6 1.6 2.9-3.3" />
  </Svg>
);

export function Spinner({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      className={`animate-spin ${className}`}
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.8" />
      <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** The green tick in a filled circle, used when something has arrived. */
export function Tick({ size = 16 }: { size?: number }) {
  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-full bg-green-2 text-white"
      style={{ width: size, height: size }}
    >
      <Check size={size * 0.72} strokeWidth={2.2} />
    </span>
  );
}
