"use client";

import { useMemo, useState } from "react";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  formatAccountCurrency,
  formatAxisTick,
  todayIsoDate,
} from "@/lib/assettracker";
import {
  type AccountDetailView,
  addRealValues,
  buildProjection,
  dateTargetReached,
  projectedDateForTarget,
  type RecurringFlow,
} from "@/lib/domain/assettracker";

const HORIZON_OPTIONS = [5, 10, 20, 30, 40] as const;
// Liability payoff is searched well beyond the chart window (mortgages!)
const PAYOFF_SEARCH_MONTHS = 480;

const PROJECTION_CONFIG: ChartConfig = {
  projected: { label: "Projected", color: "hsl(160, 60%, 45%)" },
  real: { label: "Today's money", color: "hsl(160, 30%, 60%)" },
};

interface AccountProjectionProps {
  account: AccountDetailView;
  flows: RecurringFlow[];
  /** Latest balances by account ID, for formula flows paying other accounts */
  liabilityBalances: Record<string, number>;
  inflation: number;
}

function getTargetMessage(
  account: AccountDetailView,
  projection: { date: string; projected: number }[],
  targetAmount: number | null,
  horizonYears: number,
): string | null {
  if (targetAmount == null || !Number.isFinite(targetAmount)) return null;

  const formattedTarget = formatAccountCurrency(targetAmount, account.currency);
  const reachedOn = dateTargetReached(account.snapshots, targetAmount);
  if (reachedOn) {
    return `Already at ${formattedTarget} — reached on ${reachedOn}.`;
  }

  const projectedBy = projectedDateForTarget(projection, targetAmount);
  if (projectedBy) {
    return `Projected to reach ${formattedTarget} by ${projectedBy}.`;
  }
  return `Not projected to reach ${formattedTarget} within ${horizonYears} years.`;
}

function getPayoffMessage(
  account: AccountDetailView,
  isLiabilityBalance: boolean,
  payoffDate: string | null,
): string | null {
  if (!isLiabilityBalance) return null;

  const paidOffOn = dateTargetReached(account.snapshots, 0);
  if (paidOffOn) return `Paid off on ${paidOffOn}.`;
  if (payoffDate) return `Projected to be paid off by ${payoffDate}.`;
  return `Not projected to be paid off within ${PAYOFF_SEARCH_MONTHS / 12} years.`;
}

export function AccountProjection({
  account,
  flows,
  liabilityBalances,
  inflation,
}: Readonly<AccountProjectionProps>) {
  const [target, setTarget] = useState("");
  const [horizonYears, setHorizonYears] = useState(5);

  const isLiabilityBalance =
    account.latestBalance != null && account.latestBalance < 0;

  const { projection, payoffDate } = useMemo(() => {
    if (account.latestBalance == null || account.latestSnapshotDate == null) {
      return { projection: [], payoffDate: null };
    }
    // Project forward from today using the latest known balance, so every
    // projected date is in the future rather than starting at an old snapshot
    const base = {
      accountId: account.id,
      schedule: account,
      startDate: todayIsoDate(),
      startBalance: account.latestBalance,
      flows,
      liabilityBalances,
      clampAtZero: account.latestBalance < 0,
    };
    const points = addRealValues(
      buildProjection({ ...base, months: horizonYears * 12 }),
      inflation,
    );
    const payoff =
      account.latestBalance < 0
        ? projectedDateForTarget(
            buildProjection({ ...base, months: PAYOFF_SEARCH_MONTHS }),
            0,
          )
        : null;
    return { projection: points, payoffDate: payoff };
  }, [account, flows, liabilityBalances, inflation, horizonYears]);

  if (projection.length === 0) return null;

  const targetAmount = target === "" ? null : Number(target);
  const targetMessage = getTargetMessage(
    account,
    projection,
    targetAmount,
    horizonYears,
  );
  const payoffMessage = getPayoffMessage(
    account,
    isLiabilityBalance,
    payoffDate,
  );

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Projection</h3>
        <Select
          value={String(horizonYears)}
          onValueChange={(value) => setHorizonYears(Number(value))}
        >
          <SelectTrigger
            aria-label="Projection horizon"
            size="sm"
            className="w-auto"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {HORIZON_OPTIONS.map((years) => (
              <SelectItem key={years} value={String(years)}>
                {years} years
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        Compounds the latest balance at the expected return and applies the
        expected regular flows below. The lighter line deflates by{" "}
        {(inflation * 100).toFixed(1)}%/yr expected inflation.
      </p>
      <ChartContainer config={PROJECTION_CONFIG} className="aspect-auto w-full">
        <ResponsiveContainer width="100%" height={180}>
          <LineChart
            data={projection}
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
            <ChartLegend content={<ChartLegendContent />} />
            <Line
              type="monotone"
              dataKey="projected"
              stroke="hsl(160, 60%, 45%)"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="real"
              stroke="hsl(160, 30%, 60%)"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartContainer>
      {payoffMessage && <p className="mt-2 text-sm">{payoffMessage}</p>}
      <div className="mt-3 flex items-center gap-2">
        <label
          htmlFor={`projection-target-${account.id}`}
          className="shrink-0 text-sm font-medium"
        >
          Target ({account.currency})
        </label>
        <Input
          id={`projection-target-${account.id}`}
          type="number"
          inputMode="decimal"
          step="0.01"
          placeholder={isLiabilityBalance ? "e.g. 0 (paid off)" : "e.g. 20000"}
          className="max-w-36"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />
      </div>
      {targetMessage && <p className="mt-2 text-sm">{targetMessage}</p>}
    </div>
  );
}
