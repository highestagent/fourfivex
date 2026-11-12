export function usd(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function usd0(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

/** Small costs read better as cents. */
export function cost(n: number): string {
  if (n < 0.005) return "under 1¢";
  return n < 1 ? `${Math.round(n * 100)}¢` : usd(n);
}

/** A coin amount with four significant figures and no exponent. */
export function coin(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  if (n >= 100) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const s = Number(n.toPrecision(4));
  return s < 1e-6 ? s.toFixed(8) : String(s);
}

export function pct(n: number): string {
  return `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`;
}

/** "14 seconds", "about 13 minutes". */
export function wait(seconds: number): string {
  if (seconds < 90) return `about ${Math.max(5, Math.round(seconds / 5) * 5)} seconds`;
  return `about ${Math.round(seconds / 60)} minutes`;
}

/** What one dot stands for: the smallest 1, 2, 5, 10, 20, 50... that keeps the picture to 60 dots or fewer. */
export function dotUnit(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 60) return 1;
  let unit = 1;
  for (;;) {
    for (const m of [1, 2, 5]) if (amount / (unit * m) <= 60) return unit * m;
    unit *= 10;
  }
}
