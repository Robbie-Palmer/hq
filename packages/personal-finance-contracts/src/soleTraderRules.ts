import { z } from "zod";
import { IsoDateSchema, TaxYearSchema } from "./sideIncome";

export const UK_SOLE_TRADER_RULESET_VERSION = "2026-10-31" as const;
export const SUPPORTED_SOLE_TRADER_TAX_YEAR = "2026-27" as const;

const SoleTraderSourceSchema = z
  .object({
    id: z.string().trim().min(1),
    title: z.string().trim().min(1),
    publisher: z.literal("GOV.UK"),
    url: z.url().refine((url) => new URL(url).hostname === "www.gov.uk"),
    checkedOn: IsoDateSchema,
  })
  .strict();

const SoleTraderRuleSetSchema = z
  .object({
    rulesetVersion: z.literal(UK_SOLE_TRADER_RULESET_VERSION),
    taxYear: TaxYearSchema,
    class4NationalInsurance: z
      .object({
        ruleId: z.string(),
        lowerProfitsLimitPence: z.number().int().nonnegative(),
        upperProfitsLimitPence: z.number().int().positive(),
        mainRateBasisPoints: z.number().int().nonnegative(),
        additionalRateBasisPoints: z.number().int().nonnegative(),
        smallProfitsThresholdPence: z.number().int().nonnegative(),
        sourceId: z.string(),
      })
      .strict(),
    studentLoans: z
      .object({
        ruleId: z.string(),
        standardRateBasisPoints: z.number().int().nonnegative(),
        postgraduateRateBasisPoints: z.number().int().nonnegative(),
        thresholdsPence: z
          .object({
            "plan-1": z.number().int().positive(),
            "plan-2": z.number().int().positive(),
            "plan-4": z.number().int().positive(),
            "plan-5": z.number().int().positive(),
            postgraduate: z.number().int().positive(),
          })
          .strict(),
        sourceId: z.string(),
      })
      .strict(),
    paymentsOnAccount: z
      .object({
        ruleId: z.string(),
        minimumRelevantAmountPence: z.number().int().positive(),
        minimumRelevantShareBasisPoints: z.number().int().positive(),
        instalmentShareBasisPoints: z.number().int().positive(),
        sourceId: z.string(),
      })
      .strict(),
    deadlines: z
      .object({
        ruleId: z.string(),
        sourceId: z.string(),
      })
      .strict(),
    sources: z.array(SoleTraderSourceSchema).min(1),
  })
  .strict();

export const ukSoleTraderRuleSet = SoleTraderRuleSetSchema.parse({
  rulesetVersion: UK_SOLE_TRADER_RULESET_VERSION,
  taxYear: SUPPORTED_SOLE_TRADER_TAX_YEAR,
  class4NationalInsurance: {
    ruleId: "uk.sole-trader.class-4-ni.2026-27",
    lowerProfitsLimitPence: 1_257_000,
    upperProfitsLimitPence: 5_027_000,
    mainRateBasisPoints: 600,
    additionalRateBasisPoints: 200,
    smallProfitsThresholdPence: 710_500,
    sourceId: "self-employed-national-insurance-rates",
  },
  studentLoans: {
    ruleId: "uk.sole-trader.student-loans.2026-27",
    standardRateBasisPoints: 900,
    postgraduateRateBasisPoints: 600,
    thresholdsPence: {
      "plan-1": 2_690_000,
      "plan-2": 2_938_500,
      "plan-4": 3_379_500,
      "plan-5": 2_500_000,
      postgraduate: 2_100_000,
    },
    sourceId: "student-loans-in-tax-return",
  },
  paymentsOnAccount: {
    ruleId: "uk.sole-trader.payments-on-account",
    minimumRelevantAmountPence: 100_000,
    minimumRelevantShareBasisPoints: 2_000,
    instalmentShareBasisPoints: 5_000,
    sourceId: "payments-on-account",
  },
  deadlines: {
    ruleId: "uk.sole-trader.self-assessment-deadlines",
    sourceId: "self-assessment-deadlines",
  },
  sources: [
    {
      id: "self-employed-national-insurance-rates",
      title: "Self-employed National Insurance rates",
      publisher: "GOV.UK",
      url: "https://www.gov.uk/self-employed-national-insurance-rates",
      checkedOn: "2026-10-31",
    },
    {
      id: "student-loans-in-tax-return",
      title: "Tell HMRC about a student or postgraduate loan in your tax return",
      publisher: "GOV.UK",
      url: "https://www.gov.uk/guidance/tell-hmrc-about-a-student-loan-in-your-tax-return",
      checkedOn: "2026-10-31",
    },
    {
      id: "student-loan-rates-2026-27",
      title: "Rates and thresholds for employers 2026 to 2027",
      publisher: "GOV.UK",
      url: "https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027",
      checkedOn: "2026-10-31",
    },
    {
      id: "payments-on-account",
      title: "Understand your Self Assessment tax bill: Payments on account",
      publisher: "GOV.UK",
      url: "https://www.gov.uk/understand-self-assessment-bill/payments-on-account",
      checkedOn: "2026-10-31",
    },
    {
      id: "self-assessment-deadlines",
      title: "Self Assessment tax returns: Deadlines",
      publisher: "GOV.UK",
      url: "https://www.gov.uk/self-assessment-tax-returns/deadlines",
      checkedOn: "2026-10-31",
    },
  ],
});

export type StandardStudentLoanPlan =
  | "plan-1"
  | "plan-2"
  | "plan-4"
  | "plan-5";
