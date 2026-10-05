import { describe, expect, it } from "vitest";
import { ENGLISH_MONTH_ABBREVIATIONS, isoDatePart } from "../src/dates";

describe("date constants", () => {
  it("lists English month abbreviations in calendar order", () => {
    expect(ENGLISH_MONTH_ABBREVIATIONS).toEqual([
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ]);
  });
});

describe("isoDatePart", () => {
  it("returns the UTC date and rejects invalid timestamps", () => {
    expect(isoDatePart("2026-04-06T23:30:00-02:00")).toBe("2026-04-07");
    expect(() => isoDatePart("not-a-date")).toThrow(TypeError);
  });
});
