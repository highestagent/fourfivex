/**
 * Checks against the real verifier contract on NEAR mainnet. Read-only: `simulate_intents`
 * runs the contract's actual signature and nonce checks and commits nothing.
 * Run with `pnpm test:live`.
 */
import { describe, expect, it } from "vitest";
import { balancesOf, ContractError, currentSalt, hasPublicKey, publicKeysOf, simulate } from "../lib/account/chain";
import { buildPayload, challengeFor, makeNonce, signedIntent, type Intent } from "../lib/account/intents";
import { accountIdOf, encodePublicKey } from "../lib/account/keys";
import { makeAuthenticator } from "./virtual-authenticator";

const random15 = () => crypto.getRandomValues(new Uint8Array(15));

async function sign(owner: ReturnType<typeof makeAuthenticator>, intents: Intent[], salt?: string) {
  const deadline = new Date(Date.now() + 5 * 60_000);
  const payload = buildPayload({
    signerId: accountIdOf(owner.publicKey),
    deadline,
    nonce: makeNonce(salt ?? (await currentSalt()), deadline, random15()),
    intents,
  });
  return signedIntent(payload, owner.publicKey, owner.assert(challengeFor(payload)));
}

describe.runIf(process.env.LIVE === "1")("the live verifier contract", () => {
  it("treats a brand-new passkey as an account that already exists", async () => {
    const passkey = makeAuthenticator();
    const stranger = makeAuthenticator();
    const account = accountIdOf(passkey.publicKey);
    expect(await hasPublicKey(account, encodePublicKey(passkey.publicKey))).toBe(true);
    expect(await hasPublicKey(account, encodePublicKey(stranger.publicKey))).toBe(false);
    expect(await publicKeysOf(account)).toEqual([]);
    expect(await balancesOf(account, ["nep141:btc.omft.near"])).toEqual(["0"]);
  });

  it("accepts a passkey-signed intent that adds a backup passkey", async () => {
    const owner = makeAuthenticator();
    const backup = makeAuthenticator();
    const signed = await sign(owner, [{ intent: "add_public_key", public_key: encodePublicKey(backup.publicKey) }]);
    const result = await simulate([signed]);
    expect(result.intents_executed).toHaveLength(1);
    expect(result.intents_executed[0].account_id).toBe(accountIdOf(owner.publicKey));
    expect(result.logs.join("\n")).toContain("public_key_added");
  });

  it("refuses the same intent signed by someone else's passkey", async () => {
    const owner = makeAuthenticator();
    const thief = makeAuthenticator();
    const signed = await sign(owner, [{ intent: "add_public_key", public_key: encodePublicKey(thief.publicKey) }]);
    const forged = { ...signed, signature: (await sign(thief, [])).signature };
    await expect(simulate([forged])).rejects.toBeInstanceOf(ContractError);
  });

  it("refuses a nonce minted under the wrong salt", async () => {
    const owner = makeAuthenticator();
    const signed = await sign(owner, [{ intent: "remove_public_key", public_key: encodePublicKey(owner.publicKey) }], "00000000");
    await expect(simulate([signed])).rejects.toBeInstanceOf(ContractError);
  });
});
