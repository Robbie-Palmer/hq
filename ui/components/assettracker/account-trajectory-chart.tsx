"use client";

import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
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
  type AccountDetailView,
  buildAccountHistorySeries,
  formatAccountCurrency,
  formatAxisTick,
  isLiability,
  type NetWorthDataPoint,
  selectAccountExternalFlows,
  type Transfer,
} from "@/lib/domain/assettracker";

const ASSET_COPY = {
  title: "Market value, estimate, and contributed capital",
  description:
    "Market value uses logged valuations. The dashed estimate applies dated contributions and expected return between valuations.",
  config: {
    actual: { label: "Market value", color: "hsl(220, 70%, 50%)" },
    expected: { label: "Estimated value", color: "hsl(220, 10%, 60%)" },
    contributed: {
      label: "Contributed capital",
      color: "hsl(150, 55%, 42%)",
    },
  } satisfies ChartConfig,
};

const CONTRIBUTION_COPY = {
  title: "Contributed capital history",
  description:
    "Cumulative deposits minus withdrawals, independent of changes in market value.",
  config: ASSET_COPY.config,
};

const MARKET_VALUE_COPY = {
  title: "Market value and estimate",
  description:
    "Logged valuations with a dashed estimate between them. Each valuation resets the estimate.",
  config: ASSET_COPY.config,
};

const MARKET_VALUE_ONLY_COPY = {
  ...MARKET_VALUE_COPY,
  description: "The market value logged on each valuation date.",
};

const LIABILITY_COPY = {
  title: "Actual vs interest-only",
  description:
    "Expected compounds the opening balance at the interest rate alone. The gap above it is the effect of your repayments.",
  config: {
    actual: { label: "Actual", color: "hsl(220, 70%, 50%)" },
    expected: { label: "Interest only", color: "hsl(220, 10%, 60%)" },
    contributed: { label: "Net contributed", color: "hsl(150, 55%, 42%)" },
  } satisfies ChartConfig,
};

interface AccountTrajectoryChartProps {
  account: AccountDetailView;
  transfers?: Transfer[];
  netWorthData?: NetWorthDataPoint[];
}

type HistoryView = "both" | "market" | "capital";

export function AccountTrajectoryChart({
  account,
  transfers = [],
  netWorthData = [],
}: Readonly<AccountTrajectoryChartProps>) {
  const [view, setView] = useState<HistoryView>("both");
  const externalFlows = selectAccountExternalFlows(
    account.id,
    transfers,
    account.capitalFlows,
  );
  const trajectory = buildAccountHistorySeries(
    account,
    account.snapshots,
    externalFlows,
    netWorthData.map((point) => point.date),
  );
  if (trajectory.length < 2) return null;

  const hasPerformanceHistory = account.snapshots.length >= 2;
  const hasCapitalHistory = externalFlows.length > 0;
  const liability = isLiability(account.assetType);
  let activeView: HistoryView = "market";
  if (liability) {
    activeView = "both";
  } else if (account.snapshots.length === 0) {
    activeView = "capital";
  } else if (hasCapitalHistory) {
    activeView = view;
  }
  const showMarketValue = activeView !== "capital";
  const showCapital = activeView !== "market";
  let copy = CONTRIBUTION_COPY;
  if (liability) {
    copy = LIABILITY_COPY;
  } else if (activeView === "market") {
    copy = hasPerformanceHistory ? MARKET_VALUE_COPY : MARKET_VALUE_ONLY_COPY;
  } else if (activeView === "both") {
    copy = ASSET_COPY;
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{copy.title}</h3>
        {!liability && hasCapitalHistory && account.snapshots.length > 0 && (
          <fieldset className="flex gap-1">
            <legend className="sr-only">Account history series</legend>
            {(
              [
                ["both", "Both"],
                ["market", "Market value"],
                ["capital", "Contributed"],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                variant={activeView === value ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={activeView === value}
                onClick={() => setView(value)}
              >
                {label}
              </Button>
            ))}
          </fieldset>
        )}
      </div>
      <p className="mb-2 text-xs text-muted-foreground">{copy.description}</p>
      <ChartContainer
        config={copy.config}
        className="aspect-auto w-full"
        role="img"
        aria-label={`${copy.title} for ${account.name}`}
      >
        <ResponsiveContainer width="100%" height={200}>
          <LineChart
            data={trajectory}
            margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="date" className="text-xs" hide />
            <YAxis
              className="text-xs"
              width={45}
              tickFormatter={formatAxisTick}
            />
            <ChartTooltip
              content={<ChartTooltipContent />}
              formatter={(value) =>
                formatAccountCurrency(value as number, account.currency)
              }
            />
            {showMarketValue && (
              <Line
                type="monotone"
                dataKey="actual"
                stroke="hsl(220, 70%, 50%)"
                strokeWidth={2}
                dot={account.snapshots.length < 2}
                connectNulls
              />
            )}
            {showMarketValue && hasPerformanceHistory && (
              <Line
                type="monotone"
                dataKey="expected"
                stroke="hsl(220, 10%, 60%)"
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
                connectNulls
              />
            )}
            {showCapital && hasCapitalHistory && (
              <Line
                type="stepAfter"
                dataKey="contributed"
                stroke="hsl(150, 55%, 42%)"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </ChartContainer>
    </div>
  );
}
