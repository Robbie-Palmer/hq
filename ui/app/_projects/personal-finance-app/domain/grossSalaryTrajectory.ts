import {
  adjustForInflation,
  InflationDataError,
  type InflationDatasetRelease,
  type InflationErrorCode,
  type InflationIndex,
} from "finance-inflation-indices";
import type { Currency } from "./currency";
import {
  currentSalaryHistory,
  type SalaryAmountKind,
  type SalaryHistoryRecord,
} from "./salaryHistory";

export type SalaryTrajectoryContinuity =
  | "first"
  | "continuous"
  | "employment-change"
  | "gap"
  | "overlap"
  | "work-hours-change";

export type GrossSalaryTrajectoryPoint = {
  recordId: string;
  person: string;
  employer: string;
  employmentId: string;
  currency: Currency;
  effectiveStart: string;
  effectiveEnd?: string;
  payFrequency: SalaryHistoryRecord["payFrequency"];
  amountKind: SalaryAmountKind;
  workFraction?: number;
  nominalGross: number;
  realGross: number | null;
  realChange: number | null;
  realChangeRate: number | null;
  cumulativeRealGrowthRate: number | null;
  continuity: SalaryTrajectoryContinuity;
  inflation:
    | {
        index: InflationIndex;
        datasetVersion: string;
        sourcePeriod: string;
        sourceIndexLevel: number;
        referencePeriod: string;
        referenceIndexLevel: number;
      }
    | {
        unavailableCode: InflationErrorCode;
        unavailableReason: string;
      }
    | null;
};

export type GrossSalaryChartPoint = {
  id: string;
  date: string;
  nominalGross?: number;
  realGross?: number;
  assumedNominalGross?: number;
  assumedRealGross?: number;
};

function dayAfter(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function overlaps(
  left: SalaryHistoryRecord,
  right: SalaryHistoryRecord,
): boolean {
  const leftEnd = left.effectiveEnd ?? "9999-12-31";
  const rightEnd = right.effectiveEnd ?? "9999-12-31";
  return left.effectiveStart <= rightEnd && right.effectiveStart <= leftEnd;
}

function sameWorkFraction(
  left: SalaryHistoryRecord,
  right: SalaryHistoryRecord,
): boolean {
  return left.workFraction === right.workFraction;
}

function continuityFor(
  previous: SalaryHistoryRecord | undefined,
  current: SalaryHistoryRecord,
  earlier: readonly SalaryHistoryRecord[],
): SalaryTrajectoryContinuity {
  if (previous == null) return "first";
  if (earlier.some((candidate) => overlaps(candidate, current))) {
    return "overlap";
  }
  if (!sameWorkFraction(previous, current)) return "work-hours-change";
  if (previous.employmentId !== current.employmentId) {
    return "employment-change";
  }
  if (
    previous.effectiveEnd != null &&
    dayAfter(previous.effectiveEnd) < current.effectiveStart
  ) {
    return "gap";
  }
  return "continuous";
}

function comparisonKey(record: SalaryHistoryRecord): string {
  const periodBasis =
    record.amountKind === "periodPay" ? record.payFrequency : "annual-rate";
  return [
    record.person,
    record.currency,
    record.amountKind,
    periodBasis,
    record.workFraction ?? "unknown-hours",
  ].join(":");
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function inflationAdjustment(
  record: SalaryHistoryRecord & { grossPay: number },
  release: InflationDatasetRelease | null,
  referenceDate: string,
): Pick<GrossSalaryTrajectoryPoint, "realGross" | "inflation"> {
  if (release == null) return { realGross: null, inflation: null };
  try {
    const result = adjustForInflation(release, {
      amount: record.grossPay,
      currency: record.currency,
      sourceDate: record.effectiveStart,
      referenceDate,
    });
    return {
      realGross: roundMoney(result.amount),
      inflation: {
        index: result.index,
        datasetVersion: result.datasetVersion,
        sourcePeriod: result.sourcePeriod,
        sourceIndexLevel: result.sourceIndexLevel,
        referencePeriod: result.referencePeriod,
        referenceIndexLevel: result.referenceIndexLevel,
      },
    };
  } catch (error) {
    if (!(error instanceof InflationDataError)) throw error;
    return {
      realGross: null,
      inflation: {
        unavailableCode: error.code,
        unavailableReason: error.message,
      },
    };
  }
}

function addComparison(
  point: GrossSalaryTrajectoryPoint,
  key: string,
  previousComparable: Map<string, GrossSalaryTrajectoryPoint>,
  comparisonBaseline: Map<string, GrossSalaryTrajectoryPoint>,
): GrossSalaryTrajectoryPoint {
  if (point.realGross == null || point.continuity === "overlap") return point;
  const prior = previousComparable.get(key);
  const baseline = comparisonBaseline.get(key);
  const realChange =
    prior?.realGross == null
      ? null
      : roundMoney(point.realGross - prior.realGross);
  const realChangeRate =
    prior?.realGross == null || prior.realGross === 0
      ? null
      : point.realGross / prior.realGross - 1;
  const cumulativeRealGrowthRate =
    baseline?.realGross == null ? 0 : point.realGross / baseline.realGross - 1;
  const compared = {
    ...point,
    realChange,
    realChangeRate,
    cumulativeRealGrowthRate,
  };
  comparisonBaseline.set(key, baseline ?? compared);
  previousComparable.set(key, compared);
  return compared;
}

export function buildGrossSalaryTrajectory(
  records: readonly SalaryHistoryRecord[],
  release: InflationDatasetRelease | null,
  referenceDate: string,
  person: string,
  amountKind: SalaryAmountKind,
): GrossSalaryTrajectoryPoint[] {
  const selected = currentSalaryHistory(records).filter(
    (record): record is SalaryHistoryRecord & { grossPay: number } =>
      record.person === person &&
      record.amountKind === amountKind &&
      record.grossPay != null,
  );
  const previousComparable = new Map<string, GrossSalaryTrajectoryPoint>();
  const comparisonBaseline = new Map<string, GrossSalaryTrajectoryPoint>();

  return selected.map((record, index) => {
    const previous = selected[index - 1];
    const continuity = continuityFor(
      previous,
      record,
      selected.slice(0, index),
    );
    const adjusted = inflationAdjustment(record, release, referenceDate);
    const key = comparisonKey(record);
    const point: GrossSalaryTrajectoryPoint = {
      recordId: record.id,
      person: record.person,
      employer: record.employer,
      employmentId: record.employmentId,
      currency: record.currency,
      effectiveStart: record.effectiveStart,
      effectiveEnd: record.effectiveEnd,
      payFrequency: record.payFrequency,
      amountKind: record.amountKind,
      workFraction: record.workFraction,
      nominalGross: record.grossPay,
      realGross: adjusted.realGross,
      realChange: null,
      realChangeRate: null,
      cumulativeRealGrowthRate: null,
      continuity,
      inflation: adjusted.inflation,
    };
    return addComparison(point, key, previousComparable, comparisonBaseline);
  });
}

export function grossSalaryChartData(
  points: readonly GrossSalaryTrajectoryPoint[],
  referenceDate?: string,
): GrossSalaryChartPoint[] {
  const chartData: GrossSalaryChartPoint[] = points
    .filter((point) => point.currency === "GBP")
    .map((point) => ({
      id: point.recordId,
      date: point.effectiveStart,
      nominalGross: point.nominalGross,
      realGross: point.realGross ?? undefined,
    }));
  const latest = points.at(-1);
  const latestChartPoint = chartData.at(-1);
  if (
    referenceDate == null ||
    latest == null ||
    latestChartPoint == null ||
    latest.currency !== "GBP" ||
    latest.effectiveEnd != null ||
    referenceDate <= latest.effectiveStart
  ) {
    return chartData;
  }

  return [
    ...chartData.slice(0, -1),
    {
      ...latestChartPoint,
      assumedNominalGross: latest.nominalGross,
      assumedRealGross: latest.realGross ?? undefined,
    },
    {
      id: `${latest.recordId}:assumed`,
      date: referenceDate,
      assumedNominalGross: latest.nominalGross,
      assumedRealGross:
        latest.realGross == null ? undefined : latest.nominalGross,
    },
  ];
}
