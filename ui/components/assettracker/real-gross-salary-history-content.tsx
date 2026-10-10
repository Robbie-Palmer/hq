"use client";

import { useState } from "react";
import { InflationDatasetDisclosure } from "./inflation-dataset-disclosure";
import { RealGrossSalaryChart } from "./real-gross-salary-history-chart";
import {
  RealGrossSalaryControls,
  SALARY_AMOUNT_LABELS,
} from "./real-gross-salary-history-controls";
import { SalaryTrajectoryTable } from "./real-gross-salary-history-table";
import { RealNoPensionNetSalaryChart } from "./real-no-pension-net-salary-chart";
import { NoPensionNetSalaryTable } from "./real-no-pension-net-salary-table";
import {
  type SalaryTrajectoryDateDomain,
  salaryTrajectoryDateDomain,
} from "./salary-trajectory-chart";
import type { RealGrossSalaryHistoryView } from "./use-real-gross-salary-history";

function NoMatchingSalary({
  view,
}: Readonly<{ view: RealGrossSalaryHistoryView }>) {
  return (
    <div className="rounded-lg border border-dashed px-6 py-12 text-center">
      <p className="font-medium">
        No {SALARY_AMOUNT_LABELS[view.amountKind].toLocaleLowerCase("en-GB")}{" "}
        records for {view.person}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Choose the other gross figure or add another salary record.
      </p>
    </div>
  );
}

function DatasetNotes({
  view,
}: Readonly<{ view: RealGrossSalaryHistoryView }>) {
  return (
    <div className="space-y-2">
      <InflationDatasetDisclosure
        release={view.release}
        referenceDate={view.selectedReferenceDate}
        currency="GBP"
      />
      {view.release != null && (
        <p className="text-xs text-muted-foreground">
          Coverage {view.release.source.coverageFrom} to{" "}
          {view.release.source.coverageThrough}. Real gross pay equals nominal
          pay multiplied by the reference-period index level divided by the
          salary-period index level.
        </p>
      )}
      {view.unavailableCount > 0 && (
        <output className="block text-sm text-muted-foreground">
          {view.unavailableCount} salary{" "}
          {view.unavailableCount === 1 ? "record has" : "records have"} no
          real-terms value. The table keeps each nominal fact and explains why
          its adjustment is unavailable.
        </output>
      )}
      {view.noPensionUnavailableCount > 0 && (
        <output className="block text-sm text-muted-foreground">
          {view.noPensionUnavailableCount} hypothetical net salary{" "}
          {view.noPensionUnavailableCount === 1 ? "period is" : "periods are"}{" "}
          unavailable. The evidence table names the missing assumption, rule,
          currency, or inflation coverage instead of filling the gap.
        </output>
      )}
    </div>
  );
}

function GrossSalarySection({
  availableDateDomain,
  dateDomain,
  label,
  onRangeChange,
  range,
  view,
}: Readonly<{
  availableDateDomain: SalaryTrajectoryDateDomain;
  dateDomain: SalaryTrajectoryDateDomain;
  label: string;
  onRangeChange(range: SalaryTrajectoryDateDomain): void;
  range: SalaryTrajectoryDateDomain;
  view: RealGrossSalaryHistoryView;
}>) {
  return (
    <section aria-labelledby="gross-salary-heading" className="space-y-4">
      <div className="space-y-1">
        <h3 id="gross-salary-heading" className="font-semibold">
          Gross salary
        </h3>
        <p className="text-sm text-muted-foreground">
          Recorded pay before tax and pension deductions.
        </p>
      </div>
      <RealGrossSalaryChart
        availableDateDomain={availableDateDomain}
        chartData={view.chartData}
        dateDomain={dateDomain}
        hasRealValues={view.hasRealValues}
        label={`Nominal and inflation-adjusted ${label} for ${view.person}`}
        milestones={view.milestones}
        onRangeChange={onRangeChange}
        range={range}
      />
      <SalaryTrajectoryTable points={view.points} />
    </section>
  );
}

function NoPensionSalarySection({
  dateDomain,
  label,
  view,
}: Readonly<{
  dateDomain: SalaryTrajectoryDateDomain;
  label: string;
  view: RealGrossSalaryHistoryView;
}>) {
  return (
    <section
      aria-labelledby="no-pension-net-heading"
      className="space-y-4 border-t pt-5"
    >
      <div className="space-y-1">
        <h3 id="no-pension-net-heading" className="font-semibold">
          Hypothetical net salary with no employee pension
        </h3>
        <p className="text-sm text-muted-foreground">
          A counterfactual estimate with employee pension contributions and
          salary sacrifice set to zero, using each period&apos;s UK Income Tax
          and employee National Insurance rules. Employer pension remains
          separate and is never treated as spendable pay.
        </p>
      </div>
      {view.noPensionPoints.length === 0 ? (
        <p className="rounded-lg border border-dashed px-6 py-8 text-center text-sm text-muted-foreground">
          No matching salary periods to estimate.
        </p>
      ) : (
        <>
          <RealNoPensionNetSalaryChart
            chartData={view.noPensionChartData}
            dateDomain={dateDomain}
            label={`Hypothetical nominal and inflation-adjusted net ${label} with no employee pension for ${view.person}`}
          />
          <NoPensionNetSalaryTable points={view.noPensionPoints} />
        </>
      )}
    </section>
  );
}

function SalarySections({
  label,
  view,
}: Readonly<{
  label: string;
  view: RealGrossSalaryHistoryView;
}>) {
  const availableDateDomain = salaryTrajectoryDateDomain(
    view.chartData,
    view.noPensionChartData,
  );
  const [range, setRange] =
    useState<SalaryTrajectoryDateDomain>(availableDateDomain);

  return (
    <>
      <GrossSalarySection
        availableDateDomain={availableDateDomain}
        dateDomain={range}
        label={label}
        onRangeChange={setRange}
        range={range}
        view={view}
      />
      <NoPensionSalarySection dateDomain={range} label={label} view={view} />
    </>
  );
}

export function RealGrossSalaryContent({
  view,
}: Readonly<{ view: RealGrossSalaryHistoryView }>) {
  const label =
    SALARY_AMOUNT_LABELS[view.amountKind].toLocaleLowerCase("en-GB");
  const chartKey = [
    view.person,
    view.amountKind,
    view.inflationIndex,
    view.selectedReferenceDate,
    ...view.chartData.map((point) => `${point.id}:${point.date}`),
  ].join(":");
  return (
    <>
      <RealGrossSalaryControls {...view} />
      {view.points.length === 0 ? (
        <NoMatchingSalary view={view} />
      ) : (
        <SalarySections key={chartKey} label={label} view={view} />
      )}
      <DatasetNotes view={view} />
    </>
  );
}
