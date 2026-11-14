import { connection } from "next/server";
import { isCrossSite } from "@/lib/http/origin";
import { getPrices } from "@/lib/oneclick";

/** Live prices for the handful of assets the surface names. */
export async function GET(request: Request) {
  await connection();
  if (isCrossSite(request)) return Response.json({ ok: false }, { status: 403 });
  try {
    return Response.json({ ok: true, prices: await getPrices() });
  } catch {
    return Response.json({ ok: false }, { status: 502 });
  }
}
