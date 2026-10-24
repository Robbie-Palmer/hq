import { describe, expect, it } from "vitest";
import {
  calculateTerminationPayment,
  TERMINATION_PAYMENT_RULESET,
} from "../src/terminationPayment";

function request() {
  return {
    effectiveDate: "2026-12-01",
    currency: "GBP",
    jurisdiction: "england-and-northern-ireland",
    residence: "full-year-uk" as const,
    noticeTreatment: "worked-or-paid-in-full" as const,
    priorSection403AwardsPence: 0,
    hasOtherTaxInteractions: false,
    components: [
      {
        id: "statutory",
        kind: "statutory-redundancy" as const,
        amountPence: 1_200_000,
      },
      {
        id: "enhanced",
        kind: "enhanced-redundancy" as const,
        amountPence: 800_000,
      },
    ],
    knownDeductionsPence: 10_000,
  };
}

describe("termination payment rules", () => {
  it("calculates a reviewed award within the section 403 threshold", () => {
    const result = calculateTerminationPayment(request());

    expect(result.available).toBe(true);
    expect(result).toMatchObject({
      cashGrossPence: 2_000_000,
      section403AwardPence: 2_000_000,
      section403TaxFreePence: 2_000_000,
      knownDeductionsPence: 10_000,
      netCashPence: 1_990_000,
      lineage: {
        calculationVersion: "termination-payment-v1",
        ruleSetVersion: TERMINATION_PAYMENT_RULESET.version,
      },
    });
    expect(result.treatments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          componentId: "statutory",
          incomeTax: "section-403-threshold",
          employeeNationalInsurance: "none",
        }),
      ]),
    );
    expect(result.lineage.sourceIds).toContain("hmrc-eim13500");
  });

  it("refuses to guess payroll withholding or tax above the threshold", () => {
    const result = calculateTerminationPayment({
      ...request(),
      components: [
        {
          id: "holiday",
          kind: "holiday-pay",
          amountPence: 500_000,
        },
        {
          id: "enhanced",
          kind: "enhanced-redundancy",
          amountPence: 3_500_000,
        },
      ],
      knownDeductionsPence: 0,
    });

    expect(result.available).toBe(false);
    expect(result.netCashPence).toBeNull();
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Payroll-taxable components"),
        expect.stringContaining("exceeds the remaining GBP 30,000 threshold"),
      ]),
    );
  });

  it("reports unsupported dates, currencies, non-cash benefits, and deductions", () => {
    const result = calculateTerminationPayment({
      ...request(),
      effectiveDate: "2019-12-01",
      currency: "EUR",
      jurisdiction: "other",
      residence: "partial-year",
      noticeTreatment: "reduced-or-unknown",
      hasOtherTaxInteractions: true,
      components: [
        {
          id: "benefit",
          kind: "non-cash-benefit",
          amountPence: 1,
        },
        ...(
          [
            "unpaid-wages",
            "bonus",
            "contractual-payment-in-lieu-of-notice",
            "post-employment-notice-pay",
            "restrictive-covenant",
            "employer-pension-contribution",
            "employer-paid-legal-costs",
            "injury-disability-award",
            "other",
          ] as const
        ).map((kind, index) => ({
          id: `component-${index}`,
          kind,
          amountPence: 1,
        })),
      ],
      knownDeductionsPence: 100,
    });

    expect(result.available).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining("predates"),
        expect.stringContaining("supports GBP only"),
        expect.stringContaining("Non-cash benefits"),
        expect.stringContaining("Known deductions exceed"),
      ]),
    );
  });
});
