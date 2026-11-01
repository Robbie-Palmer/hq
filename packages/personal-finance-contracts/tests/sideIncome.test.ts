import { describe, expect, it } from "vitest";
import {
  FULL_OWNERSHIP_BASIS_POINTS,
  FinancialFactSchema,
  MoneySchema,
  OwnershipBasisPointsSchema,
  SideIncomeCaseSchema,
} from "../src/sideIncome";
import {
  employmentPlusSideTradingCase,
  incompleteFactsCase,
  multipleIncomeStreamsCase,
  smallSideIncomeCase,
  syntheticSideIncomeCases,
} from "../src/sideIncomeSyntheticCases";

describe("side-income fact contract", () => {
  it("defines full ownership as 100 percent in basis points", () => {
    expect(FULL_OWNERSHIP_BASIS_POINTS).toBe(100 * 100);
    expect(
      OwnershipBasisPointsSchema.parse(FULL_OWNERSHIP_BASIS_POINTS),
    ).toBe(FULL_OWNERSHIP_BASIS_POINTS);
    expect(
      OwnershipBasisPointsSchema.safeParse(
        FULL_OWNERSHIP_BASIS_POINTS + 1,
      ).success,
    ).toBe(false);
  });

  it("validates the four synthetic acceptance cases", () => {
    expect(syntheticSideIncomeCases).toHaveLength(4);
    for (const sideIncomeCase of syntheticSideIncomeCases) {
      expect(SideIncomeCaseSchema.parse(sideIncomeCase)).toEqual(sideIncomeCase);
    }
    expect(smallSideIncomeCase.id).toBe("case:small-side-income");
    expect(employmentPlusSideTradingCase.employmentArrangements).toHaveLength(1);
    expect(
      employmentPlusSideTradingCase.employmentArrangements[0]?.payFactIds,
    ).toEqual(["fact:main-job-salary"]);
    expect(incompleteFactsCase.people[0]?.taxResidence.status).toBe("unknown");
  });

  it("keeps product, subscription, and service activities in one case", () => {
    expect(multipleIncomeStreamsCase.activities.map((activity) => activity.kind)).toEqual([
      "product-sales",
      "subscription-sales",
      "contracting-services",
    ]);
  });

  it("keeps company and household measures distinct", () => {
    const kinds = new Set(
      multipleIncomeStreamsCase.financialFacts.map((fact) => fact.kind),
    );
    expect(kinds).toEqual(
      new Set([
        "gross-revenue",
        "assignment-rate",
        "taxable-profit",
        "salary",
        "dividend",
        "pension-contribution",
        "company-cash",
        "household-cash",
        "vat",
        "tax-reserve",
      ]),
    );
    const companyCash = multipleIncomeStreamsCase.financialFacts.find(
      (fact) => fact.kind === "company-cash",
    );
    const householdCash = multipleIncomeStreamsCase.financialFacts.find(
      (fact) => fact.kind === "household-cash",
    );
    expect(companyCash?.owner.kind).toBe("business");
    expect(householdCash?.owner.kind).toBe("household");
  });

  it("requires currency and jurisdiction on money", () => {
    const fact = structuredClone(smallSideIncomeCase.financialFacts[0]);
    if (fact === undefined) throw new Error("Synthetic revenue fact is missing");
    const invalid = {
      ...fact,
      amount: { minorUnits: fact.amount.minorUnits, currency: "GBP" },
    };
    expect(FinancialFactSchema.safeParse(invalid).success).toBe(false);
  });

  it("requires currently assigned ISO country and currency codes", () => {
    expect(
      MoneySchema.safeParse({
        minorUnits: 1,
        currency: "GBP",
        jurisdiction: "GB",
      }).success,
    ).toBe(true);
    expect(
      MoneySchema.safeParse({
        minorUnits: 1,
        currency: "GBP",
        jurisdiction: "UK",
      }).success,
    ).toBe(false);
    expect(
      MoneySchema.safeParse({
        minorUnits: 1,
        currency: "ZZZ",
        jurisdiction: "GB",
      }).success,
    ).toBe(false);
  });

  it("requires a unit for assignment rates and forbids one on totals", () => {
    const rate = employmentPlusSideTradingCase.financialFacts.find(
      (fact) => fact.kind === "assignment-rate",
    );
    expect(rate).toBeDefined();
    expect(
      FinancialFactSchema.safeParse({ ...rate, unit: "total" }).success,
    ).toBe(false);
    expect(
      FinancialFactSchema.safeParse({
        ...smallSideIncomeCase.financialFacts[0],
        unit: "day",
      }).success,
    ).toBe(false);
  });
});
