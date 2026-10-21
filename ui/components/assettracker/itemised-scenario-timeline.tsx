"use client";

import { format, isValid, parseISO } from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { formatCurrency, formatCurrencyAxisTick } from "@/lib/assettracker";
import type { Currency } from "@/lib/domain/assettracker";

export type ScenarioTimelinePayment = {
  amount: number;
  date: string;
  paid: number;
  status: "committed" | "considering";
};

type TimelineDatum = {
  committed: number;
  considering: number;
  date: string;
  label: string;
  paid: number;
};

const chartConfig = {
  paid: { label: "Paid", color: "var(--chart-1)" },
  committed: { label: "Committed", color: "var(--chart-2)" },
  considering: { label: "Under consideration", color: "var(--chart-4)" },
} satisfies ChartConfig;

function timelineData(
  payments: readonly ScenarioTimelinePayment[],
): TimelineDatum[] {
  const byDate = new Map<string, Omit<TimelineDatum, "date" | "label">>();
  for (const payment of payments) {
    if (!isValid(parseISO(payment.date))) continue;
    const current = byDate.get(payment.date) ?? {
      committed: 0,
      considering: 0,
      paid: 0,
    };
    const paid = Math.min(payment.paid, payment.amount);
    const remaining = Math.max(payment.amount - paid, 0);
    current.paid += paid;
    current[payment.status] += remaining;
    byDate.set(payment.date, current);
  }
  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, values]) => ({
      ...values,
      date,
      label: format(parseISO(date), "d MMM yy"),
    }));
}

function TimelineChart({
  currency,
  data,
}: Readonly<{ currency: Currency; data: TimelineDatum[] }>) {
  return (
    <ChartContainer
      config={chartConfig}
      className="mt-4 aspect-auto h-64 w-full"
      role="img"
      aria-label="Scenario costs by due date and commitment status"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          accessibilityLayer
          data={data}
          margin={{ top: 4, right: 8, bottom: 4, left: 4 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) =>
              formatCurrencyAxisTick(value, currency)
            }
          />
          <ChartTooltip
            content={<ChartTooltipContent />}
            formatter={(value) => formatCurrency(value as number, currency)}
          />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar
            dataKey="paid"
            stackId="cost"
            fill="var(--color-paid)"
            isAnimationActive={false}
          />
          <Bar
            dataKey="committed"
            stackId="cost"
            fill="var(--color-committed)"
            isAnimationActive={false}
          />
          <Bar
            dataKey="considering"
            stackId="cost"
            fill="var(--color-considering)"
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

export function ItemisedScenarioTimeline({
  currency,
  payments,
}: Readonly<{
  currency: Currency;
  payments: readonly ScenarioTimelinePayment[];
}>) {
  const data = timelineData(payments);
  if (data.length === 0) return null;

  return (
    <section
      className="rounded-lg border p-4"
      aria-labelledby="payment-timeline-title"
    >
      <div>
        <h3 id="payment-timeline-title" className="text-sm font-semibold">
          Payment timeline
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Paid amounts and remaining scheduled estimates by due date. Costs
          without a date stay with their supplier until scheduled.
        </p>
      </div>
      <TimelineChart currency={currency} data={data} />
      <ul className="sr-only">
        {data.map((point) => (
          <li key={point.date}>
            {point.label}: {formatCurrency(point.paid, currency)} paid,{" "}
            {formatCurrency(point.committed, currency)} committed,{" "}
            {formatCurrency(point.considering, currency)} under consideration
          </li>
        ))}
      </ul>
    </section>
  );
}
