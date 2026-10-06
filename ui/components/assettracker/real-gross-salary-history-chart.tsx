"use client";

import { useState } from "react";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import { type ChartConfig, ChartContainer } from "@/components/ui/chart";
import type { GrossSalaryChartPoint } from "@/lib/domain/assettracker";
import { cn } from "@/lib/generic/styles";
import { CurrencyHistoryChartAxes } from "./currency-history-chart-axes";

const NOMINAL_COLOR = "hsl(220, 70%, 50%)";
const REAL_COLOR = "hsl(160, 60%, 34%)";
const CHART_CONFIG = {
  nominalGross: { label: "Nominal gross pay", color: NOMINAL_COLOR },
  realGross: { label: "Inflation-adjusted gross pay", color: REAL_COLOR },
} satisfies ChartConfig;
type SalarySeries = keyof typeof CHART_CONFIG;

function Legend({
  hasRealValues,
  hidden,
  onToggle,
}: Readonly<{
  hasRealValues: boolean;
  hidden: ReadonlySet<SalarySeries>;
  onToggle(series: SalarySeries): void;
}>) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      {Object.entries(CHART_CONFIG).map(([key, item]) => {
        const series = key as SalarySeries;
        if (series === "realGross" && !hasRealValues) return null;
        const isHidden = hidden.has(series);
        return (
          <button
            key={series}
            type="button"
            aria-pressed={!isHidden}
            className={cn(
              "flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-medium transition-opacity hover:bg-accent",
              isHidden && "opacity-40 line-through",
            )}
            onClick={() => onToggle(series)}
          >
            <span
              aria-hidden="true"
              className="size-2 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function SalaryChartLines({
  hasRealValues,
  hidden,
}: Readonly<{
  hasRealValues: boolean;
  hidden: ReadonlySet<SalarySeries>;
}>) {
  return (
    <>
      {!hidden.has("nominalGross") && (
        <Line
          type="linear"
          dataKey="nominalGross"
          name="Nominal gross pay"
          stroke={NOMINAL_COLOR}
          strokeWidth={2.5}
          dot
          connectNulls={false}
        />
      )}
      {hasRealValues && !hidden.has("realGross") && (
        <Line
          type="linear"
          dataKey="realGross"
          name="Inflation-adjusted gross pay"
          stroke={REAL_COLOR}
          strokeWidth={2.5}
          strokeDasharray="5 4"
          dot
          connectNulls={false}
        />
      )}
    </>
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
  const [hidden, setHidden] = useState<ReadonlySet<SalarySeries>>(new Set());

  function toggleSeries(series: SalarySeries) {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(series)) next.delete(series);
      else next.add(series);
      return next;
    });
  }

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
            <SalaryChartLines hasRealValues={hasRealValues} hidden={hidden} />
          </LineChart>
        </ResponsiveContainer>
      </ChartContainer>
      <Legend
        hasRealValues={hasRealValues}
        hidden={hidden}
        onToggle={toggleSeries}
      />
    </>
  );
}
