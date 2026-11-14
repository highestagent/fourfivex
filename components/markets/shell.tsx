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
