import { describe, expect, it } from "vitest";
import { isCrossSite } from "../lib/http/origin";

const SITE = "https://fourfivex.xyz";

function post(headers: Record<string, string>) {
  return new Request(`${SITE}/api/send`, { method: "POST", headers });
}

describe("isCrossSite", () => {
  it("lets this site's own pages post", () => {
    expect(isCrossSite(post({ origin: SITE, "sec-fetch-site": "same-origin" }))).toBe(false);
  });

  it("refuses a post from another site", () => {
    expect(isCrossSite(post({ origin: "https://evil.example", "sec-fetch-site": "cross-site" }))).toBe(true);
  });

  it("refuses a post that names another origin, whatever Sec-Fetch-Site says", () => {
    expect(isCrossSite(post({ origin: "https://evil.example" }))).toBe(true);
    expect(isCrossSite(post({ origin: "https://fourfivex.vercel.app", "sec-fetch-site": "same-site" }))).toBe(true);
  });

  it("refuses a post with no Origin at all", () => {
    expect(isCrossSite(post({}))).toBe(true);
  });

  it("lets a same-origin GET through without an Origin header", () => {
    expect(isCrossSite(new Request(`${SITE}/api/prices`, { headers: { "sec-fetch-site": "same-origin" } }))).toBe(false);
  });

  it("refuses a GET fetched from another site", () => {
    expect(isCrossSite(new Request(`${SITE}/api/prices`, { headers: { "sec-fetch-site": "cross-site" } }))).toBe(true);
  });
});
