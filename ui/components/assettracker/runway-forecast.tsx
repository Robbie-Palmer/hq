"use client";

import { format, parseISO } from "date-fns";
import { useMemo, useState } from "react";
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
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
} from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency, todayIsoDate } from "@/lib/assettracker";
import {
  type Currency,
  DEFAULT_BASE_CURRENCY,
  type ForecastCashFlow,
  futureCashFlowForecastItems,
  type MonthlyForecastBreakdown,
  type RunwayForecastPoint,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";
import { ForecastAssumptionManager } from "./forecast-assumption-manager";
import { FutureCashFlowManager } from "./future-cash-flow-manager";

const HORIZON_OPTIONS = [1, 3, 5, 10, 20, 30] as const;

const CASH_COLOR = "hsl(199, 89%, 48%)";
const LIQUID_COLOR = "hsl(160, 84%, 39%)";
const TOTAL_COLOR = "hsl(263, 70%, 58%)";
const BASELINE_COLOR = "hsl(263, 24%, 68%)";
const FUTURE_CASH_FLOW_COLOR = "hsl(38, 92%, 50%)";

const CHART_CONFIG = {
  cashMonths: { label: "Cash", color: CASH_COLOR },
  liquidMonths: { label: "Liquid assets", color: LIQUID_COLOR },
  totalMonths: { label: "Total net worth", color: TOTAL_COLOR },
  baselineTotalMonths: {
    label: "Total without future commitments and selected decisions",
    color: BASELINE_COLOR,
  },
} satisfies ChartConfig;

function formatRunway(months: number): string {
  if (months < 24) return `${months.toFixed(1)} months`;
  return `${(months / 12).toFixed(1)} years`;
}

export function formatRunwayDuration(months: number): string {
  const positiveMonths = Math.max(months, 0);
  const wholeMonths = Math.floor(positiveMonths);
  const years = Math.floor(wholeMonths / 12);
  const remainingMonths = wholeMonths % 12;
  const days = Math.round((positiveMonths - wholeMonths) * (365.25 / 12));
  const unit = (value: number, singular: string) => {
    const label = value === 1 ? singular : `${singular}s`;
    return `${value} ${label}`;
  };
  return [
    unit(years, "year"),
    unit(remainingMonths, "month"),
    unit(days, "day"),
  ].join(", ");
}

function formatAxisRunway(months: number): string {
  return months < 24
    ? `${Math.round(months)}mo`
    : `${(months / 12).toFixed(0)}yr`;
}

function impactDescription(projected: number, baseline: number): string {
  const reduction = baseline - projected;
  if (reduction < 0.05) return "No future cash-flow impact by this date";
  return `${formatRunway(reduction)} less after future cash flows`;
}

function pointOnOrAfter(
  points: RunwayForecastPoint[],
  date: string,
): RunwayForecastPoint | null {
  return points.find((point) => point.date >= date) ?? points.at(-1) ?? null;
}

type ForecastChartPoint = RunwayForecastPoint & {
  timestamp: number;
  forecastCashFlows: ForecastCashFlow[];
};

type RunwayTooltipPayload = {
  color?: string;
  dataKey?: string | number;
  payload?: ForecastChartPoint;
  value?: number | string;
};

export function plannedExpenditureSourceId(
  accounts: ReadonlyArray<{ id: string }>,
  requestedId: string,
): string {
  return accounts.some((account) => account.id === requestedId)
    ? requestedId
    : (accounts[0]?.id ?? "");
}

export function RunwayChartTooltip({
  active,
  payload,
  baseCurrency = DEFAULT_BASE_CURRENCY,
}: Readonly<{
  active?: boolean;
  payload?: RunwayTooltipPayload[];
  baseCurrency?: Currency;
}>) {
  if (!active || !payload?.length) return null;
  const point = payload.find((item) => item.payload != null)?.payload;
  if (point == null) return null;
  const runwayValues = payload.filter(
    (item): item is RunwayTooltipPayload & { dataKey: string; value: number } =>
      typeof item.dataKey === "string" &&
      typeof item.value === "number" &&
      item.dataKey in CHART_CONFIG,
  );

  return (
    <div className="grid min-w-64 gap-2 rounded-lg border bg-background px-3 py-2 text-xs shadow-xl">
      <p className="font-medium">
        {format(parseISO(point.date), "d MMM yyyy")}
      </p>
      <div className="grid gap-1.5">
        {runwayValues.map((item) => {
          const config =
            CHART_CONFIG[item.dataKey as keyof typeof CHART_CONFIG];
          return (
            <div key={item.dataKey} className="flex items-start gap-2">
              <span
                aria-hidden="true"
                className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: item.color ?? config.color }}
              />
              <span className="font-medium">{config.label}</span>
              <span className="ml-auto pl-3 text-right font-mono tabular-nums">
                {formatRunwayDuration(item.value)}
              </span>
            </div>
          );
        })}
      </div>
      {point.forecastCashFlows.length > 0 && (
        <div className="grid gap-1 border-t pt-2">
          <p className="font-medium text-amber-600 dark:text-amber-400">
            Future cash flows applied
          </p>
          {point.forecastCashFlows.map((cashFlow) => (
            <div key={cashFlow.id} className="flex justify-between gap-3">
              <span>
                {cashFlow.name} · {format(parseISO(cashFlow.date), "d MMM")}
              </span>
              <span className="font-mono tabular-nums">
                {formatCurrency(cashFlow.amount, baseCurrency)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function buildChartData(
  points: RunwayForecastPoint[],
  cashFlows: ForecastCashFlow[],
): ForecastChartPoint[] {
  return points.map((point, index) => {
    const previousDate = points[index - 1]?.date;
    return {
      ...point,
      timestamp: parseISO(point.date).getTime(),
      forecastCashFlows: cashFlows.filter(
        (cashFlow) =>
          cashFlow.date <= point.date &&
          (previousDate == null || cashFlow.date > previousDate),
      ),
    };
  });
}

function formatRange(
  range: MonthlyForecastBreakdown["explicitIncomeChange"],
  currency: Currency,
): string {
  const expected = formatCurrency(Math.round(range.expected), currency);
  if (range.minimum === range.expected && range.maximum === range.expected) {
    return expected;
  }
  return `${expected} (${formatCurrency(Math.round(range.minimum), currency)}–${formatCurrency(Math.round(range.maximum), currency)})`;
}

function MonthlyBreakdown({
  breakdown,
  currency,
}: Readonly<{
  breakdown: MonthlyForecastBreakdown;
  currency: Currency;
}>) {
  const amounts = [
    ["Historical expenditure baseline", breakdown.baselineExpenditure],
    ["External income", breakdown.externalIncome],
    ["Account transfers", breakdown.accountTransfers],
    ["Debt payments", breakdown.debtPayments],
    ["Committed cash flows", breakdown.committedCashFlows],
  ] as const;

  return (
    <div className="space-y-2 rounded-md bg-muted/40 p-3">
      <div>
        <p className="text-xs font-medium">Monthly projection breakdown</p>
        <p className="text-xs text-muted-foreground">
          Changes are forecast assumptions, not spending limits.
        </p>
      </div>
      <dl className="grid gap-1 text-xs sm:grid-cols-2">
        {amounts.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-mono tabular-nums">
              {formatCurrency(Math.round(value), currency)}
            </dd>
          </div>
        ))}
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Explicit income change</dt>
          <dd className="font-mono tabular-nums">
            {formatRange(breakdown.explicitIncomeChange, currency)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Explicit expenditure change</dt>
          <dd className="font-mono tabular-nums">
            {formatRange(breakdown.explicitExpenditureChange, currency)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Selected decisions</dt>
          <dd className="font-mono tabular-nums">
            {formatCurrency(
              Math.round(breakdown.selectedDecisionCashFlows),
              currency,
            )}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Possible decisions</dt>
          <dd className="font-mono tabular-nums">
            {formatRange(breakdown.possibleDecisions, currency)}
          </dd>
        </div>
      </dl>
      {breakdown.ordinaryRecurringOutflowsCoveredByBaseline > 0 && (
        <p className="text-xs text-muted-foreground">
          {formatCurrency(
            Math.round(breakdown.ordinaryRecurringOutflowsCoveredByBaseline),
            currency,
          )}{" "}
          of ordinary recurring outflows is already represented by the
          historical baseline and is not counted again.
        </p>
      )}
    </div>
  );
}

export function RunwayForecast() {
  const { baseCurrency, financialIndependence, futureCashFlows } =
    useAssetTracker();
  const { runwayForecast, representativeAnnualExpenditure } =
    financialIndependence;
  const [horizonYears, setHorizonYears] = useState(5);
  const [selectedDate, setSelectedDate] = useState(
    () =>
      runwayForecast[Math.min(60, runwayForecast.length - 1)]?.date ??
      todayIsoDate(),
  );
  const forecastCashFlows = useMemo(
    () => futureCashFlowForecastItems(futureCashFlows),
    [futureCashFlows],
  );
  const horizonIndex = Math.min(horizonYears * 12, runwayForecast.length - 1);
  const horizonEnd = runwayForecast[horizonIndex]?.date;
  const chartData = useMemo(
    () =>
      buildChartData(
        runwayForecast.slice(0, horizonIndex + 1),
        forecastCashFlows,
      ),
    [forecastCashFlows, horizonIndex, runwayForecast],
  );
  const visibleForecastCashFlows = useMemo(
    () =>
      forecastCashFlows.filter(
        (cashFlow) =>
          chartData[0] != null &&
          cashFlow.date > chartData[0].date &&
          cashFlow.date <= (horizonEnd ?? chartData[0].date),
      ),
    [chartData, forecastCashFlows, horizonEnd],
  );
  const selectedPoint = pointOnOrAfter(chartData, selectedDate);

  function handleHorizon(value: string) {
    const years = Number(value);
    setHorizonYears(years);
    const end =
      runwayForecast[Math.min(years * 12, runwayForecast.length - 1)]?.date;
    if (end != null && selectedDate > end) setSelectedDate(end);
  }

  return (
    <section
      className="min-w-0 space-y-4 border-t pt-5"
      aria-labelledby="runway-forecast-heading"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 id="runway-forecast-heading" className="text-sm font-medium">
            Expected runway over time
          </h3>
          <p className="text-xs text-muted-foreground">
            Uses today&apos;s money, expected account returns, active expected
            flows, and{" "}
            {representativeAnnualExpenditure == null
              ? "reconciled long-term spending"
              : `${formatCurrency(Math.round(representativeAnnualExpenditure), baseCurrency)}/yr long-term spending`}
            . Active commitments and selected decisions are deducted on their
            expected dates.
          </p>
        </div>
        <Select value={String(horizonYears)} onValueChange={handleHorizon}>
          <SelectTrigger
            aria-label="Runway forecast horizon"
            size="sm"
            className="w-28"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {HORIZON_OPTIONS.map((years) => (
              <SelectItem key={years} value={String(years)}>
                {years} {years === 1 ? "year" : "years"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {chartData.length > 1 ? (
        <>
          <ChartContainer
            config={CHART_CONFIG}
            className="aspect-auto w-full"
            role="img"
            aria-label="Expected cash, liquid asset, and total net worth runway over time"
          >
            <ResponsiveContainer width="100%" height={280}>
              <LineChart
                data={chartData}
                margin={{ top: 10, right: 18, left: 0, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="timestamp"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  minTickGap={28}
                  tickFormatter={(value: number) =>
                    format(new Date(value), "MMM yyyy")
                  }
                />
                <YAxis width={48} tickFormatter={formatAxisRunway} />
                <ChartTooltip
                  content={<RunwayChartTooltip baseCurrency={baseCurrency} />}
                />
                <ChartLegend content={<ChartLegendContent />} />
                {visibleForecastCashFlows.map((cashFlow) => (
                  <ReferenceLine
                    key={cashFlow.id}
                    x={parseISO(cashFlow.date).getTime()}
                    stroke={FUTURE_CASH_FLOW_COLOR}
                    strokeDasharray="4 3"
                    strokeWidth={1.5}
                    label={{
                      value: formatCurrency(cashFlow.amount, baseCurrency),
                      position: "insideTopRight",
                      fill: FUTURE_CASH_FLOW_COLOR,
                      fontSize: 10,
                    }}
                  />
                ))}
                {forecastCashFlows.length > 0 && (
                  <Line
                    type="monotone"
                    dataKey="baselineTotalMonths"
                    stroke={BASELINE_COLOR}
                    strokeWidth={1.5}
                    strokeDasharray="6 4"
                    dot={false}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="cashMonths"
                  stroke={CASH_COLOR}
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="liquidMonths"
                  stroke={LIQUID_COLOR}
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="totalMonths"
                  stroke={TOTAL_COLOR}
                  strokeWidth={2.5}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartContainer>
          {visibleForecastCashFlows.length > 0 && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <span
                aria-hidden="true"
                className="h-3 border-l-2 border-dashed border-amber-500"
              />{" "}
              Included future cash flows are marked on their expected dates.
              Hover the next forecast point for details.
            </p>
          )}

          <div className="space-y-3 rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-medium">
                Runway on the selected date
              </h4>
              <Input
                aria-label="Runway forecast date"
                type="date"
                min={runwayForecast[0]?.date}
                max={horizonEnd}
                value={selectedPoint?.date ?? selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
                className="w-40"
              />
            </div>
            {selectedPoint && (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    {
                      label: "Cash",
                      balance: selectedPoint.cashBalance,
                      months: selectedPoint.cashMonths,
                      baseline: selectedPoint.baselineCashMonths,
                    },
                    {
                      label: "Liquid assets",
                      balance: selectedPoint.liquidBalance,
                      months: selectedPoint.liquidMonths,
                      baseline: selectedPoint.baselineLiquidMonths,
                    },
                    {
                      label: "Total net worth",
                      balance: selectedPoint.totalBalance,
                      months: selectedPoint.totalMonths,
                      baseline: selectedPoint.baselineTotalMonths,
                    },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="rounded-md bg-muted/40 p-3"
                    >
                      <p className="text-xs text-muted-foreground">
                        {item.label}
                      </p>
                      <p className="mt-1 font-semibold">
                        {formatRunway(item.months)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatCurrency(Math.round(item.balance), baseCurrency)}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {impactDescription(item.months, item.baseline)}
                      </p>
                    </div>
                  ))}
                </div>
                <MonthlyBreakdown
                  breakdown={selectedPoint.monthlyBreakdown}
                  currency={baseCurrency}
                />
              </>
            )}
          </div>
        </>
      ) : (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          Add reconciled income and balances to forecast runway.
        </p>
      )}

      <ForecastAssumptionManager />
      <FutureCashFlowManager />
    </section>
  );
}
