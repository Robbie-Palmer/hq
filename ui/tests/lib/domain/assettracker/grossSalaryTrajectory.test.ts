import { describe, expect, it } from "vitest";
import {
  buildGrossSalaryTrajectory,
  grossSalaryChartData,
  type InflationDatasetRelease,
  type SalaryHistoryRecord,
} from "@/lib/domain/assettracker";

const release: InflationDatasetRelease = {
  versionId: "2025-03-19:aaaaaaaaaaaa",
  index: "CPIH",
  source: {
    provider: "Office for National Statistics",
    datasetId: "MM23",
    seriesId: "L522",
    frequency: "monthly",
    baseDefinition: "2015=100",
    geography: "United Kingdom",
    coverageFrom: "2025-01",
    coverageThrough: "2025-03",
    sourceUrl: "https://example.com/cpih",
    releaseVersion: "2025-03-19",
    retrievedAt: "2025-03-20T12:00:00.000Z",
    checksum: `sha256:${"a".repeat(64)}`,
  },
  observations: [
    { period: "2025-01", value: 100 },
    { period: "2025-02", value: 105 },
    { period: "2025-03", value: 110 },
  ],
};

function salaryRecord(
  overrides: Partial<SalaryHistoryRecord> = {},
): SalaryHistoryRecord {
  return {
    id: "salary-january",
    person: "Alex",
    employer: "Example Ltd",
    employmentId: "example",
    currency: "GBP",
    jurisdiction: "England",
    effectiveStart: "2025-01-01",
    effectiveEnd: "2025-01-31",
    payFrequency: "monthly",
    amountKind: "annualSalary",
    workFraction: 1,
    grossPay: 40_000,
    source: { kind: "manual" },
    acceptedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("gross salary trajectory", () => {
  it("uses corrected salary facts and the selected reference period", () => {
    const original = salaryRecord();
    const corrected = salaryRecord({
      id: "salary-january-corrected",
      grossPay: 42_000,
      acceptedAt: "2025-01-02T00:00:00.000Z",
      correctsId: original.id,
    });
    const march = salaryRecord({
      id: "salary-march",
      effectiveStart: "2025-03-01",
      effectiveEnd: "2025-03-31",
      grossPay: 45_000,
      acceptedAt: "2025-03-01T00:00:00.000Z",
    });

    const points = buildGrossSalaryTrajectory(
      [original, corrected, march],
      release,
      "2025-03-01",
      "Alex",
      "annualSalary",
    );

    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({
      recordId: corrected.id,
      nominalGross: 42_000,
      realGross: 46_200,
      cumulativeRealGrowthRate: 0,
    });
    expect(points[1]).toMatchObject({
      nominalGross: 45_000,
      realGross: 45_000,
      realChange: -1_200,
    });
    expect(points[1]?.realChangeRate).toBeCloseTo(-0.025974, 5);
  });

  it("recalculates when the reference period changes", () => {
    const [marchReference] = buildGrossSalaryTrajectory(
      [salaryRecord()],
      release,
      "2025-03-01",
      "Alex",
      "annualSalary",
    );
    const [februaryReference] = buildGrossSalaryTrajectory(
      [salaryRecord()],
      release,
      "2025-02-01",
      "Alex",
      "annualSalary",
    );

    expect(marchReference?.realGross).toBe(44_000);
    expect(februaryReference?.realGross).toBe(42_000);
  });

  it("handles deflation without assuming prices always rise", () => {
    const deflationRelease: InflationDatasetRelease = {
      ...release,
      observations: [
        { period: "2025-01", value: 110 },
        { period: "2025-02", value: 105 },
        { period: "2025-03", value: 100 },
      ],
    };

    const [point] = buildGrossSalaryTrajectory(
      [salaryRecord()],
      deflationRelease,
      "2025-03-01",
      "Alex",
      "annualSalary",
    );

    expect(point?.realGross).toBe(36_363.64);
  });

  it("retains the selected index lineage and handles an unavailable release", () => {
    const rpiRelease: InflationDatasetRelease = {
      ...release,
      index: "RPI",
    };
    const [rpiPoint] = buildGrossSalaryTrajectory(
      [salaryRecord()],
      rpiRelease,
      "2025-03-01",
      "Alex",
      "annualSalary",
    );
    const [unavailablePoint] = buildGrossSalaryTrajectory(
      [salaryRecord()],
      null,
      "2025-03-01",
      "Alex",
      "annualSalary",
    );

    expect(rpiPoint?.inflation).toMatchObject({ index: "RPI" });
    expect(unavailablePoint).toMatchObject({
      nominalGross: 40_000,
      realGross: null,
      inflation: null,
    });
  });

  it("keeps annual salary rates separate from actual period earnings", () => {
    const periodPay = salaryRecord({
      id: "period-pay",
      amountKind: "periodPay",
      grossPay: 3_500,
    });

    const annual = buildGrossSalaryTrajectory(
      [salaryRecord(), periodPay],
      release,
      "2025-03-01",
      "Alex",
      "annualSalary",
    );
    const periods = buildGrossSalaryTrajectory(
      [salaryRecord(), periodPay],
      release,
      "2025-03-01",
      "Alex",
      "periodPay",
    );

    expect(annual.map((point) => point.recordId)).toEqual(["salary-january"]);
    expect(periods.map((point) => point.recordId)).toEqual(["period-pay"]);
    expect(periods[0]?.nominalGross).toBe(3_500);
  });

  it("connects known salary facts across gaps and employment changes", () => {
    const february = salaryRecord({
      id: "salary-february",
      effectiveStart: "2025-02-10",
      effectiveEnd: "2025-02-28",
      grossPay: 42_000,
      acceptedAt: "2025-02-10T00:00:00.000Z",
    });
    const march = salaryRecord({
      id: "salary-march",
      employer: "Next Ltd",
      employmentId: "next",
      effectiveStart: "2025-03-01",
      effectiveEnd: "2025-03-31",
      grossPay: 45_000,
      acceptedAt: "2025-03-01T00:00:00.000Z",
    });
    const points = buildGrossSalaryTrajectory(
      [salaryRecord(), february, march],
      release,
      "2025-03-01",
      "Alex",
      "annualSalary",
    );

    expect(points.map((point) => point.continuity)).toEqual([
      "first",
      "gap",
      "employment-change",
    ]);
    expect(grossSalaryChartData(points).map((point) => point.id)).toEqual([
      "salary-january",
      "salary-february",
      "salary-march",
    ]);
  });

  it("carries an open-ended salary to the reference date as an assumption", () => {
    const points = buildGrossSalaryTrajectory(
      [salaryRecord({ effectiveEnd: undefined })],
      release,
      "2025-03-01",
      "Alex",
      "annualSalary",
    );

    expect(grossSalaryChartData(points, "2025-03-01")).toEqual([
      expect.objectContaining({
        id: "salary-january",
        nominalGross: 40_000,
        realGross: 44_000,
        assumedNominalGross: 40_000,
        assumedRealGross: 44_000,
      }),
      {
        id: "salary-january:assumed",
        date: "2025-03-01",
        assumedNominalGross: 40_000,
        assumedRealGross: 40_000,
      },
    ]);
  });

  it("does not carry a salary beyond its supplied end date", () => {
    const points = buildGrossSalaryTrajectory(
      [salaryRecord()],
      release,
      "2025-03-01",
      "Alex",
      "annualSalary",
    );

    expect(grossSalaryChartData(points, "2025-03-01")).toEqual([
      {
        id: "salary-january",
        date: "2025-01-01",
        nominalGross: 40_000,
        realGross: 44_000,
      },
    ]);
  });

  it("omits non-GBP records without splitting the GBP trajectory", () => {
    const february = salaryRecord({
      id: "salary-february-usd",
      currency: "USD",
      effectiveStart: "2025-02-01",
      effectiveEnd: "2025-02-28",
      acceptedAt: "2025-02-01T00:00:00.000Z",
    });
    const march = salaryRecord({
      id: "salary-march",
      effectiveStart: "2025-03-01",
      effectiveEnd: "2025-03-31",
      acceptedAt: "2025-03-01T00:00:00.000Z",
    });
    const points = buildGrossSalaryTrajectory(
      [salaryRecord(), february, march],
      release,
      "2025-03-01",
      "Alex",
      "annualSalary",
    );

    expect(points.map((point) => point.continuity)).toEqual([
      "first",
      "continuous",
      "continuous",
    ]);
    expect(grossSalaryChartData(points).map((point) => point.id)).toEqual([
      "salary-january",
      "salary-march",
    ]);
  });

  it("does not compare overlaps or changes in working hours", () => {
    const overlapping = salaryRecord({
      id: "salary-overlap",
      effectiveStart: "2025-01-15",
      effectiveEnd: "2025-02-15",
      grossPay: 41_000,
      acceptedAt: "2025-01-15T00:00:00.000Z",
    });
    const reducedHours = salaryRecord({
      id: "salary-reduced-hours",
      effectiveStart: "2025-02-16",
      effectiveEnd: "2025-02-28",
      grossPay: 35_000,
      workFraction: 0.8,
      acceptedAt: "2025-02-16T00:00:00.000Z",
    });

    const points = buildGrossSalaryTrajectory(
      [salaryRecord(), overlapping, reducedHours],
      release,
      "2025-03-01",
      "Alex",
      "annualSalary",
    );

    expect(points.map((point) => point.continuity)).toEqual([
      "first",
      "overlap",
      "work-hours-change",
    ]);
    expect(points[1]?.realChange).toBeNull();
    expect(grossSalaryChartData(points)).toHaveLength(3);
  });

  it("keeps unsupported currencies and missing periods visible", () => {
    const points = buildGrossSalaryTrajectory(
      [
        salaryRecord({ currency: "USD" }),
        salaryRecord({
          id: "salary-before-coverage",
          effectiveStart: "2024-12-01",
          currency: "GBP",
        }),
      ],
      release,
      "2025-03-01",
      "Alex",
      "annualSalary",
    );

    expect(points.map((point) => point.realGross)).toEqual([null, null]);
    expect(points.map((point) => point.inflation)).toEqual([
      expect.objectContaining({ unavailableCode: "period_unavailable" }),
      expect.objectContaining({ unavailableCode: "unsupported_currency" }),
    ]);
    expect(grossSalaryChartData(points)).toHaveLength(1);
  });
});
