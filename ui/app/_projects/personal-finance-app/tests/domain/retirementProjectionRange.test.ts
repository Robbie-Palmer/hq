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
      "stop-work",
      "stay-in-work",
      "reduced-work",
    ]);
    expect(
      result.pathComparisons[0]?.outcomes.map(
        ({ horizonYears }) => horizonYears,
      ),
    ).toEqual([10, 15, 20]);
  });

  it("separates adverse return sequence, inflation, spending, delayed income, and tax effects", () => {
    const result = compareRetirementProjectionRanges({
      facts: facts(),
      assumptionSets: assumptions,
      pathOptions: {
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

  it("compares stopping, staying, and reducing work against the same starting facts", () => {
    const result = compareRetirementProjectionRanges({
      facts: facts(),
      assumptionSets: assumptions,
      pathOptions: {
        lowerIncomeRate: 0.5,
      },
    });
    const byPath = new Map(
      result.pathComparisons.map((comparison) => [
        comparison.path.id,
        comparison,
      ]),
    );

    expect(byPath.get("stop-work")?.path.retirementDate).toBe("2035-01-01");
    expect(byPath.get("stay-in-work")?.path.retirementDate).toBeNull();
    expect(byPath.get("reduced-work")?.path.annualNetEmploymentIncome).toBe(
      21_000,
    );
    expect(
      byPath.get("stay-in-work")?.outcomes.at(-1)?.totalNetWorth,
    ).toBeGreaterThan(
      byPath.get("stop-work")?.outcomes.at(-1)?.totalNetWorth ?? 0,
    );
    expect(
      byPath.get("reduced-work")?.outcomes.at(-1)?.totalNetWorth,
    ).toBeLessThan(
      byPath.get("stay-in-work")?.outcomes.at(-1)?.totalNetWorth ?? 0,
    );
  });

  it("keeps home value, liabilities, restricted pension, and unfunded spending separate", () => {
    const input = facts();
    input.accounts.push(
      account({
        id: "home",
        name: "Home",
        balance: 300_000,
        assetType: "property",
        liquidity: "illiquid",
      }),
      account({
        id: "mortgage",
        name: "Mortgage",
        balance: -100_000,
        assetType: "mortgage",
        liquidity: "illiquid",
        taxWrapper: undefined,
      }),
    );
    const pension = input.accounts.find(({ id }) => id === "pension");
    if (pension?.accessPolicy != null) {
      pension.accessPolicy = {
        ...pension.accessPolicy,
        accessibleFromDate: "2040-01-01",
      };
    }
    input.contributionPlan = {
      accountId: "pension",
      annualEmployeeGross: 6_000,
      annualEmployer: 3_000,
    };

    const result = compareRetirementProjectionRanges({
      facts: input,
      assumptionSets: assumptions,
      pathOptions: { lowerIncomeRate: 0.5 },
    });
    const outcome = result.assumptionComparisons.find(
      ({ assumption }) => assumption.id === "central",
    )?.outcomes[0];

    expect(outcome).toMatchObject({
      liabilities: expect.any(Number),
      restrictedPensionCapital: expect.any(Number),
    });
    expect(outcome?.retainedHomeEquity).toBeGreaterThan(300_000);
    expect(outcome?.liabilities).toBeGreaterThan(100_000);
    expect(outcome?.restrictedPensionCapital).toBeGreaterThan(200_000);
    expect(outcome?.liquidWithdrawalCapital).toBeLessThan(
      outcome?.totalNetWorth ?? 0,
    );
  });

  it("blocks unsupported withdrawal rules before returning results", () => {
    const input = facts();
    const isa = input.accounts.find(({ id }) => id === "isa");
    if (isa != null) {
      isa.accessPolicy = {
        accessDelayMonths: 0,
        withdrawalFeeRate: 0,
        taxTreatment: {
          kind: "unsupported",
          reason: "Provider exit charge needs manual review",
        },
        canFundOrdinarySpending: true,
      };
    }

    expect(() =>
      compareRetirementProjectionRanges({
        facts: input,
        assumptionSets: assumptions,
        pathOptions: { lowerIncomeRate: 0.5 },
      }),
    ).toThrow(
      "Cannot show retirement forecast: ISA: Provider exit charge needs manual review",
    );
  });

  it("moves released home equity into withdrawal capital only on the chosen date", () => {
    const input = facts();
    input.accounts.push(
      account({
        id: "home",
        name: "Home",
        balance: 300_000,
        assetType: "property",
        liquidity: "illiquid",
        expectedAnnualReturn: 0,
      }),
      account({
        id: "mortgage",
        name: "Mortgage",
        balance: -100_000,
        assetType: "mortgage",
        liquidity: "illiquid",
        taxWrapper: undefined,
        expectedAnnualReturn: 0,
      }),
    );
    input.housingReleases = [
      {
        id: "downsize",
        date: "2035-01-01",
        sourcePropertyAccountId: "home",
        destinationAccountId: "isa",
        grossProceeds: 300_000,
        retainedHousingValue: 0,
        tax: 0,
        fees: 10_000,
        liabilitySettlements: [{ accountId: "mortgage", amount: 100_000 }],
      },
    ];

    const result = compareRetirementProjectionRanges({
      facts: input,
      assumptionSets: assumptions,
      pathOptions: { lowerIncomeRate: 0.5 },
    });
    const outcome = result.assumptionComparisons.find(
      ({ assumption }) => assumption.id === "central",
    )?.outcomes[0];

    expect(outcome).toMatchObject({
      retainedHomeEquity: 0,
      liabilities: 0,
    });
    expect(outcome?.liquidWithdrawalCapital).toBeGreaterThan(0);
  });

  it("keeps the central path alive when the conservative sequence exhausts accessible capital", () => {
    const result = compareRetirementProjectionRanges({
      facts: facts(),
      assumptionSets: assumptions,
      pathOptions: {
        lowerIncomeRate: 0.5,
      },
    });
    const [conservative, central] = result.assumptionComparisons;

    expect(
      conservative?.outcomes.at(-1)?.accessibleCapitalExhaustionDate,
    ).not.toBeNull();
    expect(conservative?.outcomes.at(-1)?.cashRunwayMonths).not.toBeNull();
    expect(conservative?.outcomes.at(-1)?.portfolioSurvives).toBe(false);
    expect(
      central?.outcomes.at(-1)?.accessibleCapitalExhaustionDate,
    ).toBeNull();
    expect(central?.outcomes.at(-1)?.portfolioSurvives).toBe(true);
  });
});
