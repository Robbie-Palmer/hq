import { describe, expect, it } from "vitest";
import {
  compareUtcInstants,
  ENGLISH_MONTH_ABBREVIATIONS,
  isoDatePart,
  isUtcInstant,
  previousUtcInstant,
} from "../src/dates";

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

describe("UTC instants", () => {
  it("validates calendar instants and compares nanosecond precision", () => {
    expect(isUtcInstant("2026-02-29T00:00:00Z")).toBe(false);
    expect(isUtcInstant("2028-02-29T00:00:00.123456789Z")).toBe(true);
    expect(
      compareUtcInstants(
        "2028-02-29T00:00:00.000000001Z",
        "2028-02-29T00:00:00.000000002Z",
      ),
    ).toBe(-1);
    expect(
      compareUtcInstants("2028-02-29T00:00:01Z", "2028-02-29T00:00:00Z"),
    ).toBe(1);
    expect(
      compareUtcInstants("2028-02-29T00:00:00Z", "2028-02-29T00:00:00Z"),
    ).toBe(0);
    expect(previousUtcInstant("2028-02-29T00:00:00.000000002Z")).toBe(
      "2028-02-29T00:00:00.000000001Z",
    );
    expect(previousUtcInstant("2028-02-29T00:00:00Z")).toBe(
      "2028-02-28T23:59:59.999999999Z",
    );
    expect(() => compareUtcInstants("not-a-date", "2028-02-29T00:00:00Z")).toThrow(
      RangeError,
    );
  });
});
