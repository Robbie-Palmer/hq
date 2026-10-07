"use client";

import { latestOnsInflationRelease } from "finance-inflation-indices/dataset";
import { useState } from "react";
import {
  buildGrossSalaryTrajectory,
  buildNoPensionNetTrajectory,
  currentSalaryHistory,
  grossSalaryChartData,
  type InflationIndex,
  InflationIndexSchema,
  noPensionNetChartData,
  type SalaryAmountKind,
  type SalaryHistoryRecord,
} from "@/lib/domain/assettracker";

function referenceDate(period: string, frequency?: "monthly" | "annual") {
  return frequency === "annual" ? `${period}-01-01` : `${period}-01`;
}

export function useRealGrossSalaryHistory(
  salaryHistory: readonly SalaryHistoryRecord[],
) {
  const currentRecords = currentSalaryHistory(salaryHistory);
  const people = [
    ...new Set(currentRecords.map((record) => record.person)),
  ].toSorted((left, right) => left.localeCompare(right));
  const [selectedPerson, setSelectedPerson] = useState(people[0] ?? "");
  const [amountKind, setAmountKind] =
    useState<SalaryAmountKind>("annualSalary");
  const [inflationIndex, setInflationIndex] = useState<InflationIndex>("CPIH");
  const [referencePeriod, setReferencePeriod] = useState(
    latestOnsInflationRelease("CPIH")?.source.coverageThrough ?? "",
  );
  const person = people.includes(selectedPerson)
    ? selectedPerson
    : (people[0] ?? "");
  const release = latestOnsInflationRelease(inflationIndex);
  const selectedReferenceDate = referenceDate(
    referencePeriod,
    release?.source.frequency,
  );
  const points = buildGrossSalaryTrajectory(
    salaryHistory,
    release,
    selectedReferenceDate,
    person,
    amountKind,
  );
  const noPensionPoints = buildNoPensionNetTrajectory(
    salaryHistory,
    release,
    selectedReferenceDate,
    person,
    amountKind,
    selectedReferenceDate,
  );

  function selectIndex(value: string) {
    const next = InflationIndexSchema.parse(value);
    const nextRelease = latestOnsInflationRelease(next);
    setInflationIndex(next);
    if (
      nextRelease != null &&
      !nextRelease.observations.some(
        (observation) => observation.period === referencePeriod,
      )
    ) {
      setReferencePeriod(nextRelease.source.coverageThrough);
    }
  }

  return {
    amountKind,
    chartData: grossSalaryChartData(points, selectedReferenceDate),
    hasRealValues: points.some((point) => point.realGross != null),
    hasSalaryHistory: currentRecords.length > 0,
    inflationIndex,
    noPensionChartData: noPensionNetChartData(
      noPensionPoints,
      selectedReferenceDate,
    ),
    noPensionPoints,
    noPensionUnavailableCount: noPensionPoints.filter(
      (point) => point.nominalNet == null || point.realNet == null,
    ).length,
    people,
    person,
    points,
    referencePeriod,
    release,
    selectIndex,
    selectedReferenceDate,
    setAmountKind,
    setReferencePeriod,
    setSelectedPerson,
    unavailableCount: points.filter((point) => point.realGross == null).length,
  };
}

export type RealGrossSalaryHistoryView = ReturnType<
  typeof useRealGrossSalaryHistory
>;
