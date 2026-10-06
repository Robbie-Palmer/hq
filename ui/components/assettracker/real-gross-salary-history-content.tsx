import { InflationDatasetDisclosure } from "./inflation-dataset-disclosure";
import { RealGrossSalaryChart } from "./real-gross-salary-history-chart";
import {
  RealGrossSalaryControls,
  SALARY_AMOUNT_LABELS,
} from "./real-gross-salary-history-controls";
import { SalaryTrajectoryTable } from "./real-gross-salary-history-table";
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
          gross pay multiplied by the reference-period index level divided by
          the salary-period index level.
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
    </div>
  );
}

export function RealGrossSalaryContent({
  view,
}: Readonly<{ view: RealGrossSalaryHistoryView }>) {
  const label =
    SALARY_AMOUNT_LABELS[view.amountKind].toLocaleLowerCase("en-GB");
  return (
    <>
      <RealGrossSalaryControls {...view} />
      {view.points.length === 0 ? (
        <NoMatchingSalary view={view} />
      ) : (
        <>
          <RealGrossSalaryChart
            chartData={view.chartData}
            hasRealValues={view.hasRealValues}
            label={`Nominal and inflation-adjusted ${label} for ${view.person}`}
          />
          <SalaryTrajectoryTable points={view.points} />
        </>
      )}
      <DatasetNotes view={view} />
    </>
  );
}
