import { describe, expect, it } from "vitest";
import {
  findSideIncomeRule,
  UK_SIDE_INCOME_RULESET_VERSION,
  ukSideIncomeRules,
} from "../src/sideIncomeRules";

describe("UK side-income rule catalogue", () => {
  it("pins every rule to an official source and review version", () => {
    expect(ukSideIncomeRules.length).toBeGreaterThanOrEqual(12);
    for (const rule of ukSideIncomeRules) {
      expect(rule.version).toBe(UK_SIDE_INCOME_RULESET_VERSION);
      expect(rule.source.checkedOn).toBe(UK_SIDE_INCOME_RULESET_VERSION);
      expect(new URL(rule.source.url).hostname).toBe("www.gov.uk");
      expect(rule.applicability.jurisdiction).toBe("GB");
    }
  });

  it("records gross trading and VAT tests instead of a universal threshold", () => {
    const registration = findSideIncomeRule(
      "uk.sole-trader.self-assessment-registration",
    );
    const vat = findSideIncomeRule("uk.vat.registration");
    expect(registration.test).toMatchObject({
      kind: "threshold",
      measure: "annual-gross-trading-income",
      amount: { minorUnits: 100_000, currency: "GBP", jurisdiction: "GB" },
    });
    expect(vat.test).toMatchObject({
      kind: "threshold",
      measure: "trailing-twelve-month-taxable-turnover",
      amount: { minorUnits: 9_000_000, currency: "GBP", jurisdiction: "GB" },
    });
    expect(registration.applicability.effectiveFrom).toBe("2017-04-06");
    expect(vat.applicability.effectiveFrom).toBe("2024-04-01");
  });

  it("versions all three staged Making Tax Digital tests", () => {
    const mtdRules = ukSideIncomeRules
      .filter((rule) => rule.topic === "making-tax-digital")
      .map((rule) => ({
        effectiveFrom: rule.applicability.effectiveFrom,
        test: rule.test,
      }));
    expect(mtdRules).toEqual([
      {
        effectiveFrom: "2026-04-06",
        test: expect.objectContaining({
          referenceTaxYear: "2024-25",
          amount: expect.objectContaining({ minorUnits: 5_000_000 }),
        }),
      },
      {
        effectiveFrom: "2027-04-06",
        test: expect.objectContaining({
          referenceTaxYear: "2025-26",
          amount: expect.objectContaining({ minorUnits: 3_000_000 }),
        }),
      },
      {
        effectiveFrom: "2028-04-06",
        test: expect.objectContaining({
          referenceTaxYear: "2026-27",
          amount: expect.objectContaining({ minorUnits: 2_000_000 }),
        }),
      },
    ]);
  });

  it("models umbrella work as employment rather than an entity to establish", () => {
    const umbrella = findSideIncomeRule("uk.umbrella.employment-arrangement");
    expect(umbrella.applicability.structures).toEqual(["umbrella-employment"]);
    expect(umbrella.test).toEqual({
      kind: "duty",
      trigger: "umbrella-arrangement-used",
    });
  });
});
