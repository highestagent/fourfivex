import type { Metadata } from "next";
import { Markets } from "@/components/markets/Markets";

export const metadata: Metadata = { title: "Markets | fourfivex" };

export default function MarketsPage() {
  return <Markets />;
}
