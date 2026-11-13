"use client";

import type { ReactNode } from "react";
import { Sheet } from "@/components/Sheet";

export function Dialog({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  return (
    <Sheet label={title} showTitle onClose={close}>
      <div className="markets-ui mt-4">{children}</div>
    </Sheet>
  );
}
