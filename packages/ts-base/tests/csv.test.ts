import { describe, expect, it } from "vitest";
import { parseCsv } from "../src/csv";

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
