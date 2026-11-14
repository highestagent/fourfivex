import { accountUsed } from "@/lib/account/activity";
import { ContractError, currentSalt, hasPublicKey, publicKeysOf, simulate } from "@/lib/account/chain";
import { holdingsOf } from "@/lib/account/holdings";
import { isCrossSite } from "@/lib/http/origin";
import { VERIFIER, type SignedIntent } from "@/lib/account/intents";
import { decodePublicKey, isAccountId } from "@/lib/account/keys";
import { publish, statusOf } from "@/lib/account/relay";

/**
 * The browser's window onto the verifier contract.
 *
 * Reads are plain view calls. The one write, `publish`, forwards an intent a passkey has
 * already signed, and for now only if all it does is add or remove a passkey: this route
 * will not relay anything that moves money.
 */

const KEY_INTENTS = new Set(["add_public_key", "remove_public_key"]);

const bad = (reason = "bad-request") => Response.json({ ok: false, reason }, { status: 400 });

function isPublicKey(v: unknown): v is string {
  if (typeof v !== "string") return false;
  try {
    decodePublicKey(v);
    return true;
  } catch {
    return false;
  }
}

/** Accepts only a well-formed passkey-signed envelope that manages keys on its own account. */
function keyIntent(v: unknown): SignedIntent | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  if (s.standard !== "webauthn") return null;
  for (const f of ["payload", "public_key", "signature", "client_data_json", "authenticator_data"])
    if (typeof s[f] !== "string" || (s[f] as string).length > 4000) return null;
  if (!isPublicKey(s.public_key)) return null;
  try {
    const p = JSON.parse(s.payload as string) as Record<string, unknown>;
    if (p.verifying_contract !== VERIFIER || typeof p.signer_id !== "string" || !isAccountId(p.signer_id)) return null;
    if (!Array.isArray(p.intents) || p.intents.length !== 1) return null;
    const intent = p.intents[0] as Record<string, unknown>;
    if (typeof intent.intent !== "string" || !KEY_INTENTS.has(intent.intent) || !isPublicKey(intent.public_key)) return null;
  } catch {
    return null;
  }
  return s as unknown as SignedIntent;
}

export async function POST(request: Request) {
  if (isCrossSite(request)) return Response.json({ ok: false, reason: "That request didn't come from this site." }, { status: 403 });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return bad();
  }

  try {
    switch (body.op) {
      case "salt":
        return Response.json({ ok: true, salt: await currentSalt() });

      case "has-key":
        if (typeof body.accountId !== "string" || !isAccountId(body.accountId) || !isPublicKey(body.publicKey)) return bad();
        return Response.json({ ok: true, has: await hasPublicKey(body.accountId, body.publicKey) });

      case "keys":
        if (typeof body.accountId !== "string" || !isAccountId(body.accountId)) return bad();
        return Response.json({ ok: true, keys: await publicKeysOf(body.accountId) });

      case "used": {
        const ids = body.accountIds;
        if (!Array.isArray(ids) || ids.length < 1 || ids.length > 4 || !ids.every((id) => typeof id === "string" && isAccountId(id))) return bad();
        return Response.json({ ok: true, used: await Promise.all(ids.map(accountUsed)) });
      }

      case "holdings":
        if (typeof body.accountId !== "string" || !isAccountId(body.accountId)) return bad();
        return Response.json({ ok: true, holdings: await holdingsOf(body.accountId) });

      case "publish": {
        const signed = keyIntent(body.signed);
        if (!signed) return bad("Only adding or removing a passkey can be sent in this build.");
        // Run the contract's own checks first, so a doomed intent is never sent.
        await simulate([signed]);
        return Response.json(await publish(signed));
      }

      case "status":
        if (typeof body.intentHash !== "string" || body.intentHash.length > 80) return bad();
        return Response.json({ ok: true, ...(await statusOf(body.intentHash)) });

      default:
        return bad();
    }
  } catch (err) {
    if (err instanceof ContractError) return Response.json({ ok: false, reason: `The network refused it: ${err.message}` });
    return Response.json({ ok: false, reason: "The network could not be reached. Please try again." }, { status: 502 });
  }
}
