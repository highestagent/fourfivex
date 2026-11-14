import Link from "next/link";
import type { ReactNode } from "react";
import { AppNavigation } from "@/components/AppNavigation";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";

export function MarketsHeader({ current, actions }: { current?: "markets"; actions?: ReactNode }) {
  return (
    <header className="border-b border-line">
      <div className="markets-container flex min-h-14 flex-wrap items-center gap-x-3 sm:min-h-[60px]">
        <AppNavigation compact={!current} />
        {actions && <div className="market-header-actions">{actions}</div>}
      </div>
    </header>
  );
}

export function MarketsFooter() {
  return <footer className="markets-container mt-3 flex justify-end pb-6"><ThemeSwitcher /></footer>;
}

/**
 * A room while it opens: its own frame and one line, from the moment the page starts until the chart arrives.
 * Every stage of opening (the page, the access check, the live connection) shows this same frame, so the
 * stages hand over without anything on screen changing.
 */
export function RoomLoading() {
  return (
    <div className="markets-ui room-page" aria-busy="true">
      <header className="markets-container room-header">
        <AppNavigation compact />
        <span className="room-header-divider" aria-hidden="true" />
        <h1 className="room-title"><span className="room-title-prefix">Trading </span>room</h1>
      </header>
      <main>
        <div className="workspace-grid">
          <div className="chart-panel chart-loading" role="status">Opening room…</div>
          <section className="discussion" aria-hidden="true" />
        </div>
      </main>
    </div>
  );
}

export function ShellMessage({ title, text, actions }: { title: string; text?: string; actions?: ReactNode }) {
  return <>
    <MarketsHeader />
    <main className="shell py-12">
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      {text && <p className="mt-3 text-sm text-ink-2">{text}</p>}
      <div className="mt-6 flex flex-wrap gap-2">
        {actions}
        <Link href="/markets" className="action action-secondary">Back to Markets</Link>
      </div>
    </main>
  </>;
}
