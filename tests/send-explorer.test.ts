import { describe, expect, it } from "vitest";
import { sendAddresses, sendPage } from "../lib/send/explorer";

describe("send explorer links", () => {
  it("opens the NEAR Intents explorer's page for the deposit address", () => {
    const address = "fab85aa0462b53e9e3687d4ab31b84192ba90ea76b64026a82370d70aee0604e";
    expect(sendPage(address)).toBe(`https://explorer.near-intents.org/transactions/${address}`);
    expect(sendPage("0x04FeAfcA03133AfE63ed52d839764751e001e1c1")).toBe("https://explorer.near-intents.org/transactions/0x04FeAfcA03133AfE63ed52d839764751e001e1c1");
  });

  it("links every part of a send split across networks", () => {
    expect(sendAddresses({ id: "a" })).toEqual(["a"]);
    expect(sendAddresses({ id: "a", legs: [] })).toEqual(["a"]);
    expect(sendAddresses({ id: "a", legs: ["a", "b"] })).toEqual(["a", "b"]);
  });
});
