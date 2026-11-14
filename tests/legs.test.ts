import { describe, expect, it } from "vitest";
import { combinedStatus } from "../lib/send/legs";
import type { SendStatus } from "../lib/send/types";

const s = (state: SendStatus["state"], extra: Partial<SendStatus> = {}): SendStatus => ({ state, links: [], ...extra });

describe("combinedStatus", () => {
  it("is done only when every part arrived, adding up what arrived", () => {
    const r = combinedStatus([s("done", { arrived: { amount: 30, usd: 30 } }), s("done", { arrived: { amount: 20, usd: 20 } })]);
    expect(r).toMatchObject({ state: "done", arrived: { amount: 50, usd: 50 } });
  });

  it("is partial when some parts arrived and the rest came back", () => {
    expect(combinedStatus([s("done"), s("refunded", { refunded: { amount: 20 } })])).toMatchObject({ state: "partial", refunded: { amount: 20 } });
    expect(combinedStatus([s("done"), s("failed")]).state).toBe("partial");
  });

  it("is refunded or failed when nothing arrived", () => {
    expect(combinedStatus([s("refunded"), s("refunded")]).state).toBe("refunded");
    expect(combinedStatus([s("refunded"), s("failed")]).state).toBe("failed");
  });

  it("is as far along as its slowest part until all are finished", () => {
    expect(combinedStatus([s("waiting"), s("waiting")]).state).toBe("waiting");
    expect(combinedStatus([s("done"), s("waiting")]).state).toBe("working");
    expect(combinedStatus([s("seen"), s("waiting")]).state).toBe("working");
    expect(combinedStatus([s("short"), s("done")]).state).toBe("short");
  });

  it("keeps every part's links", () => {
    const r = combinedStatus([s("done", { links: [{ hash: "a", url: "u1" }] }), s("done", { links: [{ hash: "b", url: "u2" }] })]);
    expect(r.links.map((l) => l.hash)).toEqual(["a", "b"]);
  });
});
