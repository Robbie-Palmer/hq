import { z } from "zod";
import { AssetTrackerDataError } from "./assetTrackerError";
import type { SalaryHistoryRecord } from "./salaryHistory";

export const HMRC_INDIVIDUAL_INCOME_API = "individual-income" as const;
export const HMRC_INDIVIDUAL_INCOME_VERSION = "1.2" as const;
export const HMRC_INDIVIDUAL_TAX_API = "individual-tax" as const;
export const HMRC_INDIVIDUAL_TAX_VERSION = "1.1" as const;

export const HmrcTaxYearSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, "Use a tax year such as 2024-25")
  .refine(
    (value) => Number(value.slice(5)) === (Number(value.slice(0, 4)) + 1) % 100,
    {
      message: "The tax year must cover consecutive years",
    },
  );

const HmrcMoneySchema = z
  .number()
  .nonnegative()
  .superRefine((value, context) => {
    const pennies = value * 100;
    if (!Number.isSafeInteger(pennies)) {
      context.addIssue({
        code: "custom",
        message:
          "HMRC amounts must be safe numbers with no more than two decimal places",
      });
    }
  });

const PayeReferenceSchema = z
  .string()
  .trim()
  .min(1, "PAYE reference is missing")
  .max(64, "PAYE reference is too long")
  .transform((value) => value.toLocaleUpperCase("en-GB"));

const IncomeEmploymentSchema = z.object({
  employerPayeReference: PayeReferenceSchema,
  payFromEmployment: HmrcMoneySchema,
});

const TaxEmploymentSchema = z.object({
  employerPayeReference: PayeReferenceSchema,
  taxTakenOffPay: HmrcMoneySchema,
});

const IndividualIncomeResponseSchema = z.object({
  employments: z.array(IncomeEmploymentSchema),
  pensionsAnnuitiesAndOtherStateBenefits: z.looseObject({}),
});

const IndividualTaxResponseSchema = z.object({
  employments: z.array(TaxEmploymentSchema),
  pensionsAnnuitiesAndOtherStateBenefits: z.looseObject({}),
  refunds: z.looseObject({}),
});

const HmrcImportSourceMetadataSchema = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  importedAt: z.iso.datetime(),
  objectPath: z.string().min(1),
});

export const HmrcImportSourceSchema = z.discriminatedUnion("api", [
  HmrcImportSourceMetadataSchema.extend({
    api: z.literal(HMRC_INDIVIDUAL_INCOME_API),
    version: z.literal(HMRC_INDIVIDUAL_INCOME_VERSION),
  }),
  HmrcImportSourceMetadataSchema.extend({
    api: z.literal(HMRC_INDIVIDUAL_TAX_API),
    version: z.literal(HMRC_INDIVIDUAL_TAX_VERSION),
  }),
]);
export type HmrcImportSource = z.infer<typeof HmrcImportSourceSchema>;

const HmrcObservedAmountsSchema = z
  .object({
    /** HMRC payFromEmployment. This is observed or taxable pay, not gross salary. */
    observedTaxablePay: HmrcMoneySchema.optional(),
    observedIncomeTax: HmrcMoneySchema.optional(),
  })
  .refine(
    (value) =>
      value.observedTaxablePay != null || value.observedIncomeTax != null,
    { message: "An HMRC observation must contain taxable pay or Income Tax" },
  );

export const HmrcEmploymentObservationSchema = z
  .object({
    id: z.string().min(1),
    memberId: z.string().min(1),
    taxYear: HmrcTaxYearSchema,
    payeReference: PayeReferenceSchema,
    sources: z.array(HmrcImportSourceSchema).min(1),
    acceptedAt: z.iso.datetime(),
    correctsId: z.string().min(1).optional(),
  })
  .and(HmrcObservedAmountsSchema);
export type HmrcEmploymentObservation = z.infer<
  typeof HmrcEmploymentObservationSchema
>;

export const HmrcEmploymentLabelSchema = z.object({
  id: z.string().min(1),
  memberId: z.string().min(1),
  taxYear: HmrcTaxYearSchema,
  payeReference: PayeReferenceSchema,
  label: z.string().trim().min(1).max(120),
  source: z.literal("manual"),
  recordedAt: z.iso.datetime(),
  correctsId: z.string().min(1).optional(),
});
export type HmrcEmploymentLabel = z.infer<typeof HmrcEmploymentLabelSchema>;

export type HmrcImportFileKind = "income" | "tax";

export type HmrcImportFile = {
  kind: HmrcImportFileKind;
  fileName: string;
  fingerprint: string;
  importedAt: string;
  taxYear?: string;
  employments: Array<{
    payeReference: string;
    amount: number;
    objectPath: string;
  }>;
};

export type HmrcImportDiagnostic = {
  file: "income" | "tax" | "pair";
  message: string;
};

export type HmrcImportDraftRow = {
  memberId: string;
  taxYear: string;
  payeReference: string;
  observedTaxablePay?: number;
  observedIncomeTax?: number;
  sources: HmrcImportSource[];
};

export type HmrcImportReview = {
  rows: HmrcImportDraftRow[];
  diagnostics: HmrcImportDiagnostic[];
};

type HmrcImportReviewInput = {
  memberId: string;
  taxYear: string;
  income?: HmrcImportFile;
  tax?: HmrcImportFile;
};

export const AcceptHmrcImportInputSchema = z.object({
  rows: z
    .array(
      z
        .object({
          memberId: z.string().min(1),
          taxYear: HmrcTaxYearSchema,
          payeReference: PayeReferenceSchema,
          sources: z.array(HmrcImportSourceSchema).min(1),
        })
        .and(HmrcObservedAmountsSchema),
    )
    .min(1),
  labels: z.record(z.string(), z.string().trim().max(120)).default({}),
});
export type AcceptHmrcImportInput = z.infer<typeof AcceptHmrcImportInputSchema>;

const REJECTED_SENSITIVE_KEYS = new Set([
  "authorization",
  "accesstoken",
  "refreshtoken",
  "clientsecret",
  "utr",
]);

function containsRejectedSensitiveField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsRejectedSensitiveField);
  if (typeof value !== "object" || value == null) return false;
  return Object.entries(value).some(
    ([key, child]) =>
      REJECTED_SENSITIVE_KEYS.has(
        key.toLocaleLowerCase("en-GB").replaceAll(/[^a-z]/g, ""),
      ) || containsRejectedSensitiveField(child),
  );
}

function assertNoDuplicatePayeReferences(
  employments: readonly { employerPayeReference: string }[],
): void {
  const seen = new Set<string>();
  for (const employment of employments) {
    if (seen.has(employment.employerPayeReference)) {
      throw new AssetTrackerDataError(
        `Duplicate PAYE reference "${employment.employerPayeReference}" in this response`,
      );
    }
    seen.add(employment.employerPayeReference);
  }
}

type ResponseEnvelope = {
  response: unknown;
  api?: unknown;
  version?: unknown;
  taxYear?: unknown;
};

function responseEnvelope(raw: unknown): ResponseEnvelope {
  if (
    typeof raw === "object" &&
    raw != null &&
    !Array.isArray(raw) &&
    "response" in raw
  ) {
    const envelope = raw as Record<string, unknown>;
    return {
      response: envelope.response,
      api: envelope.api,
      version: envelope.version,
      taxYear: envelope.taxYear,
    };
  }
  return { response: raw };
}

function expectedMetadata(kind: HmrcImportFileKind) {
  return kind === "income"
    ? {
        api: HMRC_INDIVIDUAL_INCOME_API,
        version: HMRC_INDIVIDUAL_INCOME_VERSION,
      }
    : { api: HMRC_INDIVIDUAL_TAX_API, version: HMRC_INDIVIDUAL_TAX_VERSION };
}

function describeMetadata(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? "unknown value";
}

function parseEnvelopeMetadata(
  kind: HmrcImportFileKind,
  envelope: ResponseEnvelope,
): string | undefined {
  const expected = expectedMetadata(kind);
  if (envelope.api != null && envelope.api !== expected.api) {
    throw new AssetTrackerDataError(
      `This file declares ${describeMetadata(envelope.api)}, not ${expected.api}`,
    );
  }
  if (envelope.version != null && envelope.version !== expected.version) {
    throw new AssetTrackerDataError(
      `Unsupported ${expected.api} version ${describeMetadata(envelope.version)}; choose version ${expected.version}`,
    );
  }
  if (envelope.taxYear == null) return undefined;
  return HmrcTaxYearSchema.parse(envelope.taxYear);
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

const MAX_HMRC_FILE_BYTES = 1_000_000;

export async function readHmrcImportFile(
  file: File,
  kind: HmrcImportFileKind,
  importedAt = new Date().toISOString(),
): Promise<HmrcImportFile> {
  if (!/\.json$/i.test(file.name)) {
    throw new AssetTrackerDataError("Choose a JSON response file");
  }
  if (file.size > MAX_HMRC_FILE_BYTES) {
    throw new AssetTrackerDataError("Choose a JSON file smaller than 1 MB");
  }
  const bytes = await file.arrayBuffer();
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new AssetTrackerDataError("The file is not valid JSON");
  }
  if (containsRejectedSensitiveField(raw)) {
    throw new AssetTrackerDataError(
      "Remove credentials and the UTR from the file. HMRC response bodies do not need them and Asset Tracker will not store them",
    );
  }
  const envelope = responseEnvelope(raw);
  const taxYear = parseEnvelopeMetadata(kind, envelope);
  const fingerprint = await sha256Hex(bytes);
  if (kind === "income") {
    const parsed = IndividualIncomeResponseSchema.safeParse(envelope.response);
    if (!parsed.success) {
      throw new AssetTrackerDataError(
        "This is not an HMRC Individual Income 1.2 response",
      );
    }
    assertNoDuplicatePayeReferences(parsed.data.employments);
    return {
      kind,
      fileName: file.name,
      fingerprint,
      importedAt,
      taxYear,
      employments: parsed.data.employments.map((employment, index) => ({
        payeReference: employment.employerPayeReference,
        amount: employment.payFromEmployment,
        objectPath: `/employments/${index}/payFromEmployment`,
      })),
    };
  }
  const parsed = IndividualTaxResponseSchema.safeParse(envelope.response);
  if (!parsed.success) {
    throw new AssetTrackerDataError(
      "This is not an HMRC Individual Tax 1.1 response",
    );
  }
  assertNoDuplicatePayeReferences(parsed.data.employments);
  return {
    kind,
    fileName: file.name,
    fingerprint,
    importedAt,
    taxYear,
    employments: parsed.data.employments.map((employment, index) => ({
      payeReference: employment.employerPayeReference,
      amount: employment.taxTakenOffPay,
      objectPath: `/employments/${index}/taxTakenOffPay`,
    })),
  };
}

function sourceFor(file: HmrcImportFile, objectPath: string): HmrcImportSource {
  const metadata = expectedMetadata(file.kind);
  return {
    ...metadata,
    fingerprint: file.fingerprint,
    importedAt: file.importedAt,
    objectPath,
  };
}

function taxYearDiagnostics(
  input: HmrcImportReviewInput,
  selectedTaxYear: string,
): HmrcImportDiagnostic[] {
  const diagnostics: HmrcImportDiagnostic[] = [];
  for (const file of [input.income, input.tax]) {
    if (file?.taxYear != null && file.taxYear !== selectedTaxYear) {
      diagnostics.push({
        file: file.kind,
        message: `${file.fileName} declares tax year ${file.taxYear}, not ${selectedTaxYear}`,
      });
    }
  }
  if (
    input.income?.taxYear != null &&
    input.tax?.taxYear != null &&
    input.income.taxYear !== input.tax.taxYear
  ) {
    diagnostics.push({
      file: "pair",
      message: `The files declare different tax years (${input.income.taxYear} and ${input.tax.taxYear})`,
    });
  }
  return diagnostics;
}

function addIncomeRows(
  rows: Map<string, HmrcImportDraftRow>,
  file: HmrcImportFile | undefined,
  memberId: string,
  taxYear: string,
): void {
  if (file == null) return;
  for (const employment of file.employments) {
    rows.set(employment.payeReference, {
      memberId,
      taxYear,
      payeReference: employment.payeReference,
      observedTaxablePay: employment.amount,
      sources: [sourceFor(file, employment.objectPath)],
    });
  }
}

function addTaxRows(
  rows: Map<string, HmrcImportDraftRow>,
  file: HmrcImportFile | undefined,
  memberId: string,
  taxYear: string,
): void {
  if (file == null) return;
  for (const employment of file.employments) {
    const existing = rows.get(employment.payeReference);
    rows.set(employment.payeReference, {
      memberId,
      taxYear,
      payeReference: employment.payeReference,
      observedTaxablePay: existing?.observedTaxablePay,
      observedIncomeTax: employment.amount,
      sources: [
        ...(existing?.sources ?? []),
        sourceFor(file, employment.objectPath),
      ],
    });
  }
}

export function reviewHmrcImport(
  input: HmrcImportReviewInput,
): HmrcImportReview {
  const taxYear = HmrcTaxYearSchema.safeParse(input.taxYear);
  if (!taxYear.success) {
    return {
      rows: [],
      diagnostics: [
        {
          file: "pair",
          message: taxYear.error.issues[0]?.message ?? "Invalid tax year",
        },
      ],
    };
  }
  if (input.income == null && input.tax == null)
    return { rows: [], diagnostics: [] };
  const diagnostics = taxYearDiagnostics(input, taxYear.data);
  if (diagnostics.length > 0) return { rows: [], diagnostics };

  const rows = new Map<string, HmrcImportDraftRow>();
  addIncomeRows(rows, input.income, input.memberId, taxYear.data);
  addTaxRows(rows, input.tax, input.memberId, taxYear.data);
  return {
    rows: [...rows.values()].sort((left, right) =>
      left.payeReference.localeCompare(right.payeReference),
    ),
    diagnostics,
  };
}

function seriesKey(record: {
  memberId: string;
  taxYear: string;
  payeReference: string;
}): string {
  return `${record.memberId}\0${record.taxYear}\0${record.payeReference}`;
}

function currentHmrcRecords<T extends { id: string; correctsId?: string }>(
  records: readonly T[],
): T[] {
  const corrected = new Set(
    records.flatMap((record) =>
      record.correctsId == null ? [] : [record.correctsId],
    ),
  );
  return records.filter((record) => !corrected.has(record.id));
}

function sameObservedValues(
  left: Pick<
    HmrcEmploymentObservation,
    "observedTaxablePay" | "observedIncomeTax"
  >,
  right: Pick<
    HmrcEmploymentObservation,
    "observedTaxablePay" | "observedIncomeTax"
  >,
): boolean {
  return (
    left.observedTaxablePay === right.observedTaxablePay &&
    left.observedIncomeTax === right.observedIncomeTax
  );
}

function mergeObservationRow(
  row: HmrcImportDraftRow,
  prior: HmrcEmploymentObservation | undefined,
) {
  return {
    ...row,
    observedTaxablePay: row.observedTaxablePay ?? prior?.observedTaxablePay,
    observedIncomeTax: row.observedIncomeTax ?? prior?.observedIncomeTax,
    sources: [
      ...(row.observedTaxablePay == null && prior != null
        ? prior.sources.filter(
            (source) => source.api === HMRC_INDIVIDUAL_INCOME_API,
          )
        : []),
      ...(row.observedIncomeTax == null && prior != null
        ? prior.sources.filter(
            (source) => source.api === HMRC_INDIVIDUAL_TAX_API,
          )
        : []),
      ...row.sources,
    ],
  };
}

function acceptObservationRows(
  observations: readonly HmrcEmploymentObservation[],
  rows: readonly HmrcImportDraftRow[],
  createId: () => string,
  acceptedAt: string,
): HmrcEmploymentObservation[] {
  const next = [...observations];
  const currentBySeries = new Map(
    currentHmrcRecords(observations).map((record) => [
      seriesKey(record),
      record,
    ]),
  );
  for (const row of rows) {
    const key = seriesKey(row);
    const prior = currentBySeries.get(key);
    const merged = mergeObservationRow(row, prior);
    if (prior != null && sameObservedValues(prior, merged)) continue;
    const record = HmrcEmploymentObservationSchema.parse({
      ...merged,
      id: `hmrc-observation-${createId()}`,
      acceptedAt,
      correctsId: prior?.id,
    });
    next.push(record);
    currentBySeries.set(key, record);
  }
  return next;
}

function acceptLabelRows(
  labels: readonly HmrcEmploymentLabel[],
  rows: readonly HmrcImportDraftRow[],
  labelValues: Readonly<Record<string, string>>,
  createId: () => string,
  acceptedAt: string,
): HmrcEmploymentLabel[] {
  const next = [...labels];
  const currentBySeries = new Map(
    currentHmrcRecords(labels).map((label) => [seriesKey(label), label]),
  );
  for (const row of rows) {
    const label = labelValues[row.payeReference]?.trim();
    if (!label) continue;
    const key = seriesKey(row);
    const prior = currentBySeries.get(key);
    if (prior?.label === label) continue;
    const record = HmrcEmploymentLabelSchema.parse({
      id: `hmrc-label-${createId()}`,
      memberId: row.memberId,
      taxYear: row.taxYear,
      payeReference: row.payeReference,
      label,
      source: "manual",
      recordedAt: acceptedAt,
      correctsId: prior?.id,
    });
    next.push(record);
    currentBySeries.set(key, record);
  }
  return next;
}

export function applyAcceptHmrcImport(
  observations: readonly HmrcEmploymentObservation[],
  labels: readonly HmrcEmploymentLabel[],
  input: AcceptHmrcImportInput,
  createId: () => string,
  acceptedAt: string,
): {
  observations: HmrcEmploymentObservation[];
  labels: HmrcEmploymentLabel[];
} {
  const parsed = AcceptHmrcImportInputSchema.parse(input);
  return {
    observations: acceptObservationRows(
      observations,
      parsed.rows,
      createId,
      acceptedAt,
    ),
    labels: acceptLabelRows(
      labels,
      parsed.rows,
      parsed.labels,
      createId,
      acceptedAt,
    ),
  };
}

export type HmrcReconciliation = {
  status: "new" | "unchanged" | "revised";
  taxablePay: "not-recorded" | "agrees" | "differs";
  incomeTax: "not-recorded" | "agrees" | "differs";
  comparedWith: string[];
};

function taxYearDates(taxYear: string): { start: string; end: string } {
  const startYear = Number(taxYear.slice(0, 4));
  return { start: `${startYear}-04-06`, end: `${startYear + 1}-04-05` };
}

function overlapsTaxYear(
  record: SalaryHistoryRecord,
  taxYear: string,
): boolean {
  const dates = taxYearDates(taxYear);
  return (
    record.effectiveStart <= dates.end &&
    (record.effectiveEnd == null || record.effectiveEnd >= dates.start)
  );
}

function evidenceLabel(record: SalaryHistoryRecord): string {
  if (record.source.kind === "manual") return "manual salary fact";
  const name = record.source.fileName.toLocaleLowerCase("en-GB");
  if (name.includes("p45")) return "P45 fact";
  if (name.includes("p60")) return "P60 fact";
  if (name.includes("payslip")) return "payslip fact";
  return "spreadsheet or file fact";
}

function comparisonStatus(
  value: number | undefined,
  candidates: readonly number[],
): "not-recorded" | "agrees" | "differs" {
  if (value == null || candidates.length === 0) return "not-recorded";
  return candidates.includes(value) ? "agrees" : "differs";
}

function reconciliationStatus(
  prior: HmrcEmploymentObservation | undefined,
  merged: Pick<
    HmrcEmploymentObservation,
    "observedTaxablePay" | "observedIncomeTax"
  >,
): HmrcReconciliation["status"] {
  if (prior == null) return "new";
  return sameObservedValues(prior, merged) ? "unchanged" : "revised";
}

export function reconcileHmrcDraftRow(
  row: HmrcImportDraftRow,
  observations: readonly HmrcEmploymentObservation[],
  salaryHistory: readonly SalaryHistoryRecord[],
): HmrcReconciliation {
  const prior = currentHmrcRecords(observations).find(
    (record) => seriesKey(record) === seriesKey(row),
  );
  const localFacts = salaryHistory.filter(
    (record) =>
      overlapsTaxYear(record, row.taxYear) &&
      record.employmentId.trim().toLocaleUpperCase("en-GB") ===
        row.payeReference,
  );
  const merged = {
    observedTaxablePay: row.observedTaxablePay ?? prior?.observedTaxablePay,
    observedIncomeTax: row.observedIncomeTax ?? prior?.observedIncomeTax,
  };
  return {
    status: reconciliationStatus(prior, merged),
    taxablePay: comparisonStatus(
      merged.observedTaxablePay,
      localFacts.flatMap((record) =>
        record.taxablePay == null ? [] : [record.taxablePay],
      ),
    ),
    incomeTax: comparisonStatus(
      merged.observedIncomeTax,
      localFacts.flatMap((record) =>
        record.observedIncomeTax == null ? [] : [record.observedIncomeTax],
      ),
    ),
    comparedWith: [...new Set(localFacts.map(evidenceLabel))],
  };
}

type CorrectionRecord = {
  id: string;
  correctsId?: string;
  memberId: string;
  taxYear: string;
  payeReference: string;
};

function validateCorrectionRecord<T extends CorrectionRecord>(
  record: T,
  byId: ReadonlyMap<string, T>,
  corrected: Set<string>,
  label: string,
): void {
  if (record.correctsId == null) return;
  const prior = byId.get(record.correctsId);
  if (prior == null) {
    throw new AssetTrackerDataError(
      `${label} correction references an unknown record`,
    );
  }
  if (seriesKey(prior) !== seriesKey(record)) {
    throw new AssetTrackerDataError(
      `${label} correction must stay in the same PAYE and tax-year series`,
    );
  }
  if (corrected.has(record.correctsId)) {
    throw new AssetTrackerDataError(
      `${label} record has more than one direct correction`,
    );
  }
  corrected.add(record.correctsId);
}

function validateCorrections<T extends CorrectionRecord>(
  records: readonly T[],
  label: string,
): void {
  const byId = new Map(records.map((record) => [record.id, record]));
  if (byId.size !== records.length) {
    throw new AssetTrackerDataError(`${label} IDs must be unique`);
  }
  const corrected = new Set<string>();
  for (const record of records) {
    validateCorrectionRecord(record, byId, corrected, label);
  }
}

export function validateHmrcObservationHistory(
  observations: readonly HmrcEmploymentObservation[],
  labels: readonly HmrcEmploymentLabel[],
): void {
  validateCorrections(observations, "HMRC observation");
  validateCorrections(labels, "HMRC label");
}
