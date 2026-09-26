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
  type Currency,
  DEFAULT_BASE_CURRENCY,
  formatCurrency,
  formatCurrencyAxisTick,
  type NetWorthDataPoint,
  todayIsoDate,
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
}

export function NetWorthChart({
  data,
  currency = DEFAULT_BASE_CURRENCY,
}: Readonly<NetWorthChartProps>) {
  const [rangeYears, setRangeYears] = useState<number | null>(null);
  const rangedData = useMemo(
    () => windowToRange(data, rangeYears),
    [data, rangeYears],
  );

  // The last point names every account with at least one market valuation.
  // Mortgages folded into their property and contribution-only accounts do
  // not produce dead legend pills.
  const seriesNames = useMemo(() => {
    const last = rangedData[rangedData.length - 1];
    if (!last) return [];
    return Object.keys(last).filter(
      (key) => key !== "date" && key !== "total" && key !== "estimatedTotal",
    );
  }, [rangedData]);
  const hasEstimatedTotal = rangedData.some(
    (point) => point.estimatedTotal != null,
  );

  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  // Ignore hidden entries for series that no longer exist (import/reset)
  const isFiltered = seriesNames.some((name) => hidden.has(name));

  // The bold total line tracks the visible subset, so focusing one account
  // shows that account's own trajectory rather than the full net worth
  const chartData = useMemo(() => {
    const visibleNames = seriesNames.filter((name) => !hidden.has(name));
    if (visibleNames.length === seriesNames.length) return rangedData;
    return rangedData.map((point) => ({
      ...point,
      total: visibleNames.reduce(
        (sum, name) => sum + (Number(point[name]) || 0),
        0,
      ),
    }));
  }, [rangedData, seriesNames, hidden]);

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
  let rangeLabel: string;
  if (rangeYears == null) {
    rangeLabel = "all time";
  } else if (rangeYears === 1) {
    rangeLabel = "past year";
  } else {
    rangeLabel = `past ${rangeYears} years`;
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
  };
  for (const [i, name] of seriesNames.entries()) {
    chartConfig[name] = {
      label: name,
      color: seriesColor(i),
    };
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle>Market net worth over time</CardTitle>
          <div className="flex gap-1">
            {RANGE_OPTIONS.map((option) => (
              <Button
                key={option.label}
                variant={rangeYears === option.years ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setRangeYears(option.years)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
        {change != null && (
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
              {isFiltered ? "for the selected accounts " : ""}over the{" "}
              {rangeLabel}
            </span>
          </p>
        )}
        <CardDescription>
          The bold line uses logged market valuations. The dashed line estimates
          unvalued investments from their last valuation, dated contributions,
          and expected return. Linked mortgages reduce property to home equity.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-2 sm:px-6">
        <ChartContainer config={chartConfig} className="aspect-auto w-full">
          <ResponsiveContainer width="100%" height={400}>
            <ComposedChart
              data={chartData}
              stackOffset="sign"
              margin={{ top: 10, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="date" className="text-xs" />
              <YAxis
                className="text-xs"
                tickFormatter={(value: number) =>
                  formatCurrencyAxisTick(value, currency)
                }
              />
              <ReferenceLine y={0} className="stroke-muted-foreground" />
              <ChartTooltip
                content={<ChartTooltipContent />}
                formatter={(value) => formatCurrency(value as number, currency)}
              />
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
            </ComposedChart>
          </ResponsiveContainer>
        </ChartContainer>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
          {seriesNames.map((name, i) => (
            <LegendPill
              key={name}
              name={name}
              color={seriesColor(i)}
              isHidden={hidden.has(name)}
              onSolo={() => soloSeries(name)}
              onToggle={() => toggleSeries(name)}
            />
          ))}
          {isFiltered && (
            <button
              type="button"
              className="rounded-full border px-2.5 py-1 text-xs font-medium hover:bg-accent"
              onClick={() => setHidden(new Set())}
            >
              Show all
            </button>
          )}
        </div>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Click an account to focus it · Ctrl/⌘-click or long-press to show/hide
          it
        </p>
      </CardContent>
    </Card>
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
        "flex select-none items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-opacity hover:bg-accent",
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
