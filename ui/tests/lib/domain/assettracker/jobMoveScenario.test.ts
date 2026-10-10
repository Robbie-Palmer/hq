import { describe, expect, it } from "vitest";
import {
  type AssetTrackerData,
  AssetTrackerDataSchema,
  applyDeleteJobMoveScenario,
  applyDuplicateJobMoveScenario,
  applySaveJobMoveScenario,
  buildRepository,
  calculateJobMoveCompensation,
  compareJobMoveScenario,
  type EmergencyFundAnalysis,
  type JobMoveScenario,
} from "@/lib/domain/assettracker";

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
      {
        id: "pension",
        name: "Workplace pension",
        provider: "Pension provider",
        currency: "GBP",
        assetType: "stocks",
        liquidity: "illiquid",
        expectedAnnualReturn: 0,
        createdAt: "2025-01-01",
      },
    ],
    snapshots: [
      { accountId: "current", date: "2026-01-01", balance: 12_000 },
      { accountId: "pension", date: "2026-01-01", balance: 20_000 },
    ],
    recurringFlows: [
      {
        id: "current-salary",
        name: "Current salary",
        toAccountId: "current",
        amount: 3_000,
        grossAmount: 4_000,
        currency: "GBP",
        compensationKind: "takeHomeIncome",
        frequency: "monthly",
        startDate: "2025-01-01",
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

function employedScenario(): JobMoveScenario {
  return {
    id: "new-role",
    name: "New role",
    employmentStatus: "employed",
    transitionDate: "2026-02-01",
    roleStartDate: "2026-03-01",
    employer: "Example Ltd",
    baseGrossPay: 72_000,
    variableGrossPay: 6_000,
    payFrequency: "monthly",
    currency: "GBP",
    jurisdiction: "Ireland",
    employeePensionRate: 0.08,
    employeePensionMethod: "salarySacrifice",
    employerPensionRate: 0.1,
    annualTakeHomeOverride: 48_000,
    destinationAccountId: "current",
    pensionAccountId: "pension",
    replacedRecurringFlowIds: ["current-salary"],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function comparison(
  scenario: JobMoveScenario,
  emergencyFundAnalysis: EmergencyFundAnalysis | null = null,
) {
  return compareJobMoveScenario({
    repository: buildRepository(data()),
    scenario,
    horizonMonths: 12,
    startDate: "2026-01-01",
    annualExpenditure: 12_000,
    annualCurrentExpenditure: 12_000,
    financialIndependenceTarget: 60_000,
    emergencyFundAnalysis,
    baselineCompensation: {
      annualTakeHomeIncome: 36_000,
      annualEmployeePensionContribution: 0,
      annualEmployerPensionContribution: 0,
    },
  });
}

describe("job-move scenarios", () => {
  it("uses an explicit take-home fallback and keeps its reason", () => {
    const result = calculateJobMoveCompensation(employedScenario());

    expect(result.annualTakeHomePay).toBe(48_000);
    expect(result.annualEmployeePensionContribution).toBe(6_240);
    expect(result.annualEmployerPensionContribution).toBe(7_800);
    expect(result.calculation).toEqual({
      kind: "manual-override",
      reasons: [
        "The jurisdiction is not covered by the reviewed UK salary rules.",
      ],
    });
  });

  it("uses the shared reviewed tax rules when they cover the offer", () => {
    const result = calculateJobMoveCompensation({
      ...employedScenario(),
      roleStartDate: "2026-10-01",
      jurisdiction: "England",
      annualTakeHomeOverride: undefined,
    });

    expect(result.calculation).toMatchObject({
      kind: "tax-derived",
      taxYear: "2026-27",
    });
    expect(result.annualTakeHomePay).toBeGreaterThan(0);
    expect(result.annualTakeHomePay).toBeLessThan(78_000);
  });

  it("compares a role with an employment gap against unchanged baseline flows", () => {
    const result = comparison(employedScenario());
    const horizon = result.timeline.at(-1);

    expect(horizon?.scenario.totalBalance).toBeGreaterThan(
      horizon?.baseline.totalBalance ?? Number.POSITIVE_INFINITY,
    );
    expect(result.compensation).toMatchObject({
      baselineAnnualTakeHomePay: 36_000,
      scenarioAnnualTakeHomePay: 48_000,
      scenarioAnnualEmployeePensionContribution: 6_240,
      scenarioAnnualEmployerPensionContribution: 7_800,
    });
  });

  it("starts the selected horizon when current income stops", () => {
    const scenario = {
      ...employedScenario(),
      transitionDate: "2027-01-01",
      roleStartDate: "2027-01-01",
    };
    const result = comparison(scenario);

    expect(result.timeline[0]?.date).toBe("2027-01-01");
    expect(result.timeline.at(-1)?.date).toBe("2028-01-01");
    expect(result.timeline).toHaveLength(13);
    expect(result.milestones.slice(0, 2)).toMatchObject([
      { date: "2027-01-01", kind: "income-stops" },
      { date: "2027-01-01", kind: "new-role-starts" },
    ]);
  });

  it("models unemployment by ending selected current-role flows", () => {
    const unemployed: JobMoveScenario = {
      ...employedScenario(),
      id: "unemployed",
      name: "Leave work",
      employmentStatus: "unemployed",
      roleStartDate: undefined,
      employer: undefined,
      baseGrossPay: 0,
      variableGrossPay: 0,
      employeePensionRate: 0,
      employerPensionRate: 0,
      annualTakeHomeOverride: undefined,
      destinationAccountId: undefined,
      pensionAccountId: undefined,
    };
    const result = comparison(unemployed);
    const horizon = result.timeline.at(-1);

    expect(result.calculation).toEqual({ kind: "not-applicable" });
    expect(result.compensation.scenarioAnnualTakeHomePay).toBe(0);
    expect(horizon?.scenario.liquidMonths).toBeLessThan(
      horizon?.baseline.liquidMonths ?? Number.NEGATIVE_INFINITY,
    );
    expect(horizon?.scenario.totalBalance).toBeLessThan(
      horizon?.baseline.totalBalance ?? Number.NEGATIVE_INFINITY,
    );
  });

  it("keeps another household member's income in a job-loss scenario", () => {
    const householdData = AssetTrackerDataSchema.parse({
      ...data(),
      household: {
        members: [
          { id: "primary", displayName: "Alex" },
          { id: "partner", displayName: "Sam" },
        ],
        activeScope: { kind: "household" },
      },
      recurringFlows: [
        ...data().recurringFlows,
        {
          id: "partner-salary",
          name: "Partner salary",
          toAccountId: "current",
          amount: 2_500,
          currency: "GBP",
          compensationKind: "takeHomeIncome",
          frequency: "monthly",
          startDate: "2025-01-01",
        },
      ],
      ownership: {
        ...data().ownership,
        recurringFlows: {
          "current-salary": { kind: "personal", memberId: "primary" },
          "partner-salary": { kind: "personal", memberId: "partner" },
        },
      },
    });
    const scenario: JobMoveScenario = {
      ...employedScenario(),
      id: "primary-job-loss",
      name: "Alex loses job",
      householdMemberId: "primary",
      employmentStatus: "unemployed",
      roleStartDate: undefined,
      employer: undefined,
      baseGrossPay: 0,
      variableGrossPay: 0,
      employeePensionRate: 0,
      employerPensionRate: 0,
      annualTakeHomeOverride: undefined,
      destinationAccountId: undefined,
      pensionAccountId: undefined,
    };
    const result = compareJobMoveScenario({
      repository: buildRepository(householdData),
      scenario,
      horizonMonths: 12,
      startDate: "2026-01-01",
      annualExpenditure: 24_000,
      annualCurrentExpenditure: 24_000,
      financialIndependenceTarget: null,
      emergencyFundAnalysis: null,
      baselineCompensation: {
        annualTakeHomeIncome: 66_000,
        annualEmployeePensionContribution: 0,
        annualEmployerPensionContribution: 0,
      },
    });

    expect(result.compensation.scenarioAnnualTakeHomePay).toBe(30_000);
  });

  it("tracks configured emergency-fund accounts throughout the forecast", () => {
    const emergencyFundAnalysis: EmergencyFundAnalysis = {
      monthlyEssentialNeed: 1_000,
      accessibleFunds: 12_000,
      accessibleCoverageMonths: 12,
      sources: [
        {
          accountId: "current",
          accountName: "Current account",
          included: true,
          exclusionReason: null,
          balance: 12_000,
          effectiveBalance: 12_000,
          protectedBalance: null,
          policy: {
            accountId: "current",
            included: true,
            kind: "cash",
            accessDelayDays: 0,
            capitalRiskRate: 0,
            withdrawalFee: 0,
            protectionGroup: "Bank",
          },
        },
      ],
      selectedDecisionCosts: 0,
      unconvertedDecisionCostIds: [],
      policyTargets: [],
      currentResults: [],
      policyResults: [],
    };
    const result = comparison(employedScenario(), emergencyFundAnalysis);
    const horizon = result.timeline.at(-1);

    expect(horizon?.baseline.emergencyFundMonths).not.toBeNull();
    expect(horizon?.scenario.emergencyFundBalance).not.toBeNull();
  });

  it("creates, edits, duplicates, and deletes without touching salary history", () => {
    const original = data();
    const saved = applySaveJobMoveScenario(
      original,
      { scenario: employedScenario() },
      "2026-01-02T00:00:00Z",
    );
    const scenario = saved.jobMoveScenarios?.[0];
    if (scenario == null) throw new Error("Expected saved scenario");
    const edited = applySaveJobMoveScenario(
      saved,
      {
        id: scenario.id,
        scenario: { ...scenario, name: "Edited role" },
      },
      "2026-01-03T00:00:00Z",
    );
    const duplicated = applyDuplicateJobMoveScenario(
      edited,
      { id: scenario.id },
      "2026-01-04T00:00:00Z",
    );
    const removed = applyDeleteJobMoveScenario(duplicated, { id: scenario.id });

    expect(edited.jobMoveScenarios?.[0]?.name).toBe("Edited role");
    expect(duplicated.jobMoveScenarios).toHaveLength(2);
    expect(removed.jobMoveScenarios).toHaveLength(1);
    expect(removed.salaryHistory).toEqual(original.salaryHistory);
  });
});
