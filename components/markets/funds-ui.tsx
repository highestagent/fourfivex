import type { ReactNode } from "react";
import { ArrowUpRight, CircleCheck, TriangleAlert } from "lucide-react";
import "./funds.css";

export const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function saved<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem(key) ?? "null"); }
  catch { return null; }
}

export function Callout({ tone, role, children }: { tone: "ok" | "warn" | "error"; role?: "status" | "alert"; children: ReactNode }) {
  const Icon = tone === "ok" ? CircleCheck : TriangleAlert;
  return (
    <div className={`funds-callout funds-callout-${tone}`} role={role}>
      <Icon size={16} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

export function OutLink({ href, primary = false, children }: { href: string; primary?: boolean; children: ReactNode }) {
  return (
    <a className={`action ${primary ? "action-primary" : "action-secondary"}`} href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <ArrowUpRight size={16} aria-hidden="true" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
