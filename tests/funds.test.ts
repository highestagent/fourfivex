import { describe, expect, it } from "vitest";
import { withdrawalLimit, withdrawalProblems } from "../lib/markets/funds";

const TRADING = "0xb24fe87ea8497c78c044c0ce7076028b562e7195";
const WALLET = "0x8ba1f109551bD432803012645Ac136ddd64DBA72";

describe("withdrawalLimit", () => {
  it("rounds the withdrawable balance down to cents", () => {
    expect(withdrawalLimit("12.349")).toBe(12.34);
    expect(withdrawalLimit("0")).toBe(0);
    expect(withdrawalLimit(undefined)).toBeUndefined();
  });
});

describe("withdrawalProblems", () => {
  it("accepts a valid withdrawal and normalizes a comma decimal", () => {
    expect(withdrawalProblems(" 25,5 ", ` ${WALLET} `, 100, TRADING)).toEqual({ value: "25.5", to: WALLET, problems: {} });
  });

  it("asks for a well-formed amount above the fee and within the balance", () => {
    expect(withdrawalProblems("", WALLET, 100, TRADING).problems.amount).toBe("Enter a valid amount.");
    expect(withdrawalProblems("2.555", WALLET, 100, TRADING).problems.amount).toBe("Enter a valid amount.");
    expect(withdrawalProblems("1", WALLET, 100, TRADING).problems.amount).toMatch(/more than \$1/);
    expect(withdrawalProblems("100.01", WALLET, 100, TRADING).problems.amount).toBe("You can withdraw up to $100.00.");
    expect(withdrawalProblems("100", WALLET, 100, TRADING).problems.amount).toBeUndefined();
    expect(withdrawalProblems("5000", WALLET, undefined, TRADING).problems.amount).toBeUndefined();
  });

  it("asks for an Arbitrum address that isn't the trading address", () => {
    expect(withdrawalProblems("5", "", 100, TRADING).problems.destination).toBe("Enter a valid Arbitrum address.");
    expect(withdrawalProblems("5", WALLET.slice(0, -1), 100, TRADING).problems.destination).toBe("Enter a valid Arbitrum address.");
    expect(withdrawalProblems("5", TRADING.toUpperCase().replace("0X", "0x"), 100, TRADING).problems.destination).toBe("That's your trading address.");
  });
});
