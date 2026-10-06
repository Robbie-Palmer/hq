import { Line, LineChart, ResponsiveContainer } from "recharts";
import { type ChartConfig, ChartContainer } from "@/components/ui/chart";
import type { GrossSalaryChartPoint } from "@/lib/domain/assettracker";
import { CurrencyHistoryChartAxes } from "./currency-history-chart-axes";

const NOMINAL_COLOR = "hsl(220, 70%, 50%)";
const REAL_COLOR = "hsl(160, 60%, 34%)";
const CHART_CONFIG = {
  nominalGross: { label: "Nominal gross pay", color: NOMINAL_COLOR },
  realGross: { label: "Inflation-adjusted gross pay", color: REAL_COLOR },
} satisfies ChartConfig;

function Legend() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
      {Object.entries(CHART_CONFIG).map(([key, item]) => (
        <span key={key} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2 rounded-full"
            style={{ backgroundColor: item.color }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

export function RealGrossSalaryChart({
  chartData,
  hasRealValues,
  label,
}: Readonly<{
  chartData: readonly GrossSalaryChartPoint[];
  hasRealValues: boolean;
  label: string;
}>) {
  return (
    <>
      <ChartContainer
        config={CHART_CONFIG}
        className="aspect-auto w-full"
        role="img"
        aria-label={label}
      >
        <ResponsiveContainer width="100%" height={340}>
          <LineChart
            data={chartData}
            margin={{ top: 10, right: 18, left: 0, bottom: 5 }}
          >
            <CurrencyHistoryChartAxes currency="GBP" />
            <Line
              type="stepAfter"
              dataKey="nominalGross"
              name="Nominal gross pay"
              stroke={NOMINAL_COLOR}
              strokeWidth={2.5}
              dot
              connectNulls={false}
            />
            <Line
              type="stepAfter"
              dataKey="realGross"
              name="Inflation-adjusted gross pay"
              stroke={REAL_COLOR}
              strokeWidth={2.5}
              strokeDasharray="5 4"
              dot={hasRealValues}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartContainer>
      <Legend />
    </>
  );
}
