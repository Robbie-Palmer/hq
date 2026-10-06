"use client";

import { type ComponentProps, useState } from "react";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { cn } from "@/lib/generic/styles";
import { CurrencyHistoryChartAxes } from "./currency-history-chart-axes";

const NOMINAL_COLOR = "hsl(220, 70%, 50%)";
const REAL_COLOR = "hsl(160, 60%, 34%)";

export type SalaryTrajectoryChartDatum = {
  id: string;
  date: string;
  nominal?: number;
  real?: number;
  assumedNominal?: number;
  assumedReal?: number;
};

type SalarySeries = "nominal" | "real";

const RECORDED_TOOLTIP_KEY = {
  assumedNominal: "nominal",
  assumedReal: "real",
} as const;

function SalaryTooltipContent({
  payload,
  ...props
}: ComponentProps<typeof ChartTooltipContent>) {
  const payloadKeys = new Set(payload?.map((item) => item.dataKey));
  const collapsedPayload = payload?.filter((item) => {
    const recordedKey =
      RECORDED_TOOLTIP_KEY[item.dataKey as keyof typeof RECORDED_TOOLTIP_KEY];
    return recordedKey == null || !payloadKeys.has(recordedKey);
  });

  return <ChartTooltipContent {...props} payload={collapsedPayload} />;
}

function Legend({
  hasRealValues,
  hidden,
  labels,
  onToggle,
}: Readonly<{
  hasRealValues: boolean;
  hidden: ReadonlySet<SalarySeries>;
  labels: Readonly<Record<SalarySeries, string>>;
  onToggle(series: SalarySeries): void;
}>) {
  const items = [
    { color: NOMINAL_COLOR, key: "nominal" as const },
    { color: REAL_COLOR, key: "real" as const },
  ];

  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      {items.map((item) => {
        if (item.key === "real" && !hasRealValues) return null;
        const isHidden = hidden.has(item.key);
        return (
          <button
            key={item.key}
            type="button"
            aria-pressed={!isHidden}
            className={cn(
              "flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-medium transition-opacity hover:bg-accent",
              isHidden && "opacity-40 line-through",
            )}
            onClick={() => onToggle(item.key)}
          >
            <span
              aria-hidden="true"
              className="size-2 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            {labels[item.key]}
          </button>
        );
      })}
    </div>
  );
}

function SalaryLines({
  assumed,
  hasRealValues,
  hidden,
  labels,
}: Readonly<{
  assumed: boolean;
  hasRealValues: boolean;
  hidden: ReadonlySet<SalarySeries>;
  labels: Readonly<Record<SalarySeries, string>>;
}>) {
  const suffix = assumed ? ", assumed unchanged" : "";
  return (
    <>
      {!hidden.has("nominal") && (
        <Line
          type="linear"
          dataKey={assumed ? "assumedNominal" : "nominal"}
          name={`${labels.nominal}${suffix}`}
          stroke={NOMINAL_COLOR}
          strokeWidth={2.5}
          strokeDasharray={assumed ? "6 4" : undefined}
          dot={!assumed}
          connectNulls={false}
        />
      )}
      {hasRealValues && !hidden.has("real") && (
        <Line
          type="linear"
          dataKey={assumed ? "assumedReal" : "real"}
          name={`${labels.real}${suffix}`}
          stroke={REAL_COLOR}
          strokeWidth={2.5}
          strokeDasharray={assumed ? "6 4" : undefined}
          dot={!assumed}
          connectNulls={false}
        />
      )}
    </>
  );
}

function chartConfig(labels: Readonly<Record<SalarySeries, string>>) {
  return {
    nominal: { label: labels.nominal, color: NOMINAL_COLOR },
    real: { label: labels.real, color: REAL_COLOR },
    assumedNominal: {
      label: `${labels.nominal}, assumed unchanged`,
      color: NOMINAL_COLOR,
    },
    assumedReal: {
      label: `${labels.real}, assumed unchanged`,
      color: REAL_COLOR,
    },
  } satisfies ChartConfig;
}

function SalaryChartCanvas({
  chartData,
  hasAssumption,
  hasRealValues,
  hidden,
  label,
  labels,
}: Readonly<{
  chartData: readonly SalaryTrajectoryChartDatum[];
  hasAssumption: boolean;
  hasRealValues: boolean;
  hidden: ReadonlySet<SalarySeries>;
  label: string;
  labels: Readonly<Record<SalarySeries, string>>;
}>) {
  return (
    <ChartContainer
      config={chartConfig(labels)}
      className="aspect-auto w-full"
      role="img"
      aria-label={label}
    >
      <ResponsiveContainer width="100%" height={340}>
        <LineChart
          data={chartData}
          margin={{ top: 10, right: 18, left: 0, bottom: 5 }}
        >
          <CurrencyHistoryChartAxes
            currency="GBP"
            tooltipContent={<SalaryTooltipContent />}
          />
          <SalaryLines
            assumed={false}
            hasRealValues={hasRealValues}
            hidden={hidden}
            labels={labels}
          />
          {hasAssumption && (
            <SalaryLines
              assumed
              hasRealValues={hasRealValues}
              hidden={hidden}
              labels={labels}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

export function SalaryTrajectoryChart({
  assumptionCopy,
  chartData,
  label,
  nominalLabel,
  realLabel,
}: Readonly<{
  assumptionCopy: string;
  chartData: readonly SalaryTrajectoryChartDatum[];
  label: string;
  nominalLabel: string;
  realLabel: string;
}>) {
  const [hidden, setHidden] = useState<ReadonlySet<SalarySeries>>(new Set());
  const hasRealValues = chartData.some(
    (point) => point.real != null || point.assumedReal != null,
  );
  const hasAssumption = chartData.some((point) => point.assumedNominal != null);
  const labels = { nominal: nominalLabel, real: realLabel };

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
      <SalaryChartCanvas
        chartData={chartData}
        hasAssumption={hasAssumption}
        hasRealValues={hasRealValues}
        hidden={hidden}
        label={label}
        labels={labels}
      />
      <Legend
        hasRealValues={hasRealValues}
        hidden={hidden}
        labels={labels}
        onToggle={toggleSeries}
      />
      {hasAssumption && (
        <p className="flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
          <span
            aria-hidden="true"
            className="w-7 border-t-2 border-dashed border-muted-foreground"
          />
          <span>{assumptionCopy}</span>
        </p>
      )}
    </>
  );
}
