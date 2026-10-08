"use client";

import { format, parseISO } from "date-fns";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
} from "@/components/ui/chart";
import { formatCurrency } from "@/lib/assettracker";
import type {
  Currency,
  DecisionScenarioComparison,
} from "@/lib/domain/assettracker";

export type DecisionScenarioResult = {
  id: string;
  name: string;
  comparison: DecisionScenarioComparison;
};

const COLORS = [
  "hsl(263, 70%, 58%)",
  "hsl(160, 84%, 39%)",
  "hsl(199, 89%, 48%)",
  "hsl(38, 92%, 50%)",
];

type ChartDatum = Record<string, string | number | [number, number]> & {
  date: string;
};

function seriesKey(
  id: string,
  metric: "portfolio" | "runway",
  part: "expected" | "range",
) {
  return `${id}-${metric}-${part}`;
}

function chartData(
  scenarios: DecisionScenarioResult[],
  metric: "portfolio" | "runway",
): ChartDatum[] {
  const dates = Array.from(
    new Set(
      scenarios.flatMap(({ comparison }) =>
        comparison.timeline.map(({ date }) => date),
      ),
    ),
  ).sort((left, right) => left.localeCompare(right));
  const pointsByScenario = scenarios.map(
    ({ comparison }) =>
      new Map(comparison.timeline.map((point) => [point.date, point])),
  );

  return dates.map((date) => {
    const row: ChartDatum = { date };
    scenarios.forEach((scenario, index) => {
      const point = pointsByScenario[index]?.get(date);
      if (point == null) return;
      const baseline =
        metric === "portfolio"
          ? point.baseline.totalBalance
          : point.baseline.totalMonths;
      const expected =
        (metric === "portfolio"
          ? point.expected.totalBalance
          : point.expected.totalMonths) - baseline;
      const outerValues = [
        (metric === "portfolio"
          ? point.lowCost.totalBalance
          : point.lowCost.totalMonths) - baseline,
        (metric === "portfolio"
          ? point.highCost.totalBalance
          : point.highCost.totalMonths) - baseline,
      ].sort((left, right) => left - right) as [number, number];
      row[seriesKey(scenario.id, metric, "expected")] = expected;
      row[seriesKey(scenario.id, metric, "range")] = outerValues;
    });
    return row;
  });
}

type TooltipItem = {
  color?: string;
  dataKey?: string | number;
  payload?: ChartDatum;
  value?: number | string | [number, number];
};

function ScenarioTooltip({
  active,
  payload,
  scenarios,
  metric,
  currency,
}: Readonly<{
  active?: boolean;
  payload?: TooltipItem[];
  scenarios: DecisionScenarioResult[];
  metric: "portfolio" | "runway";
  currency: Currency;
}>) {
  if (!active || payload?.length == null || payload.length === 0) return null;
  const point = payload.find((item) => item.payload != null)?.payload;
  if (point == null) return null;
  return (
    <div className="grid min-w-56 gap-2 rounded-lg border bg-background px-3 py-2 text-xs shadow-xl">
      <p className="font-medium">
        {format(parseISO(point.date), "d MMM yyyy")}
      </p>
      {scenarios.map((scenario, index) => {
        const value = point[seriesKey(scenario.id, metric, "expected")];
        if (typeof value !== "number") return null;
        return (
          <div key={scenario.id} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-full"
              style={{ backgroundColor: COLORS[index % COLORS.length] }}
            />
            <span>{scenario.name}</span>
            <span className="ml-auto font-mono tabular-nums">
              {metric === "portfolio"
                ? formatCurrency(Math.round(value), currency)
                : `${value > 0 ? "+" : ""}${value.toFixed(1)} mo`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function EffectChartAxes({
  metric,
  currency,
}: Readonly<{ metric: "portfolio" | "runway"; currency: Currency }>) {
  const formatTick =
    metric === "portfolio"
      ? (value: number) =>
          new Intl.NumberFormat("en-GB", {
            notation: "compact",
            style: "currency",
            currency,
            maximumFractionDigits: 0,
          }).format(value)
      : (value: number) => `${Math.round(value)}mo`;

  return (
    <>
      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
      <XAxis
        dataKey="date"
        minTickGap={32}
        tickFormatter={(value: string) => format(parseISO(value), "MMM yy")}
      />
      <YAxis width={64} tickFormatter={formatTick} />
      <ReferenceLine y={0} className="stroke-muted-foreground" />
    </>
  );
}

function ScenarioSeries({
  scenarios,
  metric,
}: Readonly<{
  scenarios: DecisionScenarioResult[];
  metric: "portfolio" | "runway";
}>) {
  return (
    <>
      {scenarios.map((scenario, index) => (
        <Area
          key={`${scenario.id}-range`}
          type="monotone"
          dataKey={seriesKey(scenario.id, metric, "range")}
          fill={COLORS[index % COLORS.length]}
          fillOpacity={0.12}
          stroke="none"
          isAnimationActive={false}
        />
      ))}
      {scenarios.map((scenario, index) => (
        <Line
          key={`${scenario.id}-expected`}
          type="monotone"
          dataKey={seriesKey(scenario.id, metric, "expected")}
          stroke={COLORS[index % COLORS.length]}
          strokeWidth={2.5}
          dot={false}
          isAnimationActive={false}
        />
      ))}
    </>
  );
}

function EffectPlot({
  scenarios,
  metric,
  currency,
  title,
}: Readonly<{
  scenarios: DecisionScenarioResult[];
  metric: "portfolio" | "runway";
  currency: Currency;
  title: string;
}>) {
  const config = Object.fromEntries(
    scenarios.map((scenario, index) => [
      seriesKey(scenario.id, metric, "expected"),
      { label: scenario.name, color: COLORS[index % COLORS.length] },
    ]),
  ) satisfies ChartConfig;
  return (
    <ChartContainer
      config={config}
      className="h-64 w-full"
      role="img"
      aria-label={title}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={chartData(scenarios, metric)}
          margin={{ top: 8, right: 12, bottom: 0, left: 4 }}
        >
          <EffectChartAxes metric={metric} currency={currency} />
          <ChartTooltip
            content={
              <ScenarioTooltip
                scenarios={scenarios}
                metric={metric}
                currency={currency}
              />
            }
          />
          <ScenarioSeries scenarios={scenarios} metric={metric} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

function EffectChart({
  scenarios,
  metric,
  currency,
}: Readonly<{
  scenarios: DecisionScenarioResult[];
  metric: "portfolio" | "runway";
  currency: Currency;
}>) {
  const title =
    metric === "portfolio"
      ? "Portfolio effect versus committed-only"
      : "Runway effect versus committed-only";
  return (
    <div className="space-y-2">
      <div>
        <h4 className="text-sm font-medium">{title}</h4>
        <p className="text-xs text-muted-foreground">
          Expected path with the entered lower-to-higher-cost range.
        </p>
      </div>
      <EffectPlot
        scenarios={scenarios}
        metric={metric}
        currency={currency}
        title={title}
      />
    </div>
  );
}

export function DecisionScenarioCharts({
  scenarios,
  currency,
}: Readonly<{ scenarios: DecisionScenarioResult[]; currency: Currency }>) {
  return (
    <div className="space-y-5 rounded-lg border p-4">
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {scenarios.map((scenario, index) => (
          <div key={scenario.id} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden="true"
              className="h-0.5 w-5"
              style={{ backgroundColor: COLORS[index % COLORS.length] }}
            />
            {scenario.name}
          </div>
        ))}
      </div>
      <EffectChart
        scenarios={scenarios}
        metric="portfolio"
        currency={currency}
      />
      <EffectChart scenarios={scenarios} metric="runway" currency={currency} />
    </div>
  );
}
