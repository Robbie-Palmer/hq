"use client";

import { format, parseISO } from "date-fns";
import { useState } from "react";
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
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  type Currency,
  DEFAULT_BASE_CURRENCY,
  formatCurrency,
  formatCurrencyAxisTick,
  type IncomeRecord,
  type PortfolioReconciliationPeriod,
} from "@/lib/domain/assettracker";

const INCOME_COLOR = "hsl(220, 70%, 50%)";
const EXPENDITURE_COLOR = "hsl(30, 80%, 55%)";
const CURRENT_EXPENDITURE_COLOR = "hsl(0, 65%, 55%)";
const DIFFERENCE_COLOR = "hsl(160, 60%, 40%)";

const CHART_CONFIG = {
  income: { label: "Income", color: INCOME_COLOR },
  expenditure: { label: "Long-term FI spending", color: EXPENDITURE_COLOR },
  currentExpenditure: {
    label: "Current spending",
    color: CURRENT_EXPENDITURE_COLOR,
  },
  difference: { label: "Income retained", color: DIFFERENCE_COLOR },
} satisfies ChartConfig;

type IncomeExpenditurePoint = {
  date: string;
  income: number;
  expenditure?: number;
  currentExpenditure?: number;
  difference?: number;
};

export function buildIncomeExpenditureSeries(
  incomeHistory: readonly IncomeRecord[],
  periods: readonly PortfolioReconciliationPeriod[],
  currency: Currency = DEFAULT_BASE_CURRENCY,
): IncomeExpenditurePoint[] {
  const expenditureByDate = new Map(
    periods.map((period) => [period.endDate, period]),
  );
  return incomeHistory
    .flatMap((record) => {
      const period = expenditureByDate.get(record.date);
      if (period == null && record.currency !== currency) return [];
      const expenditure = period?.expenditure;
      const income = period?.income ?? record.amount;
      return [
        {
          date: record.date,
          income,
          expenditure,
          currentExpenditure: period?.currentExpenditure,
          difference: expenditure == null ? undefined : income - expenditure,
        },
      ];
    })
    .toSorted((a, b) => a.date.localeCompare(b.date));
}

export function IncomeExpenditureChart({
  incomeHistory,
  periods,
  currency = DEFAULT_BASE_CURRENCY,
}: Readonly<{
  incomeHistory: readonly IncomeRecord[];
  periods: readonly PortfolioReconciliationPeriod[];
  currency?: Currency;
}>) {
  const [view, setView] = useState<"comparison" | "difference">("comparison");
  const data = buildIncomeExpenditureSeries(incomeHistory, periods, currency);
  if (data.length === 0) return null;

  const hasExpenditure = data.some((point) => point.expenditure != null);
  const hasDebtPrincipal = data.some(
    (point) =>
      point.currentExpenditure != null &&
      point.currentExpenditure !== point.expenditure,
  );

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Income and spending</h3>
          <p className="text-xs text-muted-foreground">
            {view === "comparison"
              ? "Long-term FI spending excludes debt principal. Current spending includes it."
              : "Income retained as personal saving or debt principal. External capital is excluded."}
            {!hasExpenditure &&
              " Expenditure will appear when matching balance-sheet periods are available."}
          </p>
        </div>
        <fieldset className="flex gap-1">
          <legend className="sr-only">Income and spending chart view</legend>
          <Button
            type="button"
            size="sm"
            variant={view === "comparison" ? "secondary" : "ghost"}
            onClick={() => setView("comparison")}
          >
            Compare
          </Button>
          <Button
            type="button"
            size="sm"
            variant={view === "difference" ? "secondary" : "ghost"}
            disabled={!hasExpenditure}
            onClick={() => setView("difference")}
          >
            Retained
          </Button>
        </fieldset>
      </div>
      <ChartContainer
        config={CHART_CONFIG}
        className="aspect-auto w-full"
        role="img"
        aria-label={
          view === "comparison"
            ? "Income and spending by period"
            : "Income retained by period"
        }
      >
        <ResponsiveContainer width="100%" height={280}>
          <LineChart
            data={data}
            margin={{ top: 10, right: 18, left: 0, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="date"
              className="text-xs"
              minTickGap={24}
              tickFormatter={(date: string) => format(parseISO(date), "MMM yy")}
            />
            <YAxis
              className="text-xs"
              width={48}
              tickFormatter={(value: number) =>
                formatCurrencyAxisTick(value, currency)
              }
            />
            <ReferenceLine y={0} className="stroke-muted-foreground" />
            <ChartTooltip
              content={<ChartTooltipContent />}
              formatter={(value) => formatCurrency(value as number, currency)}
            />
            {view === "comparison" ? (
              <>
                <Line
                  type="monotone"
                  dataKey="income"
                  name="Income"
                  stroke={INCOME_COLOR}
                  strokeWidth={2.5}
                  dot={data.length === 1}
                  connectNulls
                />
                {hasExpenditure && (
                  <Line
                    type="monotone"
                    dataKey="expenditure"
                    name="Long-term FI spending"
                    stroke={EXPENDITURE_COLOR}
                    strokeWidth={2.5}
                    dot
                    connectNulls={false}
                  />
                )}
                {hasDebtPrincipal && (
                  <Line
                    type="monotone"
                    dataKey="currentExpenditure"
                    name="Current spending"
                    stroke={CURRENT_EXPENDITURE_COLOR}
                    strokeWidth={2.5}
                    dot
                    connectNulls={false}
                  />
                )}
              </>
            ) : (
              <Line
                type="monotone"
                dataKey="difference"
                name="Income retained"
                stroke={DIFFERENCE_COLOR}
                strokeWidth={2.5}
                dot
                connectNulls={false}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </ChartContainer>
      <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
        {view === "comparison" ? (
          <>
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ backgroundColor: INCOME_COLOR }}
              />
              <span>Income</span>
            </span>
            {hasExpenditure && (
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full"
                  style={{ backgroundColor: EXPENDITURE_COLOR }}
                />
                <span>Long-term FI spending</span>
              </span>
            )}
            {hasDebtPrincipal && (
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full"
                  style={{ backgroundColor: CURRENT_EXPENDITURE_COLOR }}
                />
                <span>Current spending</span>
              </span>
            )}
          </>
        ) : (
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2 rounded-full"
              style={{ backgroundColor: DIFFERENCE_COLOR }}
            />
            <span>Income retained</span>
          </span>
        )}
      </div>
      <table className="sr-only">
        <caption>Income and spending by period</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>Income</th>
            <th>Long-term FI spending</th>
            <th>Current spending</th>
            <th>Income retained</th>
          </tr>
        </thead>
        <tbody>
          {data.map((point) => (
            <tr key={point.date}>
              <td>{point.date}</td>
              <td>{formatCurrency(point.income, currency)}</td>
              <td>
                {point.expenditure == null
                  ? "Awaiting reconciliation"
                  : formatCurrency(point.expenditure, currency)}
              </td>
              <td>
                {point.currentExpenditure == null
                  ? "Awaiting reconciliation"
                  : formatCurrency(point.currentExpenditure, currency)}
              </td>
              <td>
                {point.difference == null
                  ? "Awaiting reconciliation"
                  : formatCurrency(point.difference, currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
