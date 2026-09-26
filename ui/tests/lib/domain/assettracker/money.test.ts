import { describe, expect, it } from "vitest";
import {
  AssetTrackerDataSchema,
  MoneySchema,
  money,
} from "@/lib/domain/assettracker";

describe("Money", () => {
  it("keeps amount and currency together", () => {
    expect(money(125.5, "USD")).toEqual({ amount: 125.5, currency: "USD" });
    expect(() => MoneySchema.parse({ amount: 10, currency: "EUR" })).toThrow();
  });

  it("normalizes legacy income and recurring flows at the persistence boundary", () => {
    const data = AssetTrackerDataSchema.parse({
      accounts: [
        {
          id: "usd-cash",
          name: "USD cash",
          provider: "Bank",
          currency: "USD",
          assetType: "cash",
          expectedAnnualReturn: 0,
          createdAt: "2025-01-01",
        },
      ],
      snapshots: [],
      incomeHistory: [{ date: "2025-01-31", amount: 4_000 }],
      recurringFlows: [
        {
          id: "legacy-income",
          name: "Legacy income",
          toAccountId: "usd-cash",
          amount: 1_000,
          frequency: "monthly",
          startDate: "2025-01-01",
        },
      ],
    });

    expect(data.incomeHistory[0]).toEqual({
      date: "2025-01-31",
      amount: 4_000,
      currency: "GBP",
    });
    expect(data.recurringFlows[0]?.currency).toBe("USD");
  });
});
