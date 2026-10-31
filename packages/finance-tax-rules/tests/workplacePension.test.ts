import { describe, expect, it } from "vitest";
import { ruleDataset } from "../src/data";
import { calculateWorkplacePension } from "../src/workplacePension";
import { workplacePensionFixtures } from "../src/workplacePensionFixtures";

const baseRequest = {
  effectiveDate: "2026-06-01",
  payPeriod: "monthly" as const,
  annualGrossPayPence: 6_000_000,
  annualQualifyingEarningsPayPence: 6_000_000,
  qualifyingEarningsVariablePaymentsPence: [],
  employee: {
    kind: "percentage" as const,
    taxTreatment: "salary-sacrifice" as const,
    basis: "gross-pay" as const,
    rateBasisPoints: 500,
  },
  employer: {
    kind: "flat-rate" as const,
    basis: "gross-pay" as const,
    rateBasisPoints: 300,
  },
};

describe("workplace pension contributions", () => {
  it("versions statutory pay components by the tax year they took effect", () => {
    const components = (taxYear: string) =>
      ruleDataset.pensions.find((rule) => rule.taxYear === taxYear)
        ?.qualifyingEarnings.includedComponents;

    expect(components("2019-20")).not.toContain(
      "statutory-parental-bereavement-pay",
    );
    expect(components("2020-21")).toContain(
      "statutory-parental-bereavement-pay",
    );
    expect(components("2024-25")).not.toContain(
      "statutory-neonatal-care-pay",
    );
    expect(components("2025-26")).toContain("statutory-neonatal-care-pay");
  });

  it.each(workplacePensionFixtures.fixtures)(
    "matches the versioned official fixture $id",
    ({ input, expected }) => {
      expect(calculateWorkplacePension(input)).toMatchObject({
        available: true,
        ...expected,
      });
    },
  );

  it("keeps full-pay employee and employer amounts separate", () => {
    expect(calculateWorkplacePension(baseRequest)).toMatchObject({
      available: true,
      employeeGrossContributionPence: 300_000,
      employeeCashDeductionPence: 0,
      salarySacrificePence: 300_000,
      salarySacrificeByPeriodPence: Array.from(
        { length: 12 },
        () => 25_000,
      ),
      employerContributionPence: 180_000,
      providerTaxReliefPence: 0,
    });
  });

  it("uses explicit pensionable pay instead of base or gross pay", () => {
    expect(
      calculateWorkplacePension({
        ...baseRequest,
        annualPensionablePayPence: 4_000_000,
        employee: {
          ...baseRequest.employee,
          basis: "pensionable-pay",
        },
      }),
    ).toMatchObject({
      available: true,
      employeeGrossContributionPence: 200_000,
      bases: { pensionablePayPence: 4_000_000 },
    });
  });

  it("applies exact monthly lower and upper qualifying-earnings boundaries", () => {
    const atLower = calculateWorkplacePension({
      ...baseRequest,
      annualGrossPayPence: 624_000,
      annualQualifyingEarningsPayPence: 624_000,
      employee: {
        ...baseRequest.employee,
        basis: "qualifying-earnings",
        rateBasisPoints: 10_000,
      },
      employer: { kind: "none" },
    });
    const aboveLower = calculateWorkplacePension({
      ...baseRequest,
      annualGrossPayPence: 624_012,
      annualQualifyingEarningsPayPence: 624_012,
      employee: {
        ...baseRequest.employee,
        basis: "qualifying-earnings",
        rateBasisPoints: 10_000,
      },
      employer: { kind: "none" },
    });
    const aboveUpper = calculateWorkplacePension({
      ...baseRequest,
      annualGrossPayPence: 8_000_000,
      annualQualifyingEarningsPayPence: 8_000_000,
      employee: {
        ...baseRequest.employee,
        basis: "qualifying-earnings",
        rateBasisPoints: 10_000,
      },
      employer: { kind: "none" },
    });

    expect(atLower).toMatchObject({
      available: true,
      employeeGrossContributionPence: 0,
    });
    expect(aboveLower).toMatchObject({
      available: true,
      employeeGrossContributionPence: 12,
    });
    expect(aboveUpper).toMatchObject({
      available: true,
      employeeGrossContributionPence: 4_402_800,
    });
  });

  it("puts a bonus in its pay period before applying the band", () => {
    const result = calculateWorkplacePension({
      ...baseRequest,
      annualGrossPayPence: 3_000_000,
      annualQualifyingEarningsPayPence: 3_000_000,
      qualifyingEarningsVariablePaymentsPence: [600_000],
      employee: {
        ...baseRequest.employee,
        basis: "qualifying-earnings",
        rateBasisPoints: 10_000,
      },
      employer: { kind: "none" },
    });

    expect(result).toMatchObject({
      available: true,
      employeeGrossContributionPence: 1_994_900,
      employeeGrossContributionByPeriodPence: [
        366_900,
        ...Array.from({ length: 11 }, () => 148_000),
      ],
    });
  });

  it("uses the versioned band for the effective tax year", () => {
    const request = {
      ...baseRequest,
      payPeriod: "annual" as const,
      annualGrossPayPence: 6_000_000,
      annualQualifyingEarningsPayPence: 6_000_000,
      employee: {
        ...baseRequest.employee,
        basis: "qualifying-earnings" as const,
        rateBasisPoints: 10_000,
      },
      employer: { kind: "none" as const },
    };

    expect(
      calculateWorkplacePension({
        ...request,
        effectiveDate: "2020-06-01",
      }),
    ).toMatchObject({
      available: true,
      employeeGrossContributionPence: 4_376_000,
      lineage: { pensionRuleId: "pension-2020-21" },
    });
    expect(
      calculateWorkplacePension({
        ...request,
        effectiveDate: "2021-06-01",
      }),
    ).toMatchObject({
      available: true,
      employeeGrossContributionPence: 4_403_000,
      lineage: { pensionRuleId: "pension-2021-22" },
    });
  });

  it("separates relief-at-source cash and provider amounts", () => {
    expect(
      calculateWorkplacePension({
        ...baseRequest,
        employee: {
          ...baseRequest.employee,
          taxTreatment: "relief-at-source",
        },
      }),
    ).toMatchObject({
      available: true,
      employeeGrossContributionPence: 300_000,
      employeeCashDeductionPence: 240_000,
      providerTaxReliefPence: 60_000,
      employerContributionPence: 180_000,
    });
  });

  it("applies marginal matching tiers, scheme minimums, and caps", () => {
    const matched = calculateWorkplacePension({
      ...baseRequest,
      employer: {
        kind: "matching",
        basis: "gross-pay",
        tiers: [
          {
            employeeRateUpToBasisPoints: 300,
            matchRatioBasisPoints: 10_000,
          },
          {
            employeeRateUpToBasisPoints: 500,
            matchRatioBasisPoints: 5_000,
          },
        ],
        maximumRateBasisPoints: 350,
        maximumAmountPence: 200_000,
      },
    });
    const minimum = calculateWorkplacePension({
      ...baseRequest,
      employer: {
        kind: "flat-rate",
        basis: "gross-pay",
        rateBasisPoints: 100,
        schemeMinimumRateBasisPoints: 300,
      },
    });

    expect(matched).toMatchObject({
      available: true,
      employerContributionPence: 200_000,
    });
    expect(minimum).toMatchObject({
      available: true,
      employerContributionPence: 180_000,
    });
  });

  it("keeps unknown rules unavailable until an explicit amount is supplied", () => {
    expect(
      calculateWorkplacePension({
        ...baseRequest,
        employee: { kind: "unknown" },
        employer: { kind: "unknown" },
      }),
    ).toMatchObject({
      available: false,
      reasons: [
        { code: "unknown-employee-contribution" },
        { code: "unknown-employer-policy" },
      ],
    });
    expect(
      calculateWorkplacePension({
        ...baseRequest,
        employee: {
          kind: "explicit-amount",
          taxTreatment: "net-pay",
          grossAmountPence: 123_456,
        },
        employer: { kind: "explicit-amount", amountPence: 78_900 },
      }),
    ).toMatchObject({
      available: true,
      employeeGrossContributionPence: 123_456,
      employerContributionPence: 78_900,
    });
  });
});
