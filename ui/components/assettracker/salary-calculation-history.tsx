"use client";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  calculateSalaryHistory,
  type SalaryPeriodCalculation,
} from "@/lib/domain/assettracker";
import { formatMinorCurrency } from "@/lib/generic/money";
import { useAssetTracker } from "./asset-tracker-provider";

function Money({ value }: Readonly<{ value: number }>) {
  return <span className="tabular-nums">{formatMinorCurrency(value)}</span>;
}

function Breakdown({
  calculation,
}: Readonly<{ calculation: SalaryPeriodCalculation }>) {
  if (!calculation.result.available) return null;
  const { components } = calculation.result;
  const items = [
    ["Contractual gross pay", components.contractualGrossPayPence],
    ["Salary sacrifice", components.salarySacrificePence],
    ["Gross cash pay", components.grossCashPayPence],
    ["Income after Personal Allowance", components.taxablePayPence],
    ["Estimated annual Income Tax", components.incomeTaxPence],
    ["Estimated employee NI", components.employeeNationalInsurancePence],
    ["Employee pension, gross", components.employeePensionContributionPence],
    ["Employer pension", components.employerPensionContributionPence],
    ["Provider pension relief", components.providerTaxReliefPence],
    ["Other deductions", components.otherDeductionsPence],
    ["Estimated take-home pay", components.takeHomePayPence],
  ] as const;
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(([label, value]) => (
        <div
          key={label}
          className="flex justify-between gap-4 border-b pb-2 text-sm"
        >
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="font-medium">
            <Money value={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function varianceLabel(value: number | null): string {
  if (value == null) return "Not observed";
  if (value === 0) return "Matches";
  return `${value > 0 ? "+" : ""}${formatMinorCurrency(value)}`;
}

type ReconciliationRow = readonly [
  string,
  number,
  number | null,
  number | null,
];

function ReconciliationTable({
  rows,
}: Readonly<{ rows: readonly ReconciliationRow[] }>) {
  return (
    <div className="mt-2 overflow-x-auto rounded-md border">
      <table className="w-full min-w-[34rem] text-sm">
        <thead className="bg-muted/50 text-left">
          <tr>
            <th className="px-3 py-2 font-medium">Component</th>
            <th className="px-3 py-2 font-medium">Estimate</th>
            <th className="px-3 py-2 font-medium">Observed</th>
            <th className="px-3 py-2 font-medium">Estimate minus observed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, estimate, observed, difference]) => (
            <tr key={label} className="border-t">
              <th className="px-3 py-2 text-left font-normal">{label}</th>
              <td className="px-3 py-2">
                <Money value={estimate} />
              </td>
              <td className="px-3 py-2">
                {observed == null ? "Not recorded" : <Money value={observed} />}
              </td>
              <td className="px-3 py-2 tabular-nums">
                {varianceLabel(difference)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Reconciliation({
  calculation,
}: Readonly<{ calculation: SalaryPeriodCalculation }>) {
  if (!(calculation.result.available && calculation.reconciliation))
    return null;
  const rows = [
    [
      "Income Tax",
      calculation.result.components.incomeTaxPence,
      calculation.observations.incomeTaxPence,
      calculation.reconciliation.incomeTaxVariancePence,
    ],
    [
      "Employee National Insurance",
      calculation.result.components.employeeNationalInsurancePence,
      calculation.observations.employeeNationalInsurancePence,
      calculation.reconciliation.employeeNationalInsuranceVariancePence,
    ],
    [
      "Take-home pay",
      calculation.result.components.takeHomePayPence,
      calculation.observations.takeHomePayPence,
      calculation.reconciliation.takeHomePayVariancePence,
    ],
  ] as const;
  return (
    <div>
      <h4 className="font-medium">Observed reconciliation</h4>
      <ReconciliationTable rows={rows} />
    </div>
  );
}

function CalculationLineage({
  calculation,
}: Readonly<{ calculation: SalaryPeriodCalculation }>) {
  if (!calculation.result.available) return null;
  const { lineage, notes } = calculation.result;
  return (
    <details className="rounded-md border p-3 text-sm">
      <summary className="cursor-pointer font-medium">
        Rules and assumptions
      </summary>
      <div className="mt-3 space-y-3 text-muted-foreground">
        <p>
          Dataset {lineage.ruleDatasetVersion}, calculation{" "}
          {lineage.calculationVersion}, engine {lineage.engineId}{" "}
          {lineage.engineVersion}.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          {[...notes, ...calculation.notes].map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
        <ul className="space-y-1">
          {lineage.rules.map((rule) => (
            <li key={rule.id}>
              <span className="font-mono text-xs">{rule.id}</span>, effective{" "}
              {rule.effectiveFrom} to {rule.effectiveTo}
            </li>
          ))}
        </ul>
        <ul className="space-y-1">
          {lineage.sources.map((source) => (
            <li key={source.id}>
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline underline-offset-4"
              >
                {source.title}
              </a>
              {` (${source.publisher}, published ${source.publicationDate})`}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

function CalculationDetail({
  calculation,
}: Readonly<{ calculation: SalaryPeriodCalculation }>) {
  return (
    <details className="rounded-lg border">
      <summary className="cursor-pointer list-none p-4 [&::-webkit-details-marker]:hidden">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-medium">
              {calculation.person} · {calculation.employer}
            </p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {calculation.effectiveFrom} to {calculation.effectiveTo}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">
              {calculation.taxYear.replace("-", "/")}
            </Badge>
            <Badge
              variant={
                calculation.result.available ? "secondary" : "destructive"
              }
            >
              {calculation.result.available ? "Estimate ready" : "Needs input"}
            </Badge>
          </div>
        </div>
        {calculation.result.available && (
          <p className="mt-3 text-sm">
            Estimated take-home{" "}
            <Money value={calculation.result.components.takeHomePayPence} /> per
            year
          </p>
        )}
      </summary>
      <div className="space-y-5 border-t p-4">
        {calculation.result.available ? (
          <>
            <Breakdown calculation={calculation} />
            <Reconciliation calculation={calculation} />
            <CalculationLineage calculation={calculation} />
          </>
        ) : (
          <div>
            <p className="text-sm text-muted-foreground">
              The calculator will not replace unknown facts with zero.
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
              {calculation.result.reasons.map(({ code, detail }) => (
                <li key={code}>{detail}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}

export function SalaryCalculationHistory() {
  const { currentSalaryHistory } = useAssetTracker();
  const calculations = calculateSalaryHistory(currentSalaryHistory).toSorted(
    (left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom),
  );
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Historical tax and pension estimates</CardTitle>
        <CardDescription>
          Annual liability estimates for 2015/16 through 2026/27. Each period
          uses the reviewed UK rules effective on its start date. These are not
          exact PAYE deductions.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {calculations.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
            Add a salary record to calculate its historical tax, National
            Insurance, pension contributions, and take-home pay.
          </div>
        ) : (
          calculations.map((calculation) => (
            <CalculationDetail key={calculation.id} calculation={calculation} />
          ))
        )}
      </CardContent>
    </Card>
  );
}
