import { describe, expect, it } from "vitest";
import {
  compareStrings,
  isNonBlankString,
  primitiveString,
  uniqueCsv,
} from "../src/strings";

describe("string helpers", () => {
  it.each([
    ["text", true],
    [" text ", true],
    ["", false],
    [" \n\t", false],
    [undefined, false],
    [null, false],
    [1, false],
  ])("identifies non-blank strings", (value, expected) => {
    expect(isNonBlankString(value)).toBe(expected);
  });

  it("compares strings by code point for deterministic ordering", () => {
    expect(compareStrings("a", "b")).toBe(-1);
    expect(compareStrings("b", "a")).toBe(1);
    expect(compareStrings("a", "a")).toBe(0);
    expect(compareStrings("Z", "a")).toBe(-1);
  });
});

describe("uniqueCsv", () => {
  it("trims, removes blanks, and de-duplicates values", () => {
    expect(uniqueCsv(" one, two,one, ", [])).toEqual(["one", "two"]);
  });

  it("uses the fallback when no values are configured", () => {
    expect(uniqueCsv(undefined, ["default"])).toEqual(["default"]);
    expect(uniqueCsv(" , ", ["default"])).toEqual(["default"]);
  });
});

describe("primitiveString", () => {
  it("converts primitive values without stringifying objects", () => {
    expect(primitiveString(42)).toBe("42");
    expect(primitiveString(false)).toBe("false");
    expect(primitiveString({}, "fallback")).toBe("fallback");
  });
});
