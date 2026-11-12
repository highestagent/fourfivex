import { describe, expect, it } from "vitest";
import { exact } from "../lib/format";

describe("exact", () => {
  it("never rounds and trims trailing zeros", () => {
    expect(exact("58539817742532749", 18)).toBe("0.058539817742532749");
    expect(exact("120000000", 6)).toBe("120");
    expect(exact("5", 8)).toBe("0.00000005");
    expect(exact("0", 6)).toBe("0");
    expect(exact("20240000", 6)).toBe("20.24");
    expect(exact("1000000000000000000", 18)).toBe("1");
    expect(exact("12345678901234567890", 6)).toBe("12345678901234.56789");
    expect(exact("7", 0)).toBe("7");
  });
});
