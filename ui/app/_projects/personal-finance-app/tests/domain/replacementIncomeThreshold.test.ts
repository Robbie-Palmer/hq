import { describe, expect, it } from "vitest";
import {
  type AssetTrackerData,
  AssetTrackerDataSchema,
  buildRepository,
  compareJobMoveScenario,
  type JobMoveScenario,
  type ReplacementIncomeGoal,
  replacementIncomeGoalSatisfied,
  solveReplacementIncomeThresholds,
} from "@/app/_projects/personal-finance-app/domain";

function data(): AssetTrackerData {
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
        createdAt: "2025-01-01",
      },
    ],
    snapshots: [{ accountId: "current", date: "2026-01-01", balance: 10_000 }],
    recurringFlows: [
      {
        id: "current-salary",
        name: "Current salary",
        toAccountId: "current",
        amount: 3_000,
        currency: "GBP",
        compensationKind: "takeHomeIncome",
        frequency: "monthly",
        startDate: "2025-01-01",
      },
      {
        id: "side-income",
        name: "Side income",
        toAccountId: "current",
        amount: 100,
        currency: "GBP",
        compensationKind: "sideIncome",
        frequency: "monthly",
        startDate: "2025-01-01",
      },
    ],
    futureCashFlows: [
      {
        id: "redundancy-cash",
        name: "Net redundancy cash",
        kind: "commitment",
        status: "active",
        changeability: "fixed",
        refundable: false,
        labels: ["redundancy"],
        currency: "GBP",
        stages: [
          {
            id: "redundancy-stage",
            direction: "receipt",
            toAccountId: "current",
            dueDate: "2026-02-15",
            amount: 3_000,
            actuals: [],
          },
        ],
      },
    ],
    settings: {
      expectedAnnualInflation: 0,
      withdrawalRate: 0.04,
      baseCurrency: "GBP",
      valuationMaxAgeDays: 7,
    },
  });
}

function scenario(): JobMoveScenario {
  return {
    id: "replacement-role",
    name: "Replacement role",
    employmentStatus: "employed",
    transitionDate: "2026-02-01",
    roleStartDate: "2026-03-01",
    employer: "Example Ltd",
    baseGrossPay: 60_000,
    variableGrossPay: 0,
    payFrequency: "monthly",
    currency: "GBP",
    jurisdiction: "Ireland",
    employeePensionRate: 0,
    employeePensionMethod: "salarySacrifice",
    employerPensionRate: 0,
    annualTakeHomeOverride: 40_000,
    destinationAccountId: "current",
    includedFutureCashFlowIds: ["redundancy-cash"],
    replacedRecurringFlowIds: ["current-salary"],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

const assumption = {
  id: "central",
  name: "Central",
  annualReturn: 0,
  annualInflation: 0,
  annualSpending: 24_000,
  annualFeeRate: 0,
  earlyReturnShock: 0,
  earlyReturnShockYears: 0,
};

function solve(goal: ReplacementIncomeGoal) {
  return solveReplacementIncomeThresholds({
    repository: buildRepository(data()),
    scenario: scenario(),
    startDate: "2026-01-01",
    roleStartDates: ["2026-03-01"],
    assumptionSets: [assumption],
    goal,
    horizonMonths: 12,
    annualCurrentExpenditure: 24_000,
    financialIndependenceTarget: 25_000,
    baselineCompensation: null,
    emergencyFundAnalysis: null,
    maximumAnnualIncome: 100_000,
  })[0];
}

function ordinaryForecast(candidate: number, goal: ReplacementIncomeGoal) {
  const comparison = compareJobMoveScenario({
    repository: buildRepository(data()),
    scenario: {
      ...scenario(),
      annualTakeHomeOverride: candidate,
      annualSpendingOverride: assumption.annualSpending,
    },
    horizonMonths: 12,
    startDate: "2026-01-01",
    annualExpenditure: assumption.annualSpending,
    annualCurrentExpenditure: assumption.annualSpending,
    financialIndependenceTarget: 25_000,
    baselineCompensation: null,
    emergencyFundAnalysis: null,
  });
  return replacementIncomeGoalSatisfied(comparison, goal);
}

describe("replacement-income thresholds", () => {
  const goals: ReplacementIncomeGoal[] = [
    { kind: "avoid-cash-depletion" },
    { kind: "preserve-cash-reserve", amount: 5_000 },
    { kind: "avoid-accessible-capital-exhaustion" },
    { kind: "reach-financial-independence", targetDate: "2027-02-01" },
  ];

  it.each(goals)(
    "reruns the ordinary forecast below, at, and above $kind",
    (goal) => {
      const result = solve(goal);

      expect(result?.status).toBe("solved");
      expect(result?.calculation).toMatchObject({ kind: "manual-override" });
      expect(result?.grossAnnualSalary).toBeNull();
      expect(result?.boundaries.below?.satisfiesGoal).toBe(false);
      expect(result?.boundaries.at?.satisfiesGoal).toBe(true);
      expect(result?.boundaries.above?.satisfiesGoal).toBe(true);

      for (const boundary of [
        result?.boundaries.below,
        result?.boundaries.at,
        result?.boundaries.above,
      ]) {
        expect(boundary).not.toBeNull();
        expect(
          ordinaryForecast(boundary?.candidateAnnualIncome ?? -1, goal),
        ).toBe(boundary?.satisfiesGoal);
      }
    },
  );

  it("compares start dates and named assumption sets with explicit inputs", () => {
    const results = solveReplacementIncomeThresholds({
      repository: buildRepository(data()),
      scenario: scenario(),
      startDate: "2026-01-01",
      roleStartDates: ["2026-03-01", "2026-06-01"],
      assumptionSets: [
        { ...assumption, id: "conservative", name: "Conservative" },
        assumption,
        { ...assumption, id: "optimistic", name: "Optimistic" },
      ],
      goal: { kind: "preserve-cash-reserve", amount: 5_000 },
      horizonMonths: 12,
      annualCurrentExpenditure: 24_000,
      financialIndependenceTarget: 25_000,
      baselineCompensation: null,
      emergencyFundAnalysis: null,
      maximumAnnualIncome: 100_000,
    });

    expect(results).toHaveLength(6);
    expect(results[0]?.assumptions).toMatchObject({
      projectionStartDate: "2026-01-01",
      roleStartDate: "2026-03-01",
      unemploymentGapMonths: 1,
      annualSpending: 24_000,
      otherIncome: ["Side income"],
      horizonMonths: 12,
    });
    expect(results[0]?.assumptions.redundancyReceipts).toEqual([
      {
        name: "Net redundancy cash",
        date: "2026-02-15",
        amount: 3_000,
        currency: "GBP",
      },
    ]);
  });

  it("converts a take-home threshold to gross with versioned tax rules", () => {
    const result = solveReplacementIncomeThresholds({
      repository: buildRepository(data()),
      scenario: {
        ...scenario(),
        jurisdiction: "England",
        annualTakeHomeOverride: undefined,
        employeePensionRate: 0.05,
        employeePensionBasis: "qualifyingEarnings",
        variableGrossPay: 5_000,
      },
      startDate: "2026-01-01",
      roleStartDates: ["2026-03-01"],
      assumptionSets: [assumption],
      goal: { kind: "preserve-cash-reserve", amount: 5_000 },
      horizonMonths: 12,
      annualCurrentExpenditure: 24_000,
      financialIndependenceTarget: null,
      baselineCompensation: null,
      emergencyFundAnalysis: null,
      maximumAnnualIncome: 100_000,
    })[0];

    expect(result).toMatchObject({
      status: "solved",
      calculation: {
        kind: "tax-derived",
        calculationVersion: expect.any(String),
        ruleDatasetVersion: expect.any(String),
        taxYear: expect.any(String),
      },
    });
    expect(result?.grossAnnualSalary).toBeGreaterThan(
      result?.annualTakeHomeIncome ?? Number.POSITIVE_INFINITY,
    );
  });

  it("rejects duplicate prospective job start dates", () => {
    expect(() =>
      solveReplacementIncomeThresholds({
        repository: buildRepository(data()),
        scenario: scenario(),
        startDate: "2026-01-01",
        roleStartDates: ["2026-03-01", "2026-03-01"],
        assumptionSets: [assumption],
        goal: { kind: "avoid-cash-depletion" },
        horizonMonths: 12,
        annualCurrentExpenditure: 24_000,
        financialIndependenceTarget: null,
        baselineCompensation: null,
        emergencyFundAnalysis: null,
      }),
    ).toThrow("Job start dates must be different");
  });

  it("returns an explanation when the tested range cannot meet the goal", () => {
    const result = solveReplacementIncomeThresholds({
      repository: buildRepository(data()),
      scenario: scenario(),
      startDate: "2026-01-01",
      roleStartDates: ["2026-03-01"],
      assumptionSets: [assumption],
      goal: { kind: "preserve-cash-reserve", amount: 1_000_000 },
      horizonMonths: 12,
      annualCurrentExpenditure: 24_000,
      financialIndependenceTarget: null,
      baselineCompensation: null,
      emergencyFundAnalysis: null,
      maximumAnnualIncome: 10_000,
    })[0];

    expect(result).toMatchObject({
      status: "impossible",
      annualTakeHomeIncome: null,
      grossAnnualSalary: null,
    });
    expect(result?.explanation).toContain("not met");
  });
});
