import { describe, expect, it } from "vitest";
import { displayName } from "@fourfivex/markets-protocol/protocol";
import { suggestName } from "../lib/markets/names";

/** Always returns the given values in turn, so suggestions are predictable. */
const sequence = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe("suggestName", () => {
  it("pairs a temperament with a market creature", () => {
    expect(suggestName(undefined, sequence(0, 0))).toBe("Patient Bull");
    expect(suggestName(undefined, sequence(0.999, 0.999))).toBe("Easy Panda");
  });

  it("never suggests the name already in the field", () => {
    expect(suggestName("Patient Bull", sequence(0, 0, 0.5, 0.5))).toBe("Early Lynx");
  });

  it("only suggests names a room accepts", () => {
    for (let a = 0; a < 16; a++) for (let b = 0; b < 16; b++) {
      const name = suggestName(undefined, sequence(a / 16, b / 16));
      expect(displayName.safeParse(name).success).toBe(true);
    }
  });
});
