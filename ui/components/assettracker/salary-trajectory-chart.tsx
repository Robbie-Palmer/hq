"use client";

import { type ComponentProps, useState } from "react";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { cn } from "@/lib/generic/styles";
import {
  ChartPeakReferenceLine,
  highestFiniteValue,
} from "./chart-peak-reference-line";
import {
  CurrencyHistoryChartAxes,
  formatHistoryDateLabel,
} from "./currency-history-chart-axes";

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

export type SalaryTrajectoryDateDomain = readonly [number, number];

const ONE_DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1_000;
const SALARY_DATE_TICK_COUNT = 4;

export function salaryTrajectoryDateDomain(
  ...series: ReadonlyArray<readonly { date: string }[]>
): SalaryTrajectoryDateDomain {
  const timestamps = series
    .flatMap((points) => points.map((point) => Date.parse(point.date)))
    .filter(Number.isFinite);
  if (timestamps.length === 0) return [0, ONE_DAY_IN_MILLISECONDS];

  const start = Math.min(...timestamps);
  const end = Math.max(...timestamps);

  if (start === end) return [start, end + ONE_DAY_IN_MILLISECONDS];
  return [start, end];
}

function salaryTrajectoryDateTicks([
  start,
  end,
]: SalaryTrajectoryDateDomain): readonly number[] {
  return Array.from({ length: SALARY_DATE_TICK_COUNT }, (_, index) =>
    Math.round(start + ((end - start) * index) / (SALARY_DATE_TICK_COUNT - 1)),
  );
}

type SalarySeries = "nominal" | "real";

type SalaryTrajectoryChartProps = Readonly<{
  assumptionCopy: string;
  chartData: readonly SalaryTrajectoryChartDatum[];
  dateDomain: SalaryTrajectoryDateDomain;
  label: string;
  nominalLabel: string;
  realLabel: string;
  showRecordedPeaks?: boolean;
}>;

type SalaryChartCanvasProps = Readonly<{
  chartData: readonly SalaryTrajectoryChartDatum[];
  dateDomain: SalaryTrajectoryDateDomain;
  hasAssumption: boolean;
  hasRealValues: boolean;
  hidden: ReadonlySet<SalarySeries>;
  label: string;
  labels: Readonly<Record<SalarySeries, string>>;
  showRecordedPeaks: boolean;
}>;

const RECORDED_TOOLTIP_KEY = {
  assumedNominal: "nominal",
  assumedReal: "real",
} as const;

function SalaryTooltipContent({
  label,
  payload,
  ...props
}: Omit<ComponentProps<typeof ChartTooltipContent>, "label"> & {
  label?: number | string;
}) {
  const payloadKeys = new Set(payload?.map((item) => item.dataKey));
  const collapsedPayload = payload?.filter((item) => {
    const recordedKey =
      RECORDED_TOOLTIP_KEY[item.dataKey as keyof typeof RECORDED_TOOLTIP_KEY];
    return recordedKey == null || !payloadKeys.has(recordedKey);
  });

  const heading =
    typeof label === "number" && Number.isFinite(label)
      ? formatHistoryDateLabel(label)
      : undefined;

  return (
    <ChartTooltipContent
      {...props}
      heading={heading}
      payload={collapsedPayload}
    />
  );
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

function PeakSalaryLines({
  chartData,
  hasRealValues,
  hidden,
}: Readonly<{
  chartData: readonly SalaryTrajectoryChartDatum[];
  hasRealValues: boolean;
  hidden: ReadonlySet<SalarySeries>;
}>) {
  const nominalPeak = highestFiniteValue(
    chartData.map((point) => point.nominal),
  );
  const realPeak = highestFiniteValue(chartData.map((point) => point.real));

  return (
    <>
      {!hidden.has("nominal") && nominalPeak != null && (
        <ChartPeakReferenceLine
          color={NOMINAL_COLOR}
          currency="GBP"
          label="Peak nominal"
          position="insideTopRight"
          value={nominalPeak}
        />
      )}
      {hasRealValues && !hidden.has("real") && realPeak != null && (
        <ChartPeakReferenceLine
          color={REAL_COLOR}
          currency="GBP"
          label="Peak inflation-adjusted"
          position="insideBottomRight"
          value={realPeak}
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
  dateDomain,
  hasAssumption,
  hasRealValues,
  hidden,
  label,
  labels,
  showRecordedPeaks,
}: SalaryChartCanvasProps) {
  const timestampedChartData = chartData.map((point) => ({
    ...point,
    timestamp: Date.parse(point.date),
  }));

  return (
    <ChartContainer
      config={chartConfig(labels)}
      className="aspect-auto w-full"
      role="img"
      aria-label={label}
    >
      <ResponsiveContainer width="100%" height={340}>
        <LineChart
          data={timestampedChartData}
          margin={{ top: 10, right: 18, left: 0, bottom: 5 }}
        >
          <CurrencyHistoryChartAxes
            currency="GBP"
            dateDomain={dateDomain}
            dateKey="timestamp"
            dateTicks={salaryTrajectoryDateTicks(dateDomain)}
            tooltipContent={<SalaryTooltipContent />}
          />
          {showRecordedPeaks && (
            <PeakSalaryLines
              chartData={chartData}
              hasRealValues={hasRealValues}
              hidden={hidden}
            />
          )}
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
  dateDomain,
  label,
  nominalLabel,
  realLabel,
  showRecordedPeaks = false,
}: SalaryTrajectoryChartProps) {
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
        dateDomain={dateDomain}
        hasAssumption={hasAssumption}
        hasRealValues={hasRealValues}
        hidden={hidden}
        label={label}
        labels={labels}
        showRecordedPeaks={showRecordedPeaks}
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
