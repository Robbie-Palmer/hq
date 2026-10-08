import type {
  CalculationComponents,
  ValidationCorpus,
  ValidationFixture,
} from "./validation";

const annualPayroll = (overrides: Partial<ValidationFixture["input"]["payroll"]> = {}) => ({
  frequency: "annual" as const,
  periodNumber: null,
  taxCode: null,
  taxBasis: null,
  priorGrossPayPence: null,
  priorIncomeTaxPence: null,
  nationalInsuranceCategory: "A",
  employmentStartDate: "2025-04-06",
  employmentEndDate: "2026-04-05",
  jobChangedDuringTaxYear: false,
  ...overrides,
});

const exactPayroll = (
  overrides: Partial<ValidationFixture["input"]["payroll"]> = {},
) => ({
  frequency: "monthly" as const,
  periodNumber: 1,
  taxCode: "BR",
  taxBasis: "non-cumulative" as const,
  priorGrossPayPence: 0,
  priorIncomeTaxPence: 0,
  nationalInsuranceCategory: "A",
  employmentStartDate: "2026-04-06",
  employmentEndDate: null,
  jobChangedDuringTaxYear: false,
  ...overrides,
});

const components = (
  values: Partial<CalculationComponents> & {
    grossCashPayPence: number;
    taxablePayPence: number;
    incomeTaxPence: number;
    employeeNationalInsurancePence: number;
    takeHomePayPence: number;
  },
): CalculationComponents => ({
  memberPensionDeductionPence: 0,
  employerPensionContributionPence: 0,
  providerTaxReliefPence: 0,
  ...values,
});

type FixtureInput = ValidationFixture["input"];

const fixtureInput = (
  pay: Omit<FixtureInput, "payroll" | "pension">,
  payroll: FixtureInput["payroll"],
  pension: FixtureInput["pension"] = null,
): FixtureInput => ({ ...pay, payroll, pension });

const annualRounding = [
  {
    component: "incomeTaxPence" as const,
    rule: "Annual liability is rounded to whole pence after each tax band is applied.",
  },
  {
    component: "employeeNationalInsurancePence" as const,
    rule: "Annual NI is an estimate using twelve monthly threshold periods, not payslip reconciliation.",
  },
];

const exactRounding = [
  {
    component: "taxablePayPence" as const,
    rule: "HMRC PAYE routine v24.0 rounds taxable pay down to the whole pound before applying tax rates.",
  },
  {
    component: "incomeTaxPence" as const,
    rule: "HMRC PAYE routine v24.0 calculates to four decimal places of a pound, then rounds down to the penny.",
  },
  {
    component: "employeeNationalInsurancePence" as const,
    rule: "The exact-percentage NI result is rounded to the nearest penny for this fixture; inputs avoid half-penny ties.",
  },
];

const annualSources = [
  { sourceId: "hmrc-employer-rates", locator: "2025/26 Income Tax and category A NI rates" },
];
const pensionSources = [
  ...annualSources,
  { sourceId: "hmrc-workplace-pension-methods", locator: "Net pay and relief at source" },
  { sourceId: "hmrc-salary-sacrifice", locator: "Pension salary-sacrifice example" },
];
const payrollSources = [
  { sourceId: "hmrc-paye-routine-v24", locator: "Sections 4, 5, 8 and 9" },
  { sourceId: "hmrc-ca38-2026", locator: "Category A weekly and monthly exact-percentage rates" },
];

export const validationCorpus = {
  corpusVersion: "2026.10.3",
  libraryVersion: "finance-tax-rules@0.1.0",
  ruleDatasetVersion: "2026.10.3",
  calculationContractVersion: "salary-validation-v1",
  releasedAt: "2026-10-02",
  syntheticDataOnly: true,
  sources: [
    {
      id: "hmrc-employer-rates",
      title: "Rates and thresholds for employers 2025 to 2026",
      publisher: "HM Revenue & Customs",
      url: "https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2025-to-2026",
      retrievedAt: "2026-10-02",
      snapshotPath: "source-snapshots/employer-2025-26.md",
    },
    {
      id: "hmrc-employer-rates-2023",
      title: "Rates and thresholds for employers 2023 to 2024",
      publisher: "HM Revenue & Customs",
      url: "https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2023-to-2024",
      retrievedAt: "2026-10-02",
      snapshotPath: "source-snapshots/employer-2023-24.md",
    },
    {
      id: "hmrc-paye-routine-v24",
      title: "Specification for PAYE tax table routines version 24.0",
      publisher: "HM Revenue & Customs",
      url: "https://www.gov.uk/government/publications/payroll-technical-specifications-income-tax",
      retrievedAt: "2026-10-02",
      snapshotPath: "source-snapshots/paye-tax-table-routine-v24.md",
    },
    {
      id: "hmrc-ca38-2026",
      title: "National Insurance contributions tables 6 April 2026 to 5 April 2027",
      publisher: "HM Revenue & Customs",
      url: "https://www.gov.uk/government/publications/ca38-national-insurance-contributions-tables-a-and-j",
      retrievedAt: "2026-10-02",
      snapshotPath: "source-snapshots/ca38-2026-27.md",
    },
    {
      id: "hmrc-workplace-pension-methods",
      title: "Workplace pensions: managing your pension",
      publisher: "GOV.UK",
      url: "https://www.gov.uk/workplace-pensions/managing-your-pension",
      retrievedAt: "2026-10-02",
      snapshotPath: "source-snapshots/workplace-pension-methods.md",
    },
    {
      id: "hmrc-salary-sacrifice",
      title: "Salary sacrifice for employers",
      publisher: "HM Revenue & Customs",
      url: "https://www.gov.uk/guidance/salary-sacrifice-and-the-effects-on-paye",
      retrievedAt: "2026-10-02",
      snapshotPath: "source-snapshots/salary-sacrifice.md",
    },
  ],
  fixtures: [
    {
      id: "annual-england-basic-band-ceiling",
      description: "Annual England salary at the basic-rate band ceiling.",
      taxYear: "2025-26",
      jurisdiction: "england-and-northern-ireland",
      effectiveDate: "2025-06-30",
      coverage: ["tax-band-boundary"],
      sources: annualSources,
      input: fixtureInput({
        contractualGrossPayPence: 5_027_000,
        cashPayPence: 5_027_000,
        taxablePayPence: 3_770_000,
        nationalInsuranceEarningsPence: 5_027_000,
      }, annualPayroll()),
      expected: {
        supported: true,
        precision: "annual-liability-estimate",
        components: components({
          grossCashPayPence: 5_027_000,
          taxablePayPence: 3_770_000,
          incomeTaxPence: 754_000,
          employeeNationalInsurancePence: 301_540,
          takeHomePayPence: 3_971_460,
        }),
        rounding: annualRounding,
      },
    },
    {
      id: "annual-personal-allowance-taper",
      description: "Annual England salary inside the Personal Allowance taper.",
      taxYear: "2025-26",
      jurisdiction: "england-and-northern-ireland",
      effectiveDate: "2025-06-30",
      coverage: ["allowance-taper"],
      sources: annualSources,
      input: fixtureInput({
        contractualGrossPayPence: 11_000_000,
        cashPayPence: 11_000_000,
        taxablePayPence: 10_243_000,
        nationalInsuranceEarningsPence: 11_000_000,
      }, annualPayroll()),
      expected: {
        supported: true,
        precision: "annual-liability-estimate",
        components: components({
          grossCashPayPence: 11_000_000,
          taxablePayPence: 10_243_000,
          incomeTaxPence: 3_343_200,
          employeeNationalInsurancePence: 421_000,
          takeHomePayPence: 7_235_800,
        }),
        rounding: annualRounding,
      },
    },
    {
      id: "annual-scotland-bands",
      description: "Annual Scottish salary spanning starter through higher rates.",
      taxYear: "2025-26",
      jurisdiction: "scotland",
      effectiveDate: "2025-06-30",
      coverage: ["scottish-rates"],
      sources: annualSources,
      input: fixtureInput({
        contractualGrossPayPence: 5_000_000,
        cashPayPence: 5_000_000,
        taxablePayPence: 3_743_000,
        nationalInsuranceEarningsPence: 5_000_000,
      }, annualPayroll()),
      expected: {
        supported: true,
        precision: "annual-liability-estimate",
        components: components({
          grossCashPayPence: 5_000_000,
          taxablePayPence: 3_743_000,
          incomeTaxPence: 901_380,
          employeeNationalInsurancePence: 299_392,
          takeHomePayPence: 3_799_228,
        }),
        rounding: annualRounding,
      },
    },
    {
      id: "annual-pension-salary-sacrifice",
      description: "A £6,000 salary exchange becomes an employer pension contribution.",
      taxYear: "2025-26",
      jurisdiction: "england-and-northern-ireland",
      effectiveDate: "2025-06-30",
      coverage: ["salary-sacrifice", "employer-and-employee-pension-contributions"],
      sources: pensionSources,
      input: fixtureInput({
        contractualGrossPayPence: 6_000_000,
        cashPayPence: 5_400_000,
        taxablePayPence: 4_143_000,
        nationalInsuranceEarningsPence: 5_400_000,
      }, annualPayroll(), {
          method: "salary-sacrifice",
          grossContributionPence: 600_000,
          memberDeductionPence: 0,
          employerContributionPence: 600_000,
          providerTaxReliefPence: 0,
      }),
      expected: {
        supported: true,
        precision: "annual-liability-estimate",
        components: components({
          grossCashPayPence: 5_400_000,
          taxablePayPence: 4_143_000,
          incomeTaxPence: 903_200,
          employeeNationalInsurancePence: 309_000,
          employerPensionContributionPence: 600_000,
          takeHomePayPence: 4_187_800,
        }),
        rounding: annualRounding,
      },
    },
    {
      id: "annual-pension-net-pay",
      description: "A £6,000 member contribution reduces taxable pay but not NI earnings.",
      taxYear: "2025-26",
      jurisdiction: "england-and-northern-ireland",
      effectiveDate: "2025-06-30",
      coverage: ["net-pay", "employer-and-employee-pension-contributions"],
      sources: pensionSources,
      input: fixtureInput({
        contractualGrossPayPence: 6_000_000,
        cashPayPence: 6_000_000,
        taxablePayPence: 4_143_000,
        nationalInsuranceEarningsPence: 6_000_000,
      }, annualPayroll(), {
          method: "net-pay",
          grossContributionPence: 600_000,
          memberDeductionPence: 600_000,
          employerContributionPence: 0,
          providerTaxReliefPence: 0,
      }),
      expected: {
        supported: true,
        precision: "annual-liability-estimate",
        components: components({
          grossCashPayPence: 6_000_000,
          taxablePayPence: 4_143_000,
          incomeTaxPence: 903_200,
          employeeNationalInsurancePence: 321_000,
          memberPensionDeductionPence: 600_000,
          takeHomePayPence: 4_175_800,
        }),
        rounding: annualRounding,
      },
    },
    {
      id: "annual-pension-relief-at-source",
      description: "A £4,800 member payment receives £1,200 provider relief.",
      taxYear: "2025-26",
      jurisdiction: "england-and-northern-ireland",
      effectiveDate: "2025-06-30",
      coverage: ["relief-at-source", "employer-and-employee-pension-contributions"],
      sources: pensionSources,
      input: fixtureInput({
        contractualGrossPayPence: 6_000_000,
        cashPayPence: 6_000_000,
        taxablePayPence: 4_743_000,
        nationalInsuranceEarningsPence: 6_000_000,
      }, annualPayroll(), {
          method: "relief-at-source",
          grossContributionPence: 600_000,
          memberDeductionPence: 480_000,
          employerContributionPence: 0,
          providerTaxReliefPence: 120_000,
      }),
      expected: {
        supported: true,
        precision: "annual-liability-estimate",
        components: components({
          grossCashPayPence: 6_000_000,
          taxablePayPence: 4_743_000,
          incomeTaxPence: 1_023_200,
          employeeNationalInsurancePence: 321_000,
          memberPensionDeductionPence: 480_000,
          providerTaxReliefPence: 120_000,
          takeHomePayPence: 4_175_800,
        }),
        rounding: annualRounding,
      },
    },
    {
      id: "payroll-monthly-br",
      description: "Month 1 BR payroll with category A NI.",
      taxYear: "2026-27",
      jurisdiction: "england-and-northern-ireland",
      effectiveDate: "2026-04-30",
      coverage: ["pay-frequency", "non-cumulative-paye", "tax-code", "hmrc-rounding"],
      sources: payrollSources,
      input: fixtureInput({
        contractualGrossPayPence: 300_000,
        cashPayPence: 300_000,
        taxablePayPence: 300_000,
        nationalInsuranceEarningsPence: 300_000,
      }, exactPayroll()),
      expected: {
        supported: true,
        precision: "exact-payroll-deduction",
        components: components({
          grossCashPayPence: 300_000,
          taxablePayPence: 300_000,
          incomeTaxPence: 60_000,
          employeeNationalInsurancePence: 15_616,
          takeHomePayPence: 224_384,
        }),
        rounding: exactRounding,
      },
    },
    {
      id: "payroll-weekly-br",
      description: "Week 1 BR payroll with category A NI.",
      taxYear: "2026-27",
      jurisdiction: "england-and-northern-ireland",
      effectiveDate: "2026-04-10",
      coverage: ["pay-frequency", "non-cumulative-paye", "tax-code", "hmrc-rounding"],
      sources: payrollSources,
      input: fixtureInput({
        contractualGrossPayPence: 50_000,
        cashPayPence: 50_000,
        taxablePayPence: 50_000,
        nationalInsuranceEarningsPence: 50_000,
      }, exactPayroll({ frequency: "weekly", periodNumber: 1 })),
      expected: {
        supported: true,
        precision: "exact-payroll-deduction",
        components: components({
          grossCashPayPence: 50_000,
          taxablePayPence: 50_000,
          incomeTaxPence: 10_000,
          employeeNationalInsurancePence: 2_064,
          takeHomePayPence: 37_936,
        }),
        rounding: exactRounding,
      },
    },
    {
      id: "payroll-cumulative-1257l-month-one",
      description: "Month 1 cumulative 1257L establishes prior pay and tax state.",
      taxYear: "2026-27",
      jurisdiction: "england-and-northern-ireland",
      effectiveDate: "2026-04-30",
      coverage: ["cumulative-paye", "tax-code", "hmrc-rounding"],
      sources: payrollSources,
      input: fixtureInput({
        contractualGrossPayPence: 200_000,
        cashPayPence: 200_000,
        taxablePayPence: 95_100,
        nationalInsuranceEarningsPence: 200_000,
      }, exactPayroll({ taxCode: "1257L", taxBasis: "cumulative" })),
      expected: {
        supported: true,
        precision: "exact-payroll-deduction",
        components: components({
          grossCashPayPence: 200_000,
          taxablePayPence: 95_100,
          incomeTaxPence: 19_020,
          employeeNationalInsurancePence: 7_616,
          takeHomePayPence: 173_364,
        }),
        rounding: exactRounding,
      },
    },
    {
      id: "payroll-cumulative-1257l-bonus",
      description: "Month 2 cumulative 1257L includes a £5,000 bonus after a £2,000 first month.",
      taxYear: "2026-27",
      jurisdiction: "england-and-northern-ireland",
      effectiveDate: "2026-05-31",
      coverage: ["bonus", "cumulative-paye", "tax-code", "hmrc-rounding"],
      sources: payrollSources,
      input: fixtureInput({
        contractualGrossPayPence: 500_000,
        cashPayPence: 500_000,
        taxablePayPence: 395_200,
        nationalInsuranceEarningsPence: 500_000,
      }, exactPayroll({
          periodNumber: 2,
          taxCode: "1257L",
          taxBasis: "cumulative",
          priorGrossPayPence: 200_000,
          priorIncomeTaxPence: 19_020,
      })),
      expected: {
        supported: true,
        precision: "exact-payroll-deduction",
        components: components({
          grossCashPayPence: 500_000,
          taxablePayPence: 395_200,
          incomeTaxPence: 79_040,
          employeeNationalInsurancePence: 26_750,
          takeHomePayPence: 394_210,
        }),
        rounding: exactRounding,
      },
    },
    {
      id: "payroll-non-cumulative-1257l-bonus",
      description: "Month 2 1257L on a Month 1 basis treats the £5,000 payment alone.",
      taxYear: "2026-27",
      jurisdiction: "england-and-northern-ireland",
      effectiveDate: "2026-05-31",
      coverage: ["bonus", "non-cumulative-paye", "tax-code", "hmrc-rounding"],
      sources: payrollSources,
      input: fixtureInput({
        contractualGrossPayPence: 500_000,
        cashPayPence: 500_000,
        taxablePayPence: 395_100,
        nationalInsuranceEarningsPence: 500_000,
      }, exactPayroll({ periodNumber: 2, taxCode: "1257L" })),
      expected: {
        supported: true,
        precision: "exact-payroll-deduction",
        components: components({
          grossCashPayPence: 500_000,
          taxablePayPence: 395_100,
          incomeTaxPence: 79_020,
          employeeNationalInsurancePence: 26_750,
          takeHomePayPence: 394_230,
        }),
        rounding: exactRounding,
      },
    },
    {
      id: "payroll-job-change-with-prior-state",
      description: "A cumulative BR calculation preserves prior pay and tax after a job change.",
      taxYear: "2026-27",
      jurisdiction: "england-and-northern-ireland",
      effectiveDate: "2026-10-31",
      coverage: ["job-change", "partial-year", "cumulative-paye", "tax-code"],
      sources: payrollSources,
      input: fixtureInput({
        contractualGrossPayPence: 300_000,
        cashPayPence: 300_000,
        taxablePayPence: 300_000,
        nationalInsuranceEarningsPence: 300_000,
      }, exactPayroll({
          periodNumber: 7,
          taxBasis: "cumulative",
          priorGrossPayPence: 1_800_500,
          priorIncomeTaxPence: 360_100,
          employmentStartDate: "2026-10-01",
          jobChangedDuringTaxYear: true,
      })),
      expected: {
        supported: true,
        precision: "exact-payroll-deduction",
        components: components({
          grossCashPayPence: 300_000,
          taxablePayPence: 300_000,
          incomeTaxPence: 60_000,
          employeeNationalInsurancePence: 15_616,
          takeHomePayPence: 224_384,
        }),
        rounding: exactRounding,
      },
    },
    {
      id: "payroll-ni-rate-before-january-2024-cut",
      description: "December 2023 category A NI uses the 12% main rate.",
      taxYear: "2023-24",
      jurisdiction: "england-and-northern-ireland",
      effectiveDate: "2023-12-31",
      coverage: ["national-insurance-within-year-change"],
      sources: [
        { sourceId: "hmrc-employer-rates-2023", locator: "Employee NI rates through 5 January 2024" },
      ],
      input: fixtureInput({
        contractualGrossPayPence: 300_000,
        cashPayPence: 300_000,
        taxablePayPence: 300_000,
        nationalInsuranceEarningsPence: 300_000,
      }, exactPayroll({ employmentStartDate: "2023-04-06" })),
      expected: {
        supported: true,
        precision: "exact-payroll-deduction",
        components: components({
          grossCashPayPence: 300_000,
          taxablePayPence: 300_000,
          incomeTaxPence: 60_000,
          employeeNationalInsurancePence: 23_424,
          takeHomePayPence: 216_576,
        }),
        rounding: exactRounding,
      },
    },
    {
      id: "payroll-ni-rate-after-january-2024-cut",
      description: "January 2024 category A NI uses the 10% main rate.",
      taxYear: "2023-24",
      jurisdiction: "england-and-northern-ireland",
      effectiveDate: "2024-01-31",
      coverage: ["national-insurance-within-year-change"],
      sources: [
        { sourceId: "hmrc-employer-rates-2023", locator: "Employee NI rates from 6 January 2024" },
      ],
      input: fixtureInput({
        contractualGrossPayPence: 300_000,
        cashPayPence: 300_000,
        taxablePayPence: 300_000,
        nationalInsuranceEarningsPence: 300_000,
      }, exactPayroll({ employmentStartDate: "2023-04-06" })),
      expected: {
        supported: true,
        precision: "exact-payroll-deduction",
        components: components({
          grossCashPayPence: 300_000,
          taxablePayPence: 300_000,
          incomeTaxPence: 60_000,
          employeeNationalInsurancePence: 19_520,
          takeHomePayPence: 220_480,
        }),
        rounding: exactRounding,
      },
    },
    {
      id: "unsupported-ni-category-b",
      description: "Category B must fail because the pinned rules support only category A.",
      taxYear: "2026-27",
      jurisdiction: "england-and-northern-ireland",
      effectiveDate: "2026-04-30",
      coverage: ["national-insurance-category", "unsupported-input"],
      sources: payrollSources,
      input: fixtureInput({
        contractualGrossPayPence: 300_000,
        cashPayPence: 300_000,
        taxablePayPence: 300_000,
        nationalInsuranceEarningsPence: 300_000,
      }, exactPayroll({ nationalInsuranceCategory: "B" })),
      expected: {
        supported: false,
        reasons: [
          {
            code: "unsupported-national-insurance-category",
            detail: "Do not substitute category A rates for a reduced-rate category.",
          },
        ],
      },
    },
    {
      id: "unsupported-job-change-without-prior-state",
      description: "A cumulative job-change payslip cannot be reconstructed without prior pay and tax.",
      taxYear: "2026-27",
      jurisdiction: "england-and-northern-ireland",
      effectiveDate: "2026-10-31",
      coverage: ["job-change", "partial-year", "cumulative-paye", "unsupported-input"],
      sources: payrollSources,
      input: fixtureInput({
        contractualGrossPayPence: 300_000,
        cashPayPence: 300_000,
        taxablePayPence: 300_000,
        nationalInsuranceEarningsPence: 300_000,
      }, exactPayroll({
          periodNumber: 7,
          taxBasis: "cumulative",
          priorGrossPayPence: null,
          priorIncomeTaxPence: null,
          employmentStartDate: "2026-10-01",
          jobChangedDuringTaxYear: true,
      })),
      expected: {
        supported: false,
        reasons: [
          {
            code: "missing-prior-payroll-state",
            detail: "Exact cumulative PAYE needs prior taxable pay and tax paid to date.",
          },
        ],
      },
    },
  ],
} satisfies ValidationCorpus;
