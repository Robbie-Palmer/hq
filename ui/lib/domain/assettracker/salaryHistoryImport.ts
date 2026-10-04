import type { Currency } from "./currency";
import {
  type PensionContribution,
  type SalaryAmountKind,
  type SalaryHistoryRecord,
  SalaryHistoryRecordSchema,
  type SalaryPayFrequency,
} from "./salaryHistory";

export const SALARY_IMPORT_FIELDS = [
  "person",
  "employer",
  "employmentId",
  "currency",
  "jurisdiction",
  "effectiveStart",
  "effectiveEnd",
  "payFrequency",
  "amountKind",
  "workFraction",
  "grossPay",
  "baseSalary",
  "variablePay",
  "taxablePay",
  "takeHomePay",
  "employeePensionType",
  "employeePensionAmount",
  "employeePensionRate",
  "employeePensionBasis",
  "employerPensionType",
  "employerPensionAmount",
  "employerPensionRate",
  "employerPensionBasis",
] as const;
export type SalaryImportField = (typeof SALARY_IMPORT_FIELDS)[number];
export type SalaryColumnMapping = Partial<Record<SalaryImportField, number>>;

export const SALARY_IMPORT_FIELD_LABELS: Record<SalaryImportField, string> = {
  person: "Person",
  employer: "Employer",
  employmentId: "Employment ID",
  currency: "Currency",
  jurisdiction: "Jurisdiction",
  effectiveStart: "Effective start",
  effectiveEnd: "Effective end",
  payFrequency: "Pay frequency",
  amountKind: "Amount type",
  workFraction: "Work fraction",
  grossPay: "Gross pay before pension",
  baseSalary: "Base salary",
  variablePay: "Variable pay or bonus",
  taxablePay: "Taxable pay",
  takeHomePay: "Take-home pay",
  employeePensionType: "Employee pension type",
  employeePensionAmount: "Employee pension amount",
  employeePensionRate: "Employee pension rate",
  employeePensionBasis: "Employee pension basis",
  employerPensionType: "Employer pension type",
  employerPensionAmount: "Employer pension amount",
  employerPensionRate: "Employer pension rate",
  employerPensionBasis: "Employer pension basis",
};

export const REQUIRED_SALARY_IMPORT_FIELDS: readonly SalaryImportField[] = [
  "person",
  "employer",
  "employmentId",
  "currency",
  "jurisdiction",
  "effectiveStart",
  "payFrequency",
  "amountKind",
  "grossPay",
];

export type SalaryImportDiagnostic = {
  severity: "error" | "warning";
  message: string;
  row?: number;
};

export type SalaryImportSheet = {
  fileName: string;
  fingerprint: string;
  headers: string[];
  rows: unknown[][];
};

export type SalaryImportResult = {
  records: SalaryHistoryRecord[];
  diagnostics: SalaryImportDiagnostic[];
};

const HEADER_ALIASES: Record<SalaryImportField, readonly string[]> = {
  person: ["person", "employee", "employee name", "name"],
  employer: ["employer", "company", "organisation", "organization"],
  employmentId: ["employment id", "employment", "job id", "role id"],
  currency: ["currency", "currency code"],
  jurisdiction: ["jurisdiction", "tax jurisdiction", "country"],
  effectiveStart: ["effective start", "start date", "period start", "from"],
  effectiveEnd: ["effective end", "end date", "period end", "to"],
  payFrequency: ["pay frequency", "frequency", "pay period"],
  amountKind: ["amount type", "amount kind", "salary or period pay"],
  workFraction: [
    "work fraction",
    "fte",
    "full time equivalent",
    "work percentage",
  ],
  grossPay: [
    "gross pay before pension",
    "gross before pension",
    "pre pension gross pay",
    "gross pay",
    "gross salary",
  ],
  baseSalary: ["base salary", "base pay"],
  variablePay: ["variable pay", "bonus", "commission"],
  taxablePay: ["taxable pay", "taxable salary"],
  takeHomePay: ["take home pay", "take home", "net pay", "net salary"],
  employeePensionType: ["employee pension type", "pension type"],
  employeePensionAmount: ["employee pension amount", "pension amount"],
  employeePensionRate: ["employee pension rate", "pension rate"],
  employeePensionBasis: ["employee pension basis", "pension basis"],
  employerPensionType: ["employer pension type"],
  employerPensionAmount: ["employer pension amount"],
  employerPensionRate: ["employer pension rate"],
  employerPensionBasis: ["employer pension basis"],
};

function normaliseHeader(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("en-GB")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function suggestSalaryColumnMapping(
  headers: readonly string[],
): SalaryColumnMapping {
  const normalised = headers.map(normaliseHeader);
  const mapping: SalaryColumnMapping = {};
  for (const field of SALARY_IMPORT_FIELDS) {
    const index = normalised.findIndex((header) =>
      HEADER_ALIASES[field].includes(header),
    );
    if (index >= 0) mapping[field] = index;
  }
  return mapping;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Quoted CSV parsing needs state for delimiters, escaped quotes, and line endings.
function parseDelimitedText(source: string): unknown[][] {
  const delimiter = source.split(/\r?\n/, 1)[0]?.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        value += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index++;
      row.push(value);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }
  row.push(value);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

function fingerprint(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export async function readSalaryImportFile(
  file: File,
): Promise<SalaryImportSheet> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let matrix: unknown[][];
  if (/\.xlsx$/i.test(file.name)) {
    const { default: readXlsxFile } = await import("read-excel-file");
    matrix = await readXlsxFile(file);
  } else if (/\.(csv|tsv)$/i.test(file.name)) {
    matrix = parseDelimitedText(new TextDecoder().decode(bytes));
  } else {
    throw new Error("Choose a CSV, TSV, or Excel .xlsx file");
  }
  const [headerRow = [], ...rows] = matrix;
  const headers = headerRow.map((cell) => String(cell ?? "").trim());
  if (headers.length === 0 || headers.every((header) => header === "")) {
    throw new Error("The file needs a header row");
  }
  return {
    fileName: file.name,
    fingerprint: fingerprint(bytes),
    headers,
    rows,
  };
}

function cell(
  row: readonly unknown[],
  mapping: SalaryColumnMapping,
  field: SalaryImportField,
): unknown {
  const index = mapping[field];
  return index == null ? undefined : row[index];
}

function textValue(value: unknown): string | undefined {
  if (value == null) return undefined;
  const text = String(value).trim();
  return text === "" ? undefined : text;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  const text = textValue(value);
  if (text == null) return undefined;
  const parenthesised = text.startsWith("(") && text.endsWith(")");
  const parsed = Number(
    text.replace(/^\((.*)\)$/, "$1").replace(/[\p{Sc}\s,]/gu, ""),
  );
  if (!Number.isFinite(parsed)) return undefined;
  return parenthesised ? -parsed : parsed;
}

function rateValue(value: unknown): number | undefined {
  const text = textValue(value);
  const parsed = numberValue(text?.replace("%", "") ?? value);
  if (parsed == null) return undefined;
  return text?.includes("%") || parsed > 1 ? parsed / 100 : parsed;
}

function isoDate(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString().slice(0, 10);
  }
  const text = textValue(value);
  if (text == null) return undefined;
  const yearFirst = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text);
  const dayFirst = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(text);
  const match = yearFirst ?? dayFirst;
  if (match == null) return undefined;
  const [, first, second, third] = match;
  const year = yearFirst ? first : third;
  const month = second;
  const day = yearFirst ? third : first;
  if (year == null || month == null || day == null) return undefined;
  const canonical = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const date = new Date(`${canonical}T00:00:00Z`);
  return date.toISOString().slice(0, 10) === canonical ? canonical : undefined;
}

const FREQUENCIES: Record<string, SalaryPayFrequency> = {
  weekly: "weekly",
  week: "weekly",
  fortnightly: "fortnightly",
  biweekly: "fortnightly",
  "every two weeks": "fortnightly",
  "four weekly": "fourWeekly",
  "4 weekly": "fourWeekly",
  monthly: "monthly",
  month: "monthly",
  quarterly: "quarterly",
  quarter: "quarterly",
  annual: "annual",
  annually: "annual",
  yearly: "annual",
  irregular: "irregular",
};

const AMOUNT_KINDS: Record<string, SalaryAmountKind> = {
  "annual salary": "annualSalary",
  annual: "annualSalary",
  salary: "annualSalary",
  "annual rate": "annualSalary",
  "period pay": "periodPay",
  period: "periodPay",
  actual: "periodPay",
  payslip: "periodPay",
};

type PensionArrangement = PensionContribution["arrangement"];
type PensionBasis = PensionContribution["basis"];

const PENSION_TYPES: Record<string, PensionArrangement> = {
  "salary sacrifice": "salarySacrifice",
  sacrifice: "salarySacrifice",
  "net pay": "netPay",
  "relief at source": "reliefAtSource",
  other: "other",
  unknown: "unknown",
};

const PENSION_BASES: Record<string, PensionBasis> = {
  "gross pay": "grossPay",
  gross: "grossPay",
  "qualifying earnings": "qualifyingEarnings",
  "pensionable pay": "pensionablePay",
  unknown: "unknown",
};

function enumValue<T>(
  value: unknown,
  values: Record<string, T>,
): T | undefined {
  const text = textValue(value)?.toLocaleLowerCase("en-GB");
  return text == null ? undefined : values[text];
}

function pensionValue(
  row: readonly unknown[],
  mapping: SalaryColumnMapping,
  prefix: "employee" | "employer",
): PensionContribution | undefined {
  const typeField = `${prefix}PensionType` as SalaryImportField;
  const amountField = `${prefix}PensionAmount` as SalaryImportField;
  const rateField = `${prefix}PensionRate` as SalaryImportField;
  const basisField = `${prefix}PensionBasis` as SalaryImportField;
  const arrangement = enumValue(cell(row, mapping, typeField), PENSION_TYPES);
  const amount = numberValue(cell(row, mapping, amountField));
  const rate = rateValue(cell(row, mapping, rateField));
  const basis = enumValue(cell(row, mapping, basisField), PENSION_BASES);
  if (arrangement == null && amount == null && rate == null && basis == null) {
    return undefined;
  }
  return {
    arrangement: arrangement ?? "unknown",
    basis: basis ?? "unknown",
    amount,
    rate,
  };
}

function pensionWithDates(
  pension: PensionContribution | undefined,
  effectiveStart: string | undefined,
  effectiveEnd: string | undefined,
): PensionContribution | undefined {
  if (pension == null) return undefined;
  return { ...pension, effectiveStart, effectiveEnd };
}

function mappedHeader(
  sheet: SalaryImportSheet,
  mapping: SalaryColumnMapping,
  field: SalaryImportField,
): string {
  const index = mapping[field];
  return index == null ? "" : (sheet.headers[index] ?? "");
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Cross-row validation reports duplicate, overlap, and missing-period cases together.
function structuralDiagnostics(
  records: readonly SalaryHistoryRecord[],
): SalaryImportDiagnostic[] {
  const diagnostics: SalaryImportDiagnostic[] = [];
  const duplicateKeys = new Set<string>();
  const seen = new Set<string>();
  for (const record of records) {
    const key = [
      record.person,
      record.employmentId,
      record.effectiveStart,
      record.effectiveEnd ?? "",
      record.amountKind,
      record.grossPay,
    ].join("\0");
    if (seen.has(key) && !duplicateKeys.has(key)) {
      diagnostics.push({
        severity: "error",
        message: `Duplicate salary fact for ${record.person}, ${record.employmentId}, starting ${record.effectiveStart}`,
      });
      duplicateKeys.add(key);
    }
    seen.add(key);
  }

  const groups = new Map<string, SalaryHistoryRecord[]>();
  for (const record of records) {
    const key = `${record.person}\0${record.employmentId}`;
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const ordered = group.toSorted((a, b) =>
      a.effectiveStart.localeCompare(b.effectiveStart),
    );
    for (let index = 1; index < ordered.length; index++) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (previous == null || current == null) continue;
      if (
        previous.effectiveEnd == null ||
        current.effectiveStart <= previous.effectiveEnd
      ) {
        diagnostics.push({
          severity: "warning",
          row: current.source.kind === "file" ? current.source.row : undefined,
          message: `${current.person}'s ${current.employmentId} rows overlap. Confirm a job change or mid-year raise does not cover the same dates twice.`,
        });
        continue;
      }
      const previousEnd = new Date(`${previous.effectiveEnd}T00:00:00Z`);
      const currentStart = new Date(`${current.effectiveStart}T00:00:00Z`);
      const gapDays = Math.round(
        (currentStart.valueOf() - previousEnd.valueOf()) / 86_400_000,
      );
      if (gapDays > 32) {
        diagnostics.push({
          severity: "warning",
          row: current.source.kind === "file" ? current.source.row : undefined,
          message: `${gapDays - 1} uncovered days precede this ${current.employmentId} row. Keep the gap if no salary applied.`,
        });
      }
    }
  }
  return diagnostics;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Every branch reports a field-specific import diagnostic.
export function parseSalaryImport(
  sheet: SalaryImportSheet,
  mapping: SalaryColumnMapping,
  acceptedAt = new Date().toISOString(),
): SalaryImportResult {
  const diagnostics: SalaryImportDiagnostic[] = [];
  for (const field of REQUIRED_SALARY_IMPORT_FIELDS) {
    if (mapping[field] == null) {
      diagnostics.push({
        severity: "error",
        message: `Map the ${SALARY_IMPORT_FIELD_LABELS[field]} column`,
      });
    }
  }
  const grossHeader = normaliseHeader(mappedHeader(sheet, mapping, "grossPay"));
  if (/net|take home|taxable/.test(grossHeader)) {
    diagnostics.push({
      severity: "error",
      message:
        "The gross-pay mapping looks like net or taxable pay. Map pay before tax, pension deductions, and salary sacrifice.",
    });
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { records: [], diagnostics };
  }

  const records: SalaryHistoryRecord[] = [];
  for (const [index, row] of sheet.rows.entries()) {
    if (row.every((value) => textValue(value) == null)) continue;
    const rowNumber = index + 2;
    const effectiveStart = isoDate(cell(row, mapping, "effectiveStart"));
    const effectiveEnd = isoDate(cell(row, mapping, "effectiveEnd"));
    const raw = {
      id: `salary-${sheet.fingerprint}-${rowNumber}`,
      person: textValue(cell(row, mapping, "person")),
      employer: textValue(cell(row, mapping, "employer")),
      employmentId: textValue(cell(row, mapping, "employmentId")),
      currency: textValue(cell(row, mapping, "currency"))?.toUpperCase() as
        | Currency
        | undefined,
      jurisdiction: textValue(cell(row, mapping, "jurisdiction")),
      effectiveStart,
      effectiveEnd,
      payFrequency: enumValue(cell(row, mapping, "payFrequency"), FREQUENCIES),
      amountKind: enumValue(cell(row, mapping, "amountKind"), AMOUNT_KINDS),
      workFraction: rateValue(cell(row, mapping, "workFraction")),
      grossPay: numberValue(cell(row, mapping, "grossPay")),
      baseSalary: numberValue(cell(row, mapping, "baseSalary")),
      variablePay: numberValue(cell(row, mapping, "variablePay")),
      taxablePay: numberValue(cell(row, mapping, "taxablePay")),
      takeHomePay: numberValue(cell(row, mapping, "takeHomePay")),
      employeePension: pensionWithDates(
        pensionValue(row, mapping, "employee"),
        effectiveStart,
        effectiveEnd,
      ),
      employerPension: pensionWithDates(
        pensionValue(row, mapping, "employer"),
        effectiveStart,
        effectiveEnd,
      ),
      source: {
        kind: "file" as const,
        fileName: sheet.fileName,
        fingerprint: sheet.fingerprint,
        row: rowNumber,
      },
      acceptedAt,
    };
    const parsed = SalaryHistoryRecordSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        diagnostics.push({
          severity: "error",
          row: rowNumber,
          message: `${issue.path.join(".") || "Row"}: ${issue.message}`,
        });
      }
      continue;
    }
    if (
      parsed.data.baseSalary != null &&
      parsed.data.variablePay != null &&
      parsed.data.baseSalary + parsed.data.variablePay > parsed.data.grossPay
    ) {
      diagnostics.push({
        severity: "warning",
        row: rowNumber,
        message:
          "Base salary plus variable pay exceeds gross pay. Check whether the amounts use the same annual or pay-period basis.",
      });
    }
    if (
      parsed.data.taxablePay != null &&
      parsed.data.taxablePay > parsed.data.grossPay
    ) {
      diagnostics.push({
        severity: "warning",
        row: rowNumber,
        message:
          "Taxable pay exceeds gross pay before pension. Check the mapped columns and period basis.",
      });
    }
    records.push(parsed.data);
  }
  diagnostics.push(...structuralDiagnostics(records));
  return { records, diagnostics };
}

export const SALARY_HISTORY_TEMPLATE_CSV = `person,employer,employment_id,currency,jurisdiction,effective_start,effective_end,pay_frequency,amount_type,work_fraction,gross_pay_before_pension,base_salary,variable_pay,taxable_pay,take_home_pay,employee_pension_type,employee_pension_rate,employee_pension_basis,employer_pension_type,employer_pension_rate,employer_pension_basis
Alex Example,Northstar Ltd,northstar-engineer,GBP,UK,2022-04-01,2022-09-30,monthly,annual salary,100%,48000,48000,0,45600,3100,salary sacrifice,5%,gross pay,salary sacrifice,4%,gross pay
Alex Example,Northstar Ltd,northstar-engineer,GBP,UK,2022-10-01,2023-03-31,monthly,annual salary,100%,54000,52000,2000,51300,3450,salary sacrifice,5%,gross pay,salary sacrifice,4%,gross pay
`;
