import Link from "next/link";
import { FourfivexBrand } from "./ui";

type Destination = "wallet" | "markets";

const destinations = [
  { id: "wallet", href: "/", label: "Wallet" },
  { id: "markets", href: "/markets", label: "Markets" },
] as const;

export function AppNavigation({ current, compact = false, onWalletNavigate }: {
  current?: Destination;
  compact?: boolean;
  onWalletNavigate?: () => void;
}) {
  return (
    <nav aria-label="Main navigation" className="flex shrink-0 items-center gap-1 sm:gap-2">
      <Link href="/" aria-label="fourfivex home" onNavigate={onWalletNavigate}
        className="mr-1 flex min-h-11 min-w-11 items-center justify-center rounded-lg pr-1 sm:mr-2">
        <FourfivexBrand markOnly={compact} />
      </Link>
      {destinations.map(({ id, href, label }) => (
        <Link key={id} href={href} onNavigate={id === "wallet" ? onWalletNavigate : undefined}
          aria-current={current === id ? "page" : undefined}
          className="inline-flex min-h-11 items-center rounded-lg px-1.5 text-sm font-medium text-ink-2 hover:bg-card hover:text-ink aria-[current=page]:font-semibold aria-[current=page]:text-ink aria-[current=page]:underline aria-[current=page]:underline-offset-4 sm:px-2">
          {label}
        </Link>
      ))}
    </nav>
  );
}
