"use client";

import { useMemo } from "react";
import { encode } from "uqr";

/**
 * A scannable code for an address. It stays black on white in both themes on purpose: many wallet
 * scanners can't read a light code on a dark background.
 */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const { size, data } = encode(value, { ecc: "M", border: 2 });
    let path = "";
    data.forEach((row, y) => row.forEach((dark, x) => {
      if (dark) path += `M${x} ${y}h1v1h-1z`;
    }));
    return { size, path };
  }, [value]);

  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" className="size-36 shrink-0 rounded-xl">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
