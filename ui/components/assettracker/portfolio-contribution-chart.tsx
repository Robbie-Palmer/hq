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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  type Currency,
  DEFAULT_BASE_CURRENCY,
  formatCurrency,
  formatCurrencyAxisTick,
  type PortfolioContributionDataPoint,
} from "@/lib/domain/assettracker";

const CONTRIBUTION_COLOR = "hsl(160, 60%, 40%)";
const CHART_CONFIG = {
  contributedCapital: {
    label: "Net contributed capital",
    color: CONTRIBUTION_COLOR,
  },
} satisfies ChartConfig;

export function PortfolioContributionChart({
  data,
  currency = DEFAULT_BASE_CURRENCY,
}: Readonly<{
  data: readonly PortfolioContributionDataPoint[];
  currency?: Currency;
}>) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Contributed capital over time</CardTitle>
        <CardDescription>
          Cumulative deposits minus withdrawals across all accounts, tracked
          independently from market value. Internal transfers cancel when both
          sides are recorded.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4 sm:px-6">
        {data.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            Import an account&apos;s “Total contributed to date” or deposit and
            withdrawal history to build this series.
          </p>
        ) : (
          <>
            <ChartContainer
              config={CHART_CONFIG}
              className="aspect-auto w-full"
              role="img"
              aria-label="Cumulative contributed capital over time"
            >
              <ResponsiveContainer width="100%" height={280}>
                <LineChart
                  data={data}
                  margin={{ top: 10, right: 18, left: 0, bottom: 5 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-muted"
                  />
                  <XAxis
                    dataKey="date"
                    className="text-xs"
                    minTickGap={24}
                    tickFormatter={(date: string) =>
                      format(parseISO(date), "MMM yy")
                    }
                  />
                  <YAxis
                    className="text-xs"
                    width={48}
                    tickFormatter={(value: number) =>
                      formatCurrencyAxisTick(value, currency)
                    }
                  />
                  <ReferenceLine y={0} className="stroke-muted-foreground" />
                  <ChartTooltip
                    content={<ChartTooltipContent />}
                    formatter={(value) =>
                      formatCurrency(value as number, currency)
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="contributedCapital"
                    name="Net contributed capital"
                    stroke={CONTRIBUTION_COLOR}
                    strokeWidth={2.5}
                    dot={data.length === 1}
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartContainer>
            <table className="sr-only">
              <caption>Cumulative contributed capital over time</caption>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Net contributed capital</th>
                </tr>
              </thead>
              <tbody>
                {data.map((point) => (
                  <tr key={point.date}>
                    <td>{point.date}</td>
                    <td>
                      {formatCurrency(point.contributedCapital, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
