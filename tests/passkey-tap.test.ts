import { p256 } from "@noble/curves/nist.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askPasskey, PasskeyError } from "../lib/account/passkey";
import { afterTap, tapRequests } from "../lib/account/tap";

const notAllowed = () => new DOMException("The request is not allowed by the user agent.", "NotAllowedError");

/** A well-formed reply, so the request can finish once it is let through. */
function reply() {
  const der = new p256.Signature(BigInt(1), BigInt(2)).toBytes("der");
  const bytes = (u8: Uint8Array) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  return {
    rawId: bytes(Uint8Array.of(1, 2, 3)),
    response: {
      authenticatorData: bytes(new Uint8Array(37)),
      clientDataJSON: bytes(new TextEncoder().encode("{}")),
      signature: bytes(der),
      userHandle: null,
    },
  };
}

describe("passkey requests a browser refuses without a tap", () => {
  const get = vi.fn();
  let clock = 0;

  beforeEach(() => {
    clock = 0;
    get.mockReset();
    vi.stubGlobal("window", { PublicKeyCredential: class {}, location: { hostname: "fourfivex.xyz" } });
    vi.stubGlobal("navigator", { credentials: { get } });
    vi.spyOn(performance, "now").mockImplementation(() => clock);
  });
  afterEach(() => {
    tapRequests.current()?.cancel();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("asks for a tap, then makes the same request again from it", async () => {
    get.mockRejectedValueOnce(notAllowed()).mockResolvedValueOnce(reply());
    const asked = askPasskey(new Uint8Array(32), ["AQID"]);
    await vi.waitFor(() => expect(tapRequests.current()).not.toBeNull());
    expect(get).toHaveBeenCalledTimes(1);

    tapRequests.current()!.start();
    // The retry runs inside the tap, before start() returns.
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[1][0]).toEqual(get.mock.calls[0][0]);
    await expect(asked).resolves.toMatchObject({ credentialId: "AQID" });
    expect(tapRequests.current()).toBeNull();
  });

  it("treats a prompt someone closed as cancelled, without asking for a tap", async () => {
    get.mockImplementationOnce(async () => {
      clock = 5_000;
      throw notAllowed();
    });
    await expect(askPasskey(new Uint8Array(32))).rejects.toMatchObject({ code: "cancelled" });
    expect(tapRequests.current()).toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("cancels when the tap prompt is dismissed", async () => {
    get.mockRejectedValueOnce(notAllowed());
    const asked = askPasskey(new Uint8Array(32));
    await vi.waitFor(() => expect(tapRequests.current()).not.toBeNull());
    tapRequests.current()!.cancel();
    const error = await asked.catch((err: unknown) => err);
    expect(error).toBeInstanceOf(PasskeyError);
    expect((error as PasskeyError).code).toBe("cancelled");
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe("afterTap", () => {
  it("keeps one waiting request: a newer one cancels the older", async () => {
    const older = afterTap(async () => "older", () => new Error("replaced"));
    const newer = afterTap(async () => "newer", () => new Error("cancelled"));
    await expect(older).rejects.toThrow("replaced");
    tapRequests.current()!.start();
    await expect(newer).resolves.toBe("newer");
    expect(tapRequests.current()).toBeNull();
  });
});
