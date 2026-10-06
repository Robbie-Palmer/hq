import { describe, expect, it } from "vitest";
import {
  type AssetTrackerData,
  AssetTrackerDataSchema,
  analyseEmergencyFund,
  applyEmergencyFundDerivedFacts,
  applySaveEmergencyFundPlan,
  buildRepository,
  defaultEmergencyFundAccountPolicy,
  deriveEmergencyFundFacts,
  type EmergencyFundPlanInput,
} from "@/lib/domain/assettracker";

function data(): AssetTrackerData {
  return AssetTrackerDataSchema.parse({
    accounts: [
      {
        id: "cash",
        name: "Current account",
        provider: "Bank A",
        currency: "GBP",
        assetType: "cash",
        liquidity: "cash",
        expectedAnnualReturn: 0,
        createdAt: "2024-01-01",
      },
      {
        id: "savings",
        name: "Easy-access savings",
        provider: "Bank A",
        currency: "GBP",
        assetType: "cash",
        liquidity: "cash",
        expectedAnnualReturn: 0.03,
        createdAt: "2024-01-01",
      },
      {
        id: "pension",
        name: "Workplace pension",
        provider: "Pension Co",
        currency: "GBP",
        assetType: "stocks",
        taxWrapper: "pension",
        liquidity: "illiquid",
        expectedAnnualReturn: 0.05,
        createdAt: "2024-01-01",
      },
      {
        id: "home",
        name: "Home",
        provider: "Land Registry",
        currency: "GBP",
        assetType: "property",
        liquidity: "illiquid",
        expectedAnnualReturn: 0.02,
        createdAt: "2024-01-01",
      },
      {
        id: "tax",
        name: "Tax reserve",
        provider: "Bank B",
        currency: "GBP",
        assetType: "cash",
        liquidity: "cash",
        expectedAnnualReturn: 0.02,
        createdAt: "2024-01-01",
      },
    ],
    snapshots: [
      { accountId: "cash", date: "2026-10-01", balance: 5_000 },
      { accountId: "savings", date: "2026-10-01", balance: 7_000 },
      { accountId: "pension", date: "2026-10-01", balance: 50_000 },
      { accountId: "home", date: "2026-10-01", balance: 300_000 },
      { accountId: "tax", date: "2026-10-01", balance: 10_000 },
    ],
  });
}

function plan(
  source = data(),
  update: Partial<EmergencyFundPlanInput> = {},
): EmergencyFundPlanInput {
  const repository = buildRepository(source);
  return {
    name: "Household reserves",
    essentialMonthlyExpenditure: 1_000,
    annualIrregularEssentialCosts: 1_200,
    monthlyDebtPayments: 100,
    employmentMonthlyIncome: 2_000,
    monthlySideIncome: 1_000,
    accessNeedDays: 7,
    missingData: [],
    coverageMonths: [3, 6],
    accountPolicies: Array.from(repository.accounts.values()).map(
      defaultEmergencyFundAccountPolicy,
    ),
    stressScenarios: [
      {
        id: "job-loss",
        name: "Job loss",
        durationMonths: 3,
        employmentIncomeLossRate: 1,
        sideIncomeDelayMonths: 2,
        unexpectedCost: 0,
        annualInflationRate: 0,
      },
    ],
    ...update,
  };
}

describe("emergency-fund planning", () => {
  it("derives observed spending, debt, income, and inflation from tracker data", () => {
    const base = data();
    const source = AssetTrackerDataSchema.parse({
      ...base,
      accounts: [
        ...base.accounts,
        {
          id: "mortgage",
          name: "Home mortgage",
          provider: "Bank A",
          currency: "GBP",
          assetType: "mortgage",
          liquidity: "illiquid",
          expectedAnnualReturn: 0.04,
          createdAt: "2024-01-01",
        },
      ],
      snapshots: [
        ...base.snapshots,
        { accountId: "mortgage", date: "2026-10-01", balance: -100_000 },
      ],
      recurringFlows: [
        {
          id: "salary",
          name: "Salary",
          toAccountId: "cash",
          amount: 4_000,
          currency: "GBP",
          compensationKind: "takeHomeIncome",
          frequency: "monthly",
          startDate: "2024-01-01",
        },
        {
          id: "consulting",
          name: "Consulting invoices",
          toAccountId: "cash",
          amount: 500,
          currency: "GBP",
          compensationKind: "sideIncome",
          frequency: "monthly",
          startDate: "2024-01-01",
        },
        {
          id: "mortgage-payment",
          name: "Mortgage payment",
          fromAccountId: "cash",
          toAccountId: "mortgage",
          amount: 1_000,
          currency: "GBP",
          frequency: "monthly",
          startDate: "2024-01-01",
        },
      ],
      settings: { ...base.settings, expectedAnnualInflation: 0.04 },
    });
    const repository = buildRepository(source);
    const facts = deriveEmergencyFundFacts(repository, 18_000, "2026-10-01");

    expect(facts).toEqual({
      essentialMonthlyExpenditure: 500,
      monthlyDebtPayments: 1_000,
      employmentMonthlyIncome: 4_000,
      monthlySideIncome: 500,
      annualInflationRate: 0.04,
    });
    expect(applyEmergencyFundDerivedFacts(plan(source), facts)).toMatchObject({
      essentialMonthlyExpenditure: 500,
      monthlyDebtPayments: 1_000,
      employmentMonthlyIncome: 4_000,
      monthlySideIncome: 500,
      stressScenarios: [expect.objectContaining({ annualInflationRate: 0.04 })],
    });
  });

  it("does not reuse stale saved facts when current tracker data is missing", () => {
    const resolved = applyEmergencyFundDerivedFacts(plan(), {
      essentialMonthlyExpenditure: null,
      monthlyDebtPayments: 0,
      employmentMonthlyIncome: null,
      monthlySideIncome: 0,
      annualInflationRate: 0.03,
    });

    expect(resolved).toMatchObject({
      essentialMonthlyExpenditure: 0,
      monthlyDebtPayments: 0,
      employmentMonthlyIncome: 0,
      monthlySideIncome: 0,
      stressScenarios: [expect.objectContaining({ annualInflationRate: 0.03 })],
    });
  });

  it("uses reviewed essential and irregular costs without counting inaccessible assets", () => {
    const repository = buildRepository(data());
    const result = analyseEmergencyFund(repository, plan(), "2026-10-01");

    expect(result.monthlyEssentialNeed).toBe(1_200);
    expect(result.accessibleFunds).toBe(12_000);
    expect(result.accessibleCoverageMonths).toBe(10);
    expect(
      result.sources.find(({ accountId }) => accountId === "pension"),
    ).toMatchObject({
      included: false,
      effectiveBalance: 0,
    });
    expect(
      result.sources.find(({ accountId }) => accountId === "home"),
    ).toMatchObject({
      included: false,
      effectiveBalance: 0,
    });
    expect(
      result.sources.find(({ accountId }) => accountId === "tax"),
    ).toMatchObject({
      included: false,
      effectiveBalance: 0,
    });
  });

  it("reports both a funding gap and money available above smaller policies", () => {
    const result = analyseEmergencyFund(
      buildRepository(data()),
      plan(data(), { coverageMonths: [6, 12] }),
      "2026-10-01",
    );

    expect(result.policyTargets).toEqual([
      {
        months: 6,
        target: 7_200,
        fundingGap: 0,
        availableAboveTarget: 4_800,
      },
      {
        months: 12,
        target: 14_400,
        fundingGap: 2_400,
        availableAboveTarget: 0,
      },
    ]);
  });

  it("shows shortfall severity and duration under negative cash flow", () => {
    const stressPlan = plan(data(), {
      essentialMonthlyExpenditure: 1_200,
      annualIrregularEssentialCosts: 0,
      monthlyDebtPayments: 0,
      employmentMonthlyIncome: 0,
      monthlySideIncome: 0,
      accountPolicies: plan().accountPolicies.map((policy) => ({
        ...policy,
        included: policy.accountId === "cash",
      })),
      stressScenarios: [
        {
          id: "negative-cash-flow",
          name: "Negative cash flow",
          durationMonths: 6,
          employmentIncomeLossRate: 1,
          sideIncomeDelayMonths: 0,
          unexpectedCost: 0,
          annualInflationRate: 0,
        },
      ],
    });
    const result = analyseEmergencyFund(
      buildRepository(data()),
      stressPlan,
      "2026-10-01",
    );

    expect(result.currentResults[0]).toMatchObject({
      firstShortfallMonth: 5,
      shortfallMonths: 2,
      totalShortfall: 2_200,
      maximumMonthlyShortfall: 1_200,
    });
    expect(
      result.policyResults.find(({ policyMonths }) => policyMonths === 3),
    ).toMatchObject({
      firstShortfallMonth: 4,
      shortfallMonths: 3,
      totalShortfall: 3_600,
    });
  });

  it("keeps zero-spend coverage undefined while exposing money above each target", () => {
    const result = analyseEmergencyFund(
      buildRepository(data()),
      plan(data(), {
        essentialMonthlyExpenditure: 0,
        annualIrregularEssentialCosts: 0,
        monthlyDebtPayments: 0,
        employmentMonthlyIncome: 0,
        monthlySideIncome: 0,
      }),
      "2026-10-01",
    );

    expect(result.accessibleCoverageMonths).toBeNull();
    expect(result.policyTargets[0]).toMatchObject({
      target: 0,
      fundingGap: 0,
      availableAboveTarget: 12_000,
    });
  });

  it("models delayed and uncertain side income month by month", () => {
    const result = analyseEmergencyFund(
      buildRepository(data()),
      plan(data(), {
        essentialMonthlyExpenditure: 600,
        annualIrregularEssentialCosts: 0,
        monthlyDebtPayments: 0,
        employmentMonthlyIncome: 0,
      }),
      "2026-10-01",
    );

    expect(
      result.currentResults[0]?.path.map(
        ({ availableIncome }) => availableIncome,
      ),
    ).toEqual([0, 0, 1_000]);
  });

  it("applies access delays, capital risk, and withdrawal fees", () => {
    const policies = plan().accountPolicies.map((policy) => {
      if (policy.accountId === "cash") {
        return { ...policy, capitalRiskRate: 0.1, withdrawalFee: 100 };
      }
      if (policy.accountId === "savings") {
        return { ...policy, accessDelayDays: 30 };
      }
      return policy;
    });
    const result = analyseEmergencyFund(
      buildRepository(data()),
      plan(data(), { accessNeedDays: 7, accountPolicies: policies }),
      "2026-10-01",
    );

    expect(result.accessibleFunds).toBe(4_400);
    expect(
      result.sources.find(({ accountId }) => accountId === "savings"),
    ).toMatchObject({
      included: false,
      exclusionReason: "Access takes 30 days",
      effectiveBalance: 0,
    });
  });

  it("does not double-count a protection limit shared by two accounts", () => {
    const source = data();
    const policies = plan(source).accountPolicies.map((policy) =>
      policy.accountId === "cash" || policy.accountId === "savings"
        ? {
            ...policy,
            protectionLimit: 8_000,
            protectionGroup: "bank-a",
            protectionSourceUrl: "https://example.com/protection",
          }
        : policy,
    );
    const result = analyseEmergencyFund(
      buildRepository(source),
      plan(source, { accountPolicies: policies }),
      "2026-10-01",
    );
    const protectedTotal = result.sources.reduce(
      (total, sourceResult) => total + (sourceResult.protectedBalance ?? 0),
      0,
    );

    expect(protectedTotal).toBe(8_000);
  });

  it("includes selected household decisions in the stress path", () => {
    const source: AssetTrackerData = {
      ...data(),
      futureCashFlows: [
        {
          id: "urgent-repair",
          name: "Urgent repair",
          labels: [],
          currency: "GBP",
          kind: "decision",
          status: "selected",
          reversibility: "irreversible",
          dependencyIds: [],
          alternativeToIds: [],
          stages: [
            {
              id: "repair",
              fromAccountId: "cash",
              expectedDate: "2026-11-01",
              minimumAmount: 1_500,
              expectedAmount: 2_000,
              maximumAmount: 2_500,
              actuals: [],
            },
          ],
        },
      ],
    };
    const result = analyseEmergencyFund(
      buildRepository(source),
      plan(source),
      "2026-10-01",
    );

    expect(result.selectedDecisionCosts).toBe(2_000);
    expect(result.currentResults[0]?.path[0]?.decisionCosts).toBe(2_000);
  });

  it("versions revised assumptions and preserves lineage", () => {
    const first = applySaveEmergencyFundPlan(
      data(),
      plan(),
      "2026-10-01T12:00:00Z",
    );
    const revised = applySaveEmergencyFundPlan(
      first,
      plan(first, {
        annualIrregularEssentialCosts: 2_400,
        essentialMonthlyExpenditure: 1_400,
      }),
      "2026-10-02T12:00:00Z",
    );

    expect(revised.emergencyFundPlans).toHaveLength(2);
    expect(revised.emergencyFundPlans?.[0]?.status).toBe("superseded");
    expect(revised.emergencyFundPlans?.[1]).toMatchObject({
      version: 2,
      status: "active",
      supersedesId: "household-emergency-reserves-v1",
      annualIrregularEssentialCosts: 2_400,
      essentialMonthlyExpenditure: 1_400,
    });
  });
});
