"use client";

import { latestOnsInflationRelease } from "finance-inflation-indices/dataset";
import Link from "next/link";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { type ChartConfig, ChartContainer } from "@/components/ui/chart";
import { formatCurrency } from "@/lib/assettracker";
import {
  adjustForInflation,
  type Currency,
  DEFAULT_BASE_CURRENCY,
  type IncomeRecord,
  InflationDataError,
  type InflationDatasetRelease,
} from "@/lib/domain/assettracker";
import { CurrencyHistoryChartAxes } from "./currency-history-chart-axes";
import { InflationDatasetDisclosure } from "./inflation-dataset-disclosure";

const NOMINAL_COLOR = "hsl(220, 70%, 50%)";
const REAL_COLOR = "hsl(160, 60%, 34%)";

const CHART_CONFIG = {
  nominalIncome: { label: "Nominal income", color: NOMINAL_COLOR },
  adjustedIncome: { label: "CPIH-adjusted income", color: REAL_COLOR },
} satisfies ChartConfig;

export type RealIncomeHistoryPoint = {
  date: string;
  nominalIncome: number;
  adjustedIncome?: number;
};

function referenceDateFor(release: InflationDatasetRelease): string {
  return release.source.frequency === "monthly"
    ? `${release.source.coverageThrough}-01`
    : `${release.source.coverageThrough}-01-01`;
}

export function buildRealIncomeHistorySeries(
  incomeHistory: readonly IncomeRecord[],
  release: InflationDatasetRelease | null,
  currency: Currency = DEFAULT_BASE_CURRENCY,
): RealIncomeHistoryPoint[] {
  const referenceDate = release == null ? null : referenceDateFor(release);

  return incomeHistory
    .filter((record) => record.currency === currency)
    .map((record) => {
      if (release == null || referenceDate == null) {
        return { date: record.date, nominalIncome: record.amount };
      }
      try {
        const adjustment = adjustForInflation(release, {
          amount: record.amount,
          currency,
          sourceDate: record.date,
          referenceDate,
        });
        return {
          date: record.date,
          nominalIncome: record.amount,
          adjustedIncome: Math.round(adjustment.amount * 100) / 100,
        };
      } catch (error) {
        if (error instanceof InflationDataError) {
          return { date: record.date, nominalIncome: record.amount };
        }
        throw error;
      }
    })
    .toSorted((left, right) => left.date.localeCompare(right.date));
}

function LegendItem({
  color,
  children,
}: Readonly<{ color: string; children: string }>) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="size-2 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span>{children}</span>
    </span>
  );
}

function IncomeHistoryEmptyState({
  currency,
  excludedCurrencyCount,
}: Readonly<{ currency: Currency; excludedCurrencyCount: number }>) {
  const hasOtherCurrencyHistory = excludedCurrencyCount > 0;
  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 text-center">
      <div className="space-y-1">
        <p className="font-medium">
          {hasOtherCurrencyHistory
            ? `No ${currency} income history`
            : "No income history yet"}
        </p>
        <p className="max-w-md text-sm text-muted-foreground">
          {hasOtherCurrencyHistory
            ? `${excludedCurrencyCount} ${excludedCurrencyCount === 1 ? "record uses" : "records use"} another currency and cannot be compared with UK CPIH without an exchange rate.`
            : "Import dated income totals to compare the recorded amounts with their CPIH-adjusted value."}
        </p>
      </div>
      <Button asChild variant="outline">
        <Link href="/assettracker/imports">Import income history</Link>
      </Button>
    </div>
  );
}

export function RealIncomeHistoryChart({
  incomeHistory,
  currency = DEFAULT_BASE_CURRENCY,
  release = latestOnsInflationRelease("CPIH"),
}: Readonly<{
  incomeHistory: readonly IncomeRecord[];
  currency?: Currency;
  release?: InflationDatasetRelease | null;
}>) {
  const data = buildRealIncomeHistorySeries(incomeHistory, release, currency);
  const referenceDate =
    release == null ? "1970-01-01" : referenceDateFor(release);
  const unavailableCount = data.filter(
    (point) => point.adjustedIncome == null,
  ).length;
  const adjustedCount = data.length - unavailableCount;
  const excludedCurrencyCount = incomeHistory.length - data.length;
  const hasOtherCurrencyHistory = excludedCurrencyCount > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Income over time</CardTitle>
        <CardDescription>
          Compare the amount received in each period with its purchasing power
          at the latest published CPIH period.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-2 sm:px-6">
        {data.length === 0 ? (
          <IncomeHistoryEmptyState
            currency={currency}
            excludedCurrencyCount={excludedCurrencyCount}
          />
        ) : (
          <>
            <ChartContainer
              config={CHART_CONFIG}
              className="aspect-auto w-full"
              role="img"
              aria-label="Nominal and CPIH-adjusted income by period"
            >
              <ResponsiveContainer width="100%" height={320}>
                <LineChart
                  data={data}
                  margin={{ top: 10, right: 18, left: 0, bottom: 5 }}
                >
                  <CurrencyHistoryChartAxes currency={currency} />
                  <Line
                    type="monotone"
                    dataKey="nominalIncome"
                    name="Nominal income"
                    stroke={NOMINAL_COLOR}
                    strokeWidth={2.5}
                    dot={data.length === 1}
                  />
                  <Line
                    type="monotone"
                    dataKey="adjustedIncome"
                    name="CPIH-adjusted income"
                    stroke={REAL_COLOR}
                    strokeWidth={2.5}
                    strokeDasharray="5 4"
                    dot={adjustedCount === 1}
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartContainer>
            <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
              <LegendItem color={NOMINAL_COLOR}>Nominal income</LegendItem>
              <LegendItem color={REAL_COLOR}>CPIH-adjusted income</LegendItem>
            </div>
            <details className="group text-xs text-muted-foreground">
              <summary className="cursor-pointer">View income data</summary>
              <div className="mt-2 hidden max-h-80 overflow-auto rounded-md border group-open:block">
                <table className="w-full text-left">
                  <caption>Nominal and CPIH-adjusted income by period</caption>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Nominal income</th>
                      <th>CPIH-adjusted income</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((point) => (
                      <tr key={point.date}>
                        <td>{point.date}</td>
                        <td>{formatCurrency(point.nominalIncome, currency)}</td>
                        <td>
                          {point.adjustedIncome == null
                            ? "Unavailable"
                            : formatCurrency(point.adjustedIncome, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
        <InflationDatasetDisclosure
          release={release}
          referenceDate={referenceDate}
          currency={currency}
        />
        {data.length > 0 && unavailableCount > 0 && (
          <p role="status" className="text-sm text-muted-foreground">
            {unavailableCount === data.length
              ? "CPIH adjustment is unavailable for these income records."
              : `${unavailableCount} income ${unavailableCount === 1 ? "record is" : "records are"} outside the CPIH dataset coverage and remain nominal only.`}
          </p>
        )}
        {data.length > 0 && hasOtherCurrencyHistory && (
          <p role="status" className="text-sm text-muted-foreground">
            {excludedCurrencyCount} income{" "}
            {excludedCurrencyCount === 1 ? "record uses" : "records use"} a
            different currency and {excludedCurrencyCount === 1 ? "is" : "are"}{" "}
            not shown.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
