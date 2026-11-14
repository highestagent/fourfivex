import Link from "next/link";
import { FourfivexBrand } from "./ui";

export function AppNavigation({ compact = false, onWalletNavigate }: {
  compact?: boolean;
  onWalletNavigate?: () => void;
}) {
  return (
    <Link href="/" aria-label="fourfivex home" onNavigate={onWalletNavigate}
      className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg">
      <FourfivexBrand markOnly={compact} />
    </Link>
  );
}
