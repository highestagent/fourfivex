import { describe, expect, it } from "vitest";
import { describePosition, explorerLink, fillEvents, ledgerEvents } from "../lib/markets/activity";

const ME = "0xb24fe87ea8497c78c044c0ce7076028b562e7195";
const OTHER = "0x8ba1f109551bd432803012645ac136ddd64dba72";
const HASH = "0xabc0000000000000000000000000000000000000000000000000000000000001";

type Fills = Parameters<typeof fillEvents>[0];
type Updates = Parameters<typeof ledgerEvents>[0];
type Position = Parameters<typeof describePosition>[0];

const fill = (values: Partial<Fills[number]>) => ({
  coin: "BTC", px: "100000", sz: "0.001", side: "B", time: 1_000, startPosition: "0", dir: "Open Long",
  closedPnl: "0", hash: HASH, oid: 1, crossed: true, fee: "0.05", tid: 1, feeToken: "USDC", ...values,
}) as Fills[number];

describe("fillEvents", () => {
  it("joins the pieces of one order into one event", () => {
    const events = fillEvents([fill({ time: 1_000 }), fill({ time: 2_000, px: "100100" })]);
    expect(events).toEqual([{ id: "fill:1", at: 2_000, text: "You opened a $200.10 long on bitcoin.", url: `https://app.hyperliquid.xyz/explorer/tx/${HASH}` }]);
  });

  it("words closes with the result after fees, and liquidations plainly", () => {
    expect(fillEvents([fill({ dir: "Close Short", coin: "ETH", px: "2000", sz: "0.5", closedPnl: "-12", fee: "0.5" })])[0].text)
      .toBe("You closed a $1,000.00 short on ether for a $12.50 loss.");
    expect(fillEvents([fill({ dir: "Close Long", closedPnl: "20", fee: "1", liquidation: { markPx: "1", method: "market" } })])[0].text)
      .toBe("Your bitcoin long was liquidated.");
    expect(fillEvents([fill({ dir: "Long > Short", coin: "HYPE" })])[0].text).toBe("You turned your HYPE position into a short.");
  });

  it("leaves out spot fills", () => {
    expect(fillEvents([fill({ coin: "@107", dir: "Buy" }), fill({ coin: "PURR/USDC", dir: "Sell", oid: 2 })])).toEqual([]);
  });
});

describe("ledgerEvents", () => {
  const update = (delta: Updates[number]["delta"], time = 5_000) => ({ time, hash: HASH, delta }) as Updates[number];

  it("words money moving in and out of trading", () => {
    const events = ledgerEvents([
      update({ type: "deposit", usdc: "25.5" }),
      update({ type: "withdraw", usdc: "10", nonce: 1, fee: "1" }),
      update({ type: "send", user: OTHER, destination: ME, sourceDex: "", destinationDex: "", token: "USDC", amount: "7", usdcValue: "7", fee: "0", nativeTokenFee: "0", nonce: 1, feeToken: "USDC" }),
      update({ type: "internalTransfer", usdc: "3", user: ME, destination: OTHER, fee: "1" }),
    ], ME);
    expect(events.map(event => event.text)).toEqual([
      "You added $25.50 to trading.",
      "You withdrew $10.00 from trading.",
      "You received $7.00 in trading.",
      "You sent $3.00 from trading.",
    ]);
  });

  it("leaves out moves inside the trading balance", () => {
    expect(ledgerEvents([update({ type: "accountClassTransfer", usdc: "5", toPerp: true })], ME)).toEqual([]);
  });
});

describe("describePosition", () => {
  it("states the position and what to watch", () => {
    const position = { coin: "BTC", szi: "-0.01", positionValue: "1000", unrealizedPnl: "-4.2", leverage: { type: "isolated", value: 5 }, liquidationPx: "118250.5" } as unknown as Position;
    expect(describePosition(position)).toEqual({
      text: "Your short on bitcoin is worth $1,000.00 at 5×.",
      detail: "Down $4.20 · closes automatically at $118,250.50",
    });
  });

  it("keeps small prices readable", () => {
    const position = { coin: "PEPE", szi: "100000", positionValue: "1", unrealizedPnl: "0", leverage: { type: "isolated", value: 3 }, liquidationPx: "0.000006834" } as unknown as Position;
    expect(describePosition(position).detail).toBe("Up $0.00 · closes automatically at $0.000006834");
  });
});

describe("explorerLink", () => {
  it("skips the empty hash Hyperliquid uses for some fills", () => {
    expect(explorerLink(`0x${"0".repeat(64)}`)).toBeUndefined();
    expect(explorerLink(HASH)).toBe(`https://app.hyperliquid.xyz/explorer/tx/${HASH}`);
  });
});
