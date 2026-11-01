import { describe, expect, it } from "vitest";
import {
  formatCurrencyAmount,
  formatMinorCurrency,
  parseMoneyToMinorUnits,
} from "../src/money";

describe("parseMoneyToMinorUnits", () => {
  it.each([
    ["19.99", 1999],
    ["0.29", 29],
    ["1.1", 110],
    [".5", 50],
    ["1.", 100],
    [19.99, 1999],
  ])("parses %s into minor units", (amount, expected) => {
    expect(parseMoneyToMinorUnits(amount, "Price")).toBe(expected);
  });

  it.each([
    "10.005",
    "100000000000000.01",
    "-1",
    "abc",
    "0x10",
    "1e2",
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    {},
  ])("rejects invalid amount %s", (amount) => {
    expect(() => parseMoneyToMinorUnits(amount, "Price")).toThrow(
      "two decimal places",
    );
  });

  it("keeps blank optional amounts distinct from zero", () => {
    expect(parseMoneyToMinorUnits(null, "Price")).toBeNull();
    expect(parseMoneyToMinorUnits(undefined, "Price")).toBeNull();
    expect(parseMoneyToMinorUnits("", "Price")).toBeNull();
    expect(parseMoneyToMinorUnits("0", "Price")).toBe(0);
  });
});

describe("currency formatting", () => {
  it("formats major and minor units with named currency options", () => {
    expect(formatCurrencyAmount(19.99, "GBP")).toBe("£19.99");
    expect(
      formatCurrencyAmount(19.99, "GBP", { maximumFractionDigits: 0 }),
    ).toBe("£20");
    expect(formatMinorCurrency(1999)).toBe("£19.99");
    expect(formatMinorCurrency(29, "USD")).toBe("US$0.29");
  });
});
