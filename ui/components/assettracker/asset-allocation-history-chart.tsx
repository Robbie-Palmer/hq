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
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { ASSET_TYPE_COLORS, ASSET_TYPE_LABELS } from "@/lib/assettracker";
import type {
  AssetAllocationDataPoint,
  AssetType,
} from "@/lib/domain/assettracker";

const ASSET_TYPES = [
  "cash",
  "stocks",
  "bonds",
  "reits",
  "crypto",
  "property",
] as const satisfies readonly AssetType[];

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function AssetAllocationHistoryChart({
  data,
}: Readonly<{ data: AssetAllocationDataPoint[] }>) {
  const assetTypes = ASSET_TYPES.filter((assetType) =>
    data.some((point) => point[assetType] != null),
  );
  if (data.length === 0 || assetTypes.length === 0) return null;
  const chartData = data.map((point) => ({
    ...point,
    ...Object.fromEntries(
      assetTypes.map((assetType) => [assetType, point[assetType] ?? 0]),
    ),
  }));

  const chartConfig: ChartConfig = {};
  for (const assetType of assetTypes) {
    chartConfig[assetType] = {
      label: ASSET_TYPE_LABELS[assetType],
      color: ASSET_TYPE_COLORS[assetType],
    };
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Asset Allocation Over Time</CardTitle>
        <CardDescription>
          Percentage of positive net assets by type. Linked mortgages reduce
          property to home equity; standalone liabilities are excluded from this
          percentage view.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2 sm:px-6">
        <ChartContainer
          config={chartConfig}
          className="aspect-auto w-full"
          role="img"
          aria-label="Percentage of assets by asset type over time"
        >
          <ResponsiveContainer width="100%" height={320}>
            <LineChart
              data={chartData}
              margin={{ top: 10, right: 20, left: 0, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
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
                width={42}
                domain={[0, 1]}
                tickFormatter={(value: number) => `${Math.round(value * 100)}%`}
              />
              <ChartTooltip
                content={<ChartTooltipContent />}
                formatter={(value) => formatPercent(value as number)}
              />
              <ChartLegend content={<ChartLegendContent />} />
              {assetTypes.map((assetType) => (
                <Line
                  key={assetType}
                  type="monotone"
                  dataKey={assetType}
                  name={ASSET_TYPE_LABELS[assetType]}
                  stroke={ASSET_TYPE_COLORS[assetType]}
                  strokeWidth={2.5}
                  dot={data.length === 1}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </ChartContainer>
        <table className="sr-only">
          <caption>Percentage of assets by asset type over time</caption>
          <thead>
            <tr>
              <th>Date</th>
              {assetTypes.map((assetType) => (
                <th key={assetType}>{ASSET_TYPE_LABELS[assetType]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((point) => (
              <tr key={point.date}>
                <td>{point.date}</td>
                {assetTypes.map((assetType) => (
                  <td key={assetType}>
                    {formatPercent(point[assetType] ?? 0)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
