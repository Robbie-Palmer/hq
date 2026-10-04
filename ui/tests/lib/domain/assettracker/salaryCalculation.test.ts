import { describe, expect, it } from "vitest";
import {
  calculateSalaryHistory,
  type SalaryHistoryRecord,
} from "@/lib/domain/assettracker";

function salaryRecord(
  overrides: Partial<SalaryHistoryRecord> = {},
): SalaryHistoryRecord {
  return {
    id: "salary-2025",
    person: "Alex",
    employer: "Example Ltd",
    employmentId: "example",
    currency: "GBP",
    jurisdiction: "England",
    effectiveStart: "2025-04-06",
    effectiveEnd: "2026-04-05",
    payFrequency: "monthly",
    amountKind: "annualSalary",
    grossPay: 60_000,
    otherTaxableIncome: 0,
    otherDeductions: 0,
    nationalInsuranceCategory: "A",
    isCompanyDirector: false,
    employeePension: {
      arrangement: "salarySacrifice",
      amount: 6_000,
      basis: "grossPay",
    },
    employerPension: {
      arrangement: "other",
      amount: 3_000,
      basis: "grossPay",
    },
    source: { kind: "manual" },
    acceptedAt: "2026-10-04T10:00:00Z",
    ...overrides,
  };
}

describe("salary history calculations", () => {
  it("calculates an annual salary record and keeps pension sources separate", () => {
    const [calculation] = calculateSalaryHistory(
      [salaryRecord()],
      "2026-04-05",
    );

    expect(calculation?.result.available).toBe(true);
    if (!calculation?.result.available) return;
    expect(calculation.result.components).toMatchObject({
      contractualGrossPayPence: 6_000_000,
      salarySacrificePence: 600_000,
      employeePensionContributionPence: 600_000,
      employerPensionContributionPence: 300_000,
      incomeTaxPence: 903_200,
      employeeNationalInsurancePence: 309_000,
      takeHomePayPence: 4_187_800,
    });
  });

  it("does not silently replace missing assumptions with zero", () => {
    const [calculation] = calculateSalaryHistory(
      [
        salaryRecord({
          otherTaxableIncome: undefined,
          otherDeductions: undefined,
          nationalInsuranceCategory: undefined,
          isCompanyDirector: undefined,
        }),
      ],
      "2026-04-05",
    );

    expect(calculation?.result).toMatchObject({
      available: false,
      reasons: expect.arrayContaining([
        expect.objectContaining({ code: "missing-other-income" }),
        expect.objectContaining({ code: "missing-other-deductions" }),
        expect.objectContaining({ code: "missing-ni-category" }),
        expect.objectContaining({ code: "missing-director-status" }),
      ]),
    });
  });

  it("splits a record at an in-year National Insurance change", () => {
    const calculations = calculateSalaryHistory(
      [
        salaryRecord({
          effectiveStart: "2023-04-06",
          effectiveEnd: "2024-04-05",
          employeePension: { arrangement: "none", basis: "unknown" },
          employerPension: { arrangement: "none", basis: "unknown" },
        }),
      ],
      "2024-04-05",
    );

    expect(
      calculations.map(({ effectiveFrom, effectiveTo }) => [
        effectiveFrom,
        effectiveTo,
      ]),
    ).toEqual([
      ["2023-04-06", "2024-01-05"],
      ["2024-01-06", "2024-04-05"],
    ]);
    expect(
      calculations.map((calculation) =>
        calculation.result.available
          ? calculation.result.components.employeeNationalInsurancePence
          : null,
      ),
    ).toEqual([471_768, 396_384]);
  });

  it("annualises period pay and observations without changing their provenance", () => {
    const [calculation] = calculateSalaryHistory(
      [
        salaryRecord({
          amountKind: "periodPay",
          grossPay: 5_000,
          takeHomePay: 3_500,
          observedIncomeTax: 900,
          observedEmployeeNationalInsurance: 300,
          employeePension: { arrangement: "none", basis: "unknown" },
          employerPension: { arrangement: "none", basis: "unknown" },
        }),
      ],
      "2026-04-05",
    );

    expect(
      calculation?.result.available &&
        calculation.result.components.contractualGrossPayPence,
    ).toBe(6_000_000);
    expect(calculation?.observations).toEqual({
      incomeTaxPence: 1_080_000,
      employeeNationalInsurancePence: 360_000,
      takeHomePayPence: 4_200_000,
    });
    expect(calculation?.notes[0]).toContain("annualised across 12 periods");
  });

  it("flags overlapping employments and preserves an observed tax code", () => {
    const records = [
      salaryRecord({ taxCode: "1257L" }),
      salaryRecord({
        id: "second-job",
        employer: "Second Ltd",
        employmentId: "second",
        otherTaxableIncome: 60_000,
      }),
    ];
    const calculations = calculateSalaryHistory(records, "2026-04-05");

    expect(calculations[0]?.notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Tax code 1257L"),
        expect.stringContaining("Another employment overlaps"),
      ]),
    );
    const first = calculations[0]?.result;
    expect(first?.available && first.lineage.assumptions).toContainEqual({
      id: "observed-tax-code",
      value: "1257L",
    });
  });
});
