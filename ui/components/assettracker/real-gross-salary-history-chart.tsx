"use client";

import type { GrossSalaryChartPoint } from "@/lib/domain/assettracker";
import {
  SalaryTrajectoryChart,
  type SalaryTrajectoryDateDomain,
} from "./salary-trajectory-chart";

export function RealGrossSalaryChart({
  chartData,
  dateDomain,
  label,
}: Readonly<{
  chartData: readonly GrossSalaryChartPoint[];
  dateDomain: SalaryTrajectoryDateDomain;
  hasRealValues: boolean;
  label: string;
}>) {
  return (
    <SalaryTrajectoryChart
      chartData={chartData.map((point) => ({
        id: point.id,
        date: point.date,
        nominal: point.nominalGross,
        real: point.realGross,
        assumedNominal: point.assumedNominalGross,
        assumedReal: point.assumedRealGross,
      }))}
      dateDomain={dateDomain}
      label={label}
      nominalLabel="Nominal gross pay"
      realLabel="Inflation-adjusted gross pay"
      showRecordedPeaks
      assumptionCopy="Dashed segments assume the latest open-ended salary remained unchanged to the reference month."
    />
  );
}
