import {
  adjustForInflation,
  InflationDataError,
  type InflationDatasetRelease,
  type InflationErrorCode,
  type InflationIndex,
} from "finance-inflation-indices";
import type { Currency } from "./currency";
import { buildGrossSalaryTrajectory } from "./grossSalaryTrajectory";
import {
  calculateNoPensionSalaryHistory,
  type NoPensionSalaryPeriodCalculation,
} from "./salaryCalculation";
import {
  currentSalaryHistory,
  type SalaryAmountKind,
  type SalaryHistoryRecord,
} from "./salaryHistory";

export type NoPensionNetTrajectoryPoint = {
  calculationId: string;
  recordId: string;
  person: string;
  employer: string;
  employmentId: string;
  currency: Currency;
  taxYear: string;
  effectiveStart: string;
  effectiveEnd: string;
  recordEffectiveEnd?: string;
  payFrequency: SalaryHistoryRecord["payFrequency"];
  amountKind: SalaryAmountKind;
  workFraction?: number;
  continuity: NoPensionNetContinuity;
  nominalNet: number | null;
  realNet: number | null;
  observedNet: number | null;
  estimatedRecordedPensionNet: number | null;
  grossCashPayChange: number | null;
  incomeTaxChange: number | null;
  employeeNationalInsuranceChange: number | null;
  foregoneEmployeeContribution: number | null;
  employerPensionContribution: number | null;
  takeHomePayChange: number | null;
  calculation: NoPensionSalaryPeriodCalculation;
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

export type NoPensionNetContinuity =
  | "first"
  | "continuous"
  | "employment-change"
  | "gap"
  | "overlap"
  | "work-hours-change";

export type NoPensionNetChartPoint = {
  id: string;
  date: string;
  nominalNet?: number;
  realNet?: number;
  assumedNominalNet?: number;
  assumedRealNet?: number;
};

function pounds(pence: number | null): number | null {
  return pence == null ? null : Math.round(pence) / 100;
}

function inflationAdjustment(
  amount: number | null,
  currency: Currency,
  sourceDate: string,
  release: InflationDatasetRelease | null,
  referenceDate: string,
): Pick<NoPensionNetTrajectoryPoint, "realNet" | "inflation"> {
  if (amount == null || release == null) {
    return { realNet: null, inflation: null };
  }
  try {
    const result = adjustForInflation(release, {
      amount,
      currency,
      sourceDate,
      referenceDate,
    });
    return {
      realNet: Math.round(result.amount * 100) / 100,
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
      realNet: null,
      inflation: {
        unavailableCode: error.code,
        unavailableReason: error.message,
      },
    };
  }
}

function calculationPoint(
  calculation: NoPensionSalaryPeriodCalculation,
  record: SalaryHistoryRecord,
  continuity: NoPensionNetContinuity,
  release: InflationDatasetRelease | null,
  referenceDate: string,
): NoPensionNetTrajectoryPoint {
  const result = calculation.result;
  const comparison = calculation.comparison;
  const nominalNet = result.available
    ? pounds(result.components.takeHomePayPence)
    : null;
  const adjusted = inflationAdjustment(
    nominalNet,
    record.currency,
    calculation.effectiveFrom,
    release,
    referenceDate,
  );
  return {
    calculationId: calculation.id,
    recordId: record.id,
    person: record.person,
    employer: record.employer,
    employmentId: record.employmentId,
    currency: record.currency,
    taxYear: calculation.taxYear,
    effectiveStart: calculation.effectiveFrom,
    effectiveEnd: calculation.effectiveTo,
    recordEffectiveEnd: record.effectiveEnd,
    payFrequency: record.payFrequency,
    amountKind: record.amountKind,
    workFraction: record.workFraction,
    continuity,
    nominalNet,
    realNet: adjusted.realNet,
    observedNet: pounds(calculation.observations.takeHomePayPence),
    estimatedRecordedPensionNet: calculation.baselineResult.available
      ? pounds(calculation.baselineResult.components.takeHomePayPence)
      : null,
    grossCashPayChange: pounds(comparison?.grossCashPayChangePence ?? null),
    incomeTaxChange: pounds(comparison?.incomeTaxChangePence ?? null),
    employeeNationalInsuranceChange: pounds(
      comparison?.employeeNationalInsuranceChangePence ?? null,
    ),
    foregoneEmployeeContribution: pounds(
      comparison?.foregoneEmployeeContributionPence ?? null,
    ),
    employerPensionContribution: pounds(
      calculation.employerPension.contributionPence,
    ),
    takeHomePayChange: pounds(comparison?.takeHomePayChangePence ?? null),
    calculation,
    inflation: adjusted.inflation,
  };
}

export function buildNoPensionNetTrajectory(
  records: readonly SalaryHistoryRecord[],
  release: InflationDatasetRelease | null,
  referenceDate: string,
  person: string,
  amountKind: SalaryAmountKind,
  asOf = new Date().toISOString().slice(0, 10),
): NoPensionNetTrajectoryPoint[] {
  const selected = currentSalaryHistory(records).filter(
    (record) => record.person === person && record.amountKind === amountKind,
  );
  const recordsById = new Map(selected.map((record) => [record.id, record]));
  const recordContinuity = new Map(
    buildGrossSalaryTrajectory(
      selected,
      null,
      referenceDate,
      person,
      amountKind,
    ).map((point) => [point.recordId, point.continuity]),
  );
  const seenRecords = new Set<string>();

  return calculateNoPensionSalaryHistory(selected, asOf).flatMap(
    (calculation) => {
      const record = recordsById.get(calculation.recordId);
      if (record == null) return [];
      const continuity = seenRecords.has(record.id)
        ? "continuous"
        : (recordContinuity.get(record.id) ?? "first");
      seenRecords.add(record.id);
      return [
        calculationPoint(
          calculation,
          record,
          continuity,
          release,
          referenceDate,
        ),
      ];
    },
  );
}

export function noPensionNetChartData(
  points: readonly NoPensionNetTrajectoryPoint[],
  referenceDate?: string,
): NoPensionNetChartPoint[] {
  const chartData = points.map((point) => ({
    id: point.calculationId,
    date: point.effectiveStart,
    nominalNet: point.nominalNet ?? undefined,
    realNet: point.realNet ?? undefined,
  }));
  const latest = points.at(-1);
  const latestChartPoint = chartData.at(-1);
  if (
    referenceDate == null ||
    latest == null ||
    latestChartPoint == null ||
    latest.recordEffectiveEnd != null ||
    latest.nominalNet == null ||
    referenceDate <= latest.effectiveStart
  ) {
    return chartData;
  }

  return [
    ...chartData.slice(0, -1),
    {
      ...latestChartPoint,
      assumedNominalNet: latest.nominalNet,
      assumedRealNet: latest.realNet ?? undefined,
    },
    {
      id: `${latest.calculationId}:assumed`,
      date: referenceDate,
      assumedNominalNet: latest.nominalNet,
      assumedRealNet: latest.realNet == null ? undefined : latest.nominalNet,
    },
  ];
}
