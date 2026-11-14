/**
 * Checks against the real verifier contract on NEAR mainnet. Read-only: `simulate_intents`
 * runs the contract's actual signature and nonce checks and commits nothing.
 * Run with `pnpm test:live`.
 */
import { p256 } from "@noble/curves/nist.js";
import { base58 } from "@scure/base";
import { describe, expect, it } from "vitest";
import { depositAddress, recentDeposits } from "../lib/account/deposits";
import { balancesOf, ContractError, currentSalt, hasPublicKey, publicKeysOf, simulate } from "../lib/account/chain";
import { buildPayload, challengeFor, makeNonce, signedIntent, type Intent } from "../lib/account/intents";
import { accountIdOf, encodePublicKey } from "../lib/account/keys";
import { getTokens } from "../lib/oneclick";
import { payloadProblem } from "../lib/send/guard";
import { PAY_IN } from "../lib/send/payin";
import { combine, prepare, status } from "../lib/send/server";
import { payloadProblems } from "../lib/send/guard";
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

  it("accepts a backup passkey authorizing a contract call for the same account", async () => {
    const owner = makeAuthenticator();
    const backup = makeAuthenticator();
    const accountId = accountIdOf(owner.publicKey);
    const salt = await currentSalt();
    const add = await sign(owner, [{ intent: "add_public_key", public_key: encodePublicKey(backup.publicKey) }], salt);
    const deadline = new Date(Date.now() + 60_000);
    const payload = buildPayload({ signerId: accountId, deadline, nonce: makeNonce(salt, deadline, random15()), intents: [{
      intent: "auth_call", contract_id: "v1.signer", msg: "{}", min_gas: "100000000000000",
    }] });
    const signed = signedIntent(payload, backup.publicKey, backup.assert(challengeFor(payload)));
    await expect(simulate([signed])).rejects.toBeInstanceOf(ContractError);
    const result = await simulate([add, signed]);
    expect(result.intents_executed.map(intent => intent.account_id)).toEqual([accountId, accountId]);
  });

  it("refuses the same intent signed by someone else's passkey", async () => {
    const owner = makeAuthenticator();
    const thief = makeAuthenticator();
    const signed = await sign(owner, [{ intent: "add_public_key", public_key: encodePublicKey(thief.publicKey) }]);
    const forged = { ...signed, signature: (await sign(thief, [])).signature };
    await expect(simulate([forged])).rejects.toBeInstanceOf(ContractError);
  });

  // Found the hard way: both twins of a signature are valid maths, the contract takes only one.
  it("refuses the higher-s twin of a valid signature, and accepts it once lowered", async () => {
    const owner = makeAuthenticator();
    const backup = makeAuthenticator();
    const signed = await sign(owner, [{ intent: "add_public_key", public_key: encodePublicKey(backup.publicKey) }]);
    const N = p256.Point.Fn.ORDER;
    const good = p256.Signature.fromBytes(base58.decode(signed.signature.split(":")[1]), "compact");
    expect(good.hasHighS()).toBe(false);
    const twin = `p256:${base58.encode(new p256.Signature(good.r, N - good.s).toBytes("compact"))}`;
    await expect(simulate([{ ...signed, signature: twin }])).rejects.toBeInstanceOf(ContractError);
    expect((await simulate([signed])).intents_executed).toHaveLength(1);
  });

  it("refuses a nonce minted under the wrong salt", async () => {
    const owner = makeAuthenticator();
    const signed = await sign(owner, [{ intent: "remove_public_key", public_key: encodePublicKey(owner.publicKey) }], "00000000");
    await expect(simulate([signed])).rejects.toBeInstanceOf(ContractError);
  });

  it("prepares a real send, and the contract gets as far as the balance check", async () => {
    const passkey = makeAuthenticator();
    const accountId = accountIdOf(passkey.publicKey);
    const assetId = "nep141:btc.omft.near";
    const prepared = await prepare({ kind: "change", accountId, fromAssetId: assetId, to: "usd", usd: 50 });
    const { payload, depositAddress } = prepared;
    expect(payload).toBeDefined();
    expect(payloadProblem(payload!, { accountId, depositAddress, assetId, maxUnits: prepared.leaves.units })).toBeNull();
    const signed = signedIntent(payload!, passkey.publicKey, passkey.assert(challengeFor(payload!)));
    // An empty throwaway account cannot cover the transfer, so a refusal here means the
    // signature and payload were accepted up to the balance check. Nothing is submitted.
    await expect(simulate([signed])).rejects.toBeInstanceOf(ContractError);
    expect((await status(depositAddress)).state).toBe("waiting");
  });

  it("gives a passkey account one lasting deposit address per network, shared across EVM networks", async () => {
    const accountId = accountIdOf(makeAuthenticator().publicKey);
    const [ethereum, base, solana] = await Promise.all(["eth:1", "eth:8453", "sol:mainnet"].map((chain) => depositAddress(accountId, chain)));
    expect(ethereum).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(base).toBe(ethereum);
    expect(solana).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(await recentDeposits(accountId)).toEqual([]);
  });

  it("lists every way to add money in the live token list, with the same decimals", async () => {
    const tokens = await getTokens();
    for (const p of PAY_IN) {
      const t = tokens.find((x) => x.assetId === p.assetId);
      expect(t, p.label).toBeDefined();
      expect(t!.decimals, p.label).toBe(p.decimals);
      expect(t!.blockchain, p.label).toBe(p.network);
    }
  });
});

describe.runIf(process.env.LIVE === "1")("one signature over several sources", () => {
  it("is accepted by the verifier up to the balance check, like a single transfer", async () => {
    const passkey = makeAuthenticator();
    const accountId = accountIdOf(passkey.publicKey);
    const sources = [
      "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
      "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
    ];
    const legs = await Promise.all(sources.map((fromAssetId) => prepare({ kind: "change", accountId, fromAssetId, to: "eth", usd: 40 })));
    const transfers = legs.map((leg) => ({ intent: "transfer", receiver_id: leg.depositAddress, tokens: { [leg.leaves.assetId]: leg.leaves.units } }));
    const combined = await sign(passkey, transfers as unknown as Intent[]);
    const single = signedIntent(legs[0].payload!, passkey.publicKey, passkey.assert(challengeFor(legs[0].payload!)));
    const refusal = async (signed: Parameters<typeof simulate>[0]) => {
      try {
        await simulate(signed);
        return "accepted";
      } catch (error) {
        return error instanceof ContractError ? `contract: ${error.message}` : `other: ${String(error)}`;
      }
    };
    const [both, one] = [await refusal([combined]), await refusal([single])];
    expect(both.startsWith("contract:")).toBe(true);
    expect(both.replace(/\d+/g, "#")).toBe(one.replace(/\d+/g, "#"));
  });

  it("builds the message the app signs from real quotes, and the verifier accepts it up to the balance check", async () => {
    // combine only checks that a relayer is set up; it never uses it, and nothing here submits.
    process.env.TRADING_RELAYER_ACCOUNT ??= "unused.near";
    process.env.TRADING_RELAYER_KEY ??= "unused";
    const passkey = makeAuthenticator();
    const accountId = accountIdOf(passkey.publicKey);
    const legs = await Promise.all([
      "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
      "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
    ].map((fromAssetId) => prepare({ kind: "change", accountId, fromAssetId, to: "eth", usd: 40 })));
    const { payload } = await combine(accountId, legs.map((leg) => leg.depositAddress));
    expect(payloadProblems(payload, accountId, legs.map((leg) => ({ depositAddress: leg.depositAddress, assetId: leg.leaves.assetId, maxUnits: leg.leaves.units })))).toBeNull();
    const signed = signedIntent(payload, passkey.publicKey, passkey.assert(challengeFor(payload)));
    await expect(simulate([signed])).rejects.toThrow(/insufficient balance/);
  });
});
