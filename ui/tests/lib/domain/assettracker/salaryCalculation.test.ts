import { describe, expect, it } from "vitest";
import {
  calculateNoPensionSalaryHistory,
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

  it("preserves take-home history when gross pay is unknown", () => {
    const [calculation] = calculateSalaryHistory(
      [
        salaryRecord({
          amountKind: "periodPay",
          grossPay: undefined,
          takeHomePay: 1_250,
        }),
      ],
      "2026-04-05",
    );

    expect(calculation?.result).toMatchObject({
      available: false,
      reasons: [expect.objectContaining({ code: "missing-gross-pay" })],
    });
    expect(calculation?.observations.takeHomePayPence).toBe(1_500_000);
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

  it("splits a July 2015 record at the pension alignment change", () => {
    const calculations = calculateSalaryHistory(
      [
        salaryRecord({
          effectiveStart: "2015-07-01",
          effectiveEnd: "2016-04-05",
          employeePension: { arrangement: "none", basis: "unknown" },
          employerPension: { arrangement: "none", basis: "unknown" },
        }),
      ],
      "2016-04-05",
    );

    expect(
      calculations.map(({ effectiveFrom, effectiveTo, result }) => [
        effectiveFrom,
        effectiveTo,
        result.available ? result.lineage.rules[2]?.id : null,
      ]),
    ).toEqual([
      ["2015-07-01", "2015-07-08", "pension-2015-16-pre-alignment"],
      ["2015-07-09", "2016-04-05", "pension-2015-16-post-alignment"],
    ]);
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

  it("adds a one-off bonus once to its employment and tax year", () => {
    const calculations = calculateSalaryHistory(
      [
        salaryRecord({
          employeePension: { arrangement: "none", basis: "unknown" },
          employerPension: { arrangement: "none", basis: "unknown" },
        }),
        salaryRecord({
          id: "bonus-2025",
          effectiveStart: "2025-12-20",
          effectiveEnd: "2025-12-20",
          amountKind: "periodPay",
          payFrequency: "irregular",
          grossPay: 5_000,
          variablePay: 5_000,
        }),
      ],
      "2026-04-05",
    );

    expect(calculations).toHaveLength(1);
    const [calculation] = calculations;
    expect(
      calculation?.result.available &&
        calculation.result.components.contractualGrossPayPence,
    ).toBe(6_500_000);
    expect(calculation?.notes).toContain(
      "Includes £5,000.00 of one-off pay recorded in this tax year.",
    );
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

  it.each(["salarySacrifice", "netPay", "reliefAtSource"] as const)(
    "calculates a zero-employee-pension counterfactual from %s",
    (arrangement) => {
      const [calculation] = calculateNoPensionSalaryHistory(
        [
          salaryRecord({
            employeePension: {
              arrangement,
              amount: 6_000,
              basis: "grossPay",
            },
          }),
        ],
        "2026-04-05",
      );

      expect(calculation?.scenario).toBe("hypothetical-no-employee-pension");
      expect(calculation?.result.available).toBe(true);
      if (!calculation?.result.available) return;
      expect(calculation.result.components).toMatchObject({
        contractualGrossPayPence: 6_000_000,
        grossCashPayPence: 6_000_000,
        employeePensionContributionPence: 0,
        salarySacrificePence: 0,
        memberPensionDeductionPence: 0,
        employerPensionContributionPence: 300_000,
        providerTaxReliefPence: 0,
      });
      expect(calculation.result.lineage.assumptions).toEqual(
        expect.arrayContaining([
          {
            id: "scenario",
            value: "hypothetical-no-employee-pension",
          },
          { id: "employee-pension-contribution-pence", value: 0 },
          { id: "salary-sacrifice-pence", value: 0 },
        ]),
      );
      expect(calculation.comparison).toMatchObject({
        foregoneEmployeeContributionPence:
          arrangement === "reliefAtSource" ? 750_000 : 600_000,
        employerPensionContributionPence: 300_000,
      });
    },
  );

  it("can calculate the scenario when the employee pension was not recorded", () => {
    const [calculation] = calculateNoPensionSalaryHistory(
      [salaryRecord({ employeePension: undefined })],
      "2026-04-05",
    );

    expect(calculation?.baselineResult).toMatchObject({
      available: false,
      reasons: [expect.objectContaining({ code: "missing-employee-pension" })],
    });
    expect(calculation?.result.available).toBe(true);
    expect(calculation?.comparison).toBeNull();
  });

  it("keeps net pay available when only employer pension is unknown", () => {
    const [missingEmployer] = calculateNoPensionSalaryHistory(
      [salaryRecord({ employerPension: undefined })],
      "2026-04-05",
    );

    expect(missingEmployer?.result.available).toBe(true);
    expect(missingEmployer?.employerPension).toMatchObject({
      contributionPence: null,
      unavailableReasons: [
        expect.objectContaining({ code: "missing-employer-pension" }),
      ],
    });
    expect(missingEmployer?.comparison).toBeNull();
  });

  it("keeps unsupported years unavailable", () => {
    const [unsupportedYear] = calculateNoPensionSalaryHistory(
      [
        salaryRecord({
          effectiveStart: "2014-04-06",
          effectiveEnd: "2015-04-05",
        }),
      ],
      "2015-04-05",
    );

    expect(unsupportedYear?.result).toMatchObject({
      available: false,
      reasons: [expect.objectContaining({ code: "unsupported-rules" })],
    });
  });

  it("does not guess unsupported counterfactual inputs", () => {
    const [calculation] = calculateNoPensionSalaryHistory(
      [
        salaryRecord({
          currency: "USD",
          jurisdiction: "UK",
          otherTaxableIncome: undefined,
          otherDeductions: undefined,
          nationalInsuranceCategory: "B",
          isCompanyDirector: true,
        }),
      ],
      "2026-04-05",
    );

    expect(calculation?.result).toMatchObject({
      available: false,
      reasons: expect.arrayContaining([
        expect.objectContaining({ code: "unsupported-currency" }),
        expect.objectContaining({ code: "unsupported-jurisdiction" }),
        expect.objectContaining({ code: "missing-other-income" }),
        expect.objectContaining({ code: "missing-other-deductions" }),
        expect.objectContaining({ code: "unsupported-ni-category" }),
        expect.objectContaining({ code: "unsupported-director-ni" }),
      ]),
    });
  });
});
