"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
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
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  formatAccountCurrency,
  formatAnnualRate,
  formatAxisTick,
  todayIsoDate,
} from "@/lib/assettracker";
import {
  type AccountDetailView,
  buildProjection,
  effectiveExpectedReturn,
  type RecurringFlow,
  realRate,
} from "@/lib/domain/assettracker";

const EQUITY_MONTHS = 120;

const EQUITY_CONFIG: ChartConfig = {
  equity: { label: "Equity", color: "hsl(100, 50%, 45%)" },
  property: { label: "Property value", color: "hsl(220, 70%, 50%)" },
  mortgage: { label: "Mortgage", color: "hsl(350, 65%, 55%)" },
};

interface EquityProjectionProps {
  property: AccountDetailView;
  mortgages: AccountDetailView[];
  flows: RecurringFlow[];
  liabilityBalances: Record<string, number>;
  inflation: number;
}

/**
 * Projects property value, mortgage balances, and the resulting equity on a
 * shared monthly grid. Because the deposit-plus-repayments stake is smaller
 * than the asset that's growing, equity compounds faster than the property
 * itself — the leverage effect this chart is built to show.
 */
export function EquityProjection({
  property,
  mortgages,
  flows,
  liabilityBalances,
  inflation,
}: Readonly<EquityProjectionProps>) {
  const { points, equityReturn } = useMemo(() => {
    const startDate = todayIsoDate();
    const propertyPoints = buildProjection({
      accountId: property.id,
      schedule: property,
      startDate,
      startBalance: property.latestBalance ?? 0,
      flows,
      months: EQUITY_MONTHS,
      liabilityBalances,
    });
    const mortgageProjections = mortgages.map((mortgage) =>
      buildProjection({
        accountId: mortgage.id,
        schedule: mortgage,
        startDate,
        startBalance: mortgage.latestBalance ?? 0,
        flows,
        months: EQUITY_MONTHS,
        liabilityBalances,
        clampAtZero: true,
      }),
    );
    const combined = propertyPoints.map((point, i) => {
      const mortgageTotal = mortgageProjections.reduce(
        (sum, projection) => sum + (projection[i]?.projected ?? 0),
        0,
      );
      return {
        date: point.date,
        property: point.projected,
        mortgage: mortgageTotal,
        equity: Math.round((point.projected + mortgageTotal) * 100) / 100,
      };
    });
    const first = combined[0];
    const last = combined.at(-1);
    const years = EQUITY_MONTHS / 12;
    const annualised =
      first && last && first.equity > 0 && last.equity > 0
        ? (last.equity / first.equity) ** (1 / years) - 1
        : null;
    return { points: combined, equityReturn: annualised };
  }, [property, mortgages, flows, liabilityBalances]);

  if (points.length < 2) return null;

  const propertyRate = effectiveExpectedReturn(property, todayIsoDate());

  return (
    <div>
      <h3 className="mb-2 text-sm font-medium">
        Equity projection — next {EQUITY_MONTHS / 12} years
      </h3>
      <p className="mb-2 text-xs text-muted-foreground">
        A mortgage is a leveraged position: the whole property compounds while
        only your equity is at stake, and repayments shift value from debt to
        equity.
      </p>
      <ChartContainer config={EQUITY_CONFIG} className="aspect-auto w-full">
        <ResponsiveContainer width="100%" height={200}>
          <LineChart
            data={points}
            margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="date" className="text-xs" hide />
            <YAxis
              className="text-xs"
              width={50}
              tickFormatter={formatAxisTick}
            />
            <ChartTooltip
              content={<ChartTooltipContent />}
              formatter={(value) =>
                formatAccountCurrency(value as number, property.currency)
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Line
              type="monotone"
              dataKey="equity"
              stroke="hsl(100, 50%, 45%)"
              strokeWidth={2.5}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="property"
              stroke="hsl(220, 70%, 50%)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="mortgage"
              stroke="hsl(350, 65%, 55%)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartContainer>
      {equityReturn != null && (
        <p className="mt-2 text-sm">
          Property expected {formatAnnualRate(propertyRate)}/yr, but projected
          equity growth is <strong>{formatAnnualRate(equityReturn)}/yr</strong>{" "}
          ({formatAnnualRate(realRate(equityReturn, inflation))} after
          inflation) — the effect of leverage plus repayments.
        </p>
      )}
    </div>
  );
}
