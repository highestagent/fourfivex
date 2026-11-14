import { Account, JsonRpcProvider, actions, teraToGas, type KeyPairString } from "near-api-js";
import { VERIFIER, type SignedIntent } from "../account/intents";

/**
 * The account that pays gas to put a passkey-signed message on chain when 1Click can't submit it,
 * such as one signature over several networks. It holds no one's money, and its key can only call
 * `execute_intents` on the verifier. It is the same relayer trading uses.
 */
let relayer: Account | undefined;

export const relayerReady = () => Boolean(process.env.TRADING_RELAYER_ACCOUNT && process.env.TRADING_RELAYER_KEY);

/** Executes the signed messages in one transaction and returns its hash. Throws if the verifier refuses them. */
export async function executeIntents(signed: SignedIntent[]): Promise<string> {
  if (!relayerReady()) throw new Error("The relayer is not configured.");
  relayer ??= new Account(
    process.env.TRADING_RELAYER_ACCOUNT!,
    new JsonRpcProvider({ url: process.env.TRADING_NEAR_RPC_URL ?? "https://rpc.fastnear.com" }),
    process.env.TRADING_RELAYER_KEY as KeyPairString,
  );
  const result = await relayer.signAndSendTransaction({
    receiverId: VERIFIER,
    actions: [actions.functionCall("execute_intents", { signed }, teraToGas(150))],
    waitUntil: "EXECUTED_OPTIMISTIC",
    throwOnFailure: true,
  });
  return result.transaction_outcome.id;
}
