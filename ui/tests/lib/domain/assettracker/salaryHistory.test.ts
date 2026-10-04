import { describe, expect, it } from "vitest";
import {
  applyImportSalaryHistory,
  applySaveSalaryRecord,
  currentSalaryHistory,
  type SalaryHistoryRecord,
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
