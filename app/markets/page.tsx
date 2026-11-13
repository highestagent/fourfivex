import type { Metadata } from "next";
import { Markets } from "@/components/markets/Markets";

export const metadata: Metadata = { title: "Markets | Intuite" };

export default function MarketsPage() {
  return <Markets />;
}
