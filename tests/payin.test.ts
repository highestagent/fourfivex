import { describe, expect, it } from "vitest";
import { PAY_IN } from "../lib/send/payin";

describe("PAY_IN", () => {
  it("has unique ids and asset ids", () => {
    expect(new Set(PAY_IN.map((p) => p.id)).size).toBe(PAY_IN.length);
    expect(new Set(PAY_IN.map((p) => p.assetId)).size).toBe(PAY_IN.length);
  });

  it("is labelled as the sentence reads", () => {
    expect(PAY_IN.map((p) => p.label)).toEqual([
      "dollars on Base",
      "dollars on Ethereum",
      "dollars on Arbitrum",
      "dollars on Solana",
      "ether on Ethereum",
      "ether on Base",
      "sol on Solana",
      "bitcoin",
    ]);
    expect(PAY_IN.map((p) => p.word)).toEqual(["dollars", "dollars", "dollars", "dollars", "ether", "ether", "sol", "bitcoin"]);
  });
});
