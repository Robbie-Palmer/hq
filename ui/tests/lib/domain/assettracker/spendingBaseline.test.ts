import { describe, expect, it } from "vitest";
import {
  AssetTrackerDataSchema,
  applySaveSpendingBaseline,
  buildRepository,
  compareDecisionScenarios,
  createAssetTrackerBackup,
  getPortfolioFinancialIndependence,
  parseAssetTrackerBackup,
} from "@/lib/domain/assettracker";

const householdOwnership = {
  kind: "personal" as const,
  memberId: "primary",
};

function currentBalanceHousehold() {
  return AssetTrackerDataSchema.parse({
    accounts: [
      {
        id: "current",
        name: "Current account",
        provider: "Bank",
        currency: "GBP",
        assetType: "cash",
        liquidity: "cash",
        expectedAnnualReturn: 0,
        createdAt: "2026-01-01",
      },
    ],
    snapshots: [{ accountId: "current", date: "2026-01-01", balance: 120_000 }],
    spendingBaselines: [
      {
        id: "household-spending-v1",
        seriesId: "household-spending",
        version: 1,
        status: "active",
        effectiveDate: "2026-01-01",
        annualEssentialSpending: 24_000,
        annualDiscretionarySpending: 12_000,
        annualDebtCashFlow: 6_000,
        currency: "GBP",
        ownership: householdOwnership,
        source: { kind: "manual" },
        sourceNotes: "Household budget",
        createdAt: "2026-01-01T12:00:00Z",
      },
    ],
  });
}

describe("explicit spending baselines", () => {
  it("runs runway and decision forecasts from a current balance with no history", () => {
    const repository = buildRepository(currentBalanceHousehold());
    const result = getPortfolioFinancialIndependence(repository, "2026-01-01");

    expect(result.periods).toEqual([]);
    expect(result.spendingBasis).toMatchObject({
      kind: "manual",
      version: 1,
      annualEssentialSpending: 24_000,
      annualDiscretionarySpending: 12_000,
      annualDebtCashFlow: 6_000,
      sourceNotes: "Household budget",
    });
    expect(result.representativeAnnualExpenditure).toBe(36_000);
    expect(result.representativeAnnualCurrentExpenditure).toBe(42_000);
    expect(result.runwayForecast.length).toBeGreaterThan(1);

    const comparison = compareDecisionScenarios(repository, {
      decisionIds: [],
      horizonMonths: 6,
      reserveMonths: null,
      startDate: "2026-01-01",
      annualExpenditure: result.representativeAnnualExpenditure,
      annualCurrentExpenditure: result.representativeAnnualCurrentExpenditure,
      financialIndependenceTarget: result.target,
      emergencyFundAnalysis: null,
    });
    expect(comparison.timeline).toHaveLength(7);
  });

  it("keeps the manual baseline when partial history cannot reconcile", () => {
    const data = currentBalanceHousehold();
    data.incomeHistory = [
      { date: "2026-01-31", amount: 4_000, currency: "GBP" },
    ];
    const result = getPortfolioFinancialIndependence(
      buildRepository(data),
      "2026-02-01",
    );

    expect(result.periods).toEqual([]);
    expect(result.reconciledAnnualExpenditure).toBeNull();
    expect(result.spendingBasis.kind).toBe("manual");
    expect(result.representativeAnnualExpenditure).toBe(36_000);
  });

  it("builds an essential-only stress forecast without discretionary spending", () => {
    const result = getPortfolioFinancialIndependence(
      buildRepository(currentBalanceHousehold()),
      "2026-01-01",
    );

    expect(result.runwayForecast[1]?.monthlyBreakdown.baselineExpenditure).toBe(
      3_000,
    );
    expect(
      result.essentialOnlyRunwayForecast[1]?.monthlyBreakdown
        .baselineExpenditure,
    ).toBe(2_000);
    expect(result.essentialOnlyRunwayForecast[0]?.cashMonths).toBeCloseTo(48);
  });

  it("keeps debt principal, ordinary spending, and transfers separate", () => {
    const data = currentBalanceHousehold();
    data.settings.expectedAnnualInflation = 0;
    data.accounts.push({
      id: "mortgage",
      name: "Mortgage",
      provider: "Lender",
      currency: "GBP",
      assetType: "mortgage",
      expectedAnnualReturn: 0,
      createdAt: "2026-01-01",
    });
    data.snapshots.push({
      accountId: "mortgage",
      date: "2026-01-01",
      balance: -50_000,
    });
    data.recurringFlows.push({
      id: "mortgage-payment",
      name: "Mortgage payment",
      fromAccountId: "current",
      toAccountId: "mortgage",
      amount: 500,
      currency: "GBP",
      frequency: "monthly",
      startDate: "2026-01-01",
    });

    const result = getPortfolioFinancialIndependence(
      buildRepository(data),
      "2026-01-01",
    );
    const month = result.runwayForecast[1];

    expect(month?.monthlyBreakdown).toMatchObject({
      baselineExpenditure: 3_000,
      debtPayments: 500,
      accountTransfers: 0,
      committedCashFlows: 0,
      selectedDecisionCashFlows: 0,
    });
    expect(month?.cashBalance).toBe(116_500);
    expect(month?.totalBalance).toBe(67_000);
  });

  it("versions a later reconciled baseline without rewriting the manual record", () => {
    const original = currentBalanceHousehold();
    const next = applySaveSpendingBaseline(
      original,
      {
        effectiveDate: "2026-03-31",
        annualEssentialSpending: 24_000,
        annualDiscretionarySpending: 15_000,
        annualDebtCashFlow: 3_000,
        currency: "GBP",
        ownership: householdOwnership,
        source: {
          kind: "reconciled",
          periodStartDate: "2026-01-01",
          periodEndDate: "2026-03-31",
        },
        sourceNotes: "Three usable periods",
      },
      "2026-04-01T12:00:00Z",
    );

    expect(next.spendingBaselines).toHaveLength(2);
    expect(next.spendingBaselines?.[0]).toMatchObject({
      id: "household-spending-v1",
      status: "superseded",
      source: { kind: "manual" },
    });
    expect(next.spendingBaselines?.[1]).toMatchObject({
      id: "household-spending-v2",
      version: 2,
      status: "active",
      supersedesId: "household-spending-v1",
      source: { kind: "reconciled" },
    });
    const result = getPortfolioFinancialIndependence(
      buildRepository(next),
      "2026-04-01",
    );
    expect(result.spendingBasis.kind).toBe("reconciled");
    expect(result.representativeAnnualExpenditure).toBe(39_000);
    expect(result.representativeAnnualCurrentExpenditure).toBe(42_000);
  });

  it("round-trips every baseline version through backup and restore", () => {
    const data = applySaveSpendingBaseline(
      currentBalanceHousehold(),
      {
        effectiveDate: "2026-03-31",
        annualEssentialSpending: 24_000,
        annualDiscretionarySpending: 15_000,
        annualDebtCashFlow: 3_000,
        currency: "GBP",
        ownership: householdOwnership,
        source: {
          kind: "reconciled",
          periodStartDate: "2026-01-01",
          periodEndDate: "2026-03-31",
        },
      },
      "2026-04-01T12:00:00Z",
    );

    const restored = parseAssetTrackerBackup(
      JSON.parse(
        JSON.stringify(createAssetTrackerBackup(data, "2026-04-02T12:00:00Z")),
      ),
    );

    expect(restored.data.spendingBaselines).toEqual(data.spendingBaselines);
    expect(restored.summary.storedRecords).toBeGreaterThanOrEqual(4);
  });
});
