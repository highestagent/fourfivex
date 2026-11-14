/** Each withdrawal from trading costs this many dollars, kept by Hyperliquid. */
export const WITHDRAWAL_FEE = 1;

const amountFormat = /^\d{1,7}(\.\d{1,2})?$/;
const evmAddress = /^0x[\da-f]{40}$/i;

/** The most USDC that can be withdrawn, rounded down to cents, or undefined while the balance is unknown. */
export function withdrawalLimit(withdrawable: string | undefined) {
  return withdrawable === undefined ? undefined : Math.floor(Number(withdrawable) * 100) / 100;
}

/** Checks a withdrawal form before asking the server for a review. Amounts may use a comma as the decimal mark. */
export function withdrawalProblems(amount: string, destination: string, limit: number | undefined, tradingAddress: string) {
  const value = amount.trim().replace(",", ".");
  const to = destination.trim();
  const problems: { amount?: string; destination?: string } = {};
  if (!amountFormat.test(value)) problems.amount = "Enter a valid amount.";
  else if (Number(value) <= WITHDRAWAL_FEE) problems.amount = "Enter more than $1.";
  else if (limit !== undefined && Number(value) > limit) problems.amount = `You can withdraw up to $${limit.toFixed(2)}.`;
  if (!evmAddress.test(to)) problems.destination = "Enter a valid Arbitrum address.";
  else if (to.toLowerCase() === tradingAddress.toLowerCase()) problems.destination = "That's your trading address.";
  return { value, to, problems };
}
