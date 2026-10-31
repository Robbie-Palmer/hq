import { describe, expect, it } from "vitest";
import {
  HousingValueSchema,
  housingValueAgeDays,
  isHousingValueStale,
  UnsupportedHousingRegionSchema,
} from "../src";
import {
  askingPriceValue,
  completedSaleValue,
  confidenceFixtures,
  forecastValue,
  manualOverrideValue,
  revisedFallbackIndexEstimate,
  staleIndexEstimate,
  unsupportedScotland,
} from "./valueConfidenceFixtures";

describe("housing value confidence", () => {
  it("keeps each evidence kind distinct", () => {
    expect(confidenceFixtures.map(({ kind }) => kind)).toEqual([
      "index-estimate",
      "index-estimate",
      "manual-override",
      "asking-price",
      "completed-sale",
      "forecast",
    ]);
    expect(manualOverrideValue.source.kind).toBe("manual-entry");
    expect(askingPriceValue.source.kind).toBe("property-listing");
    expect(completedSaleValue.source.kind).toBe("official-completed-sale");
    expect(forecastValue.source.kind).toBe("scenario-model");
  });

  it("calculates staleness from the value date and recorded policy", () => {
    expect(housingValueAgeDays(staleIndexEstimate)).toBe(1003);
    expect(isHousingValueStale(staleIndexEstimate)).toBe(true);
    expect(isHousingValueStale(completedSaleValue)).toBe(false);
    expect(isHousingValueStale(forecastValue)).toBe(false);
  });

  it("retains revision, fallback, range, and unsupported-region evidence", () => {
    expect(revisedFallbackIndexEstimate).toMatchObject({
      dataStatus: "revised",
      fallback: { used: true },
      uncertainty: { kind: "indicative-range" },
    });
    expect(UnsupportedHousingRegionSchema.parse(unsupportedScotland)).toEqual(
      unsupportedScotland,
    );
  });

  it("rejects false precision and mismatched sources", () => {
    expect(
      HousingValueSchema.safeParse({
        ...staleIndexEstimate,
        uncertainty: { kind: "point", explanation: "Exact estimate" },
      }).success,
    ).toBe(false);
    expect(
      HousingValueSchema.safeParse({
        ...askingPriceValue,
        source: { ...askingPriceValue.source, kind: "official-completed-sale" },
      }).success,
    ).toBe(false);
    expect(
      HousingValueSchema.safeParse({
        ...revisedFallbackIndexEstimate,
        revisionNote: undefined,
      }).success,
    ).toBe(false);
  });
});
