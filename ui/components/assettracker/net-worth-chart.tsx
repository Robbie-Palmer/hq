"use client";

import { format, parseISO, subYears } from "date-fns";
import { useMemo, useRef, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
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
  ACCOUNT_COLORS,
  formatCurrency,
  formatCurrencyAxisTick,
  todayIsoDate,
} from "@/lib/assettracker";
import {
  type Currency,
  DEFAULT_BASE_CURRENCY,
  hasFxExposure,
  type NetWorthDataPoint,
  toFxImpactTimeSeries,
} from "@/lib/domain/assettracker";
import { cn } from "@/lib/generic/styles";

const LONG_PRESS_MS = 450;

const RANGE_OPTIONS = [
  { label: "1Y", years: 1 },
  { label: "5Y", years: 5 },
  { label: "All", years: null },
] as const;

function seriesColor(index: number): string {
  return ACCOUNT_COLORS[index % ACCOUNT_COLORS.length] ?? ACCOUNT_COLORS[0];
}

/**
 * Windows the series to the last N years. Balances carry forward between
 * snapshots, so a synthetic point at the cutoff (last values before it) and
 * one at today (latest values) keep the window truthful even when nothing
 * was logged inside it.
 */
function windowToRange(
  data: NetWorthDataPoint[],
  years: number | null,
): NetWorthDataPoint[] {
  const last = data.at(-1);
  if (!last) return data;
  const today = todayIsoDate();
  const extended =
    last.date < today ? [...data, { ...last, date: today }] : data;
  if (years == null) return extended;
  const cutoff = format(subYears(parseISO(today), years), "yyyy-MM-dd");
  const windowed = extended.filter((point) => point.date >= cutoff);
  const baseline = [...extended].reverse().find((point) => point.date < cutoff);
  if (baseline && windowed[0]?.date !== cutoff) {
    windowed.unshift({ ...baseline, date: cutoff });
  }
  return windowed;
}

function formatSignedCurrency(value: number, currency: Currency): string {
  const sign = value >= 0 ? "+" : "−";
  return `${sign}${formatCurrency(Math.abs(Math.round(value)), currency)}`;
}

interface NetWorthChartProps {
  data: NetWorthDataPoint[];
  currency?: Currency;
  baseCurrencyData?: NetWorthDataPoint[];
  householdBaseCurrency?: Currency;
}

type ChartMode = "value" | "fxImpact";
type ChartDataValue = string | number | null | undefined;
type RenderedChartDataPoint = Record<string, ChartDataValue>;

export function NetWorthChart({
  data,
  currency = DEFAULT_BASE_CURRENCY,
  baseCurrencyData = data,
  householdBaseCurrency = currency,
}: Readonly<NetWorthChartProps>) {
  const [rangeYears, setRangeYears] = useState<number | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>("value");
  const rangedData = useMemo(
    () => windowToRange(data, rangeYears),
    [data, rangeYears],
  );
  const rangedBaseCurrencyData = useMemo(
    () => windowToRange(baseCurrencyData, rangeYears),
    [baseCurrencyData, rangeYears],
  );
  const canShowFxImpact = useMemo(
    () => hasFxExposure(baseCurrencyData, householdBaseCurrency),
    [baseCurrencyData, householdBaseCurrency],
  );
  const showingFxImpact = chartMode === "fxImpact" && canShowFxImpact;
  const fxImpactData = useMemo(
    () => toFxImpactTimeSeries(rangedBaseCurrencyData, householdBaseCurrency),
    [rangedBaseCurrencyData, householdBaseCurrency],
  );

  // The last point names every account with at least one market valuation.
  // Mortgages folded into their property and contribution-only accounts do
  // not produce dead legend pills.
  const seriesNames = useMemo(() => {
    const last = rangedData[rangedData.length - 1];
    if (!last) return [];
    return Object.keys(last).filter(
      (key) =>
        key !== "date" &&
        key !== "total" &&
        key !== "estimatedTotal" &&
        key !== "conversion",
    );
  }, [rangedData]);
  const hasEstimatedTotal = rangedData.some(
    (point) => point.estimatedTotal != null,
  );

  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  // Ignore hidden entries for series that no longer exist (import/reset)
  const isFiltered = seriesNames.some((name) => hidden.has(name));
  const visibleSeriesNames = useMemo(
    () => seriesNames.filter((name) => !hidden.has(name)),
    [hidden, seriesNames],
  );

  // The bold total line tracks the visible subset, so focusing one account
  // shows that account's own trajectory rather than the full net worth
  const chartData = useMemo(() => {
    if (visibleSeriesNames.length === seriesNames.length) return rangedData;
    return rangedData.map((point) => ({
      ...point,
      total: visibleSeriesNames.reduce(
        (sum, name) => sum + (Number(point[name]) || 0),
        0,
      ),
    }));
  }, [rangedData, seriesNames.length, visibleSeriesNames]);
  const renderedChartData: RenderedChartDataPoint[] = showingFxImpact
    ? fxImpactData
    : chartData.map(
        (point) =>
          Object.fromEntries(
            Object.entries(point).filter(([key]) => key !== "conversion"),
          ) as RenderedChartDataPoint,
      );

  const first = chartData[0];
  const latest = chartData[chartData.length - 1];
  const change =
    first?.total != null && latest?.total != null && chartData.length > 1
      ? latest.total - first.total
      : null;
  const changePercent =
    change != null && first?.total != null && first.total !== 0
      ? change / Math.abs(first.total)
      : null;
  const latestFxImpact = fxImpactData.at(-1)?.impact;
  let rangeLabel: string;
  if (rangeYears == null) {
    rangeLabel = "all time";
  } else if (rangeYears === 1) {
    rangeLabel = "the past year";
  } else {
    rangeLabel = `the past ${rangeYears} years`;
  }

  function soloSeries(name: string) {
    setHidden((previous) => {
      const isOnlyVisible =
        !previous.has(name) && previous.size === seriesNames.length - 1;
      if (isOnlyVisible) return new Set();
      return new Set(seriesNames.filter((other) => other !== name));
    });
  }

  function toggleSeries(name: string) {
    setHidden((previous) => {
      const next = new Set(previous);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      // Hiding the last visible series means "start over", not an empty chart
      if (next.size === seriesNames.length) return new Set();
      return next;
    });
  }

  const chartConfig: ChartConfig = {
    total: {
      label: isFiltered ? "Selected total" : "Net worth",
      color: "var(--foreground)",
    },
    estimatedTotal: {
      label: "Estimated net worth",
      color: "hsl(220, 10%, 55%)",
    },
    actualTotal: {
      label: "Actual net worth",
      color: "var(--foreground)",
    },
    fixedRateTotal: {
      label: "At fixed start rates",
      color: "hsl(220, 70%, 55%)",
    },
    impact: {
      label: "FX impact on net worth",
      color: "hsl(220, 70%, 55%)",
    },
  };
  for (const [i, name] of seriesNames.entries()) {
    chartConfig[name] = {
      label: name,
      color: seriesColor(i),
    };
  }

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Market net worth over time</CardTitle>
          <CardDescription>
            Logged market valuations and estimated investment values.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            Record an account balance to start net worth history.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <NetWorthChartHeader
        canShowFxImpact={canShowFxImpact}
        change={change}
        changePercent={changePercent}
        currency={currency}
        householdBaseCurrency={householdBaseCurrency}
        isFiltered={isFiltered}
        latestFxImpact={latestFxImpact}
        onModeChange={setChartMode}
        onRangeChange={setRangeYears}
        rangeLabel={rangeLabel}
        rangeYears={rangeYears}
        showingFxImpact={showingFxImpact}
      />
      <CardContent className="px-2 sm:px-6">
        <ChartContainer
          config={chartConfig}
          className="aspect-auto w-full"
          role="img"
          aria-label={
            showingFxImpact
              ? "Currency impact on net worth over time"
              : "Market net worth by account over time"
          }
        >
          <ResponsiveContainer width="100%" height={400}>
            <ComposedChart
              accessibilityLayer
              data={renderedChartData}
              stackOffset="sign"
              margin={{ top: 10, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="date" className="text-xs" />
              <YAxis
                className="text-xs"
                tickFormatter={(value: number) =>
                  formatCurrencyAxisTick(
                    value,
                    showingFxImpact ? householdBaseCurrency : currency,
                  )
                }
              />
              <ReferenceLine y={0} className="stroke-muted-foreground" />
              <ChartTooltip
                content={<ChartTooltipContent />}
                formatter={(value) =>
                  formatCurrency(
                    value as number,
                    showingFxImpact ? householdBaseCurrency : currency,
                  )
                }
              />
              <NetWorthChartSeries
                hasEstimatedTotal={hasEstimatedTotal}
                hidden={hidden}
                isFiltered={isFiltered}
                seriesNames={seriesNames}
                showingFxImpact={showingFxImpact}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartContainer>
        <NetWorthChartLegend
          hidden={hidden}
          isFiltered={isFiltered}
          onReset={() => setHidden(new Set())}
          onSolo={soloSeries}
          onToggle={toggleSeries}
          seriesNames={seriesNames}
          showingFxImpact={showingFxImpact}
        />
        <NetWorthDataTable
          chartData={chartData}
          currency={currency}
          fxImpactData={fxImpactData}
          householdBaseCurrency={householdBaseCurrency}
          isFiltered={isFiltered}
          seriesNames={visibleSeriesNames}
          showingFxImpact={showingFxImpact}
        />
      </CardContent>
    </Card>
  );
}

interface NetWorthChartHeaderProps {
  canShowFxImpact: boolean;
  change: number | null;
  changePercent: number | null;
  currency: Currency;
  householdBaseCurrency: Currency;
  isFiltered: boolean;
  latestFxImpact?: number | null;
  onModeChange(mode: ChartMode): void;
  onRangeChange(years: number | null): void;
  rangeLabel: string;
  rangeYears: number | null;
  showingFxImpact: boolean;
}

function NetWorthChartHeader({
  canShowFxImpact,
  change,
  changePercent,
  currency,
  householdBaseCurrency,
  isFiltered,
  latestFxImpact,
  onModeChange,
  onRangeChange,
  rangeLabel,
  rangeYears,
  showingFxImpact,
}: Readonly<NetWorthChartHeaderProps>) {
  return (
    <CardHeader>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <CardTitle>
          {showingFxImpact
            ? "Currency impact on net worth"
            : "Market net worth over time"}
        </CardTitle>
        <div className="flex flex-wrap justify-end gap-2">
          {canShowFxImpact && (
            <fieldset className="flex min-w-0 gap-1 border-0 p-0">
              <legend className="sr-only">Chart view</legend>
              <Button
                variant={!showingFxImpact ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={!showingFxImpact}
                className="min-h-11"
                onClick={() => onModeChange("value")}
              >
                Value
              </Button>
              <Button
                variant={showingFxImpact ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={showingFxImpact}
                className="min-h-11"
                onClick={() => onModeChange("fxImpact")}
              >
                FX impact
              </Button>
            </fieldset>
          )}
          <fieldset className="flex min-w-0 gap-1 border-0 p-0">
            <legend className="sr-only">Chart period</legend>
            {RANGE_OPTIONS.map((option) => (
              <Button
                key={option.label}
                variant={rangeYears === option.years ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={rangeYears === option.years}
                className="min-h-11 min-w-11"
                onClick={() => onRangeChange(option.years)}
              >
                {option.label}
              </Button>
            ))}
          </fieldset>
        </div>
      </div>
      <NetWorthChartSummary
        change={change}
        changePercent={changePercent}
        currency={currency}
        householdBaseCurrency={householdBaseCurrency}
        isFiltered={isFiltered}
        latestFxImpact={latestFxImpact}
        rangeLabel={rangeLabel}
        showingFxImpact={showingFxImpact}
      />
      {showingFxImpact ? (
        <CardDescription>
          This is actual net worth minus the same portfolio valued at fixed
          start rates. Positive values mean currency movements added value.
          Holdings, prices, cash flows, account openings, and closures stay the
          same in both calculations.
        </CardDescription>
      ) : (
        <CardDescription>
          The bold line uses logged market valuations. The dashed line estimates
          unvalued investments from their last valuation, dated contributions,
          and expected return. Linked mortgages reduce property to home equity.
        </CardDescription>
      )}
    </CardHeader>
  );
}

function NetWorthChartSummary({
  change,
  changePercent,
  currency,
  householdBaseCurrency,
  isFiltered,
  latestFxImpact,
  rangeLabel,
  showingFxImpact,
}: Readonly<
  Pick<
    NetWorthChartHeaderProps,
    | "change"
    | "changePercent"
    | "currency"
    | "householdBaseCurrency"
    | "isFiltered"
    | "latestFxImpact"
    | "rangeLabel"
    | "showingFxImpact"
  >
>) {
  if (showingFxImpact) {
    if (latestFxImpact == null) {
      return (
        <p className="text-sm text-muted-foreground">
          FX impact is unavailable for the latest chart point.
        </p>
      );
    }
    return (
      <p className="text-sm">
        <span className="font-semibold">
          {formatCurrency(Math.abs(latestFxImpact), householdBaseCurrency)}
        </span>{" "}
        <span className="text-muted-foreground">
          {latestFxImpact >= 0
            ? "added to household net worth"
            : "removed from household net worth"}{" "}
          by currency movements over {rangeLabel}
        </span>
      </p>
    );
  }
  if (change == null) return null;
  return (
    <p className="text-sm">
      <span className="font-semibold">
        {formatSignedCurrency(change, currency)}
      </span>
      {changePercent != null && (
        <span className="font-semibold">
          {" "}
          ({(changePercent * 100).toFixed(1)}%)
        </span>
      )}{" "}
      <span className="text-muted-foreground">
        {isFiltered ? "for the selected accounts " : ""}over {rangeLabel}
      </span>
    </p>
  );
}

function NetWorthChartSeries({
  hasEstimatedTotal,
  hidden,
  isFiltered,
  seriesNames,
  showingFxImpact,
}: Readonly<{
  hasEstimatedTotal: boolean;
  hidden: ReadonlySet<string>;
  isFiltered: boolean;
  seriesNames: string[];
  showingFxImpact: boolean;
}>) {
  if (showingFxImpact) {
    return (
      <Area
        type="monotone"
        dataKey="impact"
        stroke="hsl(220, 70%, 55%)"
        strokeWidth={2.5}
        fill="hsl(220, 70%, 55%)"
        fillOpacity={0.2}
        dot={false}
        connectNulls
      />
    );
  }
  return (
    <>
      {seriesNames.map((name, i) =>
        hidden.has(name) ? null : (
          <Area
            key={name}
            type="monotone"
            dataKey={name}
            stackId="1"
            stroke={seriesColor(i)}
            fill={seriesColor(i)}
            fillOpacity={0.3}
          />
        ),
      )}
      <Line
        type="monotone"
        dataKey="total"
        stroke="var(--foreground)"
        strokeWidth={2.5}
        dot={false}
      />
      {hasEstimatedTotal && !isFiltered && (
        <Line
          type="monotone"
          dataKey="estimatedTotal"
          stroke="hsl(220, 10%, 55%)"
          strokeWidth={2}
          strokeDasharray="6 4"
          dot={false}
          connectNulls
        />
      )}
    </>
  );
}

function NetWorthChartLegend({
  hidden,
  isFiltered,
  onReset,
  onSolo,
  onToggle,
  seriesNames,
  showingFxImpact,
}: Readonly<{
  hidden: ReadonlySet<string>;
  isFiltered: boolean;
  onReset(): void;
  onSolo(name: string): void;
  onToggle(name: string): void;
  seriesNames: string[];
  showingFxImpact: boolean;
}>) {
  if (showingFxImpact) {
    return (
      <div className="mt-4 flex flex-wrap items-center justify-center gap-4 text-xs font-medium">
        <ChartLineKey
          color="hsl(220, 70%, 55%)"
          label="FX impact on net worth"
        />
      </div>
    );
  }
  return (
    <>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
        {seriesNames.map((name, i) => (
          <LegendPill
            key={name}
            name={name}
            color={seriesColor(i)}
            isHidden={hidden.has(name)}
            onSolo={() => onSolo(name)}
            onToggle={() => onToggle(name)}
          />
        ))}
        {isFiltered && (
          <button
            type="button"
            className="min-h-11 rounded-full border px-3 py-2 text-xs font-medium hover:bg-accent"
            onClick={onReset}
          >
            Show all
          </button>
        )}
      </div>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        Click an account to focus it · Ctrl/⌘-click or long-press to show/hide
        it
      </p>
    </>
  );
}

function ChartLineKey({
  color,
  label,
}: Readonly<{ color: string; label: string }>) {
  return (
    <span className="flex items-center gap-1.5">
      <svg aria-hidden="true" className="h-2 w-5" viewBox="0 0 20 8">
        <line x1="0" x2="20" y1="4" y2="4" stroke={color} strokeWidth="2" />
      </svg>
      {label}
    </span>
  );
}

interface LegendPillProps {
  name: string;
  color: string;
  isHidden: boolean;
  onSolo(): void;
  onToggle(): void;
}

/**
 * Grafana-style legend entry: plain click focuses (solos) the series, a
 * modified click toggles it in/out. On touch there are no modifier keys, so
 * a long-press stands in for ctrl-click.
 */
function LegendPill({
  name,
  color,
  isHidden,
  onSolo,
  onToggle,
}: Readonly<LegendPillProps>) {
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  function startPress() {
    longPressFired.current = false;
    pressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      onToggle();
    }, LONG_PRESS_MS);
  }

  function cancelPress() {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }

  function handleClick(event: React.MouseEvent) {
    // The click that follows a completed long-press must not also solo
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      onToggle();
    } else {
      onSolo();
    }
  }

  return (
    <button
      type="button"
      aria-pressed={!isHidden}
      className={cn(
        "flex min-h-11 select-none items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-medium transition-opacity hover:bg-accent",
        isHidden && "opacity-40 line-through",
      )}
      onPointerDown={startPress}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onPointerCancel={cancelPress}
      onClick={handleClick}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      {name}
    </button>
  );
}

function formatTableValue(value: unknown, currency: Currency): string {
  return typeof value === "number"
    ? formatCurrency(value, currency)
    : "Unavailable";
}

function NetWorthDataTable({
  chartData,
  currency,
  fxImpactData,
  householdBaseCurrency,
  isFiltered,
  seriesNames,
  showingFxImpact,
}: Readonly<{
  chartData: NetWorthDataPoint[];
  currency: Currency;
  fxImpactData: RenderedChartDataPoint[];
  householdBaseCurrency: Currency;
  isFiltered: boolean;
  seriesNames: string[];
  showingFxImpact: boolean;
}>) {
  if (showingFxImpact) {
    return (
      <div className="sr-only">
        <table>
          <caption>Currency impact on net worth over time</caption>
          <thead>
            <tr>
              <th>Date</th>
              <th>Actual net worth</th>
              <th>Net worth at fixed start rates</th>
              <th>Currency impact</th>
            </tr>
          </thead>
          <tbody>
            {fxImpactData.map((point) => (
              <tr key={String(point.date)}>
                <td>{point.date}</td>
                <td>
                  {formatTableValue(point.actualTotal, householdBaseCurrency)}
                </td>
                <td>
                  {formatTableValue(
                    point.fixedRateTotal,
                    householdBaseCurrency,
                  )}
                </td>
                <td>{formatTableValue(point.impact, householdBaseCurrency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="sr-only">
      <table>
        <caption>Market net worth by account over time</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>{isFiltered ? "Selected total" : "Net worth"}</th>
            <th>Estimated net worth</th>
            {seriesNames.map((name) => (
              <th key={name}>{name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chartData.map((point) => (
            <tr key={point.date}>
              <td>{point.date}</td>
              <td>{formatTableValue(point.total, currency)}</td>
              <td>{formatTableValue(point.estimatedTotal, currency)}</td>
              {seriesNames.map((name) => (
                <td key={name}>{formatTableValue(point[name], currency)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
