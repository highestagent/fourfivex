import { describe, expect, it } from "vitest";
import { addressProblem, familyOf } from "../lib/send/address";

describe("addressProblem", () => {
  it("checks Ethereum-style addresses", () => {
    expect(addressProblem("evm", "0x8ba1f109551bD432803012645Ac136ddd64DBA72")).toBeNull();
    expect(addressProblem("evm", "0x8ba1f109551bD432803012645Ac136ddd64DBA7")).not.toBeNull();
    expect(addressProblem("evm", "8ba1f109551bD432803012645Ac136ddd64DBA72")).not.toBeNull();
    expect(addressProblem("evm", "0xZZa1f109551bD432803012645Ac136ddd64DBA72")).not.toBeNull();
  });

  it("checks Solana addresses", () => {
    expect(addressProblem("sol", "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T")).toBeNull();
    expect(addressProblem("sol", "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4")).not.toBeNull();
    expect(addressProblem("sol", "0Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T")).not.toBeNull();
    expect(addressProblem("sol", "0x8ba1f109551bD432803012645Ac136ddd64DBA72")).toBe("That doesn't look like a Solana address.");
  });

  it("checks NEAR addresses", () => {
    expect(addressProblem("near", "maya.near")).toBeNull();
    expect(addressProblem("near", "a".repeat(64))).toBeNull();
    expect(addressProblem("near", "Maya.near")).not.toBeNull();
    expect(addressProblem("near", "a")).not.toBeNull();
    expect(addressProblem("near", ".near")).not.toBeNull();
    expect(addressProblem("near", "maya..near")).not.toBeNull();
    expect(addressProblem("near", "a".repeat(65))).not.toBeNull();
  });

  it("checks Bitcoin addresses", () => {
    expect(addressProblem("btc", "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4")).toBeNull();
    expect(addressProblem("btc", "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).toBeNull();
    expect(addressProblem("btc", "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy")).toBeNull();
    expect(addressProblem("btc", "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5")).not.toBeNull();
    expect(addressProblem("btc", "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3")).not.toBeNull();
    expect(addressProblem("btc", "0x8ba1f109551bD432803012645Ac136ddd64DBA72")).not.toBeNull();
  });

  it("refuses blanks and stray spaces", () => {
    expect(addressProblem("evm", "")).not.toBeNull();
    expect(addressProblem("evm", " 0x8ba1f109551bD432803012645Ac136ddd64DBA72")).not.toBeNull();
  });
});

describe("familyOf", () => {
  it("maps blockchain codes", () => {
    expect(familyOf("base")).toBe("evm");
    expect(familyOf("arb")).toBe("evm");
    expect(familyOf("eth")).toBe("evm");
    expect(familyOf("sol")).toBe("sol");
    expect(familyOf("near")).toBe("near");
    expect(familyOf("btc")).toBe("btc");
    expect(familyOf("doge")).toBeNull();
  });
});
