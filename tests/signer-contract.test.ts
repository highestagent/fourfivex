import { afterEach, describe, expect, it } from "vitest";
import { signerContract, signerKeysAccepted } from "../lib/markets/signer";

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

describe("signerKeysAccepted", () => {
  const KEY = "ed25519:GqUNSCReY8m6fj2nkCFMkxwEsMCUCzwBr9HavULF1Xji";
  const OTHER = "ed25519:EyzdcRL5UhcUZR8mdxMnCY6UxSVBJ7ymqZ9v881BbFUg";
  const keys = (...ids: string[]) => ids.map(public_key => ({ public_key }));

  it("accepts a locked signer, with or without an allowed key", () => {
    expect(signerKeysAccepted([], false, undefined)).toBe(true);
    expect(signerKeysAccepted([], false, KEY)).toBe(true);
  });

  it("refuses any key unless it is the allowed one", () => {
    expect(signerKeysAccepted(keys(KEY), false, undefined)).toBe(false);
    expect(signerKeysAccepted(keys(KEY), false, "")).toBe(false);
    expect(signerKeysAccepted(keys(OTHER), false, KEY)).toBe(false);
  });

  it("accepts the allowed key only when it is the signer's only key", () => {
    expect(signerKeysAccepted(keys(KEY), false, KEY)).toBe(true);
    expect(signerKeysAccepted(keys(KEY, OTHER), false, KEY)).toBe(false);
  });

  it("refuses a key list the node cut short", () => {
    expect(signerKeysAccepted([], true, KEY)).toBe(false);
    expect(signerKeysAccepted(keys(KEY), true, KEY)).toBe(false);
  });
});
