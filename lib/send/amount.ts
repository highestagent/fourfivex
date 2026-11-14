export function withdrawalUnits(amount: string, decimals: number) {
  if (!/^\d{1,12}(\.\d{1,24})?$/.test(amount)) return;
  const [whole, fraction = ""] = amount.split(".");
  if (fraction.length > decimals) return;
  const units = BigInt(whole + fraction.padEnd(decimals, "0"));
  if (units > BigInt(0)) return units.toString();
}

export function displayUnits(units: string, decimals: number) {
  if (decimals === 0) return units;
  const padded = units.padStart(decimals + 1, "0");
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return padded.slice(0, -decimals) + (fraction ? `.${fraction}` : "");
}
