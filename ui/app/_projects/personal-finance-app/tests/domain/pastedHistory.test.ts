import { describe, expect, it } from "vitest";
import {
  parsePastedHistory,
  toCapitalFlowRows,
} from "@/app/_projects/personal-finance-app/domain/pastedHistory";

describe("parsePastedHistory", () => {
  it("accepts CSV with an optional header and sorts by date", () => {
    expect(
      parsePastedHistory("date,value\n2024-02-29,13120\n2024-01-31,12500"),
    ).toEqual({
      rows: [
        { date: "2024-01-31", value: 12500 },
        { date: "2024-02-29", value: 13120 },
      ],
      issues: [],
    });
  });

  it("accepts tab-separated UK dates, currency and signed withdrawals", () => {
    const result = parsePastedHistory(
      "31/01/2024\t£1,234.56\n29/02/2024\t-200",
    );

    expect(result).toEqual({
      rows: [
        { date: "2024-01-31", value: 1234.56 },
        { date: "2024-02-29", value: -200 },
      ],
      issues: [],
    });
  });

  it("accepts single-digit days and months and normalises them", () => {
    const result = parsePastedHistory(
      "2024-1-7\t100\n2024-02-8\t200\n9/3/2024\t300\n10/4/2024\t400",
    );

    expect(result.issues).toEqual([]);
    expect(result.rows.map((row) => row.date)).toEqual([
      "2024-01-07",
      "2024-02-08",
      "2024-03-09",
      "2024-04-10",
    ]);
  });

  it("accepts quoted and unquoted thousands separators", () => {
    expect(parsePastedHistory('2024-01-31,"£1,234.56"').rows[0]?.value).toBe(
      1234.56,
    );
    expect(parsePastedHistory("2024-01-31,1,234.56").rows[0]?.value).toBe(
      1234.56,
    );
  });

  it("recognises accounting negatives after a currency symbol", () => {
    expect(parsePastedHistory("2024-01-31,£(1,234.56)").rows[0]?.value).toBe(
      -1234.56,
    );
  });

  it("accepts other Unicode currency symbols", () => {
    expect(parsePastedHistory("2024-01-31,¥1,234").rows[0]?.value).toBe(1234);
  });

  it("rejects an excessively large paste before parsing rows", () => {
    const result = parsePastedHistory("x".repeat(1_000_001));

    expect(result.rows).toEqual([]);
    expect(result.issues).toEqual([
      {
        line: 1,
        message: "Paste is too large (maximum 1,000,000 characters)",
      },
    ]);
  });

  it("reports every malformed and duplicate row", () => {
    const result = parsePastedHistory(
      "2024-02-30,10\n2024-01-31,nope\n2024-01-31,20\n2024-01-31,30",
    );

    expect(result.rows).toEqual([{ date: "2024-01-31", value: 20 }]);
    expect(result.issues).toEqual([
      {
        line: 1,
        message: "Use YYYY-MM-DD or DD/MM/YYYY (leading zeroes are optional)",
        source: "2024-02-30,10",
      },
      {
        line: 2,
        message: "Value must be a valid number",
        source: "2024-01-31,nope",
      },
      {
        line: 4,
        message: "Duplicate date 2024-01-31",
        source: "2024-01-31,30",
      },
    ]);
  });
});

describe("toCapitalFlowRows", () => {
  it("derives deposits and withdrawals from cumulative contribution totals", () => {
    expect(
      toCapitalFlowRows(
        [
          { date: "2024-01-31", value: 10_000 },
          { date: "2024-02-29", value: 10_500 },
          { date: "2024-03-31", value: 10_300 },
        ],
        "cumulative",
      ),
    ).toEqual([
      { date: "2024-01-31", value: 10_000 },
      { date: "2024-02-29", value: 500 },
      { date: "2024-03-31", value: -200 },
    ]);
  });

  it("omits unchanged cumulative observations and preserves change rows", () => {
    const rows = [
      { date: "2024-01-31", value: 100 },
      { date: "2024-02-29", value: 100 },
    ];

    expect(toCapitalFlowRows(rows, "cumulative")).toEqual([
      { date: "2024-01-31", value: 100 },
    ]);
    expect(toCapitalFlowRows(rows, "changes")).toEqual(rows);
  });
});
