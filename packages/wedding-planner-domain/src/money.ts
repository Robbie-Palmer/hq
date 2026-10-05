export function parseMoneyToMinorUnits(
  value: unknown,
  label: string,
): number | null {
  if (value === null || value === undefined || value === "") return null;
  const error = `${label} must be a non-negative amount with no more than two decimal places`;
  if (typeof value === "string") {
    const match = /^(\d*)(?:\.(\d{0,2}))?$/.exec(value.trim());
    if (!match || (!match[1] && !match[2])) throw new Error(error);
    const whole = BigInt(match[1] || "0");
    const fraction = BigInt((match[2] ?? "").padEnd(2, "0") || "0");
    const minorUnits = whole * BigInt(100) + fraction;
    if (minorUnits > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(error);
    return Number(minorUnits);
  }
  if (typeof value !== "number") throw new Error(error);
  const scaled = value * 100;
  const minorUnits = Math.round(scaled);
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    !Number.isSafeInteger(minorUnits) ||
    Math.abs(scaled - minorUnits) >
      Math.min(1e-6, Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4)
  )
    throw new Error(error);
  return minorUnits;
}

export function formatCurrencyAmount(
  amount: number,
  currency: string,
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    ...options,
  }).format(amount);
}

export function formatMinorCurrency(
  minorUnits: number,
  currency = "GBP",
): string {
  return formatCurrencyAmount(minorUnits / 100, currency);
}
