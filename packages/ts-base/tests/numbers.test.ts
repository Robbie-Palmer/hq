import { describe, expect, it } from "vitest";

import {
  compareDecimals,
  decimalFraction,
  divideFractions,
  finiteNumber,
  formatFraction,
  multiplyFractions,
} from "../src/numbers";

describe("finiteNumber", () => {
  it("coerces finite values and uses the fallback otherwise", () => {
    expect(finiteNumber("2.5")).toBe(2.5);
    expect(finiteNumber(null)).toBe(0);
    expect(finiteNumber(Number.POSITIVE_INFINITY, 4)).toBe(4);
    expect(finiteNumber("not-a-number", 3)).toBe(3);
  });
});

describe("exact decimal fractions", () => {
  it("parses, combines, and formats decimals without floating-point loss", () => {
    const product = multiplyFractions(
      decimalFraction("236.588"),
      decimalFraction("0.53"),
    );

    expect(formatFraction(product, 3)).toBe("125.392");
    expect(
      formatFraction(divideFractions(product, decimalFraction("1000")), 6),
    ).toBe("0.125392");
  });

  it("compares signed decimals and rounds halves away from zero", () => {
    expect(compareDecimals("0.71", "1")).toBe(-1);
    expect(compareDecimals("1.0", "1")).toBe(0);
    expect(compareDecimals("1.01", "1")).toBe(1);
    expect(formatFraction(decimalFraction("-1.25"), 1)).toBe("-1.3");
  });

  it("rejects malformed decimals, zero divisors, and invalid precision", () => {
    expect(() => decimalFraction("1e3")).toThrow("Invalid decimal");
    expect(() =>
      divideFractions(decimalFraction("1"), decimalFraction("0")),
    ).toThrow("Cannot divide by zero");
    expect(() => formatFraction(decimalFraction("1"), 13)).toThrow(
      "integer from 0 to 12",
    );
  });
});
