import { describe, expect, it } from "vitest";
import { calculateHistoricalSalary } from "../src/historicalSalary";

const request = {
  effectiveDate: "2025-06-30",
  taxYear: "2025-26",
  jurisdiction: "england-and-northern-ireland" as const,
  contractualGrossPayPence: 6_000_000,
  otherTaxableIncomePence: 0,
  otherDeductionsPence: 0,
  nationalInsuranceCategory: "A" as const,
  isCompanyDirector: false as const,
  assumptions: [
    { id: "other-taxable-income", value: 0 },
    { id: "other-deductions", value: 0 },
    { id: "employment-type", value: "employee-not-director" },
  ],
};

describe("historical salary calculation", () => {
  it("models salary sacrifice before Income Tax and National Insurance", () => {
    const result = calculateHistoricalSalary({
      ...request,
      pension: {
        method: "salary-sacrifice",
        employeeGrossContributionPence: 600_000,
        employeeCashDeductionPence: 0,
        salarySacrificePence: 600_000,
        employerContributionPence: 0,
        providerTaxReliefPence: 0,
      },
    });

    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.components).toEqual({
      contractualGrossPayPence: 6_000_000,
      grossCashPayPence: 5_400_000,
      taxablePayPence: 4_143_000,
      incomeTaxPence: 903_200,
      employeeNationalInsurancePence: 309_000,
      employeePensionContributionPence: 600_000,
      salarySacrificePence: 600_000,
      memberPensionDeductionPence: 0,
      employerPensionContributionPence: 0,
      providerTaxReliefPence: 0,
      otherDeductionsPence: 0,
      takeHomePayPence: 4_187_800,
    });
  });

  it("keeps net-pay and relief-at-source cash effects distinct", () => {
    const netPay = calculateHistoricalSalary({
      ...request,
      pension: {
        method: "net-pay",
        employeeGrossContributionPence: 600_000,
        employeeCashDeductionPence: 600_000,
        salarySacrificePence: 0,
        employerContributionPence: 0,
        providerTaxReliefPence: 0,
      },
    });
    const reliefAtSource = calculateHistoricalSalary({
      ...request,
      pension: {
        method: "relief-at-source",
        employeeGrossContributionPence: 600_000,
        employeeCashDeductionPence: 480_000,
        salarySacrificePence: 0,
        employerContributionPence: 0,
        providerTaxReliefPence: 120_000,
      },
    });

    expect(netPay.available && netPay.components).toMatchObject({
      taxablePayPence: 4_143_000,
      incomeTaxPence: 903_200,
      employeeNationalInsurancePence: 321_000,
      memberPensionDeductionPence: 600_000,
      takeHomePayPence: 4_175_800,
    });
    expect(reliefAtSource.available && reliefAtSource.components).toMatchObject(
      {
        taxablePayPence: 4_743_000,
        incomeTaxPence: 1_143_200,
        employeeNationalInsurancePence: 321_000,
        memberPensionDeductionPence: 480_000,
        providerTaxReliefPence: 120_000,
        takeHomePayPence: 4_055_800,
      },
    );
  });

  it("selects the National Insurance rate effective inside a tax year", () => {
    const beforeCut = calculateHistoricalSalary({
      ...request,
      effectiveDate: "2023-12-31",
      taxYear: "2023-24",
      contractualGrossPayPence: 3_600_000,
      pension: null,
    });
    const afterCut = calculateHistoricalSalary({
      ...request,
      effectiveDate: "2024-01-31",
      taxYear: "2023-24",
      contractualGrossPayPence: 3_600_000,
      pension: null,
    });

    expect(beforeCut.available && beforeCut.components.employeeNationalInsurancePence).toBe(
      281_088,
    );
    expect(afterCut.available && afterCut.components.employeeNationalInsurancePence).toBe(
      234_240,
    );
  });

  it("uses reviewed rules when the dependency lacks an older Scottish year", () => {
    const result = calculateHistoricalSalary({
      ...request,
      effectiveDate: "2023-06-30",
      taxYear: "2023-24",
      jurisdiction: "scotland",
      contractualGrossPayPence: 5_000_000,
      pension: null,
    });

    expect(result.available && result.components.incomeTaxPence).toBe(903_848);
  });

  it.each([
    ["2015-07-31", "2015-16", 940_300, 427_068],
    ["2016-07-31", "2016-17", 920_000, 433_188],
    ["2017-07-31", "2017-18", 870_000, 452_076],
    ["2018-07-31", "2018-19", 836_000, 462_468],
    ["2019-07-31", "2019-20", 750_000, 496_464],
    ["2020-07-31", "2020-21", 750_000, 485_952],
    ["2021-07-31", "2021-22", 748_600, 485_232],
  ])(
    "calculates reviewed historical Income Tax and NI for %s",
    (effectiveDate, taxYear, incomeTaxPence, employeeNationalInsurancePence) => {
      const result = calculateHistoricalSalary({
        ...request,
        effectiveDate,
        taxYear,
        contractualGrossPayPence: 5_000_000,
        pension: null,
      });

      expect(result.available).toBe(true);
      if (!result.available) return;
      expect(result.components).toMatchObject({
        incomeTaxPence,
        employeeNationalInsurancePence,
      });
      expect(result.lineage.taxYear).toBe(taxYear);
    },
  );

  it.each([
    ["2017-07-31", "2017-18", 910_000],
    ["2018-07-31", "2018-19", 918_400],
    ["2019-07-31", "2019-20", 904_407],
    ["2020-07-31", "2020-21", 904_157],
    ["2021-07-31", "2021-22", 897_967],
  ])(
    "uses the historical Scottish schedule for %s",
    (effectiveDate, taxYear, incomeTaxPence) => {
      const result = calculateHistoricalSalary({
        ...request,
        effectiveDate,
        taxYear,
        jurisdiction: "scotland",
        contractualGrossPayPence: 5_000_000,
        pension: null,
      });

      expect(result.available && result.components.incomeTaxPence).toBe(
        incomeTaxPence,
      );
    },
  );

  it("returns unavailable outside the reviewed rule range", () => {
    expect(
      calculateHistoricalSalary({
        ...request,
        effectiveDate: "2014-06-30",
        taxYear: "2014-15",
        pension: null,
      }),
    ).toMatchObject({
      available: false,
      reasons: [{ code: "unsupported-rules" }],
    });
  });

  it("records the rules, sources, engine, and assumptions", () => {
    const result = calculateHistoricalSalary({ ...request, pension: null });

    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.lineage).toMatchObject({
      calculationVersion: "historical-salary-v1",
      engineVersion: "3.0.1",
      ruleDatasetVersion: "2026.10.3",
      taxYear: "2025-26",
      effectiveDate: "2025-06-30",
    });
    expect(result.lineage.rules).toHaveLength(3);
    expect(result.lineage.sources.length).toBeGreaterThan(0);
    expect(result.lineage.assumptions).toEqual(request.assumptions);
    expect(result.inputs).toMatchObject({
      contractualGrossPayPence: 6_000_000,
      pension: null,
      assumptions: request.assumptions,
    });
  });
});
