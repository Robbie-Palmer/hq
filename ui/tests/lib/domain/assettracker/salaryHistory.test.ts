import { describe, expect, it } from "vitest";
import {
  applyImportSalaryHistory,
  applySaveSalaryRecord,
  currentSalaryHistory,
  type SalaryHistoryRecord,
  SalaryRecordFactsSchema,
} from "@/lib/domain/assettracker/salaryHistory";

function salaryRecord(
  changes: Partial<SalaryHistoryRecord> = {},
): SalaryHistoryRecord {
  return {
    id: "salary-file-row-2",
    person: "Alex Example",
    employer: "Northstar Ltd",
    employmentId: "northstar-engineer",
    currency: "GBP",
    jurisdiction: "UK",
    effectiveStart: "2021-04-01",
    effectiveEnd: "2021-09-30",
    payFrequency: "monthly",
    amountKind: "annualSalary",
    grossPay: 48_000,
    source: {
      kind: "file",
      fileName: "salary.csv",
      fingerprint: "file",
      row: 2,
    },
    acceptedAt: "2026-10-04T10:00:00.000Z",
    ...changes,
  };
}

describe("salary history", () => {
  it("accepts a take-home-only historical record", () => {
    const [record] = applySaveSalaryRecord(
      [],
      {
        facts: {
          person: "Alex Example",
          employer: "First job",
          employmentId: "alex-first-job",
          currency: "GBP",
          jurisdiction: "England",
          effectiveStart: "2015-04-01",
          payFrequency: "monthly",
          amountKind: "periodPay",
          takeHomePay: 1_250,
        },
      },
      "salary-take-home",
      "2026-10-08T10:00:00.000Z",
    );

    expect(record?.grossPay).toBeUndefined();
    expect(record?.takeHomePay).toBe(1_250);
  });

  it("does not duplicate a repeated file import", () => {
    const record = salaryRecord();
    const first = applyImportSalaryHistory([], { records: [record] });
    const repeated = applyImportSalaryHistory(first, {
      records: [
        salaryRecord({
          id: "salary-renamed-file-row-8",
          source: {
            kind: "file",
            fileName: "renamed-salary.csv",
            fingerprint: "renamed-file",
            row: 8,
          },
        }),
      ],
    });

    expect(repeated).toEqual([record]);
  });

  it("preserves an accepted fact when a correction is appended", () => {
    const original = salaryRecord();
    const corrected = applySaveSalaryRecord(
      [original],
      {
        correctsId: original.id,
        facts: {
          person: original.person,
          employer: original.employer,
          employmentId: original.employmentId,
          currency: original.currency,
          jurisdiction: original.jurisdiction,
          effectiveStart: original.effectiveStart,
          effectiveEnd: original.effectiveEnd,
          payFrequency: original.payFrequency,
          amountKind: original.amountKind,
          grossPay: 50_000,
        },
      },
      "salary-correction",
      "2026-10-04T11:00:00.000Z",
    );

    expect(corrected).toHaveLength(2);
    expect(corrected[0]).toEqual(original);
    expect(currentSalaryHistory(corrected)).toMatchObject([
      { id: "salary-correction", grossPay: 50_000, correctsId: original.id },
    ]);
  });

  it("closes the prior salary rate when a pay rise is added", () => {
    const previous = salaryRecord({
      effectiveStart: "2024-01-01",
      effectiveEnd: undefined,
    });
    const changed = applySaveSalaryRecord(
      [previous],
      {
        replacesRateId: previous.id,
        facts: {
          ...SalaryRecordFactsSchema.parse(previous),
          effectiveStart: "2025-07-01",
          effectiveEnd: undefined,
          grossPay: 55_000,
        },
      },
      "salary-pay-rise",
      "2026-10-04T11:00:00.000Z",
    );

    expect(currentSalaryHistory(changed)).toMatchObject([
      {
        id: "salary-pay-rise-closed-prior",
        effectiveStart: "2024-01-01",
        effectiveEnd: "2025-06-30",
        grossPay: 48_000,
        correctsId: previous.id,
      },
      {
        id: "salary-pay-rise",
        effectiveStart: "2025-07-01",
        effectiveEnd: undefined,
        grossPay: 55_000,
      },
    ]);
  });

  it("repairs a stale employment ID when adding the next pay rise", () => {
    const previous = salaryRecord({
      employer: "New Company",
      employmentId: "alex-old-company",
      effectiveStart: "2024-07-01",
      effectiveEnd: undefined,
    });
    const changed = applySaveSalaryRecord(
      [previous],
      {
        replacesRateId: previous.id,
        facts: {
          ...SalaryRecordFactsSchema.parse(previous),
          employmentId: "alex-example-new-company",
          effectiveStart: "2025-07-01",
          grossPay: 55_000,
        },
      },
      "salary-pay-rise",
      "2026-10-04T11:00:00.000Z",
    );

    expect(currentSalaryHistory(changed)).toMatchObject([
      {
        id: "salary-pay-rise-closed-prior",
        employer: "New Company",
        employmentId: "alex-example-new-company",
        effectiveEnd: "2025-06-30",
      },
      {
        id: "salary-pay-rise",
        employer: "New Company",
        employmentId: "alex-example-new-company",
      },
    ]);
  });

  it("orders accepted timestamps as instants when fractional seconds differ", () => {
    const first = salaryRecord({ acceptedAt: "2026-10-04T10:00:00Z" });
    const second = salaryRecord({
      id: "salary-second",
      acceptedAt: "2026-10-04T10:00:00.100Z",
    });

    expect(currentSalaryHistory([second, first]).map(({ id }) => id)).toEqual([
      first.id,
      second.id,
    ]);
  });

  it("rejects a second correction to a superseded fact", () => {
    const original = salaryRecord();
    const corrected = applySaveSalaryRecord(
      [original],
      { facts: { ...original, grossPay: 50_000 }, correctsId: original.id },
      "salary-correction",
      "2026-10-04T11:00:00.000Z",
    );

    expect(() =>
      applySaveSalaryRecord(
        corrected,
        { facts: { ...original, grossPay: 51_000 }, correctsId: original.id },
        "salary-other-correction",
        "2026-10-04T12:00:00.000Z",
      ),
    ).toThrow(/no longer current/);
  });
});
