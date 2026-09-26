"use client";

import { format, parseISO } from "date-fns";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  type Currency,
  DEFAULT_BASE_CURRENCY,
  formatAnnualRate,
  formatCurrency,
  formatCurrencyAxisTick,
  type PortfolioFiProjectionPoint,
} from "@/lib/domain/assettracker";

const PROJECTION_COLOR = "hsl(160, 60%, 40%)";
const CHART_CONFIG = {
  projected: {
    label: "Projected net worth (today's money)",
    color: PROJECTION_COLOR,
  },
} satisfies ChartConfig;

export function PortfolioFiProjectionChart({
  projection,
  target,
  annualSavings,
  expectedRealReturn,
  currency = DEFAULT_BASE_CURRENCY,
}: Readonly<{
  projection: PortfolioFiProjectionPoint[];
  target: number;
  annualSavings: number;
  expectedRealReturn: number;
  currency?: Currency;
}>) {
  if (projection.length < 2) return null;
  const chartData = projection.filter(
    (_, index) => index % 12 === 0 || index === projection.length - 1,
  );

  return (
    <div className="min-w-0 space-y-2">
      <div>
        <h3 className="text-sm font-medium">Portfolio FI projection</h3>
        <p className="text-xs text-muted-foreground">
          In today&apos;s money, using{" "}
          {formatCurrency(Math.round(annualSavings), currency)}
          /yr expected saving and an expected real portfolio return of{" "}
          {formatAnnualRate(expectedRealReturn)}/yr.
        </p>
      </div>
      <ChartContainer
        config={CHART_CONFIG}
        className="aspect-auto w-full"
        role="img"
        aria-label="Projected portfolio net worth against the financial independence target"
      >
        <ResponsiveContainer width="100%" height={280}>
          <LineChart
            data={chartData}
            margin={{ top: 10, right: 18, left: 0, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="date"
              className="text-xs"
              minTickGap={24}
              tickFormatter={(date: string) =>
                format(parseISO(date), "MMM yyyy")
              }
            />
            <YAxis
              className="text-xs"
              width={52}
              tickFormatter={(value: number) =>
                formatCurrencyAxisTick(value, currency)
              }
            />
            <ReferenceLine
              y={target}
              stroke="var(--muted-foreground)"
              strokeDasharray="6 4"
            />
            <ChartTooltip
              content={<ChartTooltipContent />}
              formatter={(value) => formatCurrency(value as number, currency)}
            />
            <Line
              type="monotone"
              dataKey="projected"
              stroke={PROJECTION_COLOR}
              strokeWidth={2.5}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartContainer>
      <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2 rounded-full"
            style={{ backgroundColor: PROJECTION_COLOR }}
          />
          <span>Projected net worth</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-px w-3 bg-muted-foreground" />
          <span>FI target</span>
        </span>
      </div>
    </div>
  );
}
