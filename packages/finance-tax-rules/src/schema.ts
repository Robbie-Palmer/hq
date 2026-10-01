import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().int().nonnegative();
const rate = z.number().int().min(0).max(10_000);

export const jurisdictionSchema = z.enum([
  "england-and-northern-ireland",
  "scotland",
  "wales",
]);
export const payPeriodSchema = z.enum(["weekly", "monthly"]);
export const legalStatusSchema = z.enum(["enacted", "announced"]);

export const sourceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  publisher: z.string().min(1),
  url: z.string().url(),
  archiveUrl: z.string().url().nullable(),
  publicationDate: isoDate,
  retrievalDate: isoDate,
  coverageFrom: isoDate,
  coverageTo: isoDate.nullable(),
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
  reviewedAt: isoDate,
  reviewNotes: z.string().min(1),
});

const baseRuleSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  taxYear: z.string().regex(/^\d{4}-\d{2}$/),
  legalStatus: legalStatusSchema,
  effectiveFrom: isoDate,
  effectiveTo: isoDate,
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
  standardPersonalAllowancePence: money,
  personalAllowanceTaper: z.object({
    adjustedNetIncomeStartsAtPence: money,
    allowanceReductionPence: money.positive(),
    perExcessIncomePence: money.positive(),
  }),
  bands: z
    .array(
      z.object({
        name: z.string().min(1),
        rateBasisPoints: rate,
        widthPence: money.positive().nullable(),
      }),
    )
    .min(1),
});

const payPeriodValuesSchema = z.object({
  weekly: money,
  monthly: money,
});

export const nationalInsuranceRuleSchema = baseRuleSchema.extend({
  kind: z.literal("class-1-national-insurance"),
  category: z.literal("A"),
  employmentType: z.literal("employee-not-director"),
  thresholds: z.object({
    lowerEarningsLimitPence: payPeriodValuesSchema,
    primaryThresholdPence: payPeriodValuesSchema,
    upperEarningsLimitPence: payPeriodValuesSchema,
  }),
  rates: z.object({
    atOrBelowPrimaryThresholdBasisPoints: rate,
    primaryToUpperBasisPoints: rate,
    aboveUpperBasisPoints: rate,
  }),
});

const pensionMethodSchema = z.object({
  method: z.enum(["salary-sacrifice", "net-pay", "relief-at-source"]),
  memberContribution: z.boolean(),
  reducesContractualCashPay: z.boolean(),
  deductedBeforeIncomeTax: z.boolean(),
  deductedBeforeEmployeeNationalInsurance: z.boolean(),
  providerReliefBasisPoints: rate,
  furtherReliefMayRequireClaim: z.boolean(),
});

export const pensionRuleSchema = baseRuleSchema.extend({
  kind: z.literal("pension"),
  jurisdictions: z.array(jurisdictionSchema).min(1),
  reliefLimit: z.object({
    relevantUkEarningsPercent: z.literal(100),
    basicAmountPence: money,
  }),
  annualAllowancePence: money,
  taperedAnnualAllowance: z.object({
    thresholdIncomeLimitPence: money,
    adjustedIncomeLimitPence: money,
    minimumAllowancePence: money,
  }),
  moneyPurchaseAnnualAllowancePence: money,
  methods: z.array(pensionMethodSchema).length(3),
});

export const datasetSchema = z.object({
  datasetVersion: z.string().regex(/^\d{4}\.\d{2}\.\d+$/),
  releasedAt: isoDate,
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
