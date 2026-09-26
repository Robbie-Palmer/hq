"use client";

import { addDays, addYears, format, parseISO } from "date-fns";
import { Trash2Icon } from "lucide-react";
import { type SubmitEvent, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
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
import {
  accountLiquidity,
  type Currency,
  DEFAULT_BASE_CURRENCY,
  formatAssetTrackerError,
  formatCurrency,
  isLiability,
  type PlannedExpenditure,
  RUNWAY_FORECAST_MAX_YEARS,
  type RunwayForecastPoint,
  todayIsoDate,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";

const HORIZON_OPTIONS = [1, 3, 5, 10, 20, 30] as const;

const CASH_COLOR = "hsl(199, 89%, 48%)";
const LIQUID_COLOR = "hsl(160, 84%, 39%)";
const TOTAL_COLOR = "hsl(263, 70%, 58%)";
const BASELINE_COLOR = "hsl(263, 24%, 68%)";
const PLANNED_SPENDING_COLOR = "hsl(38, 92%, 50%)";

const CHART_CONFIG = {
  cashMonths: { label: "Cash", color: CASH_COLOR },
  liquidMonths: { label: "Liquid assets", color: LIQUID_COLOR },
  totalMonths: { label: "Total net worth", color: TOTAL_COLOR },
  baselineTotalMonths: {
    label: "Total without planned spending",
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
  if (reduction < 0.05) return "No planned-spending impact by this date";
  return `${formatRunway(reduction)} less after planned spending`;
}

function pointOnOrAfter(
  points: RunwayForecastPoint[],
  date: string,
): RunwayForecastPoint | null {
  return points.find((point) => point.date >= date) ?? points.at(-1) ?? null;
}

function tomorrowIsoDate(): string {
  return format(addDays(parseISO(todayIsoDate()), 1), "yyyy-MM-dd");
}

type ForecastChartPoint = RunwayForecastPoint & {
  timestamp: number;
  plannedExpenditures: PlannedExpenditure[];
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
      {point.plannedExpenditures.length > 0 && (
        <div className="grid gap-1 border-t pt-2">
          <p className="font-medium text-amber-600 dark:text-amber-400">
            Planned spending applied
          </p>
          {point.plannedExpenditures.map((expenditure) => (
            <div key={expenditure.id} className="flex justify-between gap-3">
              <span>
                {expenditure.name} ·{" "}
                {format(parseISO(expenditure.date), "d MMM")}
              </span>
              <span className="font-mono tabular-nums">
                {formatCurrency(expenditure.amount, baseCurrency)}
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
  expenditures: PlannedExpenditure[],
): ForecastChartPoint[] {
  return points.map((point, index) => {
    const previousDate = points[index - 1]?.date;
    return {
      ...point,
      timestamp: parseISO(point.date).getTime(),
      plannedExpenditures: expenditures.filter(
        (expenditure) =>
          expenditure.date <= point.date &&
          (previousDate == null || expenditure.date > previousDate),
      ),
    };
  });
}

export function RunwayForecast() {
  const {
    accounts,
    baseCurrency,
    financialIndependence,
    plannedExpenditures,
    addPlannedExpenditure,
    deletePlannedExpenditure,
  } = useAssetTracker();
  const { runwayForecast, representativeAnnualExpenditure } =
    financialIndependence;
  const [horizonYears, setHorizonYears] = useState(5);
  const [selectedDate, setSelectedDate] = useState(
    () =>
      runwayForecast[Math.min(60, runwayForecast.length - 1)]?.date ??
      todayIsoDate(),
  );
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(tomorrowIsoDate);
  const [fromAccountId, setFromAccountId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const assetAccounts = useMemo(
    () =>
      accounts
        .filter(
          (account) =>
            account.isOpen &&
            !isLiability(account.assetType) &&
            accountLiquidity(account) !== "illiquid",
        )
        .toSorted((a, b) => {
          const rank = (account: (typeof accounts)[number]) => {
            const liquidity = accountLiquidity(account);
            if (liquidity === "cash") return 0;
            return liquidity === "liquid" ? 1 : 2;
          };
          return (
            rank(a) - rank(b) || (b.latestBalance ?? 0) - (a.latestBalance ?? 0)
          );
        }),
    [accounts],
  );
  const selectedSourceId = plannedExpenditureSourceId(
    assetAccounts,
    fromAccountId,
  );
  const horizonIndex = Math.min(horizonYears * 12, runwayForecast.length - 1);
  const horizonEnd = runwayForecast[horizonIndex]?.date;
  const chartData = useMemo(
    () =>
      buildChartData(
        runwayForecast.slice(0, horizonIndex + 1),
        plannedExpenditures,
      ),
    [horizonIndex, plannedExpenditures, runwayForecast],
  );
  const visiblePlannedExpenditures = useMemo(
    () =>
      plannedExpenditures.filter(
        (expenditure) =>
          chartData[0] != null &&
          expenditure.date > chartData[0].date &&
          expenditure.date <= (horizonEnd ?? chartData[0].date),
      ),
    [chartData, horizonEnd, plannedExpenditures],
  );
  const selectedPoint = pointOnOrAfter(chartData, selectedDate);
  const maximumDate =
    runwayForecast.at(-1)?.date ??
    format(
      addYears(parseISO(todayIsoDate()), RUNWAY_FORECAST_MAX_YEARS),
      "yyyy-MM-dd",
    );

  function handleHorizon(value: string) {
    const years = Number(value);
    setHorizonYears(years);
    const end =
      runwayForecast[Math.min(years * 12, runwayForecast.length - 1)]?.date;
    if (end != null && selectedDate > end) setSelectedDate(end);
  }

  async function handleAdd(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await addPlannedExpenditure({
        name,
        amount: Number(amount),
        date,
        fromAccountId: selectedSourceId,
      });
      setName("");
      setAmount("");
      setDate(tomorrowIsoDate());
    } catch (err) {
      setError(formatAssetTrackerError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deletePlannedExpenditure(id);
      setError(null);
    } catch (err) {
      setError(formatAssetTrackerError(err));
    }
  }

  function accountName(id: string): string {
    return accounts.find((account) => account.id === id)?.name ?? id;
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
            . Planned spending is deducted on its date.
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
                {visiblePlannedExpenditures.map((expenditure) => (
                  <ReferenceLine
                    key={expenditure.id}
                    x={parseISO(expenditure.date).getTime()}
                    stroke={PLANNED_SPENDING_COLOR}
                    strokeDasharray="4 3"
                    strokeWidth={1.5}
                    label={{
                      value: formatCurrency(expenditure.amount, baseCurrency),
                      position: "insideTopRight",
                      fill: PLANNED_SPENDING_COLOR,
                      fontSize: 10,
                    }}
                  />
                ))}
                {plannedExpenditures.length > 0 && (
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
          {visiblePlannedExpenditures.length > 0 && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <span
                aria-hidden="true"
                className="h-3 border-l-2 border-dashed border-amber-500"
              />{" "}
              Planned spending is marked on its purchase date. Hover the next
              forecast point for its details.
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
                  <div key={item.label} className="rounded-md bg-muted/40 p-3">
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
            )}
          </div>
        </>
      ) : (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          Add reconciled income and balances to forecast runway.
        </p>
      )}

      <div className="space-y-3 rounded-md border p-3">
        <div>
          <h4 className="text-sm font-medium">Planned spending</h4>
          <p className="text-xs text-muted-foreground">
            Add a dated purchase such as a holiday, car, repair, or wedding.
            Enter the expected cost in today&apos;s money.
          </p>
        </div>
        {plannedExpenditures.length > 0 && (
          <ul className="divide-y rounded-md border">
            {plannedExpenditures.map((expenditure) => (
              <li
                key={expenditure.id}
                className="flex items-center gap-3 px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{expenditure.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {expenditure.date} from{" "}
                    {accountName(expenditure.fromAccountId)}
                  </p>
                </div>
                <span className="ml-auto shrink-0 font-mono">
                  {formatCurrency(expenditure.amount, baseCurrency)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete planned expenditure ${expenditure.name}`}
                  onClick={() => handleDelete(expenditure.id)}
                >
                  <Trash2Icon />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {assetAccounts.length > 0 ? (
          <form
            onSubmit={handleAdd}
            className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_8rem_10rem_1fr_auto] lg:items-end"
          >
            <div className="space-y-1.5">
              <label
                htmlFor="planned-expenditure-name"
                className="text-xs font-medium"
              >
                Name
              </label>
              <Input
                id="planned-expenditure-name"
                required
                placeholder="e.g. New car"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="planned-expenditure-amount"
                className="text-xs font-medium"
              >
                Amount
              </label>
              <Input
                id="planned-expenditure-amount"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                required
                placeholder="10000"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="planned-expenditure-date"
                className="text-xs font-medium"
              >
                Date
              </label>
              <Input
                id="planned-expenditure-date"
                type="date"
                min={tomorrowIsoDate()}
                max={maximumDate}
                required
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="planned-expenditure-account"
                className="text-xs font-medium"
              >
                Pay from
              </label>
              <Select value={selectedSourceId} onValueChange={setFromAccountId}>
                <SelectTrigger
                  id="planned-expenditure-account"
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {assetAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={submitting}>
              Add
            </Button>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">
            Add an open asset account before planning spending.
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </section>
  );
}
