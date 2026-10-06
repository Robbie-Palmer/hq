"use client";

import type { GrossSalaryChartPoint } from "@/lib/domain/assettracker";
import { SalaryTrajectoryChart } from "./salary-trajectory-chart";

export function RealGrossSalaryChart({
  chartData,
  label,
}: Readonly<{
  chartData: readonly GrossSalaryChartPoint[];
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
      label={label}
      nominalLabel="Nominal gross pay"
      realLabel="Inflation-adjusted gross pay"
      assumptionCopy="Dashed segments assume the latest open-ended salary remained unchanged to the reference month."
    />
  );
}
