/** Hyperliquid keeps this much USDC of every withdrawal. */
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
  if (!amountFormat.test(value)) problems.amount = "Enter an amount like 25 or 25.50.";
  else if (Number(value) <= WITHDRAWAL_FEE) problems.amount = "Enter more than 1 USDC. Hyperliquid keeps 1 USDC as a fee.";
  else if (limit !== undefined && Number(value) > limit) problems.amount = `You can withdraw up to ${limit.toFixed(2)} USDC.`;
  if (!evmAddress.test(to)) problems.destination = "Enter an Arbitrum address: 0x followed by 40 letters and numbers.";
  else if (to.toLowerCase() === tradingAddress.toLowerCase()) problems.destination = "Use a wallet you control, not your trading address.";
  return { value, to, problems };
}
