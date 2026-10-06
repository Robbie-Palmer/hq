import { formatCurrency } from "@/lib/assettracker";
import type { NoPensionNetTrajectoryPoint } from "@/lib/domain/assettracker";

function money(
  value: number | null,
  point: NoPensionNetTrajectoryPoint,
): string {
  return value == null ? "Unavailable" : formatCurrency(value, point.currency);
}

function signedMoney(
  value: number | null,
  point: NoPensionNetTrajectoryPoint,
): string {
  if (value == null) return "Not comparable";
  if (value === 0) return formatCurrency(0, point.currency);
  const sign = value > 0 ? "+" : "−";
  return `${sign}${formatCurrency(Math.abs(value), point.currency)}`;
}

function InflationEvidence({
  point,
}: Readonly<{ point: NoPensionNetTrajectoryPoint }>) {
  if (point.inflation == null) {
    return <p>Inflation dataset unavailable.</p>;
  }
  if ("unavailableCode" in point.inflation) {
    return <p>{point.inflation.unavailableReason}</p>;
  }
  return (
    <p>
      {point.inflation.index} {point.inflation.sourcePeriod} at{" "}
      {point.inflation.sourceIndexLevel} to {point.inflation.referencePeriod} at{" "}
      {point.inflation.referenceIndexLevel}. Dataset{" "}
      {point.inflation.datasetVersion}.
    </p>
  );
}

function CalculationEvidence({
  point,
}: Readonly<{ point: NoPensionNetTrajectoryPoint }>) {
  const result = point.calculation.result;
  if (!result.available) {
    return (
      <ul className="list-disc space-y-1 pl-4">
        {result.reasons.map((reason) => (
          <li key={reason.code}>{reason.detail}</li>
        ))}
      </ul>
    );
  }

  return (
    <details>
      <summary className="cursor-pointer font-medium">View lineage</summary>
      <div className="mt-2 space-y-2">
        <p>
          Hypothetical no-employee-pension scenario. Employee contribution and
          salary sacrifice: £0. Employer pension is excluded from spendable pay.
        </p>
        <p>
          Salary fact {point.recordId}. Tax year {point.taxYear}. Rule dataset{" "}
          {result.lineage.ruleDatasetVersion}; rules{" "}
          {result.lineage.rules.map((rule) => rule.id).join(", ")}.
        </p>
        <InflationEvidence point={point} />
        <ul className="list-disc space-y-1 pl-4">
          {result.lineage.sources.map((source) => (
            <li key={source.id}>
              <a
                className="underline underline-offset-2"
                href={source.url}
                rel="noreferrer"
                target="_blank"
              >
                {source.publisher}: {source.title}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

function NoPensionNetRow({
  point,
}: Readonly<{ point: NoPensionNetTrajectoryPoint }>) {
  return (
    <tr className="border-b align-top last:border-0">
      <td className="whitespace-nowrap px-3 py-2">
        <p>{point.effectiveStart}</p>
        <p className="text-xs text-muted-foreground">to {point.effectiveEnd}</p>
      </td>
      <td className="px-3 py-2">
        <p className="font-medium">{point.employer}</p>
        <p className="text-xs text-muted-foreground">{point.taxYear}</p>
      </td>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums">
        {money(point.observedNet, point)}
      </td>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums">
        {money(point.estimatedRecordedPensionNet, point)}
      </td>
      <td className="whitespace-nowrap px-3 py-2 font-medium tabular-nums">
        {money(point.nominalNet, point)}
      </td>
      <td className="whitespace-nowrap px-3 py-2 font-medium tabular-nums">
        {money(point.realNet, point)}
      </td>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums">
        {signedMoney(point.grossCashPayChange, point)}
      </td>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums">
        {signedMoney(point.incomeTaxChange, point)}
      </td>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums">
        {signedMoney(point.employeeNationalInsuranceChange, point)}
      </td>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums">
        {money(point.foregoneEmployeeContribution, point)}
      </td>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums">
        {money(point.employerPensionContribution, point)}
      </td>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums">
        {signedMoney(point.takeHomePayChange, point)}
      </td>
      <td className="max-w-md px-3 py-2 text-xs text-muted-foreground">
        <CalculationEvidence point={point} />
      </td>
    </tr>
  );
}

export function NoPensionNetSalaryTable({
  points,
}: Readonly<{ points: readonly NoPensionNetTrajectoryPoint[] }>) {
  const headings = [
    "Effective period",
    "Employment / tax year",
    "Recorded take-home",
    "Estimated take-home with recorded pension",
    "Hypothetical nominal net",
    "Hypothetical real net",
    "Gross cash pay change",
    "Income Tax change",
    "Employee NI change",
    "Foregone employee contribution",
    "Employer pension (not spendable)",
    "Take-home change",
    "Calculation evidence",
  ];

  return (
    <div className="max-h-[32rem] overflow-auto rounded-md border">
      <table className="w-full min-w-[128rem] text-left text-sm">
        <caption className="sr-only">
          Hypothetical nominal and inflation-adjusted net salary with no
          employee pension contributions or salary sacrifice
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
            <NoPensionNetRow key={point.calculationId} point={point} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
