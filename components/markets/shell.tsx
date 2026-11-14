import Link from "next/link";
import type { ReactNode } from "react";
import { Arrow, FourfivexBrand } from "@/components/ui";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";

export function MarketsHeader({ showMarketsLink = true, actions }: { showMarketsLink?: boolean; actions?: ReactNode }) {
  return (
    <header className={actions ? "market-page-header" : "border-b border-line"}>
      <div className="markets-container flex min-h-14 items-center gap-3 sm:min-h-[60px] sm:gap-4">
        <Link href="/" className="flex min-h-11 items-center gap-2.5 rounded-lg" aria-label="fourfivex wallet">
          <FourfivexBrand />
        </Link>
        {showMarketsLink && <nav aria-label="Markets" className="flex items-center gap-3 sm:gap-4">
          <span aria-hidden="true" className="h-4 w-px rotate-[18deg] bg-field-line" />
          <Link href="/markets" className="inline-flex min-h-11 items-center rounded-md text-sm font-medium text-ink-2 hover:text-ink hover:underline focus-visible:underline">
            Markets
          </Link>
        </nav>}
        {actions && <>
          <span aria-hidden="true" className="market-header-divider" />
          <h1 className="market-page-title">Markets</h1>
          <div className="market-header-actions">{actions}</div>
        </>}
      </div>
    </header>
  );
}

export function MarketsFooter() {
  return <footer className="markets-container mt-3 flex justify-end pb-6"><ThemeSwitcher /></footer>;
}

export function ShellMessage({ title, text }: { title: string; text: string }) {
  return <>
    <MarketsHeader showMarketsLink={false} />
    <main className="shell py-12">
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      {text && <p className="mt-3 text-sm text-ink-2">{text}</p>}
      <Link href="/markets" className="action action-secondary mt-6"><Arrow size={16} className="rotate-180" /> Back to markets</Link>
    </main>
  </>;
}
