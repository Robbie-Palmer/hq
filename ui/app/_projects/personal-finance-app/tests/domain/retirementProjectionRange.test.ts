import { describe, expect, it } from "vitest";
import {
  compareRetirementProjectionRanges,
  type RetirementAssumptionSet,
  type RetirementCapitalAccount,
  type RetirementProjectionFacts,
} from "@/app/_projects/personal-finance-app/domain";

const assumptions: RetirementAssumptionSet[] = [
  {
    id: "conservative",
    name: "Conservative",
    annualReturn: 0.02,
    annualInflation: 0.04,
    annualSpendingChange: 0.01,
    annualFeeRate: 0.01,
    longevityYears: 35,
    earlyReturnShock: -0.2,
    earlyReturnShockYears: 2,
  },
  {
    id: "central",
    name: "Central",
    annualReturn: 0.05,
    annualInflation: 0.025,
    annualSpendingChange: 0,
    annualFeeRate: 0.005,
    longevityYears: 35,
    earlyReturnShock: 0,
    earlyReturnShockYears: 0,
  },
  {
    id: "optimistic",
    name: "Optimistic",
    annualReturn: 0.07,
    annualInflation: 0.02,
    annualSpendingChange: -0.005,
    annualFeeRate: 0.003,
    longevityYears: 35,
    earlyReturnShock: 0,
    earlyReturnShockYears: 0,
  },
];

function account(
  overrides: Partial<RetirementCapitalAccount> &
    Pick<RetirementCapitalAccount, "id" | "name" | "balance">,
): RetirementCapitalAccount {
  return {
    provider: "Test provider",
    assetType: "stocks",
    liquidity: "liquid",
    taxWrapper: "isa",
    expectedAnnualReturn: 0.05,
    accessPolicy: {
      accessDelayMonths: 0,
      withdrawalFeeRate: 0,
      taxTreatment: { kind: "tax-free" },
      canFundOrdinarySpending: true,
    },
    ...overrides,
  };
}

function facts(): RetirementProjectionFacts {
  return {
    startDate: "2027-01-01",
    plannedRetirementDate: "2035-01-01",
    annualSpending: 36_000,
    annualNetEmploymentIncome: 42_000,
    delayedIncomeAnnual: 12_000,
    delayedIncomeStartDate: "2040-01-01",
    accounts: [
      account({ id: "isa", name: "ISA", balance: 500_000 }),
      account({
        id: "pension",
        name: "Pension",
        balance: 200_000,
        taxWrapper: "pension",
        liquidity: "illiquid",
        accessPolicy: {
          accessibleFromDate: "2035-01-01",
          accessDelayMonths: 0,
          withdrawalFeeRate: 0,
          taxTreatment: { kind: "fixed-rate", rate: 0.2 },
          canFundOrdinarySpending: true,
        },
      }),
    ],
    withdrawalOrder: ["isa", "pension"],
  };
}

describe("compareRetirementProjectionRanges", () => {
  it("compares every named range at the fixed planning horizons", () => {
    const result = compareRetirementProjectionRanges({
      facts: facts(),
      assumptionSets: assumptions,
      pathOptions: {
        retireEarlierYears: 2,
        workLongerYears: 2,
        lowerIncomeRate: 0.5,
      },
    });

    expect(result.assumptionComparisons).toHaveLength(3);
    expect(
      result.assumptionComparisons[0]?.outcomes.map(
        ({ horizonYears }) => horizonYears,
      ),
    ).toEqual([10, 15, 20, 30]);
    expect(result.pathComparisons.map(({ path }) => path.id)).toEqual([
      "planned",
      "earlier",
      "longer",
      "lower-income",
    ]);
  });

  it("separates adverse return sequence, inflation, spending, delayed income, and tax effects", () => {
    const result = compareRetirementProjectionRanges({
      facts: facts(),
      assumptionSets: assumptions,
      pathOptions: {
        retireEarlierYears: 2,
        workLongerYears: 2,
        lowerIncomeRate: 0.5,
      },
    });
    const conservative = result.assumptionComparisons[0];

    expect(conservative?.effects.earlyMarketSequence).toBeLessThan(0);
    expect(conservative?.effects.inflation).toBeLessThan(0);
    expect(conservative?.effects.spendingChange).toBeLessThan(0);
    expect(conservative?.effects.delayedIncome).toBeLessThanOrEqual(0);
    expect(conservative?.effects.withdrawalTax).toBeLessThanOrEqual(0);
  });

  it("shows timing and replacement-income choices against the same starting facts", () => {
    const result = compareRetirementProjectionRanges({
      facts: facts(),
      assumptionSets: assumptions,
      pathOptions: {
        retireEarlierYears: 2,
        workLongerYears: 2,
        lowerIncomeRate: 0.5,
      },
    });
    const byPath = new Map(
      result.pathComparisons.map((comparison) => [
        comparison.path.id,
        comparison,
      ]),
    );

    expect(byPath.get("earlier")?.path.retirementDate).toBe("2033-01-01");
    expect(byPath.get("longer")?.path.retirementDate).toBe("2037-01-01");
    expect(byPath.get("lower-income")?.path.annualNetEmploymentIncome).toBe(
      21_000,
    );
    expect(byPath.get("longer")?.outcome.totalNetWorth).toBeGreaterThan(
      byPath.get("earlier")?.outcome.totalNetWorth ?? 0,
    );
    expect(byPath.get("lower-income")?.outcome.totalNetWorth).toBeLessThan(
      byPath.get("planned")?.outcome.totalNetWorth ?? 0,
    );
  });

  it("keeps the central path alive when the conservative sequence exhausts accessible capital", () => {
    const result = compareRetirementProjectionRanges({
      facts: facts(),
      assumptionSets: assumptions,
      pathOptions: {
        retireEarlierYears: 2,
        workLongerYears: 2,
        lowerIncomeRate: 0.5,
      },
    });
    const [conservative, central] = result.assumptionComparisons;

    expect(
      conservative?.outcomes.at(-1)?.accessibleCapitalExhaustionDate,
    ).not.toBeNull();
    expect(
      central?.outcomes.at(-1)?.accessibleCapitalExhaustionDate,
    ).toBeNull();
  });
});
