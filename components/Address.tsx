/**
 * An address on one line at any width. The start and the last six characters always show; the
 * middle gives way with an ellipsis when space runs out. Selecting or copying still gives the
 * whole address, because the ellipsis is only drawn, not written.
 */
export function Address({ value, className = "" }: { value: string; className?: string }) {
  const tail = value.length > 14 ? value.slice(-6) : "";
  const head = tail ? value.slice(0, -6) : value;
  return (
    <span title={value} className={`flex min-w-0 font-mono whitespace-nowrap tabular-nums select-text ${className}`}>
      <span className="min-w-0 overflow-hidden text-ellipsis">{head}</span>
      {tail && <span className="shrink-0">{tail}</span>}
    </span>
  );
}
