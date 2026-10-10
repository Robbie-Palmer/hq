"use client";

import { experiences } from "@/content/experience";
import type { GrossSalaryChartPoint } from "@/lib/domain/assettracker";
import { normalizeSlug } from "@/lib/generic/slugs";
import {
  SalaryTrajectoryChart,
  type SalaryTrajectoryDateDomain,
  type SalaryTrajectoryMilestone,
  type SalaryTrajectoryRange,
} from "./salary-trajectory-chart";

function logoForEmployer(employer: string): string | undefined {
  const employerSlug = normalizeSlug(employer);
  return experiences.find(({ company }) => {
    const companySlug = normalizeSlug(company);
    return (
      companySlug === employerSlug ||
      companySlug.startsWith(employerSlug) ||
      employerSlug.startsWith(companySlug)
    );
  })?.logoPath;
}

export function RealGrossSalaryChart({
  availableDateDomain,
  chartData,
  dateDomain,
  label,
  milestones,
  onRangeChange,
  range,
}: Readonly<{
  availableDateDomain: SalaryTrajectoryDateDomain;
  chartData: readonly GrossSalaryChartPoint[];
  dateDomain: SalaryTrajectoryDateDomain;
  hasRealValues: boolean;
  label: string;
  milestones: readonly Omit<SalaryTrajectoryMilestone, "logoPath">[];
  onRangeChange(range: SalaryTrajectoryRange): void;
  range: SalaryTrajectoryRange;
}>) {
  return (
    <SalaryTrajectoryChart
      availableDateDomain={availableDateDomain}
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
      milestones={milestones.map((milestone) => ({
        ...milestone,
        logoPath: logoForEmployer(milestone.employer),
      }))}
      nominalLabel="Nominal gross pay"
      onRangeChange={onRangeChange}
      range={range}
      realLabel="Inflation-adjusted gross pay"
      showRangeSlider
      showRecordedPeaks
      assumptionCopy="Dashed segments assume the latest open-ended salary remained unchanged to the reference month."
    />
  );
}
