import type { AssetType } from "./account";
import type { AccountSummaryView } from "./assetTrackerViews";
import { type Currency, DEFAULT_BASE_CURRENCY } from "./currency";

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  cash: "Cash",
  stocks: "Stocks",
  bonds: "Bonds",
  reits: "REITs",
  crypto: "Crypto",
  property: "Property",
  mortgage: "Mortgage",
  debt: "Debt",
};

export const ASSET_TYPE_COLORS: Record<AssetType, string> = {
  cash: "hsl(220, 70%, 50%)",
  stocks: "hsl(160, 60%, 45%)",
  bonds: "hsl(190, 70%, 45%)",
  reits: "hsl(280, 65%, 55%)",
  crypto: "hsl(30, 80%, 55%)",
  property: "hsl(100, 50%, 45%)",
  mortgage: "hsl(350, 65%, 55%)",
  debt: "hsl(0, 70%, 50%)",
};

export const ACCOUNT_COLORS = [
  "hsl(220, 70%, 50%)",
  "hsl(160, 60%, 45%)",
  "hsl(30, 80%, 55%)",
  "hsl(280, 65%, 55%)",
  "hsl(350, 65%, 55%)",
  "hsl(190, 70%, 45%)",
] as const;

export function formatCurrency(
  value: number,
  currency: Currency = DEFAULT_BASE_CURRENCY,
): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatAccountCurrency(
  amount: number,
  currency: Currency,
): string {
  // Fixed locale keeps the statically generated HTML and client render in sync
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
  }).format(amount);
}

/**
 * Compact axis tick: thousands get a "k" suffix, smaller values render in
 * full so an axis of sub-£1,000 balances isn't a column of "0k".
 */
export function formatAxisTick(value: number): string {
  if (Math.abs(value) >= 1000) return `${Math.round(value / 1000)}k`;
  return String(Math.round(value));
}

export function formatCurrencyAxisTick(
  value: number,
  currency: Currency,
): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatAnnualRate(rate: number): string {
  const percent = rate * 100;
  const sign = percent > 0 ? "+" : "";
  return `${sign}${percent.toFixed(1)}%`;
}

export function computeTotalBalance(accounts: AccountSummaryView[]): number {
  return accounts.reduce((sum, a) => sum + (a.latestBalance ?? 0), 0);
}

export function computeTotalBalancesByCurrency(
  accounts: AccountSummaryView[],
): Array<{ currency: Currency; total: number }> {
  const totals = new Map<Currency, number>();
  for (const account of accounts) {
    // No logged balance is "no data", not a zero — a freshly added account
    // shouldn't put its currency into the totals.
    if (account.latestBalance == null) continue;
    totals.set(
      account.currency,
      (totals.get(account.currency) ?? 0) + account.latestBalance,
    );
  }
  return Array.from(totals, ([currency, total]) => ({ currency, total })).sort(
    (a, b) => a.currency.localeCompare(b.currency, "en"),
  );
}

/**
 * One formatted amount per currency (e.g. "£1,200 + $300"), so accounts held
 * in different currencies are never summed into a single mislabelled number.
 */
export function formatTotalBalances(accounts: AccountSummaryView[]): string {
  const totals = computeTotalBalancesByCurrency(accounts);
  if (totals.length === 0) {
    return formatAccountCurrency(0, DEFAULT_BASE_CURRENCY);
  }
  return totals
    .map(({ currency, total }) => formatAccountCurrency(total, currency))
    .join(" + ");
}
