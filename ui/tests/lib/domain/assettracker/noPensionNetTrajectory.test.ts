import { describe, expect, it } from "vitest";
import {
  buildNoPensionNetTrajectory,
  type InflationDatasetRelease,
  noPensionNetChartData,
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
    effectiveEnd: "2025-03-31",
    payFrequency: "monthly",
    amountKind: "annualSalary",
    workFraction: 1,
    grossPay: 60_000,
    otherTaxableIncome: 0,
    otherDeductions: 0,
    nationalInsuranceCategory: "A",
    isCompanyDirector: false,
    employeePension: {
      arrangement: "salarySacrifice",
      amount: 6_000,
      basis: "grossPay",
    },
    employerPension: {
      arrangement: "other",
      amount: 3_000,
      basis: "grossPay",
    },
    source: { kind: "manual" },
    acceptedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("no-pension net salary trajectory", () => {
  it("plots a hypothetical net result and its purchasing power", () => {
    const [point] = buildNoPensionNetTrajectory(
      [salaryRecord()],
      release,
      "2025-03-01",
      "Alex",
      "annualSalary",
      "2025-03-31",
    );

    expect(point).toMatchObject({
      recordId: "salary-january",
      taxYear: "2024-25",
      nominalNet: 45_358,
      realNet: 49_893.8,
      grossCashPayChange: 6_000,
      incomeTaxChange: 2_400,
      employeeNationalInsuranceChange: 120,
      foregoneEmployeeContribution: 6_000,
      employerPensionContribution: 3_000,
      takeHomePayChange: 3_480,
    });
    expect(point?.calculation.result.available).toBe(true);
    expect(point?.inflation).toMatchObject({
      index: "CPIH",
      referencePeriod: "2025-03",
    });
  });

  it("handles deflation and changes at historical rule boundaries", () => {
    const deflationRelease: InflationDatasetRelease = {
      ...release,
      observations: [
        { period: "2025-01", value: 110 },
        { period: "2025-02", value: 105 },
        { period: "2025-03", value: 100 },
      ],
    };
    const [deflated] = buildNoPensionNetTrajectory(
      [salaryRecord()],
      deflationRelease,
      "2025-03-01",
      "Alex",
      "annualSalary",
      "2025-03-31",
    );
    const changedRules = buildNoPensionNetTrajectory(
      [
        salaryRecord({
          effectiveStart: "2023-04-06",
          effectiveEnd: "2024-04-05",
        }),
      ],
      null,
      "2025-03-01",
      "Alex",
      "annualSalary",
      "2024-04-05",
    );

    expect(deflated?.realNet).toBe(41_234.55);
    expect(changedRules.map((point) => point.effectiveStart)).toEqual([
      "2023-04-06",
      "2024-01-06",
    ]);
    expect(changedRules.map((point) => point.continuity)).toEqual([
      "first",
      "continuous",
    ]);
  });

  it("uses corrected facts and keeps unavailable calculations visible", () => {
    const original = salaryRecord();
    const corrected = salaryRecord({
      id: "salary-january-corrected",
      correctsId: original.id,
      grossPay: 65_000,
      acceptedAt: "2025-01-02T00:00:00.000Z",
    });
    const unsupported = salaryRecord({
      id: "salary-unsupported",
      effectiveStart: "2014-04-06",
      effectiveEnd: "2015-04-05",
      acceptedAt: "2014-04-06T00:00:00.000Z",
    });

    const points = buildNoPensionNetTrajectory(
      [original, corrected, unsupported],
      release,
      "2025-03-01",
      "Alex",
      "annualSalary",
      "2025-03-31",
    );

    expect(points.map((point) => point.recordId)).toEqual([
      "salary-unsupported",
      "salary-january-corrected",
    ]);
    expect(points[0]).toMatchObject({ nominalNet: null, realNet: null });
    expect(points[0]?.calculation.result).toMatchObject({
      available: false,
      reasons: [expect.objectContaining({ code: "unsupported-rules" })],
    });
    expect(noPensionNetChartData(points)[0]).toEqual({
      id: points[0]?.calculationId,
      date: "2014-04-06",
      nominalNet: undefined,
      realNet: undefined,
    });
  });

  it("plots net pay when a separate employer pension amount is unavailable", () => {
    const [point] = buildNoPensionNetTrajectory(
      [
        salaryRecord({
          effectiveStart: "2016-01-01",
          effectiveEnd: "2016-04-05",
          employeePension: {
            arrangement: "netPay",
            rate: 0.03,
            basis: "qualifyingEarnings",
          },
          employerPension: {
            arrangement: "other",
            rate: 0.03,
            basis: "qualifyingEarnings",
          },
        }),
      ],
      null,
      "2025-03-01",
      "Alex",
      "annualSalary",
      "2016-04-05",
    );

    expect(point).toMatchObject({
      effectiveStart: "2016-01-01",
      nominalNet: 42_126.28,
      employerPensionContribution: null,
    });
    expect(point?.calculation.employerPension.unavailableReasons).toEqual([
      expect.objectContaining({ code: "unsupported-qualifying-earnings" }),
    ]);
    if (point == null) throw new Error("Expected an early net salary point");
    expect(noPensionNetChartData([point])[0]?.nominalNet).toBe(42_126.28);
  });

  it("carries an open-ended estimate to the reference date as an assumption", () => {
    const points = buildNoPensionNetTrajectory(
      [salaryRecord({ effectiveEnd: undefined })],
      release,
      "2025-03-01",
      "Alex",
      "annualSalary",
      "2025-03-01",
    );
    const latest = points.at(-1);

    expect(noPensionNetChartData(points, "2025-03-01")).toEqual([
      expect.objectContaining({
        id: latest?.calculationId,
        assumedNominalNet: latest?.nominalNet,
        assumedRealNet: latest?.realNet,
      }),
      {
        id: `${latest?.calculationId}:assumed`,
        date: "2025-03-01",
        assumedNominalNet: latest?.nominalNet,
        assumedRealNet: latest?.nominalNet,
      },
    ]);
  });
});
