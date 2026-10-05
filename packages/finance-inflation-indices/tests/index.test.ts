import { describe, expect, it } from "vitest";
import {
  adjustForInflation,
  type InflationDataError,
  type InflationDatasetArchive,
  type InflationDatasetRelease,
  ingestInflationRelease,
  selectInflationDataset,
} from "../src";

function release(
  values: Array<[string, number]>,
  overrides: Partial<InflationDatasetRelease> = {},
): InflationDatasetRelease {
  const first = values[0];
  if (first == null) throw new Error("Fixture needs at least one observation");
  return {
    versionId: "2025-03-01:aaaaaaaaaaaa",
    index: "CPIH",
    source: {
      provider: "Office for National Statistics",
      datasetId: "fixture",
      seriesId: "FIXTURE",
      frequency: "monthly",
      baseDefinition: "2015=100",
      geography: "United Kingdom",
      coverageFrom: first[0],
      coverageThrough: values.at(-1)?.[0] ?? first[0],
      sourceUrl: "https://example.com/fixture",
      releaseVersion: "2025-03-01",
      retrievedAt: "2025-03-02T12:00:00.000Z",
      checksum: `sha256:${"a".repeat(64)}`,
    },
    observations: values.map(([period, value]) => ({ period, value })),
    ...overrides,
  };
}

describe("inflation adjustment", () => {
  it("uses the reference/source index ratio for inflation and deflation", () => {
    const dataset = release([
      ["2024-01", 100],
      ["2024-02", 125],
      ["2024-03", 80],
    ]);

    expect(
      adjustForInflation(dataset, {
        amount: 1_000,
        currency: "GBP",
        sourceDate: "2024-01-31",
        referenceDate: "2024-02-01",
      }).amount,
    ).toBe(1_250);
    expect(
      adjustForInflation(dataset, {
        amount: 1_000,
        currency: "GBP",
        sourceDate: "2024-01-01",
        referenceDate: "2024-03-31",
      }).amount,
    ).toBe(800);
  });

  it("is invariant when every index level is rebased", () => {
    const original = release([
      ["2024-01", 100],
      ["2024-02", 125],
    ]);
    const rebased = release([
      ["2024-01", 40],
      ["2024-02", 50],
    ]);
    const input = {
      amount: 72_000,
      currency: "GBP" as const,
      sourceDate: "2024-01-15",
      referenceDate: "2024-02-15",
    };

    expect(adjustForInflation(original, input).amount).toBe(
      adjustForInflation(rebased, input).amount,
    );
  });

  it("maps monthly dates to months and annual dates to years", () => {
    const monthly = release([
      ["2024-01", 100],
      ["2024-02", 110],
    ]);
    const annual = release(
      [
        ["2023", 80],
        ["2024", 100],
      ],
      {
        source: {
          ...monthly.source,
          frequency: "annual",
          coverageFrom: "2023",
          coverageThrough: "2024",
        },
        observations: [
          { period: "2023", value: 80 },
          { period: "2024", value: 100 },
        ],
      },
    );

    expect(
      adjustForInflation(monthly, {
        amount: 100,
        currency: "GBP",
        sourceDate: "2024-01-01",
        referenceDate: "2024-02-29",
      }).referencePeriod,
    ).toBe("2024-02");
    expect(
      adjustForInflation(annual, {
        amount: 80,
        currency: "GBP",
        sourceDate: "2023-02-01",
        referenceDate: "2024-12-31",
      }).amount,
    ).toBe(100);
  });

  it("rejects missing, future, and unsupported-currency comparisons", () => {
    const dataset = release([
      ["2024-01", 100],
      ["2024-03", 110],
    ]);
    const request = {
      amount: 100,
      currency: "GBP" as const,
      sourceDate: "2024-01-01",
      referenceDate: "2024-02-01",
    };

    expect(() => adjustForInflation(dataset, request)).toThrowError(
      expect.objectContaining<Partial<InflationDataError>>({
        code: "missing_period",
      }),
    );
    expect(() =>
      adjustForInflation(dataset, {
        ...request,
        referenceDate: "2024-04-01",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<InflationDataError>>({
        code: "future_period_unavailable",
      }),
    );
    expect(() =>
      adjustForInflation(dataset, { ...request, currency: "USD" }),
    ).toThrowError(
      expect.objectContaining<Partial<InflationDataError>>({
        code: "unsupported_currency",
      }),
    );
  });

  it("changes the result when the reference date changes", () => {
    const dataset = release([
      ["2024-01", 100],
      ["2024-02", 110],
      ["2024-03", 120],
    ]);
    const base = {
      amount: 50_000,
      currency: "GBP" as const,
      sourceDate: "2024-01-31",
    };

    expect(
      adjustForInflation(dataset, {
        ...base,
        referenceDate: "2024-02-01",
      }).amount,
    ).toBeCloseTo(55_000);
    expect(
      adjustForInflation(dataset, {
        ...base,
        referenceDate: "2024-03-01",
      }).amount,
    ).toBe(60_000);
  });
});

describe("versioned inflation archive", () => {
  it("is idempotent and retains revised releases for pinned selection", () => {
    const first = release([
      ["2024-01", 100],
      ["2024-02", 110],
    ]);
    const revision = release(
      [
        ["2024-01", 100],
        ["2024-02", 111],
      ],
      {
        versionId: "2025-03-01:bbbbbbbbbbbb",
        source: {
          ...first.source,
          checksum: `sha256:${"b".repeat(64)}`,
        },
      },
    );
    const empty: InflationDatasetArchive = { releases: [] };
    const stored = ingestInflationRelease(empty, first);
    const repeated = ingestInflationRelease(stored, first);
    const revised = ingestInflationRelease(repeated, revision);

    expect(repeated).toEqual(stored);
    expect(revised.releases).toHaveLength(2);
    expect(
      selectInflationDataset(revised, "CPIH", first.versionId).observations.at(
        1,
      )?.value,
    ).toBe(110);
    expect(
      selectInflationDataset(
        revised,
        "CPIH",
        revision.versionId,
      ).observations.at(1)?.value,
    ).toBe(111);
    expect(() =>
      selectInflationDataset(revised, "CPI", first.versionId),
    ).toThrowError(
      expect.objectContaining<Partial<InflationDataError>>({
        code: "dataset_unavailable",
      }),
    );
  });
});
