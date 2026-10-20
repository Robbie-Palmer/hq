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
import { Badge } from "@/components/ui/badge";
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
  AdoptedActionReconciliation,
  AdoptedDecisionForecastRecord,
  AdoptedForecastReconciliation,
  AdoptedForecastVarianceSource,
  Currency,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";

function formatDate(value: string): string {
  const date = value.length === 10 ? `${value}T00:00:00Z` : value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(date));
}

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
    <section>
      <h4 className="text-sm font-semibold">Frozen forecast sources</h4>
      <dl className="mt-2 grid gap-3 rounded-md border p-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
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
    </section>
  );
}

function ActionTimeline({
  forecast,
}: Readonly<{ forecast: AdoptedDecisionForecastRecord }>) {
  return (
    <section>
      <h4 className="text-sm font-semibold">Full action schedule</h4>
      {forecast.actions.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No actions were adopted.
        </p>
      ) : (
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
      )}
    </section>
  );
}

const varianceLabels: Record<AdoptedForecastVarianceSource["kind"], string> = {
  "changed-amount": "Changed amount",
  "changed-timing": "Changed timing",
  "household-cash-flow": "Household cash flow",
  "market-or-currency": "Market or currency",
  unexplained: "Unexplained",
  "revised-assumption": "Revised assumption",
};

const varianceChartLabels: Record<
  AdoptedForecastVarianceSource["kind"],
  string
> = {
  "changed-amount": "Amount",
  "changed-timing": "Timing",
  "household-cash-flow": "Cash flow",
  "market-or-currency": "Market / FX",
  unexplained: "Unexplained",
  "revised-assumption": "Assumption",
};

const balanceChartConfig = {
  expected: { label: "Adopted", color: "var(--chart-2)" },
  observed: { label: "Observed", color: "var(--chart-1)" },
} satisfies ChartConfig;

const varianceChartConfig = {
  amount: { label: "Change" },
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
    <section className="space-y-2">
      <h4 className="text-sm font-semibold">Account balance comparison</h4>
      <div className="rounded-md border p-3">
        <BalanceChartPlot data={data} currency={currency} />
        <div className="sr-only">
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
      </div>
    </section>
  );
}

type VarianceChartDatum = {
  id: string;
  label: string;
  amount: number;
  kind: AdoptedForecastVarianceSource["kind"];
};

function VarianceAxisTick({
  x = 0,
  y = 0,
  payload,
}: Readonly<{
  x?: number;
  y?: number;
  payload?: { value?: string };
}>) {
  const lines = (payload?.value ?? "").split(" · ");
  return (
    <text x={x - 6} y={y} fill="currentColor" fontSize={10} textAnchor="end">
      {lines.map((line, index) => (
        <tspan
          key={`${index}-${line}`}
          x={x - 6}
          dy={index === 0 ? "-0.2em" : "1.1em"}
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
    <div style={{ height: Math.max(190, data.length * 54 + 44) }}>
      <ChartContainer
        config={varianceChartConfig}
        className="aspect-auto h-full w-full"
        role="img"
        aria-label="Largest forecast changes"
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
              width={124}
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

function measuredSources(
  sources: readonly AdoptedForecastVarianceSource[],
): AdoptedForecastVarianceSource[] {
  return sources
    .filter(
      (source): source is AdoptedForecastVarianceSource & { amount: number } =>
        source.amount != null,
    )
    .toSorted((left, right) => Math.abs(right.amount) - Math.abs(left.amount));
}

function PrimaryVarianceChart({
  sources,
  currency,
}: Readonly<{
  sources: readonly AdoptedForecastVarianceSource[];
  currency: Currency;
}>) {
  const data = measuredSources(sources)
    .slice(0, 5)
    .map((source, index) => ({
      id: `${source.kind}-${source.subject}-${index}`,
      label: `${varianceChartLabels[source.kind]} · ${source.subject}`,
      amount: source.amount ?? 0,
      kind: source.kind,
    }));
  if (data.length === 0) return null;
  return (
    <section className="rounded-md border p-3">
      <h3 className="text-sm font-semibold">What changed</h3>
      <VarianceChartPlot data={data} currency={currency} />
    </section>
  );
}

type ForecastPosition = {
  checkpointDate: string;
  observedAt: string;
  expected: number;
  observed: number;
  observedCount: number;
  accountCount: number;
};

function latestPosition(
  reconciliation: AdoptedForecastReconciliation,
): ForecastPosition | null {
  const observed = reconciliation.balances.filter(
    (balance) => balance.observedBalance != null,
  );
  const checkpointDate = observed
    .map(({ checkpointDate: date }) => date)
    .toSorted()
    .at(-1);
  if (checkpointDate == null) return null;
  const atCheckpoint = observed.filter(
    (balance) => balance.checkpointDate === checkpointDate,
  );
  const observedAt = atCheckpoint
    .flatMap((balance) =>
      balance.observedAt == null ? [] : [balance.observedAt],
    )
    .toSorted()
    .at(-1);
  if (observedAt == null) return null;
  return {
    checkpointDate,
    observedAt,
    expected: atCheckpoint.reduce(
      (total, balance) => total + balance.expectedBalance,
      0,
    ),
    observed: atCheckpoint.reduce(
      (total, balance) => total + (balance.observedBalance ?? 0),
      0,
    ),
    observedCount: atCheckpoint.length,
    accountCount: reconciliation.balances.filter(
      (balance) => balance.checkpointDate === checkpointDate,
    ).length,
  };
}

function forecastStatus(
  reconciliation: AdoptedForecastReconciliation,
  variance: number | null,
) {
  const needsReview =
    (variance != null && variance < -0.01) ||
    reconciliation.varianceSources.some(({ kind }) =>
      ["unexplained", "revised-assumption"].includes(kind),
    );
  if (needsReview) {
    return { label: "Needs review", variant: "destructive" as const };
  }
  if (reconciliation.varianceSources.length > 0) {
    return { label: "Changed", variant: "secondary" as const };
  }
  if (variance == null) {
    return { label: "Awaiting data", variant: "outline" as const };
  }
  return { label: "On track", variant: "outline" as const };
}

function forecastHeadline(
  reconciliation: AdoptedForecastReconciliation,
  variance: number | null,
  currency: Currency,
): string {
  if (variance == null) {
    return reconciliation.varianceSources.length > 0
      ? `${reconciliation.varianceSources.length} changes to review`
      : "Waiting for observations";
  }
  if (Math.abs(variance) < 0.01) return "On track";
  return `${formatCurrency(Math.abs(Math.round(variance)), currency)} ${variance > 0 ? "above" : "below"} forecast`;
}

function SummaryStatus({
  reconciliation,
  currency,
}: Readonly<{
  reconciliation: AdoptedForecastReconciliation;
  currency: Currency;
}>) {
  const position = latestPosition(reconciliation);
  const variance =
    position == null ? null : position.observed - position.expected;
  const status = forecastStatus(reconciliation, variance);
  const headline = forecastHeadline(reconciliation, variance, currency);
  return (
    <section className="flex flex-wrap items-start justify-between gap-3 rounded-md bg-muted/40 p-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Latest position
        </p>
        <p className="mt-1 text-2xl font-semibold tracking-tight">{headline}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {position == null
            ? "No balance observation yet"
            : `Observed ${formatDate(position.observedAt)} · ${position.observedCount} of ${position.accountCount} balances`}
        </p>
      </div>
      <Badge variant={status.variant}>{status.label}</Badge>
    </section>
  );
}

function formatDriverAmount(amount: number | null, currency: Currency): string {
  if (amount == null) return "Non-monetary";
  const sign = amount > 0 ? "+" : amount < 0 ? "−" : "";
  return `${sign}${formatCurrency(Math.abs(Math.round(amount)), currency)}`;
}

function TopDrivers({
  sources,
  currency,
}: Readonly<{
  sources: readonly AdoptedForecastVarianceSource[];
  currency: Currency;
}>) {
  const drivers = sources
    .toSorted(
      (left, right) => Math.abs(right.amount ?? 0) - Math.abs(left.amount ?? 0),
    )
    .slice(0, 3);
  if (drivers.length === 0) return null;
  return (
    <section>
      <h3 className="text-sm font-semibold">Biggest drivers</h3>
      <ol className="mt-2 divide-y rounded-md border">
        {drivers.map((source, index) => (
          <li
            key={`${source.kind}-${source.subject}-${index}`}
            className="flex items-center justify-between gap-3 p-3 text-sm"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{source.subject}</p>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: varianceColors[source.kind] }}
                />
                {varianceLabels[source.kind]}
              </p>
            </div>
            <span className="shrink-0 font-mono text-xs">
              {formatDriverAmount(source.amount, currency)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function actionExceptionLabel(
  reconciliation: AdoptedActionReconciliation,
): string {
  const changes: string[] = [];
  if (
    reconciliation.amountVariance != null &&
    Math.abs(reconciliation.amountVariance) >= 0.01
  ) {
    changes.push(
      `${formatCurrency(Math.abs(Math.round(reconciliation.amountVariance)), reconciliation.action.currency)} ${reconciliation.amountVariance > 0 ? "higher" : "lower"}`,
    );
  }
  if (
    reconciliation.timingVarianceDays != null &&
    reconciliation.timingVarianceDays !== 0
  ) {
    const dayLabel =
      Math.abs(reconciliation.timingVarianceDays) === 1 ? "day" : "days";
    changes.push(
      `${Math.abs(reconciliation.timingVarianceDays)} ${dayLabel} ${reconciliation.timingVarianceDays > 0 ? "late" : "early"}`,
    );
  }
  return changes.join(" · ");
}

function ActionExceptions({
  actions,
}: Readonly<{ actions: readonly AdoptedActionReconciliation[] }>) {
  const exceptions = actions.filter(
    (action) =>
      (action.amountVariance != null &&
        Math.abs(action.amountVariance) >= 0.01) ||
      (action.timingVarianceDays != null && action.timingVarianceDays !== 0),
  );
  if (exceptions.length === 0) return null;
  return (
    <section>
      <h3 className="text-sm font-semibold">Actions needing attention</h3>
      <ul className="mt-2 divide-y rounded-md border text-sm">
        {exceptions.map((action) => (
          <li
            key={action.action.id}
            className="flex flex-wrap items-center justify-between gap-2 p-3"
          >
            <span className="font-medium">{action.action.name}</span>
            <span className="text-xs text-muted-foreground">
              {actionExceptionLabel(action)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function useRevisitForm(forecastId: string, decisionId: string) {
  const { revisitAdoptedDecision } = useAssetTracker();
  const [editing, setEditing] = useState(false);
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
      setEditing(false);
    } catch {
      setError("This decision could not be reopened.");
    } finally {
      setSaving(false);
    }
  }
  return {
    editing,
    setEditing,
    reason,
    setReason,
    saving,
    error,
    submit,
  };
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
  const form = useRevisitForm(forecastId, decisionId);
  if (!form.editing) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => form.setEditing(true)}
        aria-label={`Revisit decision: ${decisionName}`}
      >
        Revisit decision
      </Button>
    );
  }
  return (
    <form className="grid gap-2 rounded-md border p-3" onSubmit={form.submit}>
      <label
        className="text-sm font-medium"
        htmlFor={`${forecastId}-${decisionId}`}
      >
        Why revisit {decisionName}?
      </label>
      <Input
        id={`${forecastId}-${decisionId}`}
        required
        placeholder="What changed?"
        value={form.reason}
        onChange={(event) => form.setReason(event.target.value)}
      />
      {form.error != null && (
        <p className="text-sm text-destructive" role="alert">
          {form.error}
        </p>
      )}
      <div className="flex gap-2">
        <Button disabled={form.saving} size="sm">
          {form.saving ? "Reopening…" : "Confirm revisit"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => form.setEditing(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function DecisionControls({
  forecast,
}: Readonly<{ forecast: AdoptedDecisionForecastRecord }>) {
  if (forecast.selectedDecisions.length === 0) return null;
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
      <p className="text-sm text-muted-foreground">
        {forecast.selectedDecisions.map(({ name }) => name).join(", ")}
      </p>
      {forecast.selectedDecisions.map((decision) => (
        <RevisitDecision
          key={decision.id}
          decisionId={decision.id}
          decisionName={decision.name}
          forecastId={forecast.id}
        />
      ))}
    </section>
  );
}

function VarianceNotes({
  sources,
  currency,
}: Readonly<{
  sources: readonly AdoptedForecastVarianceSource[];
  currency: Currency;
}>) {
  if (sources.length === 0) return null;
  return (
    <section>
      <h4 className="text-sm font-semibold">Complete variance notes</h4>
      <ul className="mt-2 space-y-2 text-sm">
        {sources.map((source, index) => (
          <li
            key={`${source.kind}-${source.label}-${index}`}
            className="rounded-md bg-muted/40 p-3"
          >
            <span className="font-medium">{varianceLabels[source.kind]}</span>
            {`: ${source.label}`}
            {source.amount == null
              ? ""
              : ` (${formatCurrency(Math.round(source.amount), currency)})`}
          </li>
        ))}
      </ul>
    </section>
  );
}

function DecisionDetails({
  forecast,
}: Readonly<{ forecast: AdoptedDecisionForecastRecord }>) {
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <div>
        <h4 className="text-sm font-semibold">Adopted choices</h4>
        <ul className="mt-2 space-y-2 text-sm">
          {forecast.selectedDecisions.map((decision) => (
            <li key={decision.id} className="rounded-md border p-3">
              {decision.name}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h4 className="text-sm font-semibold">Still undecided</h4>
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

function PlanDetails({
  forecast,
  reconciliation,
  currency,
}: Readonly<{
  forecast: AdoptedDecisionForecastRecord;
  reconciliation: AdoptedForecastReconciliation;
  currency: Currency;
}>) {
  return (
    <details className="rounded-md border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        View plan details
      </summary>
      <div className="mt-4 space-y-5 border-t pt-4">
        <SourceSnapshot forecast={forecast} />
        <ActionTimeline forecast={forecast} />
        <BalanceComparisonChart
          reconciliation={reconciliation}
          currency={currency}
        />
        <VarianceNotes
          sources={reconciliation.varianceSources}
          currency={currency}
        />
        <DecisionDetails forecast={forecast} />
      </div>
    </details>
  );
}

export function AdoptedForecastCard({
  forecast,
}: Readonly<{ forecast: AdoptedDecisionForecastRecord }>) {
  const { reconcileAdoptedForecast } = useAssetTracker();
  const reconciliation = reconcileAdoptedForecast(forecast);
  const currency =
    forecast.balanceCheckpoints[0]?.accounts[0]?.currency ?? "GBP";
  return (
    <article className="space-y-4 rounded-lg border p-5">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">{forecast.title}</h2>
          <p className="text-xs text-muted-foreground">
            Adopted {formatDate(forecast.adoptedAt)}
          </p>
        </div>
        <Badge variant="secondary">Live forecast</Badge>
      </header>
      <SummaryStatus reconciliation={reconciliation} currency={currency} />
      {reconciliation.varianceSources.length === 0 ? (
        <p className="rounded-md bg-muted/40 p-3 text-sm">
          No material variance has been observed yet.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.6fr)]">
          <PrimaryVarianceChart
            sources={reconciliation.varianceSources}
            currency={currency}
          />
          <TopDrivers
            sources={reconciliation.varianceSources}
            currency={currency}
          />
        </div>
      )}
      <ActionExceptions actions={reconciliation.actions} />
      <DecisionControls forecast={forecast} />
      <PlanDetails
        forecast={forecast}
        reconciliation={reconciliation}
        currency={currency}
      />
    </article>
  );
}
