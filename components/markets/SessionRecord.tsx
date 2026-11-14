import type { TrackRecord } from "@fourfivex/markets-protocol/sessions";
import { Address } from "@/components/Address";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const signedUsd = (value: number) => (value > 0 ? "+" : "") + usd.format(value);
export const usdc = (amount: string | number) => usd.format(Number(amount));

/** A host's record as the service read it: net P&L over the window, how active, and how much of the window it covers. */
export function SessionRecord({ record }: { record: TrackRecord }) {
  const tone = record.net > 0 ? "trade-long" : record.net < 0 ? "trade-short" : "";
  return (
    <div className="session-record">
      <dl>
        <div><dt>Net P&amp;L · {record.window.days} days</dt><dd className={tone}>{signedUsd(record.net)}</dd></div>
        <div><dt>Trades</dt><dd>{record.fills} on {record.activeDays} {record.activeDays === 1 ? "day" : "days"}</dd></div>
        <div>
          <dt>Coverage</dt>
          <dd className={record.coverage.complete ? "" : "text-amber"}>{record.coverage.days} of {record.window.days} days</dd>
        </div>
      </dl>
      <p className="session-record-foot">
        <span>Closed {signedUsd(record.realized)} · fees {usd.format(record.fees)} · funding {signedUsd(record.funding)}</span>
        <Address value={record.address} className="session-record-address" />
      </p>
    </div>
  );
}
