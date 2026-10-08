import { describe, expect, it } from "vitest";
import {
  type AssetTrackerData,
  analyseEmergencyFund,
  buildRepository,
  compareDecisionScenarios,
  defaultEmergencyFundAccountPolicy,
  defaultHouseholdFields,
} from "@/lib/domain/assettracker";

function scenarioData(): AssetTrackerData {
  return {
    ...defaultHouseholdFields(),
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
        expectedAnnualReturn: 0.04,
        createdAt: "2025-01-01",
      },
    ],
    snapshots: [
      { accountId: "current", date: "2026-01-01", balance: 5_000 },
      { accountId: "isa", date: "2026-01-01", balance: 10_000 },
    ],
    capitalFlows: [],
    incomeHistory: [],
    salaryHistory: [],
    transfers: [],
    recurringFlows: [
      {
        id: "salary",
        name: "Salary",
        toAccountId: "current",
        amount: 1_000,
        currency: "GBP",
        frequency: "monthly",
        startDate: "2025-01-01",
      },
    ],
    plannedExpenditures: [],
    planningCases: [
      { id: "home", name: "Home work", labels: [] },
      { id: "travel", name: "Travel", labels: [] },
    ],
    futureCashFlows: [
      {
        id: "survey",
        name: "Survey",
        planningCaseId: "home",
        kind: "commitment",
        status: "active",
        changeability: "fixed",
        refundable: false,
        labels: [],
        currency: "GBP",
        stages: [
          {
            id: "survey-payment",
            fromAccountId: "current",
            dueDate: "2026-01-15",
            amount: 1_000,
            actuals: [],
          },
        ],
      },
      {
        id: "foundations",
        name: "Foundations",
        planningCaseId: "home",
        kind: "decision",
        status: "considering",
        importance: "Required before the extension",
        confidence: 0.8,
        reversibility: "irreversible",
        dependencyIds: ["survey"],
        alternativeToIds: [],
        labels: [],
        currency: "GBP",
        stages: [
          {
            id: "foundation-payment",
            fromAccountId: "current",
            earliestDate: "2026-02-15",
            expectedDate: "2026-03-15",
            latestDate: "2026-04-15",
            minimumAmount: 1_000,
            expectedAmount: 2_000,
            maximumAmount: 3_000,
            actuals: [],
          },
        ],
      },
      {
        id: "extension",
        name: "Extension",
        planningCaseId: "home",
        kind: "decision",
        status: "selected",
        importance: "More living space",
        confidence: 0.6,
        reversibility: "irreversible",
        dependencyIds: ["foundations"],
        alternativeToIds: ["loft"],
        labels: [],
        currency: "GBP",
        stages: [
          {
            id: "extension-payment",
            fromAccountId: "current",
            earliestDate: "2026-05-15",
            expectedDate: "2026-06-15",
            latestDate: "2026-07-15",
            minimumAmount: 4_000,
            expectedAmount: 6_000,
            maximumAmount: 8_000,
            actuals: [],
          },
        ],
      },
      {
        id: "loft",
        name: "Loft conversion",
        planningCaseId: "travel",
        kind: "decision",
        status: "considering",
        importance: "Preserve the garden",
        confidence: 0.5,
        reversibility: "partly-reversible",
        dependencyIds: [],
        alternativeToIds: ["extension"],
        labels: [],
        currency: "GBP",
        stages: [
          {
            id: "loft-payment",
            name: "Build and fit-out",
            fromAccountId: "isa",
            expectedDate: "2026-05-20",
            minimumAmount: 2_000,
            expectedAmount: 3_000,
            maximumAmount: 4_000,
            actuals: [],
          },
        ],
      },
    ],
    forecastAssumptionSets: [],
    emergencyFundPlans: [],
    settings: {
      expectedAnnualInflation: 0,
      withdrawalRate: 0.04,
      baseCurrency: "GBP",
      valuationMaxAgeDays: 7,
    },
  };
}

function comparison(decisionIds: string[], horizonMonths = 12) {
  const repository = buildRepository(scenarioData());
  const policies = Array.from(repository.accounts.values()).map((account) => ({
    ...defaultEmergencyFundAccountPolicy(account),
    included: account.id === "current",
  }));
  const emergencyFundAnalysis = analyseEmergencyFund(
    repository,
    {
      name: "Emergency cash",
      essentialMonthlyExpenditure: 1_000,
      annualIrregularEssentialCosts: 0,
      monthlyDebtPayments: 0,
      employmentMonthlyIncome: 1_000,
      monthlySideIncome: 0,
      accessNeedDays: 7,
      missingData: [],
      coverageMonths: [3, 6],
      accountPolicies: policies,
      stressScenarios: [
        {
          id: "loss",
          name: "Income loss",
          durationMonths: 6,
          employmentIncomeLossRate: 1,
          sideIncomeDelayMonths: 0,
          unexpectedCost: 0,
          annualInflationRate: 0,
        },
      ],
    },
    "2026-01-01",
  );
  return compareDecisionScenarios(repository, {
    decisionIds,
    horizonMonths,
    reserveMonths: 3,
    startDate: "2026-01-01",
    annualExpenditure: 12_000,
    annualCurrentExpenditure: 12_000,
    financialIndependenceTarget: 20_000,
    emergencyFundAnalysis,
  });
}

describe("decision scenario comparison", () => {
  it("uses active commitments as the baseline and expands decision dependencies", () => {
    const result = comparison(["extension"]);
    const horizon = result.timeline.at(-1);
    const afterExtension = result.timeline.find(
      ({ date }) => date === "2026-07-01",
    );

    expect(result.includedDecisionIds).toEqual(["foundations", "extension"]);
    expect(result.includedDependencyIds).toEqual(["foundations"]);
    expect(horizon?.cumulativeEffect.cash).toBe(-4_000);
    expect(horizon?.cumulativeEffect.liquid).toBeCloseTo(-8_046.05, 1);
    expect(horizon?.cumulativeEffect.total).toBeCloseTo(-8_046.05, 1);
    expect(horizon?.cumulativeEffect.cashMonths).toBe(-4);
    expect(horizon?.cumulativeEffect.liquidMonths).toBeCloseTo(-8.05, 1);
    expect(horizon?.marginalEffect.totalMonths).toBeCloseTo(0, 1);
    expect(horizon?.baseline.totalBalance).toBeCloseTo(14_400, 1);
    expect(afterExtension?.expected.accountShortfalls).toEqual([
      {
        accountId: "current",
        accountName: "Current account",
        amount: 4_000,
      },
    ]);
    expect(afterExtension?.expected.reserveCoverageMonths).toBe(0);
    expect(result.actions).toContainEqual(
      expect.objectContaining({
        kind: "saving",
        name: "Save toward Extension",
        amount: 800,
        cadence: "monthly",
        countsAsExpenditure: false,
      }),
    );
  });

  it("keeps alternative and uncertainty paths visible without ranking them", () => {
    const result = comparison(["extension", "loft"]);
    const horizon = result.timeline.at(-1);

    expect(result.warnings).toContain(
      "Extension is marked as an alternative to Loft conversion.",
    );
    expect(horizon?.lowCost.totalBalance).toBeGreaterThan(
      horizon?.expected.totalBalance ?? 0,
    );
    expect(horizon?.expected.totalBalance).toBeGreaterThan(
      horizon?.highCost.totalBalance ?? 0,
    );
    expect(result.judgments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Extension",
          importance: "More living space",
          confidence: 0.6,
          reversibility: "irreversible",
        }),
        expect.objectContaining({ name: "Loft conversion" }),
      ]),
    );
  });

  it("returns material-date effects and implied actions without treating asset sales as expenditure", () => {
    const result = comparison(["loft"], 6);

    expect(result.materialDates).toEqual([
      "2026-02-01",
      "2026-06-01",
      "2026-07-01",
    ]);
    expect(
      result.timeline.filter(({ isMaterialDate }) => isMaterialDate),
    ).toHaveLength(3);
    expect(result.actions).toEqual([
      expect.objectContaining({
        kind: "asset-sale",
        name: "Loft conversion: Build and fit-out",
        countsAsExpenditure: false,
      }),
    ]);
    expect(result.fundingMechanics).toEqual([
      expect.objectContaining({
        accountName: "Stocks ISA",
        fundingMethod: "asset-sale",
        liquidity: "liquid",
        annualReturn: 0.04,
        convertsToBaseCurrency: false,
      }),
    ]);
  });

  it("returns no timeline when reconciled spending is unavailable", () => {
    const repository = buildRepository(scenarioData());
    const result = compareDecisionScenarios(repository, {
      decisionIds: ["extension"],
      horizonMonths: 12,
      reserveMonths: null,
      startDate: "2026-01-01",
      annualExpenditure: null,
      annualCurrentExpenditure: null,
      financialIndependenceTarget: null,
      emergencyFundAnalysis: null,
    });

    expect(result.timeline).toEqual([]);
    expect(result.goalDates.expected).toBeNull();
  });
});
