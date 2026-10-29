import { describe, expect, it } from "vitest";

import {
  compareDecimals,
  decimalFraction,
  divideFractions,
  finiteNumber,
  formatFraction,
  meanOrZero,
  medianOrZero,
  multiplyFractions,
  ratioOrZero,
  sum,
} from "../src/numbers";

describe("finiteNumber", () => {
  it("coerces finite values and uses the fallback otherwise", () => {
    expect(finiteNumber("2.5")).toBe(2.5);
    expect(finiteNumber(null)).toBe(0);
    expect(finiteNumber(Number.POSITIVE_INFINITY, 4)).toBe(4);
    expect(finiteNumber("not-a-number", 3)).toBe(3);
  });
});

describe("numeric aggregates", () => {
  it("sums values using zero as the additive identity", () => {
    expect(sum([1, 2, 3])).toBe(6);
    expect(sum([])).toBe(0);
  });

  it("calculates the mean and names its empty-input fallback", () => {
    expect(meanOrZero([1, 2, 6])).toBe(3);
    expect(meanOrZero([])).toBe(0);
  });

  it("calculates medians without mutating the input", () => {
    const values = [8, 2, 4, 1];

    expect(medianOrZero(values)).toBe(3);
    expect(medianOrZero([8, 2, 4])).toBe(4);
    expect(medianOrZero([])).toBe(0);
    expect(values).toEqual([8, 2, 4, 1]);
  });

  it("names its zero-denominator fallback", () => {
    expect(ratioOrZero(3, 4)).toBe(0.75);
    expect(ratioOrZero(3, 0)).toBe(0);
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
