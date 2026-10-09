import type { ReactNode } from "react";
import type {
  HousingPlanningPosition,
  HousingStrategyOutcome,
} from "@/lib/domain/assettracker";

type Formatters = {
  money: (value: number) => string;
  fiDate: (value: string | null) => string;
};

function ExpandableTable({
  children,
  label,
}: Readonly<{ children: ReactNode; label: string }>) {
  return (
    <details className="rounded-md border p-4">
      <summary className="cursor-pointer text-sm font-medium">{label}</summary>
      <div className="mt-4 overflow-x-auto rounded-md border">{children}</div>
    </details>
  );
}

function HousingTableHeader({
  columns,
}: Readonly<{
  columns: readonly { label: string; align?: "right" }[];
}>) {
  return (
    <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
      <tr>
        {columns.map(({ align, label }) => (
          <th
            className={`px-3 py-2 font-medium${align === "right" ? " text-right" : ""}`}
            key={label}
          >
            {label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

export function HousingPositionSummary({
  position,
  money,
}: Readonly<{
  position: HousingPlanningPosition;
  money: Formatters["money"];
}>) {
  const values = [
    ["Recorded home value", position.homeValue],
    ["Mortgage balance", position.mortgageBalance],
    ["Total home equity", position.homeEquity],
    ["Non-housing portfolio", position.withdrawalCapital],
  ] as const;
  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {values.map(([label, value]) => (
          <div className="rounded-md border p-3" key={label}>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 font-semibold">{money(value)}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        The non-housing portfolio is cash and investments, less non-mortgage
        debts. It excludes the house and mortgage shown separately.
      </p>
    </div>
  );
}

export function HousingStrategySummary({
  outcomes,
  money,
  fiDate,
}: Readonly<
  {
    outcomes: HousingStrategyOutcome[];
  } & Formatters
>) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table
        className="w-full min-w-[680px] text-sm"
        aria-label="Housing strategy comparison"
      >
        <HousingTableHeader
          columns={[
            { label: "Strategy" },
            { label: "Net worth", align: "right" },
            { label: "Available capital", align: "right" },
            { label: "FI spending / yr", align: "right" },
            { label: "Projected FI" },
          ]}
        />
        <tbody>
          {outcomes.map((outcome) => (
            <tr className="border-t" key={outcome.kind}>
              <th
                scope="row"
                className="whitespace-nowrap px-3 py-3 text-left font-medium"
              >
                {outcome.label}
              </th>
              <td className="px-3 py-3 text-right">
                {money(outcome.totalNetWorth)}
              </td>
              <td className="px-3 py-3 text-right">
                {money(outcome.withdrawalCapital)}
              </td>
              <td className="px-3 py-3 text-right">
                {money(outcome.annualExpenditure)}
              </td>
              <td className="whitespace-nowrap px-3 py-3">
                {fiDate(outcome.projectedFiDate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HousingWarnings({
  warnings,
}: Readonly<{ warnings: string[] }>) {
  if (warnings.length === 0) return null;
  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/50 p-3 text-sm"
    >
      {warnings.map((warning) => (
        <p key={warning}>{warning}</p>
      ))}
    </div>
  );
}

export function HousingCalculatedMeasures({
  outcomes,
  money,
  fiDate,
}: Readonly<
  {
    outcomes: HousingStrategyOutcome[];
  } & Formatters
>) {
  const moneyColumns = [
    ["Sale", "salePrice"],
    ["Mortgage settlement", "mortgageSettlement"],
    ["Transaction costs", "transactionCosts"],
    ["Taxes / fees", "taxesAndFees"],
    ["Replacement home", "replacementHousingCost"],
    ["Rent / yr", "annualRent"],
    ["Ownership / yr", "annualOwnershipCost"],
    ["Borrowing / yr", "annualBorrowingCost"],
    ["Released", "releasedCapital"],
    ["Retained", "retainedEquity"],
    ["Net worth", "totalNetWorth"],
    ["Withdrawal capital", "withdrawalCapital"],
    ["FI spending / yr", "annualExpenditure"],
    ["FI target", "fiTarget"],
  ] as const;
  return (
    <ExpandableTable label="All calculated measures">
      <table
        className="w-full min-w-[1500px] text-sm"
        aria-label="Housing strategy calculated measures"
      >
        <HousingTableHeader
          columns={[
            { label: "Strategy" },
            ...moneyColumns.map(([label]) => ({
              label,
              align: "right" as const,
            })),
            { label: "Projected FI" },
          ]}
        />
        <tbody>
          {outcomes.map((outcome) => (
            <tr className="border-t" key={outcome.kind}>
              <th
                scope="row"
                className="whitespace-nowrap px-3 py-2 text-left font-medium"
              >
                {outcome.label}
              </th>
              {moneyColumns.map(([, field]) => (
                <td className="px-3 py-2 text-right" key={field}>
                  {money(outcome[field])}
                </td>
              ))}
              <td className="whitespace-nowrap px-3 py-2">
                {fiDate(outcome.projectedFiDate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ExpandableTable>
  );
}

export function HousingTimelines({
  outcomes,
}: Readonly<{ outcomes: HousingStrategyOutcome[] }>) {
  return (
    <ExpandableTable label="Housing timelines">
      <table className="w-full min-w-[680px] text-sm">
        <HousingTableHeader
          columns={[
            { label: "Strategy" },
            { label: "From" },
            { label: "Until" },
            { label: "Housing" },
          ]}
        />
        <tbody>
          {outcomes.flatMap((outcome) =>
            outcome.timeline.map((phase, index) => (
              <tr
                className="border-t"
                key={`${outcome.kind}:${phase.startDate}:${phase.housingState}`}
              >
                <th
                  scope="row"
                  className="whitespace-nowrap px-3 py-3 text-left font-medium"
                >
                  {index === 0 ? outcome.label : ""}
                </th>
                <td className="whitespace-nowrap px-3 py-3">
                  {phase.startDate}
                </td>
                <td className="whitespace-nowrap px-3 py-3">
                  {phase.endDate ?? "Ongoing"}
                </td>
                <td className="px-3 py-3">{phase.housingState}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </ExpandableTable>
  );
}
