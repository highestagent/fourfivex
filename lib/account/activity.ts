/**
 * Whether an account has ever been used. Runs on the server.
 *
 * A passkey's first signature on a new device fits two public keys, so two possible accounts. The wrong one
 * comes from a random point nobody has seen before, so it has never held anything, added a passkey or received
 * a deposit. When exactly one of the two has, that is the account, and no second touch is needed.
 */
import { publicKeysOf, tokensOf } from "./chain";
import { hasDeposits } from "./deposits";

export async function accountUsed(accountId: string): Promise<boolean> {
  const checks = await Promise.allSettled([
    tokensOf(accountId).then((tokens) => tokens.length > 0),
    publicKeysOf(accountId).then((keys) => keys.length > 0),
    hasDeposits(accountId, AbortSignal.timeout(8_000)),
  ]);
  // A check that failed proves nothing either way; any one that succeeded and found something is enough.
  return checks.some((check) => check.status === "fulfilled" && check.value);
}
