"use client";

import { addYears, format, parseISO } from "date-fns";
import { type ReactNode, useState } from "react";
import {
  Area,
  AreaChart,
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
} from "@/components/ui/chart";
import { formatCurrency } from "@/lib/assettracker";
import type {
  Currency,
  JobMoveScenarioComparison,
} from "@/lib/domain/assettracker";

const BASELINE_COLOR = "hsl(263, 24%, 68%)";
const SCENARIO_COLOR = "hsl(160, 84%, 39%)";
const CASH_COLOR = "hsl(199, 89%, 48%)";
const LIQUID_COLOR = "hsl(160, 84%, 39%)";
const ILLIQUID_COLOR = "hsl(263, 70%, 58%)";
const UNFUNDED_COLOR = "hsl(0, 72%, 51%)";
const NET_WORTH_GAIN_COLOR = "hsl(221, 83%, 53%)";
const MILESTONE_COLOR = "hsl(38, 92%, 50%)";

const FI_CHART_CONFIG = {
  baseline: { label: "Current path", color: BASELINE_COLOR },
  scenario: { label: "Job-move scenario", color: SCENARIO_COLOR },
} satisfies ChartConfig;

const DRAWDOWN_CHART_CONFIG = {
  cash: { label: "Cash reserves used", color: CASH_COLOR },
  liquid: { label: "Liquid assets sold", color: LIQUID_COLOR },
  illiquid: { label: "Illiquid assets used", color: ILLIQUID_COLOR },
  unfunded: { label: "Unfunded gap", color: UNFUNDED_COLOR },
} satisfies ChartConfig;

const GROWTH_CHART_CONFIG = {
  liquidGain: { label: "Additional liquid assets", color: LIQUID_COLOR },
  netWorthGain: { label: "Additional net worth", color: NET_WORTH_GAIN_COLOR },
} satisfies ChartConfig;

type ForecastPoint = { date: string; baseline: number; scenario: number };
type DrawdownPoint = {
  date: string;
  cash: number;
  liquid: number;
  illiquid: number;
  unfunded: number;
};
type GrowthPoint = {
  date: string;
  liquidGain: number;
  netWorthGain: number;
};
type ChartWindow = 1 | 3 | 5 | "full";

function compactCurrency(currency: Currency) {
  return (value: number) =>
    new Intl.NumberFormat("en-GB", {
      notation: "compact",
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
}

function fiChartData(comparison: JobMoveScenarioComparison): ForecastPoint[] {
  return comparison.timeline.map((point) => ({
    date: point.date,
    baseline: point.baseline.totalBalance,
    scenario: point.scenario.totalBalance,
  }));
}

function drawdownChartData(
  comparison: JobMoveScenarioComparison,
): DrawdownPoint[] {
  const cumulative = { cash: 0, liquid: 0, illiquid: 0, unfunded: 0 };
  return comparison.timeline.map((point) => {
    const monthly = point.scenario.spendingDrawdown;
    cumulative.cash += monthly.cash;
    cumulative.liquid += monthly.liquid;
    cumulative.illiquid += monthly.illiquid;
    cumulative.unfunded += monthly.unfunded;
    return { date: point.date, ...cumulative };
  });
}

function growthChartData(comparison: JobMoveScenarioComparison): GrowthPoint[] {
  return comparison.timeline.map((point) => ({
    date: point.date,
    liquidGain: point.scenario.liquidBalance - point.baseline.liquidBalance,
    netWorthGain: point.scenario.totalBalance - point.baseline.totalBalance,
  }));
}

type TooltipItem<T> = {
  color?: string;
  dataKey?: string | number;
  payload?: T;
  value?: number | string;
};

function ForecastTooltip({
  active,
  currency,
  payload,
}: Readonly<{
  active?: boolean;
  currency: Currency;
  payload?: Array<TooltipItem<ForecastPoint>>;
}>) {
  const point = payload?.find((item) => item.payload != null)?.payload;
  if (!active || point == null) return null;
  return (
    <div className="grid min-w-52 gap-1.5 rounded-lg border bg-background px-3 py-2 text-xs shadow-xl">
      <p className="font-medium">{format(parseISO(point.date), "MMM yyyy")}</p>
      <p className="flex justify-between gap-4">
        <span>Current path</span>
        <span className="font-mono">
          {formatCurrency(Math.round(point.baseline), currency)}
        </span>
      </p>
      <p className="flex justify-between gap-4">
        <span>Job-move scenario</span>
        <span className="font-mono">
          {formatCurrency(Math.round(point.scenario), currency)}
        </span>
      </p>
    </div>
  );
}

function DrawdownTooltip({
  active,
  currency,
  payload,
}: Readonly<{
  active?: boolean;
  currency: Currency;
  payload?: Array<TooltipItem<DrawdownPoint>>;
}>) {
  const point = payload?.find((item) => item.payload != null)?.payload;
  if (!active || point == null) return null;
  const rows = [
    ["Cash reserves used", point.cash],
    ["Liquid assets sold", point.liquid],
    ["Illiquid assets used", point.illiquid],
    ["Unfunded gap", point.unfunded],
  ] as const;
  return (
    <div className="grid min-w-56 gap-1.5 rounded-lg border bg-background px-3 py-2 text-xs shadow-xl">
      <p className="font-medium">{format(parseISO(point.date), "MMM yyyy")}</p>
      {rows.map(([label, amount]) => (
        <p key={label} className="flex justify-between gap-4">
          <span>{label}</span>
          <span className="font-mono">
            {formatCurrency(Math.round(amount), currency)}
          </span>
        </p>
      ))}
    </div>
  );
}

function GrowthTooltip({
  active,
  currency,
  payload,
}: Readonly<{
  active?: boolean;
  currency: Currency;
  payload?: Array<TooltipItem<GrowthPoint>>;
}>) {
  const point = payload?.find((item) => item.payload != null)?.payload;
  if (!active || point == null) return null;
  const rows = [
    ["Additional liquid assets", point.liquidGain],
    ["Additional net worth", point.netWorthGain],
  ] as const;
  return (
    <div className="grid min-w-56 gap-1.5 rounded-lg border bg-background px-3 py-2 text-xs shadow-xl">
      <p className="font-medium">{format(parseISO(point.date), "MMM yyyy")}</p>
      {rows.map(([label, amount]) => (
        <p key={label} className="flex justify-between gap-4">
          <span>{label}</span>
          <span className="font-mono">
            {formatCurrency(Math.round(amount), currency)}
          </span>
        </p>
      ))}
    </div>
  );
}

function MilestoneLines({
  milestones,
  timeline,
}: Readonly<{
  milestones: JobMoveScenarioComparison["milestones"];
  timeline: JobMoveScenarioComparison["timeline"];
}>) {
  const chartDates = timeline.map(({ date }) => date);
  const labelsByDate = new Map<string, number[]>();
  milestones.forEach((milestone, index) => {
    const chartDate =
      chartDates.find((date) => date >= milestone.date) ?? chartDates.at(-1);
    if (chartDate == null) return;
    labelsByDate.set(chartDate, [
      ...(labelsByDate.get(chartDate) ?? []),
      index + 1,
    ]);
  });
  return Array.from(labelsByDate, ([date, labels]) => (
    <ReferenceLine
      key={date}
      x={date}
      stroke={MILESTONE_COLOR}
      strokeDasharray="4 4"
      label={{
        value: labels.join(", "),
        position: "insideTopLeft",
        fill: MILESTONE_COLOR,
        fontSize: 11,
        fontWeight: 600,
      }}
    />
  ));
}

function DrawdownChart({
  comparison,
  currency,
}: Readonly<{
  comparison: JobMoveScenarioComparison;
  currency: Currency;
}>) {
  return (
    <ChartContainer
      config={DRAWDOWN_CHART_CONFIG}
      className="h-64 w-full"
      role="img"
      aria-label="Cumulative scenario drawdown by funding source"
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={drawdownChartData(comparison)}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis
            dataKey="date"
            interval="preserveStartEnd"
            minTickGap={32}
            padding={{ left: 8, right: 8 }}
            tickFormatter={(date: string) => format(parseISO(date), "MMM yy")}
          />
          <YAxis width={64} tickFormatter={compactCurrency(currency)} />
          <MilestoneLines
            milestones={comparison.milestones}
            timeline={comparison.timeline}
          />
          <ChartTooltip content={<DrawdownTooltip currency={currency} />} />
          <DrawdownAreas />
        </AreaChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

function DrawdownAreas() {
  const areas = [
    ["cash", CASH_COLOR],
    ["liquid", LIQUID_COLOR],
    ["illiquid", ILLIQUID_COLOR],
    ["unfunded", UNFUNDED_COLOR],
  ] as const;
  return areas.map(([dataKey, color]) => (
    <Area
      key={dataKey}
      type="monotone"
      dataKey={dataKey}
      stackId="drawdown"
      stroke={color}
      fill={color}
      fillOpacity={0.55}
      isAnimationActive={false}
    />
  ));
}

function GrowthChart({
  comparison,
  currency,
}: Readonly<{
  comparison: JobMoveScenarioComparison;
  currency: Currency;
}>) {
  return (
    <ChartContainer
      config={GROWTH_CHART_CONFIG}
      className="h-64 w-full"
      role="img"
      aria-label="Additional assets created by the job-move scenario"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={growthChartData(comparison)}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis
            dataKey="date"
            interval="preserveStartEnd"
            minTickGap={32}
            padding={{ left: 8, right: 8 }}
            tickFormatter={(date: string) => format(parseISO(date), "MMM yy")}
          />
          <YAxis width={64} tickFormatter={compactCurrency(currency)} />
          <ReferenceLine y={0} stroke={BASELINE_COLOR} />
          <MilestoneLines
            milestones={comparison.milestones}
            timeline={comparison.timeline}
          />
          <ChartTooltip content={<GrowthTooltip currency={currency} />} />
          <Line
            type="monotone"
            dataKey="liquidGain"
            stroke={LIQUID_COLOR}
            strokeWidth={2.5}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="netWorthGain"
            stroke={NET_WORTH_GAIN_COLOR}
            strokeWidth={2.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

function FiChart({
  comparison,
  currency,
}: Readonly<{
  comparison: JobMoveScenarioComparison;
  currency: Currency;
}>) {
  return (
    <ChartContainer
      config={FI_CHART_CONFIG}
      className="h-64 w-full"
      role="img"
      aria-label="Net worth and financial-independence path, current path versus job-move scenario"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={fiChartData(comparison)}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis
            dataKey="date"
            interval="preserveStartEnd"
            minTickGap={32}
            padding={{ left: 8, right: 8 }}
            tickFormatter={(date: string) => format(parseISO(date), "MMM yy")}
          />
          <YAxis width={64} tickFormatter={compactCurrency(currency)} />
          {comparison.financialIndependenceTarget != null && (
            <ReferenceLine
              y={comparison.financialIndependenceTarget}
              stroke={MILESTONE_COLOR}
              strokeDasharray="4 4"
            />
          )}
          <MilestoneLines
            milestones={comparison.milestones}
            timeline={comparison.timeline}
          />
          <ChartTooltip content={<ForecastTooltip currency={currency} />} />
          <Line
            type="monotone"
            dataKey="baseline"
            stroke={BASELINE_COLOR}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="scenario"
            stroke={SCENARIO_COLOR}
            strokeWidth={2.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}

function ChartLegend({
  items,
}: Readonly<{ items: ReadonlyArray<readonly [string, string]> }>) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
      {items.map(([label, color]) => (
        <div key={label} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-0.5 w-5"
            style={{ backgroundColor: color }}
          />
          {label}
        </div>
      ))}
    </div>
  );
}

function MilestoneList({
  milestones,
}: Readonly<{ milestones: JobMoveScenarioComparison["milestones"] }>) {
  if (milestones.length === 0) return null;
  return (
    <div className="space-y-2 rounded-md border p-3">
      <h5 className="text-sm font-medium">Forecast milestones</h5>
      <div className="grid gap-3 sm:grid-cols-2">
        {milestones.map((milestone, index) => (
          <div
            key={`${milestone.kind}:${milestone.date}`}
            className="flex gap-2 text-xs"
          >
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-500/15 font-medium text-amber-700 dark:text-amber-300">
              {index + 1}
            </span>
            <div>
              <p className="font-medium">
                {format(parseISO(milestone.date), "MMM yyyy")} ·{" "}
                {milestone.label}
              </p>
              <p className="text-muted-foreground">{milestone.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ForecastPanel({
  children,
  description,
  legend,
  title,
}: Readonly<{
  children: ReactNode;
  description: string;
  legend: ReadonlyArray<readonly [string, string]>;
  title: string;
}>) {
  return (
    <div className="space-y-2">
      <div>
        <h5 className="text-sm font-medium">{title}</h5>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {legend.length > 0 && <ChartLegend items={legend} />}
      {children}
    </div>
  );
}

function ScenarioChangePanel({
  comparison,
  currency,
}: Readonly<{
  comparison: JobMoveScenarioComparison;
  currency: Currency;
}>) {
  const hasDrawdown = comparison.timeline.some(({ scenario }) =>
    Object.values(scenario.spendingDrawdown).some((amount) => amount > 0),
  );
  const legend = hasDrawdown
    ? ([
        ["Cash reserves used", CASH_COLOR],
        ["Liquid assets sold", LIQUID_COLOR],
        ["Illiquid assets used", ILLIQUID_COLOR],
        ["Unfunded gap", UNFUNDED_COLOR],
        ["Milestone", MILESTONE_COLOR],
      ] as const)
    : ([
        ["Additional liquid assets", LIQUID_COLOR],
        ["Additional net worth", NET_WORTH_GAIN_COLOR],
        ["Milestone", MILESTONE_COLOR],
      ] as const);
  return (
    <ForecastPanel
      title={
        hasDrawdown
          ? "Drawdown funding over time"
          : "Asset growth from the move"
      }
      description={
        hasDrawdown
          ? "Only spending above accessible income counts as drawdown. Sale proceeds spent in the same month appear against the asset sold, not as temporary cash."
          : "Shows the additional liquid assets and net worth created versus staying on the current path."
      }
      legend={legend}
    >
      {hasDrawdown ? (
        <DrawdownChart comparison={comparison} currency={currency} />
      ) : (
        <GrowthChart comparison={comparison} currency={currency} />
      )}
    </ForecastPanel>
  );
}

function shorterChartWindows(comparison: JobMoveScenarioComparison) {
  const firstDate = comparison.timeline[0]?.date;
  const lastDate = comparison.timeline.at(-1)?.date;
  if (firstDate == null || lastDate == null) return [];
  return ([1, 3, 5] as const).filter(
    (years) =>
      format(addYears(parseISO(firstDate), years), "yyyy-MM-dd") < lastDate,
  );
}

function comparisonForWindow(
  comparison: JobMoveScenarioComparison,
  window: ChartWindow,
): JobMoveScenarioComparison {
  const firstDate = comparison.timeline[0]?.date;
  if (window === "full" || firstDate == null) return comparison;
  const throughDate = format(
    addYears(parseISO(firstDate), window),
    "yyyy-MM-dd",
  );
  return {
    ...comparison,
    timeline: comparison.timeline.filter(({ date }) => date <= throughDate),
    milestones: comparison.milestones.filter(({ date }) => date <= throughDate),
  };
}

function ChartWindowSelect({
  comparison,
  value,
  onChange,
}: Readonly<{
  comparison: JobMoveScenarioComparison;
  value: ChartWindow;
  onChange(value: ChartWindow): void;
}>) {
  const windows = shorterChartWindows(comparison);
  if (windows.length === 0) return null;
  return (
    <label className="flex items-center gap-2 text-xs">
      Chart window
      <select
        aria-label="Chart time window"
        className="h-8 rounded-md border bg-background px-2"
        value={value}
        onChange={(event) =>
          onChange(
            event.target.value === "full"
              ? "full"
              : (Number(event.target.value) as Exclude<ChartWindow, "full">),
          )
        }
      >
        {windows.map((years) => (
          <option key={years} value={years}>
            First {years} {years === 1 ? "year" : "years"}
          </option>
        ))}
        <option value="full">Full horizon</option>
      </select>
    </label>
  );
}

export function JobMoveScenarioCharts({
  comparison,
  currency,
}: Readonly<{
  comparison: JobMoveScenarioComparison;
  currency: Currency;
}>) {
  const [chartWindow, setChartWindow] = useState<ChartWindow>("full");
  const availableWindows = shorterChartWindows(comparison);
  const effectiveChartWindow =
    chartWindow === "full" || availableWindows.includes(chartWindow)
      ? chartWindow
      : "full";
  const visibleComparison = comparisonForWindow(
    comparison,
    effectiveChartWindow,
  );
  const fiDescription =
    comparison.financialIndependenceTarget == null
      ? "Shows the net-worth path. Set an FI target to add the target line."
      : "Shows net worth against the current financial-independence target.";
  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <ChartWindowSelect
          comparison={comparison}
          value={effectiveChartWindow}
          onChange={setChartWindow}
        />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <ScenarioChangePanel
          comparison={visibleComparison}
          currency={currency}
        />
        <ForecastPanel
          title="FI path over time"
          description={fiDescription}
          legend={[
            ["Current path", BASELINE_COLOR],
            ["Job-move scenario", SCENARIO_COLOR],
            ["Milestone", MILESTONE_COLOR],
          ]}
        >
          <FiChart comparison={visibleComparison} currency={currency} />
        </ForecastPanel>
      </div>
      <MilestoneList milestones={comparison.milestones} />
    </div>
  );
}
