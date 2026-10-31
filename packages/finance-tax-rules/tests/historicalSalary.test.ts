import { describe, expect, it } from "vitest";
import { calculateHistoricalSalary } from "../src/historicalSalary";

type PensionMethod = "salary-sacrifice" | "net-pay" | "relief-at-source";

function distribute(total: number, earnings: readonly number[]): number[] {
  const earningsTotal = earnings.reduce((sum, amount) => sum + amount, 0);
  const amounts = earnings.map((amount) =>
    Math.floor((total * amount) / earningsTotal),
  );
  let remainder = total - amounts.reduce((sum, amount) => sum + amount, 0);
  for (let index = 0; remainder > 0; index += 1) {
    const period = index % amounts.length;
    amounts[period] = (amounts[period] ?? 0) + 1;
    remainder -= 1;
  }
  return amounts;
}

function methodCalculation(
  method: PensionMethod,
  fixture: {
    effectiveDate: string;
    taxYear: string;
    jurisdiction: "england-and-northern-ireland" | "scotland";
    payPeriod: "monthly" | "weekly";
    earningsPence: number[];
  },
) {
  const contractualGrossPayPence = fixture.earningsPence.reduce(
    (sum, amount) => sum + amount,
    0,
  );
  const employeeGrossContributionPence = Math.min(
    120_000,
    contractualGrossPayPence,
  );
  const salarySacrificePence =
    method === "salary-sacrifice" ? employeeGrossContributionPence : 0;
  const sacrificeByPeriod = distribute(
    salarySacrificePence,
    fixture.earningsPence,
  );
  return calculateHistoricalSalary({
    ...request,
    effectiveDate: fixture.effectiveDate,
    taxYear: fixture.taxYear,
    jurisdiction: fixture.jurisdiction,
    contractualGrossPayPence,
    nationalInsurancePeriods: {
      payPeriod: fixture.payPeriod,
      postSacrificeEarningsPence: fixture.earningsPence.map(
        (amount, index) => amount - (sacrificeByPeriod[index] ?? 0),
      ),
    },
    pension: {
      method,
      employeeGrossContributionPence,
      employeeCashDeductionPence:
        method === "salary-sacrifice"
          ? 0
          : method === "relief-at-source"
            ? Math.round(employeeGrossContributionPence * 0.8)
            : employeeGrossContributionPence,
      salarySacrificePence,
      employerContributionPence: 0,
      providerTaxReliefPence:
        method === "relief-at-source"
          ? Math.round(employeeGrossContributionPence * 0.2)
          : 0,
    },
  });
}

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
      nationalInsuranceEarningsPence: 5_400_000,
      incomeTaxPence: 903_200,
      employeeNationalInsurancePence: 309_000,
      employeePensionContributionPence: 600_000,
      salarySacrificePence: 600_000,
      memberPensionDeductionPence: 0,
      employerPensionContributionPence: 0,
      employerNationalInsuranceSavingPence: 0,
      employerNationalInsuranceSavingContributionPence: 0,
      totalEmployerPensionContributionPence: 0,
      providerTaxReliefPence: 0,
      furtherPensionTaxReliefPence: 0,
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
        incomeTaxPence: 1_023_200,
        employeeNationalInsurancePence: 321_000,
        memberPensionDeductionPence: 480_000,
        providerTaxReliefPence: 120_000,
        takeHomePayPence: 4_175_800,
      },
    );
  });

  it("records provider relief and further relief that may need a claim", () => {
    const result = calculateHistoricalSalary({
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

    expect(result.available && result.components).toMatchObject({
      providerTaxReliefPence: 120_000,
      furtherPensionTaxReliefPence: 120_000,
    });
  });

  it("keeps entered employer NI savings separate from contractual contributions", () => {
    const result = calculateHistoricalSalary({
      ...request,
      pension: {
        method: "salary-sacrifice",
        employeeGrossContributionPence: 600_000,
        employeeCashDeductionPence: 0,
        salarySacrificePence: 600_000,
        employerContributionPence: 300_000,
        providerTaxReliefPence: 0,
        employerNationalInsuranceSavingPence: 90_000,
        employerNationalInsuranceSavingContributionPence: 45_000,
      },
    });

    expect(result.available && result.components).toMatchObject({
      employerPensionContributionPence: 300_000,
      employerNationalInsuranceSavingPence: 90_000,
      employerNationalInsuranceSavingContributionPence: 45_000,
      totalEmployerPensionContributionPence: 345_000,
    });
  });

  const pensionMethodBoundaryFixtures = [
    {
      name: "Income Tax personal allowance",
      effectiveDate: "2025-06-30",
      taxYear: "2025-26",
      jurisdiction: "england-and-northern-ireland" as const,
      payPeriod: "monthly" as const,
      earningsPence: Array.from({ length: 12 }, () => 104_750),
    },
    {
      name: "monthly NI primary threshold",
      effectiveDate: "2025-06-30",
      taxYear: "2025-26",
      jurisdiction: "england-and-northern-ireland" as const,
      payPeriod: "monthly" as const,
      earningsPence: Array.from({ length: 12 }, () => 104_800),
    },
    {
      name: "monthly NI upper earnings limit and higher-rate threshold",
      effectiveDate: "2025-06-30",
      taxYear: "2025-26",
      jurisdiction: "england-and-northern-ireland" as const,
      payPeriod: "monthly" as const,
      earningsPence: Array.from({ length: 12 }, () => 418_900),
    },
    {
      name: "Scottish higher bands",
      effectiveDate: "2025-06-30",
      taxYear: "2025-26",
      jurisdiction: "scotland" as const,
      payPeriod: "monthly" as const,
      earningsPence: Array.from({ length: 12 }, () => 500_000),
    },
    {
      name: "one-month bonus",
      effectiveDate: "2025-06-30",
      taxYear: "2025-26",
      jurisdiction: "england-and-northern-ireland" as const,
      payPeriod: "monthly" as const,
      earningsPence: [2_700_000, ...Array.from({ length: 11 }, () => 300_000)],
    },
    {
      name: "NI rate before the January 2024 change",
      effectiveDate: "2023-12-31",
      taxYear: "2023-24",
      jurisdiction: "england-and-northern-ireland" as const,
      payPeriod: "monthly" as const,
      earningsPence: Array.from({ length: 12 }, () => 300_000),
    },
    {
      name: "NI rate after the January 2024 change",
      effectiveDate: "2024-01-31",
      taxYear: "2023-24",
      jurisdiction: "england-and-northern-ireland" as const,
      payPeriod: "monthly" as const,
      earningsPence: Array.from({ length: 12 }, () => 300_000),
    },
  ];

  it.each(pensionMethodBoundaryFixtures)(
    "compares all pension methods at $name",
    (fixture) => {
      const salarySacrifice = methodCalculation("salary-sacrifice", fixture);
      const netPay = methodCalculation("net-pay", fixture);
      const reliefAtSource = methodCalculation("relief-at-source", fixture);

      expect(salarySacrifice.available).toBe(true);
      expect(netPay.available).toBe(true);
      expect(reliefAtSource.available).toBe(true);
      if (!(salarySacrifice.available && netPay.available && reliefAtSource.available)) {
        return;
      }
      expect(salarySacrifice.components.grossCashPayPence).toBe(
        netPay.components.grossCashPayPence - 120_000,
      );
      expect(salarySacrifice.components.taxablePayPence).toBe(
        netPay.components.taxablePayPence,
      );
      expect(salarySacrifice.components.employeeNationalInsurancePence).toBeLessThanOrEqual(
        netPay.components.employeeNationalInsurancePence,
      );
      expect(reliefAtSource.components.employeeNationalInsurancePence).toBe(
        netPay.components.employeeNationalInsurancePence,
      );
      expect(reliefAtSource.components.providerTaxReliefPence).toBe(24_000);
    },
  );

  it("applies NI thresholds to a bonus in its actual pay period", () => {
    const concentratedBonus = calculateHistoricalSalary({
      ...request,
      contractualGrossPayPence: 6_000_000,
      nationalInsurancePeriods: {
        payPeriod: "monthly",
        postSacrificeEarningsPence: [
          2_700_000,
          ...Array.from({ length: 11 }, () => 300_000),
        ],
      },
      pension: null,
    });
    const smoothedBonus = calculateHistoricalSalary({
      ...request,
      contractualGrossPayPence: 6_000_000,
      nationalInsurancePeriods: {
        payPeriod: "monthly",
        postSacrificeEarningsPence: Array.from(
          { length: 12 },
          () => 500_000,
        ),
      },
      pension: null,
    });

    expect(
      concentratedBonus.available &&
        concentratedBonus.components.employeeNationalInsurancePence,
    ).toBeLessThan(
      smoothedBonus.available
        ? smoothedBonus.components.employeeNationalInsurancePence
        : 0,
    );
  });

  it("extends the Scottish basic band for relief-at-source contributions", () => {
    const result = calculateHistoricalSalary({
      ...request,
      jurisdiction: "scotland",
      pension: {
        method: "relief-at-source",
        employeeGrossContributionPence: 600_000,
        employeeCashDeductionPence: 480_000,
        salarySacrificePence: 0,
        employerContributionPence: 0,
        providerTaxReliefPence: 120_000,
      },
    });

    expect(result.available && result.components.incomeTaxPence).toBe(
      1_189_380,
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
      calculationVersion: "historical-salary-v2",
      engineVersion: "3.0.1",
      ruleDatasetVersion: "2026.10.4",
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
