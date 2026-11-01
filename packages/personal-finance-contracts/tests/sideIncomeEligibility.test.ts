import { describe, expect, it } from "vitest";
import { evaluateSideIncomeEligibility } from "../src/sideIncomeEligibility";
import { SideIncomeCaseSchema } from "../src/sideIncome";
import {
  employmentPlusSideTradingCase,
  incompleteFactsCase,
  multipleIncomeStreamsCase,
  smallSideIncomeCase,
} from "../src/sideIncomeSyntheticCases";

const evaluate = (
  value = smallSideIncomeCase,
  evaluatedOn = "2026-10-31",
) =>
  evaluateSideIncomeEligibility(value, {
    evaluatedOn,
    taxYear: "2026-27",
  });

const option = (
  result: ReturnType<typeof evaluate>,
  name: "sole-trader" | "uk-limited-company" | "umbrella-employment",
) => {
  const found = result.options.find((candidate) => candidate.option === name);
  if (found === undefined) throw new Error(`Missing ${name} result`);
  return found;
};

const ruleStatus = (
  result: ReturnType<typeof evaluate>,
  optionName: "sole-trader" | "uk-limited-company" | "umbrella-employment",
  ruleId: string,
) => option(result, optionName).rules.find((rule) => rule.ruleId === ruleId)?.status;

describe("side-income structure eligibility", () => {
  it("keeps small gross side income below the registration threshold", () => {
    const result = evaluate();
    expect(result.rankingAllowed).toBe(true);
    expect(option(result, "sole-trader").state).toBe("eligible");
    expect(
      ruleStatus(
        result,
        "sole-trader",
        "uk.sole-trader.self-assessment-registration",
      ),
    ).toBe("not-required");
    expect(
      ruleStatus(result, "sole-trader", "uk.sole-trader.trading-allowance"),
    ).toBe("available");
    expect(ruleStatus(result, "sole-trader", "uk.vat.registration")).toBe(
      "not-required",
    );
    expect(option(result, "umbrella-employment").state).toBe("ineligible");
  });

  it("does not treat existing PAYE salary as company payroll", () => {
    const result = evaluate(employmentPlusSideTradingCase);
    expect(
      ruleStatus(
        result,
        "sole-trader",
        "uk.sole-trader.self-assessment-registration",
      ),
    ).toBe("required");
    expect(
      ruleStatus(result, "uk-limited-company", "uk.company.paye-registration"),
    ).toBe("not-required");
    expect(option(result, "umbrella-employment").state).toBe(
      "requires-arrangement",
    );
  });

  it("allows sales and services to coexist without making umbrella cover the sales", () => {
    const result = evaluate(multipleIncomeStreamsCase);
    expect(option(result, "sole-trader").coveredActivityIds).toHaveLength(3);
    expect(option(result, "uk-limited-company").coveredActivityIds).toHaveLength(3);
    expect(option(result, "umbrella-employment")).toMatchObject({
      state: "eligible",
      coveredActivityIds: ["activity:consulting"],
      uncoveredActivityIds: ["activity:software-sales", "activity:subscriptions"],
    });
    expect(
      ruleStatus(result, "uk-limited-company", "uk.company.paye-registration"),
    ).toBe("required");
    expect(
      ruleStatus(result, "uk-limited-company", "uk.company.withdrawals"),
    ).toBe("required");
    expect(ruleStatus(result, "uk-limited-company", "uk.vat.registration")).toBe(
      "required",
    );
  });

  it("uses the MTD threshold effective on the evaluation date", () => {
    const later = SideIncomeCaseSchema.parse({
      ...smallSideIncomeCase,
      mtdQualifyingIncome: [
        ...smallSideIncomeCase.mtdQualifyingIncome,
        {
          personId: "person:owner",
          taxReturnYear: "2025-26",
          grossSelfEmploymentAndPropertyIncome: {
            minorUnits: 4_000_000,
            currency: "GBP",
            jurisdiction: "GB",
          },
          sourceComplete: true,
        },
      ],
    });
    const result = evaluate(later, "2027-10-31");
    expect(ruleStatus(result, "sole-trader", "uk.mtd-income-tax.2025-26")).toBe(
      "required",
    );
  });

  it("stops ranking when core facts are incomplete", () => {
    const result = evaluate(incompleteFactsCase);
    expect(result.rankingAllowed).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "unknown-residence",
      "unknown-business-structure",
      "missing-ownership",
    ]);
    expect(result.options.every((candidate) => candidate.state === "needs-review")).toBe(
      true,
    );
  });

  it("identifies cross-border, partnership, and multi-owner cases before ranking", () => {
    const unsupported = SideIncomeCaseSchema.parse({
      ...multipleIncomeStreamsCase,
      people: [
        ...multipleIncomeStreamsCase.people,
        {
          id: "person:co-owner",
          taxResidence: {
            status: "resident",
            jurisdiction: "GB",
            effectiveFrom: "2026-04-06",
            effectiveTo: null,
          },
        },
      ],
      businesses: [
        {
          ...multipleIncomeStreamsCase.businesses[0],
          structure: "partnership",
        },
      ],
      businessOwnerships: [
        {
          ...multipleIncomeStreamsCase.businessOwnerships[0],
          ownershipBasisPoints: 5_000,
        },
        {
          businessId: "business:software-company",
          personId: "person:co-owner",
          ownershipBasisPoints: 5_000,
          effectiveFrom: "2025-01-01",
          effectiveTo: null,
        },
      ],
      customerArrangements: multipleIncomeStreamsCase.customerArrangements.map(
        (arrangement, index) =>
          index === 0
            ? { ...arrangement, customerJurisdiction: "US" }
            : arrangement,
      ),
    });
    const result = evaluate(unsupported);
    expect(result.rankingAllowed).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "cross-border",
      "partnership",
      "multi-owner",
    ]);
    expect(result.options.every((candidate) => candidate.state === "unsupported")).toBe(
      true,
    );
  });
});
