import { describe, expect, it } from "vitest";
import {
  invertExchangeRate,
  triangulateExchangeRates,
} from "@/lib/domain/assettracker/exchangeRateDecimal";

describe("exchange-rate decimal arithmetic", () => {
  it("inverts and triangulates without binary floating-point loss", () => {
    expect(invertExchangeRate("1.25")).toBe("0.8");
    expect(invertExchangeRate("3")).toBe("0.333333333333333333");
    expect(triangulateExchangeRates("1.25", "0.8")).toBe("1");
    expect(triangulateExchangeRates("1.23456789", "0.98765432")).toBe(
      "1.2193263098917848",
    );
  });

  it("accepts positive exponential notation from JavaScript numbers", () => {
    expect(triangulateExchangeRates("1e-8", "2e2")).toBe("0.000002");
  });

  it("rejects invalid and non-positive rates", () => {
    expect(() => invertExchangeRate("not-a-rate")).toThrow(
      "Invalid positive decimal rate",
    );
    expect(() => invertExchangeRate("Infinity")).toThrow(
      "Invalid positive decimal rate",
    );
    expect(() => invertExchangeRate("0")).toThrow(
      "Exchange rates must be positive",
    );
    expect(() => invertExchangeRate("-1")).toThrow(
      "Exchange rates must be positive",
    );
  });
});
