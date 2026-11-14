import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { sessionTag, signalOrderId, signalProblem, signalRule, usdcUnits, fillMarket } from "@fourfivex/markets-protocol/sessions";
import { seatOutcome, seatPayment } from "../lib/markets/room-payments";

const account = "0x" + "ab".repeat(20);
const room = "5f0c6a8e-8f3c-4a39-9d3e-0b6f2f1c9a11";
const ESCROW = "room-escrow.fourfivex.near";
const TOKEN = "nep141:usdc.test";

function payload(change: (intent: Record<string, unknown>, body: Record<string, unknown>) => void = () => {}) {
  const intent: Record<string, unknown> = {
    intent: "transfer", receiver_id: ESCROW, tokens: { [TOKEN]: "25000000" }, msg: JSON.stringify({ session: room, entry: "a".repeat(64) }),
  };
  const body: Record<string, unknown> = {
    signer_id: account, verifying_contract: "intents.near", deadline: new Date(Date.now() + 5 * 60_000).toISOString(), nonce: "n", intents: [intent],
  };
  change(intent, body);
  return JSON.stringify(body);
}

describe("the seat payment relay", () => {
  beforeEach(() => {
    vi.stubEnv("ROOM_ESCROW_CONTRACT", ESCROW);
    vi.stubEnv("ROOM_ESCROW_TOKEN", TOKEN);
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  test("takes exactly one transfer of the fee token to the escrow, naming a session", () => {
    expect(seatPayment(payload(), account)).toEqual({ session: room });
  });

  test("refuses anything else it could be used to relay", () => {
    const refused = [
      payload((_, body) => { body.signer_id = "0x" + "cd".repeat(20); }),
      payload(intent => { intent.receiver_id = "someone-else.near"; }),
      payload(intent => { intent.tokens = { [TOKEN]: "25000000", "nep141:other.near": "1" }; }),
      payload(intent => { intent.tokens = { "nep141:other.near": "25000000" }; }),
      payload(intent => { intent.min_gas = "300000000000000"; }),
      payload(intent => { intent.msg = JSON.stringify({ session: "not-a-room", entry: "a".repeat(64) }); }),
      payload(intent => { intent.msg = JSON.stringify({ session: room }); }),
      payload((intent, body) => { body.intents = [intent, { intent: "add_public_key", public_key: "ed25519:x" }]; }),
      payload(intent => { intent.intent = "ft_withdraw"; }),
      payload((_, body) => { body.deadline = new Date(Date.now() + 60 * 60_000).toISOString(); }),
      payload((_, body) => { body.verifying_contract = "intents.testnet"; }),
    ];
    for (const value of refused) expect(seatPayment(value, account)).toBeUndefined();
  });

  test("reads the escrow's verdict from the receipts", () => {
    const log = (event: string, data: object) => `EVENT_JSON:${JSON.stringify({ standard: "fourfivex_room_escrow", version: "1.0.0", event, data: [data] })}`;
    expect(seatOutcome([{ outcome: { logs: [log("seat_paid", { session: room })] } }], "tx")).toEqual({ transaction: "tx", seat: true });
    expect(seatOutcome([{ outcome: { logs: ["other", log("payment_refunded", { reason: "sold_out" })] } }], "tx"))
      .toEqual({ transaction: "tx", seat: false, reason: "sold_out" });
    expect(seatOutcome([], "tx")).toEqual({ transaction: "tx", seat: false, reason: "unknown" });
  });
});

describe("trade signals", () => {
  test("a signal is usable only while it is fresh and the price is close to the host's fill", () => {
    const fill = { price: "100", time: 1_000_000 };
    expect(signalProblem(fill, 100.5, fill.time + 60_000)).toBeUndefined();
    expect(signalProblem(fill, 100, fill.time + signalRule.maxAgeMs + 1)).toMatch(/more than 5 minutes old/);
    expect(signalProblem(fill, 101.01, fill.time)).toMatch(/moved more than 1%/);
    expect(signalProblem(fill, 98.99, fill.time)).toMatch(/moved more than 1%/);
  });

  test("an order placed from a session's feed carries the session's tag, so its fill can be tied to the session", async () => {
    const tag = await sessionTag(room);
    const id = await signalOrderId(room);
    expect(id).toMatch(/^0x[0-9a-f]{32}$/);
    expect(id.startsWith(`0x${tag}`)).toBe(true);
    expect(await signalOrderId(room)).not.toBe(id);
    expect((await signalOrderId("6f0c6a8e-8f3c-4a39-9d3e-0b6f2f1c9a11")).startsWith(`0x${tag}`)).toBe(false);
  });

  test("fees convert to USDC units exactly, and fills name their market", () => {
    expect(usdcUnits("25")).toBe("25000000");
    expect(usdcUnits("12.5")).toBe("12500000");
    expect(usdcUnits("0.01")).toBe("10000");
    expect(fillMarket("BTC")).toBe("hyperliquid:perp:BTC");
    expect(fillMarket("xyz:TSLA")).toBe("hyperliquid:perp:xyz:TSLA");
    expect(fillMarket("@107")).toBe("hyperliquid:spot:@107");
  });
});
