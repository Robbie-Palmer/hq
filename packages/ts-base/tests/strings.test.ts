import { describe, expect, it } from "vitest";
import { compareStrings, isNonBlankString } from "../src/strings";

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
