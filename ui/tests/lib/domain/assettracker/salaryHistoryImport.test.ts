import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseSalaryImport,
  readSalaryImportFile,
  suggestSalaryColumnMapping,
} from "@/lib/domain/assettracker/salaryHistoryImport";

async function fixtureFile(): Promise<File> {
  const source = await readFile(
    join(process.cwd(), "tests/fixtures/assettracker/salary-history.csv"),
  );
  return new File([source], "salary-history.csv", { type: "text/csv" });
}

describe("salary history import", () => {
  it("maps a synthetic history with raises, bonuses, pension changes, partial years, and multiple employments", async () => {
    const sheet = await readSalaryImportFile(await fixtureFile());
    const mapping = suggestSalaryColumnMapping(sheet.headers);
    const result = parseSalaryImport(
      sheet,
      mapping,
      "2026-10-04T10:00:00.000Z",
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.records).toHaveLength(4);
    expect(result.records[1]).toMatchObject({
      employer: "Northstar Ltd",
      grossPay: 55_000,
      baseSalary: 52_000,
      variablePay: 3_000,
      employeePension: {
        arrangement: "salarySacrifice",
        rate: 0.06,
        basis: "grossPay",
        effectiveStart: "2021-10-01",
        effectiveEnd: "2022-03-31",
      },
    });
    expect(result.records[2]).toMatchObject({
      employmentId: "harbour-consultant",
      workFraction: 0.5,
      grossPay: 28_000,
    });
    expect(result.records[3]).toMatchObject({
      amountKind: "periodPay",
      payFrequency: "monthly",
      grossPay: 6_000,
      currency: "USD",
    });
  });

  it("reports duplicate, overlap, gap, and ambiguous gross-pay diagnostics", () => {
    const baseSheet = {
      fileName: "history.csv",
      fingerprint: "fixture",
      headers: [
        "person",
        "employer",
        "employment id",
        "currency",
        "jurisdiction",
        "effective start",
        "effective end",
        "pay frequency",
        "amount type",
        "gross pay before pension",
      ],
      rows: [
        [
          "Alex",
          "Acme",
          "job",
          "GBP",
          "UK",
          "2020-01-01",
          "2020-03-31",
          "monthly",
          "annual salary",
          40_000,
        ],
        [
          "Alex",
          "Acme",
          "job",
          "GBP",
          "UK",
          "2020-01-01",
          "2020-03-31",
          "monthly",
          "annual salary",
          40_000,
        ],
        [
          "Alex",
          "Acme",
          "job",
          "GBP",
          "UK",
          "2020-03-01",
          "2020-04-30",
          "monthly",
          "annual salary",
          42_000,
        ],
        [
          "Alex",
          "Acme",
          "job",
          "GBP",
          "UK",
          "2020-08-01",
          "2020-12-31",
          "monthly",
          "annual salary",
          45_000,
        ],
      ],
    };
    const mapping = suggestSalaryColumnMapping(baseSheet.headers);
    const result = parseSalaryImport(baseSheet, mapping);

    expect(result.diagnostics.map(({ message }) => message).join("\n")).toMatch(
      /Duplicate salary fact/,
    );
    expect(result.diagnostics.map(({ message }) => message).join("\n")).toMatch(
      /overlap/,
    );
    expect(result.diagnostics.map(({ message }) => message).join("\n")).toMatch(
      /uncovered days/,
    );

    const ambiguous = parseSalaryImport(
      { ...baseSheet, headers: baseSheet.headers.with(9, "net pay") },
      mapping,
    );
    expect(ambiguous.records).toEqual([]);
    expect(ambiguous.diagnostics[0]?.message).toMatch(/net or taxable pay/);
  });

  it("warns when an unsuffixed pension rate of one is ambiguous", () => {
    const sheet = {
      fileName: "history.csv",
      fingerprint: "fixture",
      headers: [
        "person",
        "employer",
        "employment id",
        "currency",
        "jurisdiction",
        "effective start",
        "pay frequency",
        "amount type",
        "gross pay before pension",
        "employee pension rate",
      ],
      rows: [
        [
          "Alex",
          "Acme",
          "job",
          "GBP",
          "UK",
          "2025-01-01",
          "monthly",
          "annual salary",
          40_000,
          1,
        ],
      ],
    };
    const result = parseSalaryImport(
      sheet,
      suggestSalaryColumnMapping(sheet.headers),
    );

    expect(result.records[0]?.employeePension?.rate).toBe(1);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ message: expect.stringMatching(/Use 1%/) }),
    ]);
  });
});
