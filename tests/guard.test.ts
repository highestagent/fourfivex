import { describe, expect, it } from "vitest";
import { payloadProblem } from "../lib/send/guard";

const NOW = Date.parse("2026-11-12T00:00:00Z");
const ACCOUNT = "0x3602b546589a8fcafdce7fad64a46f91db0e4d50";
const DEPOSIT = "4f72ca933f12df9abfcc1a086ccd0b8b7b227ad9341250ad635016a0ad58e9a6";
const BTC = "nep141:btc.omft.near";

// Shape returned by /v0/generate-intent for a bitcoin transfer.
const fixture = (over: Record<string, unknown> = {}) => ({
  verifying_contract: "intents.near",
  signer_id: ACCOUNT,
  deadline: "2026-11-15T02:36:08.000Z",
  nonce: "Vij2xgAlKBKzAPBrlmMX6BiuTGJU0/D5oCf+qxVQFCI=",
  intents: [{ intent: "transfer", receiver_id: DEPOSIT, tokens: { [BTC]: "70000" } }],
  ...over,
});

const expect_ = { accountId: ACCOUNT, depositAddress: DEPOSIT, assetId: BTC, maxUnits: "70000" };
const check = (p: unknown, e = expect_) => payloadProblem(typeof p === "string" ? p : JSON.stringify(p), e, NOW);
const withIntent = (i: Record<string, unknown>) => fixture({ intents: [i] });
const transfer = (over: Record<string, unknown>) => withIntent({ intent: "transfer", receiver_id: DEPOSIT, tokens: { [BTC]: "70000" }, ...over });

describe("payloadProblem", () => {
  it("accepts what 1Click generated", () => {
    expect(check(fixture())).toBeNull();
    expect(check(fixture(), { ...expect_, maxUnits: "80000" })).toBeNull();
    expect(check(transfer({ memo: "hi" }))).toBeNull();
  });

  it("refuses the wrong contract", () => expect(check(fixture({ verifying_contract: "evil.near" }))).not.toBeNull());
  it("refuses the wrong signer", () => expect(check(fixture({ signer_id: "0xabc" }))).not.toBeNull());
  it("refuses the wrong receiver", () => expect(check(transfer({ receiver_id: "attacker.near" }))).not.toBeNull());
  it("refuses a different token", () => expect(check(transfer({ tokens: { "nep141:eth.omft.near": "70000" } }))).not.toBeNull());
  it("refuses more than the shown amount", () => expect(check(transfer({ tokens: { [BTC]: "70001" } }))).not.toBeNull());
  it("refuses a zero amount", () => expect(check(transfer({ tokens: { [BTC]: "0" } }))).not.toBeNull());
  it("refuses an amount that is not a plain number", () => {
    expect(check(transfer({ tokens: { [BTC]: "7e4" } }))).not.toBeNull();
    expect(check(transfer({ tokens: { [BTC]: 70000 } }))).not.toBeNull();
    expect(check(transfer({ tokens: { [BTC]: "-5" } }))).not.toBeNull();
  });

  it("refuses two intents", () => {
    const one = { intent: "transfer", receiver_id: DEPOSIT, tokens: { [BTC]: "1" } };
    expect(check(fixture({ intents: [one, one] }))).not.toBeNull();
    expect(check(fixture({ intents: [] }))).not.toBeNull();
  });

  it("refuses an intent that is not a transfer", () => {
    expect(check(withIntent({ intent: "add_public_key", public_key: "p256:abc" }))).not.toBeNull();
    expect(check(withIntent({ intent: "ft_withdraw", token: "btc.omft.near", receiver_id: DEPOSIT, amount: "1" }))).not.toBeNull();
  });

  it("refuses two tokens", () => {
    expect(check(transfer({ tokens: { [BTC]: "1", "nep141:eth.omft.near": "1" } }))).not.toBeNull();
  });

  it("refuses an extra key on the transfer", () => {
    expect(check(transfer({ msg: "swap everything" }))).not.toBeNull();
    expect(check(transfer({ min_gas: "1" }))).not.toBeNull();
  });

  it("refuses an expired or unreadable deadline", () => {
    expect(check(fixture({ deadline: "2026-11-11T00:00:00.000Z" }))).not.toBeNull();
    expect(check(fixture({ deadline: "soon" }))).not.toBeNull();
    expect(check(fixture({ deadline: undefined }))).not.toBeNull();
  });

  it("refuses text that is not JSON", () => {
    expect(check("not json")).not.toBeNull();
    expect(check("null")).not.toBeNull();
    expect(check("[]")).not.toBeNull();
  });
});
