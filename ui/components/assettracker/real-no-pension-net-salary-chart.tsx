"use client";

import type { NoPensionNetChartPoint } from "@/lib/domain/assettracker";
import { SalaryTrajectoryChart } from "./salary-trajectory-chart";

export function RealNoPensionNetSalaryChart({
  chartData,
  label,
}: Readonly<{
  chartData: readonly NoPensionNetChartPoint[];
  label: string;
}>) {
  return (
    <SalaryTrajectoryChart
      chartData={chartData.map((point) => ({
        id: point.id,
        date: point.date,
        nominal: point.nominalNet,
        real: point.realNet,
        assumedNominal: point.assumedNominalNet,
        assumedReal: point.assumedRealNet,
      }))}
      label={label}
      nominalLabel="Hypothetical nominal net pay"
      realLabel="Hypothetical inflation-adjusted net pay"
      assumptionCopy="Dashed segments assume the latest open-ended salary and its no-pension estimate remained unchanged to the reference month."
    />
  );
}
