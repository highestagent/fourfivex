import { parseAsk, quote } from "@/lib/oneclick";

/** Prices one sentence. Always a dry run: see lib/oneclick.ts. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, reason: "bad-request" }, { status: 400 });
  }
  const ask = parseAsk(body);
  if (!ask) return Response.json({ ok: false, reason: "bad-request" }, { status: 400 });
  return Response.json(await quote(ask));
}
