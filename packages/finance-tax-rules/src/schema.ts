import { z } from "zod";

export const isoDateSchema = z.iso.date();
export const taxYearSchema = z.string().regex(/^\d{4}-\d{2}$/);
export const datasetVersionSchema = z.string().regex(/^\d{4}\.\d{2}\.\d+$/);
export const moneyPenceSchema = z.number().int().nonnegative();
export const rateBasisPointsSchema = z.number().int().min(0).max(10_000);

export const jurisdictionSchema = z.enum([
  "england-and-northern-ireland",
  "scotland",
  "wales",
]);
export const payPeriodSchema = z.enum(["weekly", "monthly"]);
export const payeTaxBasisSchema = z.enum(["cumulative", "non-cumulative"]);
export const legalStatusSchema = z.enum(["enacted", "announced"]);
export const nationalInsuranceCategorySchema = z.string().regex(/^[A-Z]$/);
export const supportedNationalInsuranceCategorySchema = z.literal("A");
export const pensionContributionMethodSchema = z.enum([
  "salary-sacrifice",
  "net-pay",
  "relief-at-source",
]);

export const sourceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  publisher: z.string().min(1),
  url: z.url(),
  archiveUrl: z.url().nullable(),
  publicationDate: isoDateSchema,
  retrievalDate: isoDateSchema,
  coverageFrom: isoDateSchema,
  coverageTo: isoDateSchema.nullable(),
  sourceContentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  snapshotPath: z.string().min(1),
  licence: z.literal("Open Government Licence v3.0"),
  licenceUrl: z.literal(
    "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
  ),
  copyright: z.literal("Crown copyright"),
  attribution: z.string().min(1),
});

const provenanceSchema = z.object({
  sourceIds: z.array(z.string().min(1)).min(1),
  reviewedBy: z.string().min(1),
  reviewedAt: isoDateSchema,
  reviewNotes: z.string().min(1),
});

const baseRuleSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  taxYear: taxYearSchema,
  legalStatus: legalStatusSchema,
  effectiveFrom: isoDateSchema,
  effectiveTo: isoDateSchema,
  currency: z.literal("GBP"),
  moneyUnit: z.literal("pence"),
  rateUnit: z.literal("basis-points"),
  provenance: provenanceSchema,
});

export const incomeTaxRuleSchema = baseRuleSchema.extend({
  kind: z.literal("income-tax"),
  jurisdictions: z.array(jurisdictionSchema).min(1),
  incomeScope: z.literal("employment-non-savings-non-dividend"),
  calculationScope: z.literal("annual-liability"),
  standardPersonalAllowancePence: moneyPenceSchema,
  personalAllowanceTaper: z.object({
    adjustedNetIncomeStartsAtPence: moneyPenceSchema,
    allowanceReductionPence: moneyPenceSchema.positive(),
    perExcessIncomePence: moneyPenceSchema.positive(),
  }),
  bands: z
    .array(
      z.object({
        name: z.string().min(1),
        rateBasisPoints: rateBasisPointsSchema,
        widthPence: moneyPenceSchema.positive().nullable(),
      }),
    )
    .min(1),
});

const payPeriodValuesSchema = z.object({
  weekly: moneyPenceSchema,
  monthly: moneyPenceSchema,
});

export const nationalInsuranceRuleSchema = baseRuleSchema.extend({
  kind: z.literal("class-1-national-insurance"),
  category: supportedNationalInsuranceCategorySchema,
  employmentType: z.literal("employee-not-director"),
  thresholds: z.object({
    lowerEarningsLimitPence: payPeriodValuesSchema,
    primaryThresholdPence: payPeriodValuesSchema,
    upperEarningsLimitPence: payPeriodValuesSchema,
  }),
  rates: z.object({
    atOrBelowPrimaryThresholdBasisPoints: rateBasisPointsSchema,
    primaryToUpperBasisPoints: rateBasisPointsSchema,
    aboveUpperBasisPoints: rateBasisPointsSchema,
  }),
});

const pensionMethodSchema = z.object({
  method: pensionContributionMethodSchema,
  memberContribution: z.boolean(),
  reducesContractualCashPay: z.boolean(),
  deductedBeforeIncomeTax: z.boolean(),
  deductedBeforeEmployeeNationalInsurance: z.boolean(),
  providerReliefBasisPoints: rateBasisPointsSchema,
  furtherReliefMayRequireClaim: z.boolean(),
});

export const pensionRuleSchema = baseRuleSchema.extend({
  kind: z.literal("pension"),
  jurisdictions: z.array(jurisdictionSchema).min(1),
  reliefLimit: z.object({
    relevantUkEarningsPercent: z.literal(100),
    basicAmountPence: moneyPenceSchema,
  }),
  annualAllowancePence: moneyPenceSchema,
  taperedAnnualAllowance: z.object({
    thresholdIncomeLimitPence: moneyPenceSchema,
    adjustedIncomeLimitPence: moneyPenceSchema,
    minimumAllowancePence: moneyPenceSchema,
  }),
  moneyPurchaseAnnualAllowancePence: moneyPenceSchema,
  methods: z.array(pensionMethodSchema).length(3),
});

export const datasetSchema = z.object({
  datasetVersion: datasetVersionSchema,
  releasedAt: isoDateSchema,
  supersedes: z.string().nullable(),
  corrections: z.array(
    z.object({
      ruleId: z.string().min(1),
      description: z.string().min(1),
    }),
  ),
  dataLicence: z.object({
    name: z.literal("Open Government Licence v3.0"),
    url: z.literal(
      "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
    ),
    copyright: z.literal("Crown copyright"),
    attribution: z.string().min(1),
  }),
  sources: z.array(sourceSchema).min(1),
  incomeTax: z.array(incomeTaxRuleSchema).min(1),
  nationalInsurance: z.array(nationalInsuranceRuleSchema).min(1),
  pensions: z.array(pensionRuleSchema).min(1),
});

export type RuleDataset = z.infer<typeof datasetSchema>;
export type Jurisdiction = z.infer<typeof jurisdictionSchema>;
export type PayPeriod = z.infer<typeof payPeriodSchema>;
export type PensionContributionMethod = z.infer<
  typeof pensionContributionMethodSchema
>;
