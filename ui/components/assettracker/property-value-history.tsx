"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { formatAccountCurrency, formatAxisTick } from "@/lib/assettracker";
import type { PropertyValueHistoryView } from "@/lib/domain/assettracker";

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

const valuationLabels = {
  "purchase-price": "Purchase price",
  "formal-valuation": "Formal valuation",
  "manual-valuation": "Manual valuation",
} as const;

type ChartPoint = {
  date: string;
  estimate?: number;
  recorded?: number;
};

function chartPoints(
  view: Extract<PropertyValueHistoryView, { status: "ready" }>,
): ChartPoint[] {
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

export function PropertyValueHistory({
  view,
}: Readonly<{ view: PropertyValueHistoryView }>) {
  if (view.status === "unavailable") {
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

  const { history } = view;
  const points = chartPoints(view);
  const availableEstimates = history.estimates.filter(
    (estimate) => estimate.kind === "index-estimate",
  );
  const latestEstimate = availableEstimates.at(-1);
  const unavailablePeriods = history.estimates.filter(
    (estimate) => estimate.kind === "index-unavailable",
  );

  return (
    <section className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">Indexed property history</h3>
        <Badge variant="secondary">Estimate</Badge>
        {history.calculation.series.fallback && (
          <Badge variant="outline">Fallback series</Badge>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Purchase prices and valuations stay recorded separately from the index
        estimate.
      </p>
      {latestEstimate && (
        <p className="mt-3 text-sm">
          <span className="text-muted-foreground">Latest index estimate</span>{" "}
          <span className="font-semibold">
            {formatAccountCurrency(latestEstimate.value, "GBP")}
          </span>{" "}
          <span className="text-xs text-muted-foreground">
            at {latestEstimate.date}
          </span>
        </p>
      )}

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
              formatter={(value) =>
                formatAccountCurrency(value as number, "GBP")
              }
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

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium">Recorded valuations</p>
          <ul className="mt-1 space-y-1 text-xs">
            {history.recordedValuations.map((valuation) => (
              <li
                key={valuation.id}
                className="flex items-center justify-between gap-2"
              >
                <span className="text-muted-foreground">
                  {valuationLabels[valuation.kind]} · {valuation.date}
                </span>
                <span className="font-mono">
                  {formatAccountCurrency(valuation.value, valuation.currency)}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-medium">Selected index series</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {history.calculation.series.label}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {history.calculation.dataset.provider} · release{" "}
            {history.calculation.dataset.releasePeriod} · dataset{" "}
            {history.calculation.dataset.versionId}
          </p>
        </div>
      </div>

      {unavailablePeriods.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          No index observation for{" "}
          {unavailablePeriods.map(({ period }) => period).join(", ")}.
        </p>
      )}

      <details className="mt-3 border-t pt-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">
          Calculation details
        </summary>
        <p className="mt-2 font-mono">{history.calculation.formula}</p>
        <p className="mt-1">
          Anchor {history.calculation.anchor.date} ·{" "}
          {formatAccountCurrency(
            history.calculation.anchor.value,
            history.calculation.anchor.currency,
          )}{" "}
          · index {history.calculation.anchor.indexLevel}
        </p>
      </details>
    </section>
  );
}
