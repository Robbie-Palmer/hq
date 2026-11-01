import { describe, expect, it } from "vitest";

import {
  CountryCodeSchema,
  CurrencyCodeSchema,
  ISO_3166_ALPHA_2_CODES,
  ISO_4217_ALPHABETIC_CODES,
  ISO_CODE_DATASET_METADATA,
  isCountryCode,
  isCurrencyCode,
  parseCountryCode,
  parseCurrencyCode,
} from "../src/index";

describe("ISO 3166-1 alpha-2 codes", () => {
  it("accepts every code in the sourced current dataset", () => {
    expect(ISO_3166_ALPHA_2_CODES).toHaveLength(249);
    for (const code of ISO_3166_ALPHA_2_CODES) {
      expect(CountryCodeSchema.parse(code)).toBe(code);
    }
  });

  it("distinguishes assigned codes from aliases and user-assigned codes", () => {
    expect(isCountryCode("GB")).toBe(true);
    expect(isCountryCode("TW")).toBe(true);
    expect(isCountryCode("UK")).toBe(false);
    expect(isCountryCode("ZZ")).toBe(false);
    expect(isCountryCode("gb")).toBe(false);
  });

  it("returns a branded country code from the parser", () => {
    expect(parseCountryCode("GB")).toBe("GB");
    expect(() => parseCountryCode("UK")).toThrow();
  });
});

describe("ISO 4217 alphabetic codes", () => {
  it("accepts every code in the sourced current List One dataset", () => {
    expect(ISO_4217_ALPHABETIC_CODES).toHaveLength(178);
    for (const code of ISO_4217_ALPHABETIC_CODES) {
      expect(CurrencyCodeSchema.parse(code)).toBe(code);
    }
  });

  it("rejects withdrawn and malformed currency codes", () => {
    expect(isCurrencyCode("GBP")).toBe(true);
    expect(isCurrencyCode("XAD")).toBe(true);
    expect(isCurrencyCode("BGN")).toBe(false);
    expect(isCurrencyCode("gbp")).toBe(false);
    expect(isCurrencyCode("GB")).toBe(false);
  });

  it("returns a branded currency code from the parser", () => {
    expect(parseCurrencyCode("GBP")).toBe("GBP");
    expect(() => parseCurrencyCode("BGN")).toThrow();
  });
});

it("exposes versioned source provenance", () => {
  expect(ISO_CODE_DATASET_METADATA.datasetVersion).toBe("2026-11-01");
  expect(ISO_CODE_DATASET_METADATA.sources.currencies.sourceRevision).toBe(
    "2026-09-17",
  );
});
