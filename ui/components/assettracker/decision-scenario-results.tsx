import { format, parseISO } from "date-fns";
import { formatCurrency } from "@/lib/assettracker";
import type {
  Currency,
  DecisionScenarioComparison,
  DecisionScenarioMetrics,
  DecisionScenarioPoint,
} from "@/lib/domain/assettracker";
import {
  DecisionScenarioCharts,
  type DecisionScenarioResult,
} from "./decision-scenario-charts";

function signedCurrency(value: number, currency: Currency): string {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${formatCurrency(rounded, currency)}`;
}

function formatGoalDate(date: string | null): string {
  return date == null
    ? "Not reached in this horizon"
    : format(parseISO(date), "MMM yyyy");
}

function reserveDescription(
  metrics: DecisionScenarioMetrics,
  reserveMonths: number | null,
): string {
  if (metrics.reserveCoverageMonths == null) return "No reserve plan";
  const coverage = `${metrics.reserveCoverageMonths.toFixed(1)} months`;
  if (reserveMonths == null) return coverage;
  return metrics.reserveCoverageMonths < reserveMonths
    ? `${coverage}, below the ${reserveMonths}-month preference`
    : `${coverage}, above the ${reserveMonths}-month preference`;
}

function ComparisonSummary({
  currency,
  horizon,
  reserveMonths,
}: Readonly<{
  currency: Currency;
  horizon: DecisionScenarioPoint;
  reserveMonths: number | null;
}>) {
  const rows = [
    ["Cash", horizon.baseline.cashBalance, horizon.expected.cashBalance],
    [
      "Liquid assets",
      horizon.baseline.liquidBalance,
      horizon.expected.liquidBalance,
    ],
    [
      "Total portfolio",
      horizon.baseline.totalBalance,
      horizon.expected.totalBalance,
    ],
  ] as const;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {rows.map(([label, baseline, expected]) => (
        <div key={label} className="rounded-md bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 font-semibold">
            {formatCurrency(Math.round(expected), currency)}
          </p>
          <p className="text-xs text-muted-foreground">
            {signedCurrency(expected - baseline, currency)} against
            committed-only
          </p>
        </div>
      ))}
      <div className="rounded-md bg-muted/40 p-3">
        <p className="text-xs text-muted-foreground">Emergency reserve</p>
        <p className="mt-1 font-semibold">
          {horizon.expected.reserveCoverageMonths?.toFixed(1) ?? "—"} months
        </p>
        <p className="text-xs text-muted-foreground">
          {reserveDescription(horizon.expected, reserveMonths)}
        </p>
      </div>
    </div>
  );
}

function EffectValue({
  cumulative,
  marginal,
  currency,
}: Readonly<{ cumulative: number; marginal: number; currency: Currency }>) {
  return (
    <td className="px-3 py-2 font-mono">
      {signedCurrency(cumulative, currency)}
      <span className="block text-muted-foreground">
        {signedCurrency(marginal, currency)} this period
      </span>
    </td>
  );
}

function signedMonths(value: number): string {
  const rounded = value.toFixed(1);
  return `${value > 0 ? "+" : ""}${rounded} mo`;
}

function RunwayEffect({ point }: Readonly<{ point: DecisionScenarioPoint }>) {
  return (
    <td className="px-3 py-2 font-mono">
      <span className="block">
        Cash {signedMonths(point.cumulativeEffect.cashMonths)}
      </span>
      <span className="block">
        Liquid {signedMonths(point.cumulativeEffect.liquidMonths)}
      </span>
      <span className="block">
        Portfolio {signedMonths(point.cumulativeEffect.totalMonths)}
      </span>
      <span className="block text-muted-foreground">
        {signedMonths(point.marginalEffect.totalMonths)} portfolio this period
      </span>
    </td>
  );
}

function accountEffectText(point: DecisionScenarioPoint, currency: Currency) {
  const effects = point.accountEffects.filter(
    ({ cumulativeEffect }) => Math.abs(cumulativeEffect) >= 0.01,
  );
  if (effects.length === 0) return "None";
  return effects
    .map(
      ({ accountName, cumulativeEffect, marginalEffect }) =>
        `${accountName} ${signedCurrency(cumulativeEffect, currency)} cumulative, ${signedCurrency(marginalEffect, currency)} this period`,
    )
    .join("; ");
}

function shortfallText(point: DecisionScenarioPoint, currency: Currency) {
  if (point.expected.accountShortfalls.length === 0) return "None";
  return point.expected.accountShortfalls
    .map(
      ({ accountName, amount }) =>
        `${accountName} ${formatCurrency(Math.round(amount), currency)}`,
    )
    .join(", ");
}

function MaterialPointRow({
  point,
  currency,
  reserveMonths,
}: Readonly<{
  point: DecisionScenarioPoint;
  currency: Currency;
  reserveMonths: number | null;
}>) {
  return (
    <tr>
      <th scope="row" className="px-3 py-2 font-medium">
        {format(parseISO(point.date), "d MMM yyyy")}
      </th>
      <EffectValue
        cumulative={point.cumulativeEffect.cash}
        marginal={point.marginalEffect.cash}
        currency={currency}
      />
      <EffectValue
        cumulative={point.cumulativeEffect.liquid}
        marginal={point.marginalEffect.liquid}
        currency={currency}
      />
      <EffectValue
        cumulative={point.cumulativeEffect.total}
        marginal={point.marginalEffect.total}
        currency={currency}
      />
      <RunwayEffect point={point} />
      <td className="px-3 py-2">{accountEffectText(point, currency)}</td>
      <td className="px-3 py-2 font-mono">
        {formatCurrency(Math.round(point.highCost.totalBalance), currency)} to{" "}
        {formatCurrency(Math.round(point.lowCost.totalBalance), currency)}
      </td>
      <td className="px-3 py-2">
        {reserveDescription(point.expected, reserveMonths)}
      </td>
      <td className="px-3 py-2">{shortfallText(point, currency)}</td>
    </tr>
  );
}

function MaterialEffectsTable({
  points,
  currency,
  reserveMonths,
}: Readonly<{
  points: DecisionScenarioPoint[];
  currency: Currency;
  reserveMonths: number | null;
}>) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[72rem] text-left text-xs">
        <caption className="sr-only">
          Decision effects on material cash-flow dates and at the selected
          horizon
        </caption>
        <thead className="border-b bg-muted/40">
          <tr>
            {[
              "Date",
              "Cash effect",
              "Liquid effect",
              "Portfolio effect",
              "Runway effect",
              "Account effects",
              "Expected range",
              "Reserve",
              "Shortfalls",
            ].map((heading) => (
              <th key={heading} className="px-3 py-2 font-medium">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {points.map((point) => (
            <MaterialPointRow
              key={point.date}
              point={point}
              currency={currency}
              reserveMonths={reserveMonths}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GoalDates({
  comparison,
}: Readonly<{ comparison: DecisionScenarioComparison }>) {
  const dates = [
    ["Committed only", comparison.goalDates.baseline],
    ["Selected decisions", comparison.goalDates.expected],
    ["Lower-cost path", comparison.goalDates.lowCost],
    ["Higher-cost path", comparison.goalDates.highCost],
  ] as const;
  return (
    <div className="rounded-md border p-3">
      <h4 className="text-sm font-medium">Longer-term goal date</h4>
      <dl className="mt-2 grid grid-cols-2 gap-1 text-xs">
        {dates.map(([label, date]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right">{formatGoalDate(date)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function JudgmentInputs({
  comparison,
}: Readonly<{ comparison: DecisionScenarioComparison }>) {
  return (
    <div className="rounded-md border p-3">
      <h4 className="text-sm font-medium">Judgment inputs</h4>
      <ul className="mt-2 space-y-2 text-xs">
        {comparison.judgments.map((judgment) => (
          <li key={judgment.id}>
            <span className="font-medium">{judgment.name}</span>
            {` · ${judgment.importance ?? "No importance note"}`}
            {` · ${confidenceDescription(judgment.confidence)}`}
            {` · ${judgment.reversibility.replace("-", " ")}`}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        These inputs remain separate. The comparison does not rank the choices.
      </p>
    </div>
  );
}

function confidenceDescription(confidence: number | undefined): string {
  return confidence == null
    ? "No confidence entered"
    : `${(confidence * 100).toFixed(0)}% confidence`;
}

function FundingMechanics({
  comparison,
  baseCurrency,
}: Readonly<{
  comparison: DecisionScenarioComparison;
  baseCurrency: Currency;
}>) {
  return (
    <div className="rounded-md border p-3">
      <h4 className="text-sm font-medium">Funding mechanics and assumptions</h4>
      <div className="mt-3 space-y-3 text-xs">
        {comparison.fundingMechanics.map((mechanic) => (
          <div key={mechanic.id} className="rounded-md bg-muted/40 p-3">
            <p className="font-medium">
              {mechanic.decisionName}: {mechanic.stageName}
            </p>
            <p className="text-muted-foreground">
              {mechanic.fundingMethod === "cash"
                ? "Cash payment"
                : "Asset sale"}{" "}
              from {mechanic.accountName}. {mechanic.liquidity} access
              {mechanic.accessDelayDays == null
                ? ", no access delay entered"
                : `, ${mechanic.accessDelayDays}-day access delay`}
              .
              {` ${(mechanic.annualReturn * 100).toFixed(2)}% annual return assumption.`}
              {mechanic.convertsToBaseCurrency
                ? ` Converted from ${mechanic.currency} to ${baseCurrency} using accepted exchange-rate observations.`
                : " No currency conversion."}
            </p>
            <p className="text-muted-foreground">{mechanic.taxAndFees}</p>
          </div>
        ))}
        <p className="text-muted-foreground">
          Borrowing is not inferred. Add its income, repayments, interest, tax,
          and fees as explicit household forecast inputs before comparing it.
        </p>
      </div>
    </div>
  );
}

function ImpliedActions({
  comparison,
}: Readonly<{ comparison: DecisionScenarioComparison }>) {
  return (
    <div className="rounded-md border p-3">
      <h4 className="text-sm font-medium">Implied actions</h4>
      <p className="text-xs text-muted-foreground">
        Saving, asset-sale, and internal-transfer actions move existing
        household value and are not counted as income or expenditure.
      </p>
      <ul className="mt-2 divide-y text-xs">
        {comparison.actions.map((action) => (
          <li
            key={action.id}
            className="flex flex-wrap justify-between gap-2 py-2"
          >
            <span>
              {format(parseISO(action.date), "d MMM yyyy")} · {action.name} ·{" "}
              {action.accountName}
              {action.cadence === "monthly" ? " · monthly" : ""}
            </span>
            <span className="font-mono">
              {formatCurrency(Math.round(action.amount), action.currency)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HorizonSummaries({
  scenarios,
  currency,
  reserveMonths,
}: Readonly<{
  scenarios: DecisionScenarioResult[];
  currency: Currency;
  reserveMonths: number | null;
}>) {
  return (
    <div className="space-y-4">
      {scenarios.map(({ id, name, comparison }) => {
        const horizon = comparison.timeline.at(-1);
        if (horizon == null) return null;
        return (
          <section
            key={id}
            className="space-y-3"
            aria-label={`${name} summary`}
          >
            <h4 className="text-sm font-semibold">{name} at the horizon</h4>
            <ComparisonSummary
              currency={currency}
              horizon={horizon}
              reserveMonths={reserveMonths}
            />
          </section>
        );
      })}
    </div>
  );
}

function ExactFigures({
  scenarios,
  currency,
  reserveMonths,
}: Readonly<{
  scenarios: DecisionScenarioResult[];
  currency: Currency;
  reserveMonths: number | null;
}>) {
  return (
    <details className="rounded-md border p-4">
      <summary className="cursor-pointer text-sm font-medium">
        View exact figures
      </summary>
      <div className="mt-4 space-y-5">
        {scenarios.map(({ id, name, comparison }) => (
          <section
            key={id}
            className="space-y-2"
            aria-label={`${name} exact figures`}
          >
            <h4 className="text-sm font-medium">{name}</h4>
            <MaterialEffectsTable
              points={comparison.timeline.filter(
                ({ isMaterialDate }) => isMaterialDate,
              )}
              currency={currency}
              reserveMonths={reserveMonths}
            />
          </section>
        ))}
      </div>
    </details>
  );
}

function ScenarioAssumptions({
  scenarios,
  currency,
}: Readonly<{ scenarios: DecisionScenarioResult[]; currency: Currency }>) {
  return (
    <details className="rounded-md border p-4">
      <summary className="cursor-pointer text-sm font-medium">
        Review assumptions and implied actions
      </summary>
      <div className="mt-4 space-y-5">
        {scenarios.map(({ id, name, comparison }) => (
          <section
            key={id}
            className="space-y-3"
            aria-label={`${name} assumptions`}
          >
            <h4 className="text-sm font-semibold">{name}</h4>
            <div className="grid gap-3 lg:grid-cols-2">
              <GoalDates comparison={comparison} />
              <JudgmentInputs comparison={comparison} />
            </div>
            <FundingMechanics comparison={comparison} baseCurrency={currency} />
            <ImpliedActions comparison={comparison} />
          </section>
        ))}
      </div>
    </details>
  );
}

export function DecisionScenarioResults({
  scenarios,
  currency,
  reserveMonths,
}: Readonly<{
  scenarios: DecisionScenarioResult[];
  currency: Currency;
  reserveMonths: number | null;
}>) {
  const availableScenarios = scenarios.filter(
    ({ comparison }) => comparison.timeline.length > 0,
  );
  if (availableScenarios.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        Add reconciled spending and current account values to compare these
        decisions.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <DecisionScenarioCharts
        scenarios={availableScenarios}
        currency={currency}
      />
      <HorizonSummaries
        scenarios={availableScenarios}
        currency={currency}
        reserveMonths={reserveMonths}
      />
      <ExactFigures
        scenarios={availableScenarios}
        currency={currency}
        reserveMonths={reserveMonths}
      />
      <ScenarioAssumptions scenarios={availableScenarios} currency={currency} />
    </div>
  );
}
