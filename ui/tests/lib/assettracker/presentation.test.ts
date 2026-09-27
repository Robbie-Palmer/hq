import { describe, expect, it } from "vitest";
import {
  computeTotalBalancesByCurrency,
  formatTotalBalances,
} from "@/lib/assettracker";
import type { AccountSummaryView, Currency } from "@/lib/domain/assettracker";

function account(
  id: string,
  currency: Currency,
  latestBalance: number | null,
): AccountSummaryView {
  return {
    id,
    name: id,
    provider: "Test Bank",
    currency,
    assetType: "cash",
    expectedAnnualReturn: 0,
    isOpen: true,
    latestBalance,
    latestSnapshotDate: latestBalance == null ? null : "2026-01-01",
    cagr: null,
  };
}

describe("computeTotalBalancesByCurrency presentation adapter", () => {
  it("sums each currency separately", () => {
    const totals = computeTotalBalancesByCurrency([
      account("gbp-1", "GBP", 1000),
      account("usd-1", "USD", 300),
      account("gbp-2", "GBP", 250),
    ]);

    expect(totals).toEqual([
      { currency: "GBP", total: 1250 },
      { currency: "USD", total: 300 },
    ]);
  });

  it("ignores accounts with no logged balance", () => {
    expect(
      computeTotalBalancesByCurrency([
        account("usd-1", "USD", null),
        account("gbp-1", "GBP", 100),
      ]),
    ).toEqual([{ currency: "GBP", total: 100 }]);
  });

  it("keeps genuine zero balances", () => {
    expect(
      computeTotalBalancesByCurrency([account("usd-1", "USD", 0)]),
    ).toEqual([{ currency: "USD", total: 0 }]);
  });
});

describe("formatTotalBalances", () => {
  it("formats a single-currency portfolio as one amount", () => {
    expect(
      formatTotalBalances([
        account("gbp-1", "GBP", 1000),
        account("gbp-2", "GBP", -250),
      ]),
    ).toBe("£750.00");
  });

  it("joins mixed-currency totals instead of mislabelling their sum", () => {
    expect(
      formatTotalBalances([
        account("gbp-1", "GBP", 1200),
        account("usd-1", "USD", 300),
      ]),
    ).toBe("£1,200.00 + US$300.00");
  });

  it("falls back to zero GBP with no accounts or no logged balances", () => {
    expect(formatTotalBalances([])).toBe("£0.00");
    expect(formatTotalBalances([account("usd-1", "USD", null)])).toBe("£0.00");
  });
});
