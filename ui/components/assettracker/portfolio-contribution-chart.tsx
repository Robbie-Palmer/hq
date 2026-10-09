"use client";

import { Line, LineChart, ReferenceLine, ResponsiveContainer } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { type ChartConfig, ChartContainer } from "@/components/ui/chart";
import { formatCurrency } from "@/lib/assettracker";
import {
  type Currency,
  DEFAULT_BASE_CURRENCY,
  type PortfolioContributionDataPoint,
} from "@/lib/domain/assettracker";
import { CurrencyHistoryChartAxes } from "./currency-history-chart-axes";

const CONTRIBUTION_COLOR = "hsl(160, 60%, 40%)";
const CHART_CONFIG = {
  contributedCapital: {
    label: "Net contributed capital",
    color: CONTRIBUTION_COLOR,
  },
} satisfies ChartConfig;

function ContributionHistoryData({
  currency,
  data,
}: Readonly<{
  currency: Currency;
  data: readonly PortfolioContributionDataPoint[];
}>) {
  return (
    <details className="group text-xs text-muted-foreground">
      <summary className="cursor-pointer">View contribution data</summary>
      <div className="mt-2 hidden max-h-80 overflow-auto rounded-md border group-open:block">
        <table className="w-full text-left">
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
                <td>{formatCurrency(point.contributedCapital, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

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
                  <CurrencyHistoryChartAxes currency={currency} />
                  <ReferenceLine y={0} className="stroke-muted-foreground" />
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
            <ContributionHistoryData currency={currency} data={data} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
