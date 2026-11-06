import { z } from "zod";
import { IsoDateSchema, TaxYearSchema } from "./sideIncome";

export const UK_UMBRELLA_RULESET_VERSION = "2026-11-06" as const;
export const SUPPORTED_UMBRELLA_TAX_YEARS = ["2025-26", "2026-27"] as const;

const OfficialSourceSchema = z
  .object({
    id: z.string().trim().min(1),
    title: z.string().trim().min(1),
    publisher: z.enum(["GOV.UK", "HMRC"]),
    url: z.url().refine((url) => new URL(url).hostname === "www.gov.uk"),
    checkedOn: IsoDateSchema,
  })
  .strict();

const PeriodThresholdSchema = z
  .object({ weekly: z.number().int().nonnegative(), monthly: z.number().int().nonnegative() })
  .strict();

const StudentThresholdsSchema = z
  .object({
    "plan-1": PeriodThresholdSchema,
    "plan-2": PeriodThresholdSchema,
    "plan-4": PeriodThresholdSchema,
    "plan-5": PeriodThresholdSchema.nullable(),
    postgraduate: PeriodThresholdSchema,
  })
  .strict();

const PayrollRuleSchema = z
  .object({
    ruleId: z.string().trim().min(1),
    taxYear: TaxYearSchema,
    effectiveFrom: IsoDateSchema,
    effectiveTo: IsoDateSchema,
    employerNationalInsurance: z
      .object({
        secondaryThresholdPence: PeriodThresholdSchema,
        rateBasisPoints: z.number().int().nonnegative(),
      })
      .strict(),
    studentLoans: z
      .object({
        thresholdsPence: StudentThresholdsSchema,
        standardRateBasisPoints: z.number().int().nonnegative(),
        postgraduateRateBasisPoints: z.number().int().nonnegative(),
      })
      .strict(),
    sourceId: z.string().trim().min(1),
  })
  .strict();

const MinimumWageRuleSchema = z
  .object({
    ruleId: z.string().trim().min(1),
    effectiveFrom: IsoDateSchema,
    effectiveTo: IsoDateSchema,
    hourlyRatesPence: z
      .object({
        "age-21-and-over": z.number().int().positive(),
        "age-18-to-20": z.number().int().positive(),
        "under-18": z.number().int().positive(),
        apprentice: z.number().int().positive(),
      })
      .strict(),
    sourceId: z.string().trim().min(1),
  })
  .strict();

const UmbrellaRuleSetSchema = z
  .object({
    rulesetVersion: z.literal(UK_UMBRELLA_RULESET_VERSION),
    taxYears: z.array(TaxYearSchema),
    payroll: z.array(PayrollRuleSchema),
    minimumWage: z.array(MinimumWageRuleSchema),
    apprenticeshipLevy: z
      .object({
        ruleId: z.string().trim().min(1),
        effectiveFrom: IsoDateSchema,
        effectiveTo: IsoDateSchema.nullable(),
        rateBasisPoints: z.number().int().nonnegative(),
        annualPayBillThresholdPence: z.number().int().positive(),
        annualAllowancePence: z.number().int().positive(),
        sourceId: z.string().trim().min(1),
      })
      .strict(),
    holidayPay: z
      .object({
        ruleId: z.string().trim().min(1),
        effectiveFrom: IsoDateSchema,
        effectiveTo: IsoDateSchema.nullable(),
        statutoryRolledUpRateBasisPoints: z.number().int().positive(),
        eligibleWorkerPatterns: z.array(z.enum(["irregular-hours", "part-year"])),
        sourceId: z.string().trim().min(1),
      })
      .strict(),
    sources: z.array(OfficialSourceSchema).min(1),
  })
  .strict();

export const ukUmbrellaRuleSet = UmbrellaRuleSetSchema.parse({
  rulesetVersion: UK_UMBRELLA_RULESET_VERSION,
  taxYears: [...SUPPORTED_UMBRELLA_TAX_YEARS],
  payroll: [
    {
      ruleId: "uk.umbrella.payroll.2025-26",
      taxYear: "2025-26",
      effectiveFrom: "2025-04-06",
      effectiveTo: "2026-04-05",
      employerNationalInsurance: {
        secondaryThresholdPence: { weekly: 9_600, monthly: 41_700 },
        rateBasisPoints: 1_500,
      },
      studentLoans: {
        thresholdsPence: {
          "plan-1": { weekly: 50_125, monthly: 217_208 },
          "plan-2": { weekly: 54_750, monthly: 237_250 },
          "plan-4": { weekly: 62_971, monthly: 272_875 },
          "plan-5": null,
          postgraduate: { weekly: 40_384, monthly: 175_000 },
        },
        standardRateBasisPoints: 900,
        postgraduateRateBasisPoints: 600,
      },
      sourceId: "employer-rates-2025-26",
    },
    {
      ruleId: "uk.umbrella.payroll.2026-27",
      taxYear: "2026-27",
      effectiveFrom: "2026-04-06",
      effectiveTo: "2027-04-05",
      employerNationalInsurance: {
        secondaryThresholdPence: { weekly: 9_600, monthly: 41_700 },
        rateBasisPoints: 1_500,
      },
      studentLoans: {
        thresholdsPence: {
          "plan-1": { weekly: 51_730, monthly: 224_166 },
          "plan-2": { weekly: 56_509, monthly: 244_875 },
          "plan-4": { weekly: 64_990, monthly: 281_625 },
          "plan-5": { weekly: 48_076, monthly: 208_333 },
          postgraduate: { weekly: 40_384, monthly: 175_000 },
        },
        standardRateBasisPoints: 900,
        postgraduateRateBasisPoints: 600,
      },
      sourceId: "employer-rates-2026-27",
    },
  ],
  minimumWage: [
    {
      ruleId: "uk.minimum-wage.2025-04-01",
      effectiveFrom: "2025-04-01",
      effectiveTo: "2026-03-31",
      hourlyRatesPence: {
        "age-21-and-over": 1_221,
        "age-18-to-20": 1_000,
        "under-18": 755,
        apprentice: 755,
      },
      sourceId: "minimum-wage-rates",
    },
    {
      ruleId: "uk.minimum-wage.2026-04-01",
      effectiveFrom: "2026-04-01",
      effectiveTo: "2027-03-31",
      hourlyRatesPence: {
        "age-21-and-over": 1_271,
        "age-18-to-20": 1_085,
        "under-18": 800,
        apprentice: 800,
      },
      sourceId: "minimum-wage-rates",
    },
  ],
  apprenticeshipLevy: {
    ruleId: "uk.apprenticeship-levy.current",
    effectiveFrom: "2017-04-06",
    effectiveTo: null,
    rateBasisPoints: 50,
    annualPayBillThresholdPence: 300_000_000,
    annualAllowancePence: 1_500_000,
    sourceId: "apprenticeship-levy",
  },
  holidayPay: {
    ruleId: "uk.rolled-up-holiday-pay.2024-04-01",
    effectiveFrom: "2024-04-01",
    effectiveTo: null,
    statutoryRolledUpRateBasisPoints: 1_207,
    eligibleWorkerPatterns: ["irregular-hours", "part-year"],
    sourceId: "holiday-pay-reforms-2024",
  },
  sources: [
    {
      id: "umbrella-guidance",
      title: "Working through an umbrella company",
      publisher: "HMRC",
      url: "https://www.gov.uk/guidance/working-through-an-umbrella-company",
      checkedOn: "2026-11-06",
    },
    {
      id: "employer-rates-2025-26",
      title: "Rates and thresholds for employers 2025 to 2026",
      publisher: "HMRC",
      url: "https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2025-to-2026",
      checkedOn: "2026-11-06",
    },
    {
      id: "employer-rates-2026-27",
      title: "Rates and thresholds for employers 2026 to 2027",
      publisher: "HMRC",
      url: "https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027",
      checkedOn: "2026-11-06",
    },
    {
      id: "apprenticeship-levy",
      title: "Pay Apprenticeship Levy",
      publisher: "HMRC",
      url: "https://www.gov.uk/guidance/pay-apprenticeship-levy",
      checkedOn: "2026-11-06",
    },
    {
      id: "holiday-pay-reforms-2024",
      title: "Holiday pay and entitlement reforms from 1 January 2024",
      publisher: "GOV.UK",
      url: "https://www.gov.uk/government/publications/simplifying-holiday-entitlement-and-holiday-pay-calculations/holiday-pay-and-entitlement-reforms-from-1-january-2024",
      checkedOn: "2026-11-06",
    },
    {
      id: "minimum-wage-rates",
      title: "National Minimum Wage and National Living Wage rates",
      publisher: "GOV.UK",
      url: "https://www.gov.uk/national-minimum-wage-rates",
      checkedOn: "2026-11-06",
    },
  ],
});

export type UmbrellaPayPeriod = "weekly" | "monthly";
export type MinimumWageCategory = keyof (typeof ukUmbrellaRuleSet.minimumWage)[number]["hourlyRatesPence"];

export function resolveUmbrellaPayrollRule(taxYear: string, effectiveDate: string) {
  return ukUmbrellaRuleSet.payroll.find(
    (rule) =>
      rule.taxYear === taxYear &&
      rule.effectiveFrom <= effectiveDate &&
      effectiveDate <= rule.effectiveTo,
  );
}

export function resolveMinimumWageRule(effectiveDate: string) {
  return ukUmbrellaRuleSet.minimumWage.find(
    (rule) => rule.effectiveFrom <= effectiveDate && effectiveDate <= rule.effectiveTo,
  );
}

export type UkUmbrellaRuleSet = typeof ukUmbrellaRuleSet;
