import { describe, expect, it } from "vitest";
import {
  estimatePropertyValueHistory,
  type HousePriceIndexRelease,
  type PropertyHistoryError,
  PROPERTY_INDEX_FORMULA,
} from "../src";

function release(
  values: Array<{
    period: string;
    geographyCode?: string;
    geographyName?: string;
    propertyType?: "all" | "detached";
    index: number;
    provisional?: boolean;
  }>,
  overrides: Partial<HousePriceIndexRelease> = {},
): HousePriceIndexRelease {
  return {
    versionId: "2025-03:aaaaaaaaaaaa",
    source: {
      provider: "HM Land Registry",
      dataset: "UK House Price Index",
      releasePeriod: "2025-03",
      publishedAt: "2025-05-21",
      retrievedAt: "2025-05-22T10:00:00.000Z",
      pageUrl: "https://example.com/uk-hpi",
      downloadUrl: "https://example.com/uk-hpi.csv",
      checksum: `sha256:${"a".repeat(64)}`,
      rawObjectKey: "uk-hpi/releases/fixture.csv",
      licence: "Open Government Licence v3.0",
      attribution: "Contains HM Land Registry fixture data.",
    },
    observations: values.map((value) => ({
      geographyCode: "E06000001",
      geographyName: "Local area",
      propertyType: "detached",
      provisional: false,
      ...value,
    })),
    ...overrides,
  };
}

const recordedValuations = [
  {
    id: "purchase",
    date: "2024-01-15",
    value: 200_000,
    currency: "GBP" as const,
    kind: "purchase-price" as const,
  },
  {
    id: "survey",
    date: "2024-03-20",
    value: 230_000,
    currency: "GBP" as const,
    kind: "formal-valuation" as const,
    sourceLabel: "Chartered surveyor",
  },
];

const exactSeries = {
  geographyCode: "E06000001",
  propertyType: "detached" as const,
  geographyMatch: "exact" as const,
  propertyTypeMatch: "exact" as const,
};

describe("indexed property history", () => {
  it("calculates rising and falling values with reproducible provenance", () => {
    const dataset = release([
      { period: "2024-01", index: 100 },
      { period: "2024-02", index: 120 },
      { period: "2024-03", index: 90, provisional: true },
    ]);
    const input = {
      recordedValuations,
      anchorValuationId: "purchase",
      targetDates: ["2024-03-01", "2024-02-01"],
      seriesHierarchy: [exactSeries],
    };

    const history = estimatePropertyValueHistory(dataset, input);

    expect(history.estimates).toEqual([
      {
        kind: "index-estimate",
        date: "2024-02-01",
        period: "2024-02",
        value: 240_000,
        currency: "GBP",
        targetIndexLevel: 120,
        provisional: false,
      },
      {
        kind: "index-estimate",
        date: "2024-03-01",
        period: "2024-03",
        value: 180_000,
        currency: "GBP",
        targetIndexLevel: 90,
        provisional: true,
      },
    ]);
    expect(history.calculation).toMatchObject({
      method: "uk-hpi-index-ratio",
      formula: PROPERTY_INDEX_FORMULA,
      anchor: {
        id: "purchase",
        date: "2024-01-15",
        value: 200_000,
        period: "2024-01",
        indexLevel: 100,
      },
      series: {
        geographyCode: "E06000001",
        geographyName: "Local area",
        propertyType: "detached",
        hierarchyPosition: 1,
        fallback: false,
        label: "Exact match: Local area, detached",
      },
      dataset: {
        provider: "HM Land Registry",
        name: "UK House Price Index",
        versionId: "2025-03:aaaaaaaaaaaa",
        releasePeriod: "2025-03",
        publishedAt: "2025-05-21",
        checksum: `sha256:${"a".repeat(64)}`,
      },
    });
    expect(estimatePropertyValueHistory(dataset, input)).toEqual(history);
  });

  it("uses the first available fallback and labels the weaker match", () => {
    const dataset = release([
      {
        period: "2024-01",
        geographyCode: "E12000001",
        geographyName: "North East",
        propertyType: "all",
        index: 80,
      },
      {
        period: "2024-02",
        geographyCode: "E12000001",
        geographyName: "North East",
        propertyType: "all",
        index: 84,
      },
    ]);

    const history = estimatePropertyValueHistory(dataset, {
      recordedValuations,
      anchorValuationId: "purchase",
      targetDates: ["2024-02-01"],
      seriesHierarchy: [
        exactSeries,
        {
          geographyCode: "E12000001",
          propertyType: "all",
          geographyMatch: "broader",
          propertyTypeMatch: "all",
        },
        {
          geographyCode: "E92000001",
          propertyType: "all",
          geographyMatch: "national",
          propertyTypeMatch: "all",
        },
      ],
    });

    expect(history.calculation.series).toMatchObject({
      geographyCode: "E12000001",
      hierarchyPosition: 2,
      fallback: true,
      label: "Broader geography fallback: North East, all",
    });
    expect(history.calculation.skippedSeries).toEqual([
      { candidate: exactSeries, reason: "anchor-period-unavailable" },
    ]);
    expect(history.estimates[0]).toMatchObject({
      kind: "index-estimate",
      value: 210_000,
    });
  });

  it("keeps unavailable target periods in the history without changing series", () => {
    const dataset = release([
      { period: "2024-01", index: 100 },
      {
        period: "2024-02",
        geographyCode: "E92000001",
        geographyName: "England",
        propertyType: "all",
        index: 110,
      },
    ]);

    const history = estimatePropertyValueHistory(dataset, {
      recordedValuations,
      anchorValuationId: "purchase",
      targetDates: ["2024-02-15"],
      seriesHierarchy: [
        exactSeries,
        {
          geographyCode: "E92000001",
          propertyType: "all",
          geographyMatch: "national",
          propertyTypeMatch: "all",
        },
      ],
    });

    expect(history.calculation.series.geographyCode).toBe("E06000001");
    expect(history.estimates).toEqual([
      {
        kind: "index-unavailable",
        date: "2024-02-15",
        period: "2024-02",
        reason: "index-period-unavailable",
      },
    ]);
  });

  it("pins revisions and recalculates only when the chosen dataset changes", () => {
    const first = release([
      { period: "2024-01", index: 100 },
      { period: "2024-02", index: 110 },
    ]);
    const revised = release(
      [
        { period: "2024-01", index: 100 },
        { period: "2024-02", index: 115 },
      ],
      {
        versionId: "2025-04:bbbbbbbbbbbb",
        source: {
          ...first.source,
          releasePeriod: "2025-04",
          publishedAt: "2025-06-18",
          checksum: `sha256:${"b".repeat(64)}`,
        },
      },
    );
    const input = {
      recordedValuations,
      anchorValuationId: "purchase",
      targetDates: ["2024-02-01"],
      seriesHierarchy: [exactSeries],
    };

    const originalHistory = estimatePropertyValueHistory(first, input);
    const revisedHistory = estimatePropertyValueHistory(revised, input);

    expect(originalHistory.estimates[0]?.kind).toBe("index-estimate");
    expect(revisedHistory.estimates[0]?.kind).toBe("index-estimate");
    if (
      originalHistory.estimates[0]?.kind !== "index-estimate" ||
      revisedHistory.estimates[0]?.kind !== "index-estimate"
    ) {
      throw new Error("Expected indexed estimates from both releases");
    }
    expect(originalHistory.estimates[0].value).toBeCloseTo(220_000);
    expect(revisedHistory.estimates[0].value).toBeCloseTo(230_000);
    expect(originalHistory.calculation.dataset.versionId).toBe(first.versionId);
    expect(revisedHistory.calculation.dataset.versionId).toBe(
      revised.versionId,
    );
  });

  it("returns recorded values separately and never replaces a formal valuation", () => {
    const dataset = release([
      { period: "2024-01", index: 100 },
      { period: "2024-03", index: 105 },
    ]);

    const history = estimatePropertyValueHistory(dataset, {
      recordedValuations,
      anchorValuationId: "purchase",
      targetDates: ["2024-03-20"],
      seriesHierarchy: [exactSeries],
    });

    expect(history.recordedValuations).toEqual(recordedValuations);
    expect(history.recordedValuations[1]).toMatchObject({
      id: "survey",
      kind: "formal-valuation",
      value: 230_000,
    });
    expect(history.estimates[0]).toMatchObject({
      kind: "index-estimate",
      date: "2024-03-20",
      value: 210_000,
    });
  });

  it("fails when neither the anchor nor any fallback series is available", () => {
    const dataset = release([{ period: "2024-02", index: 110 }]);

    expect(() =>
      estimatePropertyValueHistory(dataset, {
        recordedValuations,
        anchorValuationId: "missing",
        targetDates: ["2024-02-01"],
        seriesHierarchy: [exactSeries],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<PropertyHistoryError>>({
        code: "anchor_unavailable",
      }),
    );
    expect(() =>
      estimatePropertyValueHistory(dataset, {
        recordedValuations,
        anchorValuationId: "purchase",
        targetDates: ["2024-02-01"],
        seriesHierarchy: [exactSeries],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<PropertyHistoryError>>({
        code: "series_unavailable",
      }),
    );
  });
});
