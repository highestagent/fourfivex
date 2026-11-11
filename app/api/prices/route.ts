import { connection } from "next/server";
import { getPrices } from "@/lib/oneclick";

/** Live prices for the handful of assets the surface names. */
export async function GET() {
  await connection();
  try {
    return Response.json({ ok: true, prices: await getPrices() });
  } catch {
    return Response.json({ ok: false }, { status: 502 });
  }
}
