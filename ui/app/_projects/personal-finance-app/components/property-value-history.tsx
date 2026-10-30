"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import type { PropertyValueHistoryView } from "@/app/_projects/personal-finance-app/domain";
import {
  formatAccountCurrency,
  formatAxisTick,
} from "@/app/_projects/personal-finance-app/lib";
import { Badge } from "@/components/ui/badge";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { HousingValueDisclosure } from "./housing-value-disclosure";

const chartConfig = {
  estimate: {
    label: "Index estimate",
    color: "hsl(220, 70%, 50%)",
  },
  recorded: {
    label: "Recorded valuation",
    color: "hsl(150, 55%, 42%)",
  },
} satisfies ChartConfig;

type ChartPoint = {
  date: string;
  estimate?: number;
  recorded?: number;
};

type ReadyPropertyValueHistoryView = Extract<
  PropertyValueHistoryView,
  { status: "ready" }
>;

function chartPoints(view: ReadyPropertyValueHistoryView): ChartPoint[] {
  const byDate = new Map<string, ChartPoint>();
  for (const estimate of view.history.estimates) {
    const point = byDate.get(estimate.date) ?? { date: estimate.date };
    if (estimate.kind === "index-estimate") point.estimate = estimate.value;
    byDate.set(estimate.date, point);
  }
  for (const valuation of view.history.recordedValuations) {
    const point = byDate.get(valuation.date) ?? { date: valuation.date };
    point.recorded = valuation.value;
    byDate.set(valuation.date, point);
  }
  return Array.from(byDate.values()).toSorted((left, right) =>
    left.date.localeCompare(right.date),
  );
}

function UnavailablePropertyValueHistory({
  view,
}: Readonly<{ view: PropertyValueHistoryView }>) {
  if (view.status !== "unavailable") return null;
  return (
    <section className="rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium">Indexed property history</h3>
        <Badge variant="outline">Unavailable</Badge>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{view.message}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Dataset {view.datasetVersion}
      </p>
    </section>
  );
}

function PropertyHistoryHeader({ fallback }: Readonly<{ fallback: boolean }>) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">Indexed property history</h3>
        <Badge variant="secondary">Estimate</Badge>
        {fallback && <Badge variant="outline">Fallback series</Badge>}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Purchase prices and valuations stay recorded separately from the index
        estimate.
      </p>
    </>
  );
}

function PropertyHistoryLineChart({
  points,
}: Readonly<{ points: ChartPoint[] }>) {
  return (
    <ChartContainer
      config={chartConfig}
      className="mt-3 aspect-auto w-full"
      role="img"
      aria-label="Recorded and UK HPI indexed property values"
    >
      <ResponsiveContainer width="100%" height={200}>
        <LineChart
          data={points}
          margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="date" className="text-xs" hide />
          <YAxis
            className="text-xs"
            width={52}
            tickFormatter={formatAxisTick}
          />
          <ChartTooltip
            content={<ChartTooltipContent />}
            formatter={(value) => formatAccountCurrency(value as number, "GBP")}
          />
          <Line
            type="monotone"
            dataKey="estimate"
            stroke="hsl(220, 70%, 50%)"
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={false}
            connectNulls
          />
          <Line
            type="linear"
            dataKey="recorded"
            stroke="hsl(150, 55%, 42%)"
            strokeWidth={0}
            dot={{ r: 4, fill: "hsl(150, 55%, 42%)" }}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

function AccessiblePropertyHistory({
  points,
}: Readonly<{ points: ChartPoint[] }>) {
  return (
    <div className="sr-only">
      <table>
        <caption>Recorded and indexed property values</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>Index estimate</th>
            <th>Recorded valuation</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.date}>
              <td>{point.date}</td>
              <td>
                {point.estimate == null
                  ? "Unavailable"
                  : formatAccountCurrency(point.estimate, "GBP")}
              </td>
              <td>
                {point.recorded == null
                  ? "No recorded valuation"
                  : formatAccountCurrency(point.recorded, "GBP")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecordedHousingValues({
  values,
}: Readonly<{
  values: ReadyPropertyValueHistoryView["history"]["housingValues"];
}>) {
  return (
    <div>
      <p className="text-xs font-medium">Recorded valuations</p>
      <div className="mt-2 grid gap-2">
        {values.map((value) => (
          <HousingValueDisclosure key={value.id} value={value} compact />
        ))}
      </div>
    </div>
  );
}

function SelectedIndexSeries({
  history,
}: Readonly<{ history: ReadyPropertyValueHistoryView["history"] }>) {
  const { dataset, series } = history.calculation;
  return (
    <div>
      <p className="text-xs font-medium">Selected index series</p>
      <p className="mt-1 text-xs text-muted-foreground">{series.label}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {dataset.provider} · release {dataset.releasePeriod} · dataset{" "}
        {dataset.versionId}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Published {dataset.publishedAt} · retrieved{" "}
        {dataset.retrievedAt.slice(0, 10)} · geography {series.geographyName}
      </p>
    </div>
  );
}

function PropertyHistoryCalculation({
  calculation,
}: Readonly<{
  calculation: ReadyPropertyValueHistoryView["history"]["calculation"];
}>) {
  return (
    <details className="mt-3 border-t pt-3 text-xs text-muted-foreground">
      <summary className="cursor-pointer font-medium text-foreground">
        Calculation details
      </summary>
      <p className="mt-2 font-mono">{calculation.formula}</p>
      <p className="mt-1">
        Anchor {calculation.anchor.date} ·{" "}
        {formatAccountCurrency(
          calculation.anchor.value,
          calculation.anchor.currency,
        )}{" "}
        · index {calculation.anchor.indexLevel}
      </p>
    </details>
  );
}

function ReadyPropertyValueHistory({
  view,
}: Readonly<{ view: ReadyPropertyValueHistoryView }>) {
  const { history } = view;
  const points = chartPoints(view);
  const latestEstimate = history.estimates
    .filter((estimate) => estimate.kind === "index-estimate")
    .at(-1);
  const latestHousingValue = history.housingValues.find(
    ({ id }) => id === `index-estimate:${latestEstimate?.date}`,
  );
  const recordedHousingValues = history.housingValues.filter(
    ({ kind }) =>
      kind === "recorded-purchase" ||
      kind === "recorded-valuation" ||
      kind === "manual-override",
  );
  const unavailablePeriods = history.estimates
    .filter((estimate) => estimate.kind === "index-unavailable")
    .map(({ period }) => period);

  return (
    <section className="rounded-lg border p-3">
      <PropertyHistoryHeader fallback={history.calculation.series.fallback} />
      {latestHousingValue && (
        <div className="mt-3">
          <p className="mb-2 text-xs font-medium">Latest index estimate</p>
          <HousingValueDisclosure value={latestHousingValue} compact />
        </div>
      )}
      <PropertyHistoryLineChart points={points} />
      <AccessiblePropertyHistory points={points} />
      <div className="mt-3 grid gap-3">
        <RecordedHousingValues values={recordedHousingValues} />
        <SelectedIndexSeries history={history} />
      </div>
      {unavailablePeriods.length !== 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          No index observation for {unavailablePeriods.join(", ")}.
        </p>
      )}
      <PropertyHistoryCalculation calculation={history.calculation} />
    </section>
  );
}

export function PropertyValueHistory({
  view,
}: Readonly<{ view: PropertyValueHistoryView }>) {
  if (view.status === "unavailable") {
    return <UnavailablePropertyValueHistory view={view} />;
  }
  return <ReadyPropertyValueHistory view={view} />;
}
