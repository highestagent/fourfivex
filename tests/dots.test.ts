import { describe, expect, it } from "vitest";
import { dotUnit } from "../lib/format";

describe("dotUnit", () => {
  it("never needs more than 60 dots", () => {
    for (const a of [1, 60, 61, 500, 5000, 250000, 1_000_000, 9_999_999]) {
      expect(Math.ceil(a / dotUnit(a))).toBeLessThanOrEqual(60);
    }
  });
  it("uses the smallest round unit", () => {
    expect(dotUnit(60)).toBe(1);
    expect(dotUnit(61)).toBe(2);
    expect(dotUnit(500)).toBe(10);
    expect(dotUnit(5000)).toBe(100);
  });
  it("is safe for zero and not-a-number", () => {
    expect(dotUnit(0)).toBe(1);
    expect(dotUnit(NaN)).toBe(1);
    expect(dotUnit(Infinity)).toBe(1);
  });
});
