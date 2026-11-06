import { z } from "zod";
import { IsoDateSchema, TaxYearSchema } from "./sideIncome";

export const UK_LIMITED_COMPANY_RULESET_VERSION = "2026-11-06" as const;
export const SUPPORTED_LIMITED_COMPANY_TAX_YEAR = "2026-27" as const;
export const SUPPORTED_LIMITED_COMPANY_TAX_YEARS = [
  "2025-26",
  SUPPORTED_LIMITED_COMPANY_TAX_YEAR,
] as const;

const SourceSchema = z
  .object({
    id: z.string().trim().min(1),
    title: z.string().trim().min(1),
    publisher: z.enum(["GOV.UK", "HMRC", "Companies House"]),
    url: z.url().refine((url) => {
      const host = new URL(url).hostname;
      return host === "www.gov.uk" || host.endsWith(".service.gov.uk");
    }),
    checkedOn: IsoDateSchema,
  })
  .strict();

type Source = z.input<typeof SourceSchema>;

const officialSource = (
  id: string,
  title: string,
  publisher: Source["publisher"],
  url: string,
): Source => ({ id, title, publisher, url, checkedOn: "2026-11-06" });

const sourceInputs = {
  corporationTaxRates: [
    "corporation-tax-rates",
    "Corporation Tax rates and allowances",
    "HMRC",
    "https://www.gov.uk/government/publications/rates-and-allowances-corporation-tax/rates-and-allowances-corporation-tax",
  ],
  employerRates2025: [
    "employer-rates-2025-26",
    "Rates and thresholds for employers 2025 to 2026",
    "HMRC",
    "https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2025-to-2026",
  ],
  employerRates2026: [
    "employer-rates-2026-27",
    "Rates and thresholds for employers 2026 to 2027",
    "HMRC",
    "https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027",
  ],
  employmentAllowance: [
    "employment-allowance-single-director",
    "Single-director companies and Employment Allowance",
    "HMRC",
    "https://www.gov.uk/government/publications/employment-allowance-more-detailed-guidance/single-director-companies-and-employment-allowance-further-employer-guidance",
  ],
  employerPension: [
    "employer-pension-contributions",
    "PTM024200: contributions",
    "HMRC",
    "https://www.gov.uk/hmrc-internal-manuals/pensions-tax-manual/ptm024200",
  ],
  pensionDeductibility: [
    "employer-pension-wholly-exclusive",
    "BIM46030: pension schemes and the wholly and exclusively test",
    "HMRC",
    "https://www.gov.uk/hmrc-internal-manuals/business-income-manual/bim46030",
  ],
  vatThresholds: [
    "vat-thresholds",
    "How VAT works: VAT thresholds",
    "GOV.UK",
    "https://www.gov.uk/how-vat-works/vat-thresholds",
  ],
  vatReturnDeadlines: [
    "vat-return-deadlines",
    "How to fill in and submit your VAT Return",
    "HMRC",
    "https://www.gov.uk/guidance/how-to-fill-in-and-submit-your-vat-return-vat-notice-70012",
  ],
  vatFlatRate: [
    "vat-flat-rate",
    "Flat Rate Scheme for small businesses",
    "HMRC",
    "https://www.gov.uk/guidance/flat-rate-scheme-for-small-businesses-vat-notice-733--2",
  ],
  companyAccounts: [
    "company-accounts-deadlines",
    "Accounts and tax returns for private limited companies",
    "GOV.UK",
    "https://www.gov.uk/prepare-file-annual-accounts-for-limited-company",
  ],
  payroll: [
    "running-payroll",
    "Running payroll",
    "GOV.UK",
    "https://www.gov.uk/running-payroll",
  ],
  companiesHouseFees: [
    "companies-house-fees-2026",
    "Companies House fees",
    "Companies House",
    "https://www.gov.uk/government/publications/companies-house-fees/companies-house-fees",
  ],
} as const satisfies Record<
  string,
  readonly [string, string, Source["publisher"], string]
>;

const limitedCompanySources = Object.values(sourceInputs).map(
  ([id, title, publisher, url]) =>
    officialSource(id, title, publisher, url),
);

const EffectiveRuleSchema = z
  .object({
    ruleId: z.string().trim().min(1),
    effectiveFrom: IsoDateSchema,
    effectiveTo: IsoDateSchema.nullable(),
    sourceId: z.string().trim().min(1),
  })
  .strict();

const RuleSetSchema = z
  .object({
    rulesetVersion: z.literal(UK_LIMITED_COMPANY_RULESET_VERSION),
    taxYears: z.array(TaxYearSchema).min(1),
    corporationTax: EffectiveRuleSchema.extend({
      smallProfitsRateBasisPoints: z.number().int().nonnegative(),
      mainRateBasisPoints: z.number().int().nonnegative(),
      lowerLimitPence: z.number().int().positive(),
      upperLimitPence: z.number().int().positive(),
      marginalReliefNumerator: z.number().int().positive(),
      marginalReliefDenominator: z.number().int().positive(),
    }).strict(),
    payroll: EffectiveRuleSchema.extend({
      primaryThresholdPence: z.number().int().positive(),
      upperEarningsLimitPence: z.number().int().positive(),
      employeeMainRateBasisPoints: z.number().int().nonnegative(),
      employeeAdditionalRateBasisPoints: z.number().int().nonnegative(),
      secondaryThresholdPence: z.number().int().positive(),
      employerRateBasisPoints: z.number().int().nonnegative(),
      employmentAllowancePence: z.number().int().nonnegative(),
      employmentAllowanceSourceId: z.string().trim().min(1),
    }).strict(),
    pension: EffectiveRuleSchema.extend({
      standardAnnualAllowancePence: z.number().int().positive(),
      moneyPurchaseAnnualAllowancePence: z.number().int().positive(),
      whollyAndExclusivelySourceId: z.string().trim().min(1),
    }).strict(),
    vat: EffectiveRuleSchema.extend({
      registrationThresholdPence: z.number().int().positive(),
      deregistrationThresholdPence: z.number().int().positive(),
      flatRateJoinThresholdPence: z.number().int().positive(),
      flatRateLeaveThresholdPence: z.number().int().positive(),
      cashAndAnnualJoinThresholdPence: z.number().int().positive(),
      cashAndAnnualLeaveThresholdPence: z.number().int().positive(),
      limitedCostRateBasisPoints: z.number().int().positive(),
      flatRateCapitalPurchaseMinimumPence: z.number().int().positive(),
      returnDeadlineCalendarMonths: z.number().int().positive(),
      returnDeadlineExtraDays: z.number().int().nonnegative(),
      annualReturnDeadlineCalendarMonths: z.number().int().positive(),
      returnSourceId: z.string().trim().min(1),
      flatRateSourceId: z.string().trim().min(1),
    }).strict(),
    administration: EffectiveRuleSchema.extend({
      incorporationOnlineFeePence: z.number().int().positive(),
      confirmationStatementOnlineFeePence: z.number().int().positive(),
      firstAccountsMonthsAfterIncorporation: z.number().int().positive(),
      annualAccountsMonthsAfterPeriodEnd: z.number().int().positive(),
      corporationTaxPaymentMonthsAfterPeriodEnd: z.number().int().positive(),
      corporationTaxPaymentExtraDays: z.number().int().positive(),
      companyTaxReturnMonthsAfterPeriodEnd: z.number().int().positive(),
      confirmationReviewMonths: z.number().int().positive(),
      confirmationFilingDays: z.number().int().positive(),
      payrollElectronicPaymentDay: z.number().int().positive(),
      payrollReportSourceId: z.string().trim().min(1),
      feesSourceId: z.string().trim().min(1),
    }).strict(),
    sources: z.array(SourceSchema).min(1),
  })
  .strict();

export const ukLimitedCompanyRuleSet = RuleSetSchema.parse({
  rulesetVersion: UK_LIMITED_COMPANY_RULESET_VERSION,
  taxYears: [...SUPPORTED_LIMITED_COMPANY_TAX_YEARS],
  corporationTax: {
    ruleId: "uk.company.corporation-tax.2025-27",
    effectiveFrom: "2025-04-01",
    effectiveTo: "2027-03-31",
    smallProfitsRateBasisPoints: 1_900,
    mainRateBasisPoints: 2_500,
    lowerLimitPence: 5_000_000,
    upperLimitPence: 25_000_000,
    marginalReliefNumerator: 3,
    marginalReliefDenominator: 200,
    sourceId: "corporation-tax-rates",
  },
  payroll: {
    ruleId: "uk.company.class-1-ni.2025-27",
    effectiveFrom: "2025-04-06",
    effectiveTo: "2027-04-05",
    primaryThresholdPence: 1_257_000,
    upperEarningsLimitPence: 5_027_000,
    employeeMainRateBasisPoints: 800,
    employeeAdditionalRateBasisPoints: 200,
    secondaryThresholdPence: 500_000,
    employerRateBasisPoints: 1_500,
    employmentAllowancePence: 1_050_000,
    sourceId: "employer-rates-2026-27",
    employmentAllowanceSourceId: "employment-allowance-single-director",
  },
  pension: {
    ruleId: "uk.company.employer-pension.2025-27",
    effectiveFrom: "2025-04-06",
    effectiveTo: "2027-04-05",
    standardAnnualAllowancePence: 6_000_000,
    moneyPurchaseAnnualAllowancePence: 1_000_000,
    sourceId: "employer-pension-contributions",
    whollyAndExclusivelySourceId: "employer-pension-wholly-exclusive",
  },
  vat: {
    ruleId: "uk.company.vat.2026-27",
    effectiveFrom: "2026-04-01",
    effectiveTo: null,
    registrationThresholdPence: 9_000_000,
    deregistrationThresholdPence: 8_800_000,
    flatRateJoinThresholdPence: 15_000_000,
    flatRateLeaveThresholdPence: 23_000_000,
    cashAndAnnualJoinThresholdPence: 135_000_000,
    cashAndAnnualLeaveThresholdPence: 160_000_000,
    limitedCostRateBasisPoints: 1_650,
    flatRateCapitalPurchaseMinimumPence: 200_000,
    returnDeadlineCalendarMonths: 1,
    returnDeadlineExtraDays: 7,
    annualReturnDeadlineCalendarMonths: 2,
    sourceId: "vat-thresholds",
    returnSourceId: "vat-return-deadlines",
    flatRateSourceId: "vat-flat-rate",
  },
  administration: {
    ruleId: "uk.company.administration.2026",
    effectiveFrom: "2026-02-01",
    effectiveTo: null,
    incorporationOnlineFeePence: 10_000,
    confirmationStatementOnlineFeePence: 5_000,
    firstAccountsMonthsAfterIncorporation: 21,
    annualAccountsMonthsAfterPeriodEnd: 9,
    corporationTaxPaymentMonthsAfterPeriodEnd: 9,
    corporationTaxPaymentExtraDays: 1,
    companyTaxReturnMonthsAfterPeriodEnd: 12,
    confirmationReviewMonths: 12,
    confirmationFilingDays: 14,
    payrollElectronicPaymentDay: 22,
    sourceId: "company-accounts-deadlines",
    payrollReportSourceId: "running-payroll",
    feesSourceId: "companies-house-fees-2026",
  },
  sources: limitedCompanySources,
});

export type UkLimitedCompanyRuleSet = typeof ukLimitedCompanyRuleSet;
