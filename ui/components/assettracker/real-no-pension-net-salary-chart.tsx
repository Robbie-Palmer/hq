"use client";

import type { NoPensionNetChartPoint } from "@/lib/domain/assettracker";
import {
  SalaryTrajectoryChart,
  type SalaryTrajectoryDateDomain,
} from "./salary-trajectory-chart";

export function RealNoPensionNetSalaryChart({
  chartData,
  dateDomain,
  label,
}: Readonly<{
  chartData: readonly NoPensionNetChartPoint[];
  dateDomain: SalaryTrajectoryDateDomain;
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
      dateDomain={dateDomain}
      label={label}
      nominalLabel="Hypothetical nominal net pay"
      realLabel="Hypothetical inflation-adjusted net pay"
      assumptionCopy="Dashed segments assume the latest open-ended salary and its no-pension estimate remained unchanged to the reference month."
    />
  );
}
