import { afterEach, describe, expect, it } from "vitest";
import { signerContract } from "../lib/markets/signer";

const IMPLICIT = "98793cd91a3f870fb126f66285808c7e094afcfc4eda8a970f6648cdf0dbd6de";

function withContract(value: string | undefined) {
  if (value === undefined) delete process.env.TRADING_SIGNER_CONTRACT;
  else process.env.TRADING_SIGNER_CONTRACT = value;
  return signerContract();
}

describe("signerContract", () => {
  afterEach(() => {
    delete process.env.TRADING_SIGNER_CONTRACT;
  });

  it("accepts a plain (implicit) account", () => {
    expect(withContract(IMPLICIT)).toBe(IMPLICIT);
  });

  it("still accepts a named .near account", () => {
    expect(withContract("trading-signer.fourfivex.near")).toBe("trading-signer.fourfivex.near");
  });

  it("refuses anything else", () => {
    expect(withContract(undefined)).toBeUndefined();
    expect(withContract(IMPLICIT.toUpperCase())).toBeUndefined();
    expect(withContract(IMPLICIT.slice(1))).toBeUndefined();
    expect(withContract(`${IMPLICIT}0`)).toBeUndefined();
    expect(withContract("0x8ba1f109551bd432803012645ac136ddd64dba72")).toBeUndefined();
    expect(withContract("signer.testnet")).toBeUndefined();
    expect(withContract("intents.near ")).toBeUndefined();
  });
});
