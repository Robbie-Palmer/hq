import { describe, expect, it } from "vitest";
import { parseCsv, stringifyCsv } from "../src/csv";

describe("parseCsv", () => {
  it("keeps quoted commas, quotes, and line breaks in their fields", () => {
    expect(
      parseCsv('name,note\r\n"Belfast, East","line one\nline ""two"""'),
    ).toEqual([
      ["name", "note"],
      ["Belfast, East", 'line one\nline "two"'],
    ]);
  });

  it("keeps empty fields and a final row without a newline", () => {
    expect(parseCsv("one,,three\nlast,row")).toEqual([
      ["one", "", "three"],
      ["last", "row"],
    ]);
  });

  it("rejects an unterminated quoted field", () => {
    expect(() => parseCsv('one,"two')).toThrow(
      "CSV contains an unterminated quoted field",
    );
  });
});

describe("stringifyCsv", () => {
  it("quotes RFC 4180 fields and preserves primitive values", () => {
    expect(
      stringifyCsv(
        [
          ["name", "note", "enabled", "count", "blank"],
          ['Belfast, East', 'line one\nline "two"', true, 2, null],
        ],
        { trailingLineEnding: true },
      ),
    ).toBe(
      'name,note,enabled,count,blank\r\n"Belfast, East","line one\nline ""two""",true,2,\r\n',
    );
  });

  it("supports Unix lines and spreadsheet-formula escaping", () => {
    expect(
      stringifyCsv([["value"], ["=SUM(A1:A2)"], ["safe"]], {
        lineEnding: "\n",
        escapeSpreadsheetFormulas: true,
      }),
    ).toBe("value\n'=SUM(A1:A2)\nsafe");
  });
});
