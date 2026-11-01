import {
  CountryCodeSchema,
  CurrencyCodeSchema,
  parseCountryCode,
  parseCurrencyCode,
} from "iso-codes";
import { z } from "zod";

export { CountryCodeSchema, CurrencyCodeSchema } from "iso-codes";

export const SIDE_INCOME_CONTRACT_VERSION = 1 as const;

export const IdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9][a-z0-9._:/-]*$/);

export const IsoDateSchema = z.iso.date();
export const TimestampSchema = z.iso.datetime();
export const TaxYearSchema = z.string().regex(/^\d{4}-\d{2}$/);

export const SupportedSideIncomeCurrencySchema = z.enum(["GBP"]);
export const SupportedSideIncomeJurisdictionSchema = z.enum(["GB"]);
export const SIDE_INCOME_CURRENCY = parseCurrencyCode(
  SupportedSideIncomeCurrencySchema.enum.GBP,
);
export const SIDE_INCOME_JURISDICTION = parseCountryCode(
  SupportedSideIncomeJurisdictionSchema.enum.GB,
);

// One basis point is 0.01%, so 100% ownership is 10,000 basis points.
export const FULL_OWNERSHIP_BASIS_POINTS = 10_000;
export const OwnershipBasisPointsSchema = z
  .number()
  .int()
  .min(1)
  .max(FULL_OWNERSHIP_BASIS_POINTS);

export const MoneySchema = z
  .object({
    minorUnits: z.int(),
    currency: CurrencyCodeSchema,
    jurisdiction: CountryCodeSchema,
  })
  .strict();
export type Money = z.infer<typeof MoneySchema>;

export const SourceLineageSchema = z
  .object({
    kind: z.enum(["user-entry", "file-import", "provider-import", "derived"]),
    sourceId: z.string().trim().min(1).max(500),
    sourceRevision: z.string().trim().min(1).max(200),
    observedAt: TimestampSchema,
    recordedAt: TimestampSchema,
    parentRecordIds: z.array(IdentifierSchema),
  })
  .strict();
export type SourceLineage = z.infer<typeof SourceLineageSchema>;

const KnownOrUnknownBooleanSchema = z.union([z.boolean(), z.literal("unknown")]);

export const PersonSchema = z
  .object({
    id: IdentifierSchema,
    taxResidence: z
      .object({
        status: z.enum(["resident", "non-resident", "unknown"]),
        jurisdiction: CountryCodeSchema.nullable(),
        effectiveFrom: IsoDateSchema,
        effectiveTo: IsoDateSchema.nullable(),
      })
      .strict(),
  })
  .strict();
export type Person = z.infer<typeof PersonSchema>;

export const ActivitySchema = z
  .object({
    id: IdentifierSchema,
    label: z.string().trim().min(1).max(200),
    kind: z.enum([
      "product-sales",
      "subscription-sales",
      "freelance-services",
      "contracting-services",
    ]),
    startedOn: IsoDateSchema,
    endedOn: IsoDateSchema.nullable(),
    expectedVolatility: z.discriminatedUnion("status", [
      z.object({ status: z.literal("unknown") }).strict(),
      z
        .object({
          status: z.literal("known"),
          expectedAnnualVariationBasisPoints: z.number().int().min(0),
        })
        .strict(),
    ]),
  })
  .strict();
export type Activity = z.infer<typeof ActivitySchema>;

export const BusinessSchema = z
  .object({
    id: IdentifierSchema,
    name: z.string().trim().min(1).max(200),
    structure: z.enum([
      "sole-trader",
      "uk-limited-company",
      "partnership",
      "overseas-company",
      "foreign-llc",
      "unknown",
    ]),
    jurisdiction: CountryCodeSchema,
    incorporatedOn: IsoDateSchema.nullable(),
  })
  .strict();
export type Business = z.infer<typeof BusinessSchema>;

export const ActivityOwnershipSchema = z
  .object({
    activityId: IdentifierSchema,
    businessId: IdentifierSchema,
    effectiveFrom: IsoDateSchema,
    effectiveTo: IsoDateSchema.nullable(),
  })
  .strict();

export const BusinessOwnershipSchema = z
  .object({
    businessId: IdentifierSchema,
    personId: IdentifierSchema,
    ownershipBasisPoints: OwnershipBasisPointsSchema,
    effectiveFrom: IsoDateSchema,
    effectiveTo: IsoDateSchema.nullable(),
  })
  .strict();

export const CustomerArrangementSchema = z
  .object({
    id: IdentifierSchema,
    activityId: IdentifierSchema,
    customerJurisdiction: CountryCodeSchema,
    engagementKind: z.enum(["sale", "subscription", "statement-of-work", "time-based-assignment"]),
    connectedParty: KnownOrUnknownBooleanSchema,
    currentEmployerRelated: KnownOrUnknownBooleanSchema,
    clientCategory: z.enum([
      "consumer",
      "public-sector",
      "private-small",
      "private-medium-or-large",
      "unknown",
    ]),
    offPayrollAssessment: z.enum(["inside", "outside", "not-assessed", "not-applicable"]),
    contractStartedOn: IsoDateSchema,
    contractEndedOn: IsoDateSchema.nullable(),
    expectedHoursPerWeek: z.number().nonnegative().nullable(),
    expectedWorkingDaysPerYear: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type CustomerArrangement = z.infer<typeof CustomerArrangementSchema>;

export const EmploymentArrangementSchema = z
  .object({
    id: IdentifierSchema,
    personId: IdentifierSchema,
    kind: z.enum(["paye-employment", "umbrella-employment"]),
    employerOrProviderName: z.string().trim().min(1).max(200),
    providerSuitability: z.enum(["confirmed", "rejected", "not-reviewed", "not-applicable"]),
    activityIds: z.array(IdentifierSchema),
    payFactIds: z.array(IdentifierSchema),
    startedOn: IsoDateSchema,
    endedOn: IsoDateSchema.nullable(),
  })
  .strict();
export type EmploymentArrangement = z.infer<typeof EmploymentArrangementSchema>;

export const FinancialFactKindSchema = z.enum([
  "gross-revenue",
  "business-cost",
  "taxable-profit",
  "assignment-rate",
  "salary",
  "other-taxable-income",
  "dividend",
  "pension-contribution",
  "company-cash",
  "household-cash",
  "vat",
  "tax-reserve",
]);
export type FinancialFactKind = z.infer<typeof FinancialFactKindSchema>;

export const FinancialFactOwnerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("person"), personId: IdentifierSchema }).strict(),
  z.object({ kind: z.literal("household"), householdId: IdentifierSchema }).strict(),
  z.object({ kind: z.literal("business"), businessId: IdentifierSchema }).strict(),
  z.object({ kind: z.literal("activity"), activityId: IdentifierSchema }).strict(),
  z.object({ kind: z.literal("tax-authority"), jurisdiction: CountryCodeSchema }).strict(),
]);

export const FinancialFactSchema = z
  .object({
    id: IdentifierSchema,
    kind: FinancialFactKindSchema,
    amount: MoneySchema,
    owner: FinancialFactOwnerSchema,
    activityId: IdentifierSchema.nullable(),
    businessId: IdentifierSchema.nullable(),
    occurredOn: IsoDateSchema,
    taxYear: TaxYearSchema.nullable(),
    unit: z.enum(["total", "hour", "day"]),
    status: z.enum(["actual", "forecast", "scenario"]),
    lineage: SourceLineageSchema,
  })
  .strict()
  .superRefine((fact, context) => {
    if (fact.kind === "assignment-rate" && fact.unit === "total") {
      context.addIssue({
        code: "custom",
        message: "An assignment rate needs an hourly or daily unit",
        path: ["unit"],
      });
    }
    if (fact.kind !== "assignment-rate" && fact.unit !== "total") {
      context.addIssue({
        code: "custom",
        message: "Only an assignment rate can use an hourly or daily unit",
        path: ["unit"],
      });
    }
  });
export type FinancialFact = z.infer<typeof FinancialFactSchema>;

export const VatPositionSchema = z
  .object({
    businessId: IdentifierSchema,
    assessedOn: IsoDateSchema,
    trailingTwelveMonthTaxableTurnover: MoneySchema.nullable(),
    expectedNextThirtyDayTaxableTurnover: MoneySchema.nullable(),
    allSuppliesExemptOrOutOfScope: KnownOrUnknownBooleanSchema,
  })
  .strict();

export const MtdQualifyingIncomeSchema = z
  .object({
    personId: IdentifierSchema,
    taxReturnYear: TaxYearSchema,
    grossSelfEmploymentAndPropertyIncome: MoneySchema.nullable(),
    sourceComplete: z.boolean(),
  })
  .strict();

export const ScenarioPreferencesSchema = z
  .object({
    plannedWithdrawalFactIds: z.array(IdentifierSchema),
    retainedProfitIntention: z.enum(["retain", "withdraw", "mixed", "undecided"]),
    liabilityProtection: z.enum(["required", "preferred", "not-important", "undecided"]),
    administrationTolerance: z.enum(["low", "medium", "high", "undecided"]),
  })
  .strict();

export const SideIncomeCaseSchema = z
  .object({
    contractVersion: z.literal(SIDE_INCOME_CONTRACT_VERSION),
    id: IdentifierSchema,
    householdId: IdentifierSchema,
    recordedAt: TimestampSchema,
    people: z.array(PersonSchema).min(1),
    activities: z.array(ActivitySchema),
    businesses: z.array(BusinessSchema),
    activityOwnerships: z.array(ActivityOwnershipSchema),
    businessOwnerships: z.array(BusinessOwnershipSchema),
    customerArrangements: z.array(CustomerArrangementSchema),
    employmentArrangements: z.array(EmploymentArrangementSchema),
    financialFacts: z.array(FinancialFactSchema),
    vatPositions: z.array(VatPositionSchema),
    mtdQualifyingIncome: z.array(MtdQualifyingIncomeSchema),
    preferences: ScenarioPreferencesSchema,
  })
  .strict();
export type SideIncomeCase = z.infer<typeof SideIncomeCaseSchema>;
