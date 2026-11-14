import { parseWatchedWallet } from "@/lib/account/portfolio";
import { walletBalances } from "@/lib/account/wallet-balances";
import { isCrossSite } from "@/lib/http/origin";

export async function POST(request: Request) {
  if (isCrossSite(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const wallet = parseWatchedWallet(await request.json().catch(() => null));
  if (!wallet) return Response.json({ error: "Choose a supported network and enter a valid wallet address." }, { status: 400 });
  try {
    return Response.json({ assets: await walletBalances(wallet) });
  } catch {
    return Response.json({ error: "Couldn't read this wallet's balance." }, { status: 502 });
  }
}
