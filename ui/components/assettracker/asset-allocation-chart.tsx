"use client";

import {
  Bar,
  BarChart,
  Cell,
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
  ASSET_TYPE_COLORS,
  ASSET_TYPE_LABELS,
  formatCurrency,
  formatCurrencyAxisTick,
} from "@/lib/assettracker";
import type { AssetType, Currency } from "@/lib/domain/assettracker";
import { DEFAULT_BASE_CURRENCY } from "@/lib/domain/assettracker";

interface AssetAllocationChartProps {
  data: { assetType: AssetType; total: number }[];
  currency?: Currency;
}

export function AssetAllocationChart({
  data,
  currency = DEFAULT_BASE_CURRENCY,
}: Readonly<AssetAllocationChartProps>) {
  // Largest magnitude first so assets and liabilities read top-to-bottom
  const chartData = [...data]
    .filter((item) => item.total !== 0)
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
    .map((item) => ({
      label: ASSET_TYPE_LABELS[item.assetType],
      value: item.total,
      assetType: item.assetType,
    }));

  const chartConfig: ChartConfig = { value: { label: "Net value" } };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Net Worth Composition</CardTitle>
        <CardDescription>
          Assets above the line, liabilities below. Mortgages are netted into
          the property they're secured on, so property shows as equity.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2 sm:px-6">
        {chartData.length === 0 ? (
          <p className="mx-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            Add an account and record a balance to see how net worth is split by
            asset type.
          </p>
        ) : (
          <>
            <ChartContainer
              config={chartConfig}
              className="aspect-auto w-full"
              role="img"
              aria-label="Net worth composition by asset type"
            >
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  accessibilityLayer
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 5, right: 16, left: 8, bottom: 5 }}
                >
                  <XAxis
                    type="number"
                    className="text-xs"
                    tickFormatter={(value: number) =>
                      formatCurrencyAxisTick(value, currency)
                    }
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    className="text-xs"
                    width={70}
                  />
                  <ReferenceLine x={0} className="stroke-muted-foreground" />
                  <ChartTooltip
                    content={<ChartTooltipContent />}
                    formatter={(value) =>
                      formatCurrency(value as number, currency)
                    }
                  />
                  <Bar dataKey="value" radius={4}>
                    {chartData.map((entry) => (
                      <Cell
                        key={entry.assetType}
                        fill={ASSET_TYPE_COLORS[entry.assetType]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
            <div className="sr-only">
              <table>
                <caption>Net worth composition by asset type</caption>
                <thead>
                  <tr>
                    <th>Asset type</th>
                    <th>Net value</th>
                  </tr>
                </thead>
                <tbody>
                  {chartData.map((entry) => (
                    <tr key={entry.assetType}>
                      <th scope="row">{entry.label}</th>
                      <td>{formatCurrency(entry.value, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
