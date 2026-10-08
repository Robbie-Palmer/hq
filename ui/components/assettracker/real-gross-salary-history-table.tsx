import { formatCurrency } from "@/lib/assettracker";
import type { GrossSalaryTrajectoryPoint } from "@/lib/domain/assettracker";

function formatPercentage(value: number | null): string {
  if (value == null) return "Not comparable";
  const percentage = value * 100;
  return `${percentage > 0 ? "+" : ""}${percentage.toFixed(1)}%`;
}

function formatChange(point: GrossSalaryTrajectoryPoint): string {
  if (point.realChange == null) return "Not comparable";
  const sign = point.realChange > 0 ? "+" : "";
  return `${sign}${formatCurrency(point.realChange, point.currency)} (${formatPercentage(point.realChangeRate)})`;
}

function basisLabel(point: GrossSalaryTrajectoryPoint): string {
  const work =
    point.workFraction == null
      ? "work hours unknown"
      : `${Math.round(point.workFraction * 100)}% hours`;
  return point.amountKind === "annualSalary"
    ? `Annual rate, ${work}`
    : `${point.payFrequency} earnings, ${work}`;
}

function continuityLabel(point: GrossSalaryTrajectoryPoint): string {
  const labels = {
    continuous: "Continuous period",
    "employment-change": "Employment changed",
    first: "First record",
    gap: "Employment gap between records",
    overlap: "Overlapping record; changes unavailable",
    "work-hours-change": "Work hours changed",
  } as const;
  return labels[point.continuity];
}

function inflationEvidence(point: GrossSalaryTrajectoryPoint): string {
  if (point.inflation == null) return "Inflation dataset unavailable";
  if ("unavailableCode" in point.inflation) {
    return point.inflation.unavailableReason;
  }
  const evidence = point.inflation;
  return `${evidence.index} ${evidence.sourcePeriod} at ${evidence.sourceIndexLevel} to ${evidence.referencePeriod} at ${evidence.referenceIndexLevel}. Dataset ${evidence.datasetVersion}. Salary fact ${point.recordId}.`;
}

function SalaryTrajectoryRow({
  point,
}: Readonly<{ point: GrossSalaryTrajectoryPoint }>) {
  return (
    <tr className="border-b align-top last:border-0">
      <td className="whitespace-nowrap px-3 py-2">
        <p>{point.effectiveStart}</p>
        <p className="text-xs text-muted-foreground">
          to {point.effectiveEnd ?? "present"}
        </p>
      </td>
      <td className="px-3 py-2">
        <p className="font-medium">{point.employer}</p>
        <p className="text-xs text-muted-foreground">
          {continuityLabel(point)}
        </p>
      </td>
      <td className="px-3 py-2">{basisLabel(point)}</td>
      <td className="whitespace-nowrap px-3 py-2 font-medium tabular-nums">
        {formatCurrency(point.nominalGross, point.currency)}
      </td>
      <td className="whitespace-nowrap px-3 py-2 font-medium tabular-nums">
        {point.realGross == null
          ? "Unavailable"
          : formatCurrency(point.realGross, point.currency)}
      </td>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums">
        {formatChange(point)}
      </td>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums">
        {formatPercentage(point.cumulativeRealGrowthRate)}
      </td>
      <td className="max-w-md px-3 py-2 text-xs text-muted-foreground">
        {inflationEvidence(point)}
      </td>
    </tr>
  );
}

export function SalaryTrajectoryTable({
  points,
}: Readonly<{ points: readonly GrossSalaryTrajectoryPoint[] }>) {
  const headings = [
    "Effective period",
    "Employment",
    "Basis",
    "Nominal gross",
    "Real gross",
    "Real change",
    "Cumulative growth",
    "Calculation evidence",
  ];
  return (
    <div className="max-h-[32rem] overflow-auto rounded-md border">
      <table className="w-full min-w-[74rem] text-left text-sm">
        <caption className="sr-only">
          Nominal and inflation-adjusted gross salary history
        </caption>
        <thead className="sticky top-0 bg-background">
          <tr className="border-b">
            {headings.map((heading) => (
              <th key={heading} className="px-3 py-2 font-medium">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <SalaryTrajectoryRow key={point.recordId} point={point} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
