import { z } from "zod";
import { CurrencySchema } from "./currency";

export const SalaryPayFrequencySchema = z.enum([
  "weekly",
  "fortnightly",
  "fourWeekly",
  "monthly",
  "quarterly",
  "annual",
  "irregular",
]);
export type SalaryPayFrequency = z.infer<typeof SalaryPayFrequencySchema>;

export const SalaryAmountKindSchema = z.enum(["annualSalary", "periodPay"]);
export type SalaryAmountKind = z.infer<typeof SalaryAmountKindSchema>;

export const PensionContributionSchema = z
  .object({
    arrangement: z.enum([
      "salarySacrifice",
      "netPay",
      "reliefAtSource",
      "none",
      "other",
      "unknown",
    ]),
    amount: z.number().nonnegative().optional(),
    rate: z.number().min(0).max(1).optional(),
    basis: z.enum([
      "grossPay",
      "qualifyingEarnings",
      "pensionablePay",
      "unknown",
    ]),
    effectiveStart: z.iso.date().optional(),
    effectiveEnd: z.iso.date().optional(),
  })
  .refine(
    (contribution) => contribution.amount == null || contribution.rate == null,
    { message: "Enter a pension amount or rate, not both" },
  )
  .refine(
    (contribution) =>
      contribution.effectiveStart == null ||
      contribution.effectiveEnd == null ||
      contribution.effectiveEnd >= contribution.effectiveStart,
    {
      message: "Pension effective end must be on or after the start date",
      path: ["effectiveEnd"],
    },
  );
export type PensionContribution = z.infer<typeof PensionContributionSchema>;

export const SalaryRecordSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("manual") }),
  z.object({
    kind: z.literal("file"),
    fileName: z.string().min(1),
    fingerprint: z.string().min(1),
    row: z.number().int().positive(),
  }),
]);

const SalaryRecordFactsObjectSchema = z.object({
  person: z.string().trim().min(1, "Person is required"),
  employer: z.string().trim().min(1, "Employer is required"),
  employmentId: z.string().trim().min(1, "Employment ID is required"),
  currency: CurrencySchema,
  jurisdiction: z.string().trim().min(1, "Jurisdiction is required"),
  effectiveStart: z.iso.date(),
  effectiveEnd: z.iso.date().optional(),
  payFrequency: SalaryPayFrequencySchema,
  amountKind: SalaryAmountKindSchema,
  /** 1 is full-time, 0.5 is half-time. Unknown stays absent. */
  workFraction: z.number().positive().max(1).optional(),
  /** Gross pay before employee pension deductions or salary sacrifice. */
  grossPay: z.number().positive("Gross pay must be greater than zero"),
  baseSalary: z.number().nonnegative().optional(),
  variablePay: z.number().nonnegative().optional(),
  taxablePay: z.number().nonnegative().optional(),
  takeHomePay: z.number().nonnegative().optional(),
  observedIncomeTax: z.number().nonnegative().optional(),
  observedEmployeeNationalInsurance: z.number().nonnegative().optional(),
  otherDeductions: z.number().nonnegative().optional(),
  otherTaxableIncome: z.number().nonnegative().optional(),
  taxCode: z.string().trim().min(1).optional(),
  nationalInsuranceCategory: z.string().trim().min(1).optional(),
  isCompanyDirector: z.boolean().optional(),
  employeePension: PensionContributionSchema.optional(),
  employerPension: PensionContributionSchema.optional(),
});

function hasValidEffectiveDates(record: {
  effectiveStart: string;
  effectiveEnd?: string;
}): boolean {
  return (
    record.effectiveEnd == null || record.effectiveEnd >= record.effectiveStart
  );
}

const EFFECTIVE_DATE_ERROR = {
  message: "Effective end must be on or after the start date",
  path: ["effectiveEnd"] as PropertyKey[],
};

export const SalaryRecordFactsSchema = SalaryRecordFactsObjectSchema.refine(
  hasValidEffectiveDates,
  EFFECTIVE_DATE_ERROR,
);
export type SalaryRecordFacts = z.infer<typeof SalaryRecordFactsSchema>;

export const SalaryHistoryRecordSchema = z
  .object({
    ...SalaryRecordFactsObjectSchema.shape,
    id: z.string().min(1),
    source: SalaryRecordSourceSchema,
    acceptedAt: z.iso.datetime(),
    correctsId: z.string().min(1).optional(),
  })
  .refine(hasValidEffectiveDates, EFFECTIVE_DATE_ERROR);
export type SalaryHistoryRecord = z.infer<typeof SalaryHistoryRecordSchema>;

export const ImportSalaryHistoryInputSchema = z.object({
  records: z.array(SalaryHistoryRecordSchema).min(1),
});
export type ImportSalaryHistoryInput = z.infer<
  typeof ImportSalaryHistoryInputSchema
>;

export const SaveSalaryRecordInputSchema = z.object({
  facts: SalaryRecordFactsSchema,
  correctsId: z.string().min(1).optional(),
});
export type SaveSalaryRecordInput = z.infer<typeof SaveSalaryRecordInputSchema>;

const PERIODS_PER_YEAR: Record<SalaryPayFrequency, number | null> = {
  weekly: 52,
  fortnightly: 26,
  fourWeekly: 13,
  monthly: 12,
  quarterly: 4,
  annual: 1,
  irregular: null,
};

export function annualisedGrossPay(record: SalaryHistoryRecord): number | null {
  if (record.amountKind === "annualSalary") return record.grossPay;
  const periods = PERIODS_PER_YEAR[record.payFrequency];
  return periods == null ? null : record.grossPay * periods;
}

export function compareAcceptedAt(left: string, right: string): number {
  return Date.parse(left) - Date.parse(right);
}

/** Returns accepted facts that have not been superseded by a correction. */
export function currentSalaryHistory(
  records: readonly SalaryHistoryRecord[],
): SalaryHistoryRecord[] {
  const correctedIds = new Set(
    records.flatMap((record) =>
      record.correctsId == null ? [] : [record.correctsId],
    ),
  );
  return records
    .filter((record) => !correctedIds.has(record.id))
    .toSorted((a, b) =>
      a.effectiveStart === b.effectiveStart
        ? compareAcceptedAt(a.acceptedAt, b.acceptedAt)
        : a.effectiveStart.localeCompare(b.effectiveStart),
    );
}

export function applyImportSalaryHistory(
  records: readonly SalaryHistoryRecord[],
  input: ImportSalaryHistoryInput,
): SalaryHistoryRecord[] {
  const parsed = ImportSalaryHistoryInputSchema.parse(input);
  const byId = new Map(records.map((record) => [record.id, record]));
  const factKeys = new Set(
    records.map((record) =>
      JSON.stringify(SalaryRecordFactsSchema.parse(record)),
    ),
  );
  for (const record of parsed.records) {
    const factKey = JSON.stringify(SalaryRecordFactsSchema.parse(record));
    if (!byId.has(record.id) && !factKeys.has(factKey)) {
      byId.set(record.id, record);
      factKeys.add(factKey);
    }
  }
  return Array.from(byId.values());
}

export function applySaveSalaryRecord(
  records: readonly SalaryHistoryRecord[],
  input: SaveSalaryRecordInput,
  id: string,
  acceptedAt: string,
): SalaryHistoryRecord[] {
  const parsed = SaveSalaryRecordInputSchema.parse(input);
  if (
    parsed.correctsId != null &&
    !currentSalaryHistory(records).some(
      (record) => record.id === parsed.correctsId,
    )
  ) {
    throw new Error("The salary record being corrected is no longer current");
  }
  const next = SalaryHistoryRecordSchema.parse({
    ...parsed.facts,
    id,
    source: { kind: "manual" },
    acceptedAt,
    correctsId: parsed.correctsId,
  });
  return [...records, next];
}
