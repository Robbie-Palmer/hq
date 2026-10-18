"use client";

import { type SubmitEvent, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatCurrencyAxisTick } from "@/lib/assettracker";
import type {
  AdoptedDecisionForecastRecord,
  AdoptedForecastReconciliation,
  AdoptedForecastVarianceSource,
  Currency,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";

function SourceSnapshot({
  forecast,
}: Readonly<{ forecast: AdoptedDecisionForecastRecord }>) {
  const incomeAssumptions = forecast.assumptionSets.reduce(
    (count, set) => count + set.incomeAssumptionIds.length,
    0,
  );
  const expenditureAssumptions = forecast.assumptionSets.reduce(
    (count, set) => count + set.expenditureAssumptionIds.length,
    0,
  );
  return (
    <details className="rounded-md border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Frozen forecast sources
      </summary>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Planning cases</dt>
          <dd>
            {forecast.planningCases.map(({ name }) => name).join(", ") ||
              "No named case"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Baseline</dt>
          <dd>
            {forecast.sourceBalances.length} balances and{" "}
            {forecast.commitments.length} commitments
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            Cash-flow assumptions
          </dt>
          <dd>
            {incomeAssumptions} income and {expenditureAssumptions} expenditure
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Reserve preference</dt>
          <dd>
            {forecast.reservePreference.coverageMonths == null
              ? "No warning threshold"
              : `${forecast.reservePreference.coverageMonths} months`}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Rates</dt>
          <dd>{forecast.rates.length} account rate inputs</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Calculation</dt>
          <dd>{forecast.calculationVersion}</dd>
        </div>
      </dl>
    </details>
  );
}

function ActionTimeline({
  forecast,
}: Readonly<{ forecast: AdoptedDecisionForecastRecord }>) {
  return (
    <section>
      <h3 className="text-sm font-semibold">Live actions</h3>
      <ul className="mt-2 divide-y rounded-md border text-sm">
        {forecast.actions.map((action) => (
          <li
            key={action.id}
            className="flex flex-wrap items-center justify-between gap-2 p-3"
          >
            <span>
              {action.date} · {action.kind} · {action.name}
              {action.cadence === "monthly" ? " · monthly" : ""}
            </span>
            <span className="font-mono">
              {formatCurrency(Math.round(action.amount), action.currency)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const varianceLabels: Record<AdoptedForecastVarianceSource["kind"], string> = {
  "changed-amount": "Changed amount",
  "changed-timing": "Changed timing",
  "household-cash-flow": "Household cash flow",
  "market-or-currency": "Market or currency movement",
  unexplained: "Unexplained balance change",
  "revised-assumption": "Revised assumption",
};

const balanceChartConfig = {
  expected: { label: "Adopted", color: "var(--chart-2)" },
  observed: { label: "Observed", color: "var(--chart-1)" },
} satisfies ChartConfig;

const varianceChartConfig = {
  amount: { label: "Variance amount" },
} satisfies ChartConfig;

const varianceColors: Record<AdoptedForecastVarianceSource["kind"], string> = {
  "changed-amount": "var(--chart-1)",
  "changed-timing": "var(--chart-2)",
  "household-cash-flow": "var(--chart-3)",
  "market-or-currency": "var(--chart-4)",
  unexplained: "var(--chart-5)",
  "revised-assumption": "var(--muted-foreground)",
};

type BalanceChartDatum = {
  label: string;
  checkpointDate: string;
  expected: number;
  observed: number;
};

function BalanceChartPlot({
  data,
  currency,
}: Readonly<{
  data: readonly BalanceChartDatum[];
  currency: Currency;
}>) {
  return (
    <div style={{ height: Math.max(190, data.length * 70 + 56) }}>
      <ChartContainer
        config={balanceChartConfig}
        className="aspect-auto h-full w-full"
        role="img"
        aria-label="Adopted and observed account balances"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            accessibilityLayer
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 12, bottom: 4, left: 4 }}
          >
            <CartesianGrid horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={(value: number) =>
                formatCurrencyAxisTick(value, currency)
              }
            />
            <YAxis type="category" dataKey="label" width={96} />
            <ReferenceLine x={0} className="stroke-muted-foreground" />
            <ChartTooltip
              content={<ChartTooltipContent />}
              formatter={(value) => formatCurrency(value as number, currency)}
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar
              dataKey="expected"
              fill="var(--color-expected)"
              radius={3}
              isAnimationActive={false}
            />
            <Bar
              dataKey="observed"
              fill="var(--color-observed)"
              radius={3}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </ChartContainer>
    </div>
  );
}

function BalanceValues({
  data,
  currency,
}: Readonly<{
  data: readonly BalanceChartDatum[];
  currency: Currency;
}>) {
  return (
    <div className="sr-only">
      <h5>Adopted and observed account balances</h5>
      <ul>
        {data.map((row) => (
          <li key={`${row.label}-${row.checkpointDate}`}>
            {row.label}, checkpoint {row.checkpointDate}: adopted{" "}
            {formatCurrency(row.expected, currency)}, observed{" "}
            {formatCurrency(row.observed, currency)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function BalanceComparisonChart({
  reconciliation,
  currency,
}: Readonly<{
  reconciliation: AdoptedForecastReconciliation;
  currency: Currency;
}>) {
  const data = reconciliation.balances.flatMap((balance) =>
    balance.observedBalance == null
      ? []
      : [
          {
            label: balance.accountName,
            checkpointDate: balance.checkpointDate,
            expected: balance.expectedBalance,
            observed: balance.observedBalance,
          },
        ],
  );
  if (data.length === 0) return null;
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div>
        <h4 className="text-sm font-medium">Balances against forecast</h4>
        <p className="text-xs text-muted-foreground">
          Adopted checkpoint balances beside the first observation on or after
          each checkpoint.
        </p>
      </div>
      <BalanceChartPlot data={data} currency={currency} />
      <BalanceValues data={data} currency={currency} />
    </div>
  );
}

type VarianceChartDatum = {
  id: string;
  label: string;
  amount: number;
  kind: AdoptedForecastVarianceSource["kind"];
};

function wrapAxisLabel(label: string, lineLength = 24): string[] {
  const lines: string[] = [];
  for (const word of label.split(" ")) {
    const current = lines.at(-1);
    if (current == null || `${current} ${word}`.length > lineLength) {
      lines.push(word);
    } else {
      lines[lines.length - 1] = `${current} ${word}`;
    }
  }
  return lines;
}

function VarianceAxisTick({
  x = 0,
  y = 0,
  payload,
}: Readonly<{
  x?: number;
  y?: number;
  payload?: { value?: string };
}>) {
  const lines = wrapAxisLabel(payload?.value ?? "");
  const firstLineOffset = -((lines.length - 1) * 0.55);
  return (
    <text x={x - 6} y={y} fill="currentColor" fontSize={10} textAnchor="end">
      {lines.map((line, index) => (
        <tspan
          key={`${index}-${line}`}
          x={x - 6}
          dy={index === 0 ? `${firstLineOffset}em` : "1.1em"}
        >
          {line}
        </tspan>
      ))}
    </text>
  );
}

function VarianceChartPlot({
  data,
  currency,
}: Readonly<{
  data: readonly VarianceChartDatum[];
  currency: Currency;
}>) {
  return (
    <div style={{ height: Math.max(220, data.length * 72 + 48) }}>
      <ChartContainer
        config={varianceChartConfig}
        className="aspect-auto h-full w-full"
        role="img"
        aria-label="Monetary variance sources"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            accessibilityLayer
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 12, bottom: 4, left: 4 }}
          >
            <CartesianGrid horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={(value: number) =>
                formatCurrencyAxisTick(value, currency)
              }
            />
            <YAxis
              type="category"
              dataKey="label"
              tick={<VarianceAxisTick />}
              width={156}
            />
            <ReferenceLine x={0} className="stroke-muted-foreground" />
            <ChartTooltip
              content={<ChartTooltipContent hideIndicator />}
              formatter={(value) => formatCurrency(value as number, currency)}
            />
            <Bar dataKey="amount" radius={3} isAnimationActive={false}>
              {data.map((row) => (
                <Cell key={row.id} fill={varianceColors[row.kind]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartContainer>
    </div>
  );
}

function VarianceAttributionChart({
  sources,
  currency,
}: Readonly<{
  sources: readonly AdoptedForecastVarianceSource[];
  currency: Currency;
}>) {
  const data = sources.flatMap((source, index) =>
    source.amount == null
      ? []
      : [
          {
            id: `${source.kind}-${index}`,
            label: `${varianceLabels[source.kind]}: ${source.label}`,
            amount: source.amount,
            kind: source.kind,
          },
        ],
  );
  if (data.length === 0) return null;
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div>
        <h4 className="text-sm font-medium">Measured variance</h4>
        <p className="text-xs text-muted-foreground">
          Monetary differences share one scale. Timing and assumption changes
          stay in the notes below.
        </p>
      </div>
      <VarianceChartPlot data={data} currency={currency} />
    </div>
  );
}

function Reconciliation({
  forecast,
}: Readonly<{ forecast: AdoptedDecisionForecastRecord }>) {
  const { reconcileAdoptedForecast } = useAssetTracker();
  const reconciliation = reconcileAdoptedForecast(forecast);
  const observedActions = reconciliation.actions.filter(
    ({ actualAmount }) => actualAmount != null,
  );
  const observedBalances = reconciliation.balances.filter(
    ({ observedBalance }) => observedBalance != null,
  );
  const currency =
    forecast.balanceCheckpoints[0]?.accounts[0]?.currency ?? "GBP";
  return (
    <section>
      <h3 className="text-sm font-semibold">Forecast and actuals</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        {observedActions.length} cash-flow actions and {observedBalances.length}{" "}
        balance observations now reconcile with the frozen forecast.
      </p>
      {reconciliation.varianceSources.length === 0 ? (
        <p className="mt-2 rounded-md bg-muted/40 p-3 text-sm">
          No material variance has been observed yet.
        </p>
      ) : (
        <>
          <div className="mt-3 grid gap-3 xl:grid-cols-2">
            <BalanceComparisonChart
              reconciliation={reconciliation}
              currency={currency}
            />
            <VarianceAttributionChart
              sources={reconciliation.varianceSources}
              currency={currency}
            />
          </div>
          <h4 className="mt-4 text-sm font-medium">Variance notes</h4>
          <ul className="mt-2 space-y-2 text-sm">
            {reconciliation.varianceSources.map((source, index) => (
              <li
                key={`${source.kind}-${source.label}-${index}`}
                className="rounded-md bg-muted/40 p-3"
              >
                <span className="font-medium">
                  {varianceLabels[source.kind]}
                </span>
                {`: ${source.label}`}
                {source.amount == null
                  ? ""
                  : ` (${formatCurrency(Math.round(source.amount), currency)})`}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function RevisitDecision({
  forecastId,
  decisionId,
  decisionName,
}: Readonly<{
  forecastId: string;
  decisionId: string;
  decisionName: string;
}>) {
  const { revisitAdoptedDecision } = useAssetTracker();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await revisitAdoptedDecision({ forecastId, decisionId, reason });
      setReason("");
    } catch {
      setError("This decision could not be reopened.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="grid gap-2 rounded-md border p-3" onSubmit={submit}>
      <label
        className="text-sm font-medium"
        htmlFor={`${forecastId}-${decisionId}`}
      >
        {decisionName}
      </label>
      <Input
        id={`${forecastId}-${decisionId}`}
        required
        placeholder="What changed?"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      {error != null && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button className="justify-self-start" disabled={saving} size="sm">
        {saving ? "Reopening…" : "Revisit this decision"}
      </Button>
    </form>
  );
}

function Decisions({
  forecast,
}: Readonly<{ forecast: AdoptedDecisionForecastRecord }>) {
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <div>
        <h3 className="text-sm font-semibold">Adopted choices</h3>
        <div className="mt-2 space-y-2">
          {forecast.selectedDecisions.map((decision) => (
            <RevisitDecision
              key={decision.id}
              decisionId={decision.id}
              decisionName={decision.name}
              forecastId={forecast.id}
            />
          ))}
        </div>
      </div>
      <div>
        <h3 className="text-sm font-semibold">Still undecided</h3>
        {forecast.undecidedDecisions.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">None</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {forecast.undecidedDecisions.map((decision) => (
              <li key={decision.id} className="rounded-md border p-3">
                {decision.name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function AdoptedForecastCard({
  forecast,
}: Readonly<{ forecast: AdoptedDecisionForecastRecord }>) {
  return (
    <article className="space-y-4 rounded-lg border p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">{forecast.title}</h2>
          <p className="text-xs text-muted-foreground">
            Adopted {forecast.adoptedAt}
          </p>
        </div>
        <span className="rounded-full bg-muted px-2 py-1 text-xs">
          Live forecast
        </span>
      </div>
      <SourceSnapshot forecast={forecast} />
      <ActionTimeline forecast={forecast} />
      <Reconciliation forecast={forecast} />
      <Decisions forecast={forecast} />
    </article>
  );
}
