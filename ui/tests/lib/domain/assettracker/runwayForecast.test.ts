import { describe, expect, it } from "vitest";
import {
  type AssetTrackerData,
  buildRepository,
  buildRunwayForecast,
} from "@/lib/domain/assettracker";

function forecastData(): AssetTrackerData {
  return {
    accounts: [
      {
        id: "current",
        name: "Current account",
        provider: "Bank",
        currency: "GBP",
        assetType: "cash",
        liquidity: "cash",
        expectedAnnualReturn: 0,
        createdAt: "2025-01-01",
      },
      {
        id: "isa",
        name: "Stocks ISA",
        provider: "Broker",
        currency: "GBP",
        assetType: "stocks",
        liquidity: "liquid",
        expectedAnnualReturn: 0,
        createdAt: "2025-01-01",
      },
      {
        id: "pension",
        name: "Workplace pension",
        provider: "Provider",
        currency: "GBP",
        assetType: "stocks",
        liquidity: "illiquid",
        expectedAnnualReturn: 0,
        createdAt: "2025-01-01",
      },
      {
        id: "debt",
        name: "Loan",
        provider: "Lender",
        currency: "GBP",
        assetType: "debt",
        expectedAnnualReturn: 0,
        createdAt: "2025-01-01",
      },
    ],
    snapshots: [
      { accountId: "current", date: "2026-01-01", balance: 10_000 },
      { accountId: "isa", date: "2026-01-01", balance: 20_000 },
      { accountId: "pension", date: "2026-01-01", balance: 30_000 },
      { accountId: "debt", date: "2026-01-01", balance: -5_000 },
    ],
    capitalFlows: [],
    incomeHistory: [],
    transfers: [],
    recurringFlows: [
      {
        id: "salary",
        name: "Salary",
        toAccountId: "current",
        amount: 3_000,
        currency: "GBP",
        frequency: "monthly",
        startDate: "2025-01-01",
      },
      {
        id: "isa-saving",
        name: "ISA saving",
        fromAccountId: "current",
        toAccountId: "isa",
        amount: 500,
        currency: "GBP",
        frequency: "monthly",
        startDate: "2025-01-01",
      },
      {
        id: "employer-pension",
        name: "Employer pension",
        toAccountId: "pension",
        amount: 300,
        currency: "GBP",
        frequency: "monthly",
        startDate: "2025-01-01",
      },
    ],
    plannedExpenditures: [
      {
        id: "holiday",
        name: "Holiday",
        amount: 6_000,
        date: "2026-01-15",
        fromAccountId: "current",
      },
    ],
    settings: {
      expectedAnnualInflation: 0,
      withdrawalRate: 0.04,
      baseCurrency: "GBP",
      valuationMaxAgeDays: 7,
    },
  };
}

describe("buildRunwayForecast", () => {
  it("projects income, transfers, spending, and a dated purchase by access tier", () => {
    const projection = buildRunwayForecast({
      repository: buildRepository(forecastData()),
      annualExpenditure: 24_000,
      annualCurrentExpenditure: 24_000,
      startDate: "2026-01-01",
      months: 1,
    });

    expect(projection).toHaveLength(2);
    expect(projection[0]).toMatchObject({
      cashBalance: 10_000,
      liquidBalance: 30_000,
      totalBalance: 55_000,
    });
    expect(projection[1]).toMatchObject({
      cashBalance: 4_500,
      liquidBalance: 25_000,
      totalBalance: 50_300,
      baselineCashMonths: 5.25,
      baselineLiquidMonths: 15.5,
      baselineTotalMonths: 28.15,
    });
    expect(projection[1]?.cashMonths).toBe(2.25);
    expect(projection[1]?.liquidMonths).toBe(12.5);
    expect(projection[1]?.totalMonths).toBe(25.15);
  });

  it("returns no forecast until spending can be reconciled", () => {
    expect(
      buildRunwayForecast({
        repository: buildRepository(forecastData()),
        annualExpenditure: null,
        annualCurrentExpenditure: null,
        startDate: "2026-01-01",
      }),
    ).toEqual([]);
  });

  it("can fund a purchase from an ISA without reducing the cash line", () => {
    const data = forecastData();
    const expenditure = data.plannedExpenditures[0];
    if (!expenditure) throw new Error("fixture has no planned expenditure");
    data.plannedExpenditures[0] = {
      ...expenditure,
      fromAccountId: "isa",
    };
    const projection = buildRunwayForecast({
      repository: buildRepository(data),
      annualExpenditure: 24_000,
      annualCurrentExpenditure: 24_000,
      startDate: "2026-01-01",
      months: 1,
    });

    expect(projection[1]).toMatchObject({
      cashBalance: 10_500,
      liquidBalance: 25_000,
      totalBalance: 50_300,
    });
  });

  it("compounds balances at their expected return after inflation", () => {
    const data = forecastData();
    const cash = data.accounts[0];
    if (!cash) throw new Error("fixture has no cash account");
    cash.expectedAnnualReturn = 0.12;
    data.recurringFlows = [];
    data.plannedExpenditures = [];
    const projection = buildRunwayForecast({
      repository: buildRepository(data),
      annualExpenditure: 0,
      annualCurrentExpenditure: 12_000,
      startDate: "2026-01-01",
      months: 1,
    });

    expect(projection[1]?.cashBalance).toBeCloseTo(
      10_000 * 1.12 ** (1 / 12),
      2,
    );
  });
});
