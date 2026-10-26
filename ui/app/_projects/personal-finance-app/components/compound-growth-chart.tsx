"use client";

import { format, parseISO } from "date-fns";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import type {
  Currency,
  GrowthProjectionPoint,
} from "@/app/_projects/personal-finance-app/domain";
import {
  formatCurrency,
  formatCurrencyAxisTick,
} from "@/app/_projects/personal-finance-app/lib";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

const BALANCE_CONFIG = {
  nominalBalance: { label: "Nominal balance", color: "hsl(160, 60%, 40%)" },
  purchasingPower: {
    label: "Purchasing power",
    color: "hsl(215, 70%, 48%)",
  },
} satisfies ChartConfig;

const BREAKDOWN_CONFIG = {
  contributions: { label: "Contributions", color: "hsl(160, 60%, 40%)" },
  withdrawals: { label: "Withdrawals", color: "hsl(0, 70%, 50%)" },
  growth: { label: "Growth", color: "hsl(215, 70%, 48%)" },
  fees: { label: "Fees", color: "hsl(35, 85%, 48%)" },
  taxes: { label: "Supported taxes", color: "hsl(280, 55%, 50%)" },
} satisfies ChartConfig;

function ProjectionChart({
  ariaLabel,
  config,
  currency,
  data,
  keys,
}: Readonly<{
  ariaLabel: string;
  config: ChartConfig;
  currency: Currency;
  data: readonly GrowthProjectionPoint[];
  keys: string[];
}>) {
  return (
    <ChartContainer
      config={config}
      className="aspect-auto w-full"
      role="img"
      aria-label={ariaLabel}
    >
      <ResponsiveContainer width="100%" height={280}>
        <LineChart
          data={data}
          margin={{ top: 10, right: 18, left: 0, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis
            dataKey="date"
            minTickGap={24}
            tickFormatter={(date: string) => format(parseISO(date), "MMM yy")}
          />
          <YAxis
            width={58}
            tickFormatter={(value: number) =>
              formatCurrencyAxisTick(value, currency)
            }
          />
          <ChartTooltip
            content={<ChartTooltipContent />}
            formatter={(value) => formatCurrency(value as number, currency)}
          />
          <ChartLegend content={<ChartLegendContent />} />
          {keys.map((key) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              stroke={`var(--color-${key})`}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

export function CompoundGrowthCharts({
  currency,
  points,
}: Readonly<{
  currency: Currency;
  points: readonly GrowthProjectionPoint[];
}>) {
  const chartPoints = points.filter(
    (_, index) => index % 3 === 0 || index === points.length - 1,
  );
  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-2">
      <div className="min-w-0 space-y-2">
        <h3 className="text-sm font-medium">Balance and purchasing power</h3>
        <ProjectionChart
          ariaLabel="Projected nominal balance and inflation-adjusted purchasing power"
          config={BALANCE_CONFIG}
          currency={currency}
          data={chartPoints}
          keys={["nominalBalance", "purchasingPower"]}
        />
      </div>
      <div className="min-w-0 space-y-2">
        <h3 className="text-sm font-medium">Cumulative calculation ledger</h3>
        <ProjectionChart
          ariaLabel="Cumulative contributions, withdrawals, growth, fees, and supported taxes"
          config={BREAKDOWN_CONFIG}
          currency={currency}
          data={chartPoints}
          keys={["contributions", "withdrawals", "growth", "fees", "taxes"]}
        />
      </div>
    </div>
  );
}
