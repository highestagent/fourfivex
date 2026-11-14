import { isAccountId } from "@/lib/account/keys";
import { isCrossSite } from "@/lib/http/origin";
import { ASSETS, type AssetKey } from "@/lib/assets";
import { findToken } from "@/lib/oneclick";
import { addressProblem, familyOf } from "@/lib/send/address";
import { prepare, SendError, status, submit, transferAssets } from "@/lib/send/server";
import { NETWORKS, type Network, type SendAsk } from "@/lib/send/types";

/**
 * Real sends. `prepare` quotes and returns what to sign, `submit` forwards a signed transfer
 * (after lib/send/server.ts has checked it), `status` follows a send. No key lives here.
 */

const bad = (reason = "That request wasn't valid.") => Response.json({ ok: false, reason }, { status: 400 });

const text = (v: unknown, max = 200): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

/** Validates the fields and returns a SendAsk, or a reason. */
async function askFrom(b: Record<string, unknown>): Promise<SendAsk | string> {
  if (!text(b.accountId) || !isAccountId(b.accountId)) return "That account isn't valid.";
  const accountId = b.accountId;
  if (b.kind === "withdraw") {
    if (!text(b.fromAssetId) || !text(b.assetId) || !text(b.amount, 40) || !text(b.address, 100)) return "Complete the withdrawal details.";
    return { kind: "withdraw", accountId, fromAssetId: b.fromAssetId, assetId: b.assetId, amount: b.amount, address: b.address };
  }
  const usd = b.usd;
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd < 1 || usd > 1_000_000)
    return "Pick an amount between $1 and $1,000,000.";

  if (b.kind === "change") {
    if (!text(b.fromAssetId) || !(await findToken(b.fromAssetId))) return "We don't know that kind of money.";
    if (typeof b.to !== "string" || !(b.to in ASSETS)) return "We can't change into that.";
    return { kind: "change", accountId, fromAssetId: b.fromAssetId, to: b.to as AssetKey, usd };
  }
  if (b.kind === "pay") {
    if (!text(b.fromAssetId) || !(await findToken(b.fromAssetId))) return "We don't know that kind of money.";
    const to = b.to as Record<string, unknown> | null;
    if (!to || typeof to !== "object" || !NETWORKS.includes(to.network as Network)) return "We can't pay on that network yet.";
    const network = to.network as Network;
    if (!text(to.address, 100)) return "Add the address to pay.";
    const reason = addressProblem(familyOf(network)!, to.address);
    if (reason) return reason;
    return { kind: "pay", accountId, fromAssetId: b.fromAssetId, usd, to: { address: to.address, network } };
  }
  if (b.kind === "add") {
    if (!text(b.payAssetId)) return "We don't know that kind of money.";
    const token = await findToken(b.payAssetId);
    if (!token) return "We don't know that kind of money.";
    const family = familyOf(token.blockchain);
    if (!family) return "We can't take money from that network yet.";
    if (!text(b.refundTo, 100)) return "Add the address the money is coming from.";
    const reason = addressProblem(family, b.refundTo);
    if (reason) return reason;
    return { kind: "add", accountId, payAssetId: b.payAssetId, usd, refundTo: b.refundTo };
  }
  return "That request wasn't valid.";
}

export async function POST(request: Request) {
  if (isCrossSite(request)) return Response.json({ ok: false, reason: "That request didn't come from this site." }, { status: 403 });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return bad();
  }
  if (!body || typeof body !== "object") return bad();

  try {
    switch (body.op) {
      case "assets":
        return Response.json({ ok: true, assets: await transferAssets() });
      case "prepare": {
        const ask = await askFrom(body);
        if (typeof ask === "string") return bad(ask);
        return Response.json({ ok: true, prepared: await prepare(ask) });
      }
      case "submit":
        if (!text(body.depositAddress, 200) || !body.signed || typeof body.signed !== "object") return bad();
        return Response.json({ ok: true, ...(await submit(body.depositAddress, body.signed)) });
      case "status":
        if (!text(body.depositAddress, 200)) return bad();
        return Response.json({ ok: true, status: await status(body.depositAddress) });
      default:
        return bad();
    }
  } catch (err) {
    if (err instanceof SendError) return Response.json({ ok: false, reason: err.message });
    return Response.json({ ok: false, reason: "The service could not be reached. Please try again." }, { status: 502 });
  }
}
