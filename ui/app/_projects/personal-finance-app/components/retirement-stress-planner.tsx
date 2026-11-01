"use client";

import { useMemo } from "react";
import {
  activeSpendingBaseline,
  annualOrdinarySpending,
  type Currency,
  type RetirementProjectionRangeComparison,
} from "@/app/_projects/personal-finance-app/domain";
import { formatCurrency } from "@/app/_projects/personal-finance-app/lib";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAssetTracker } from "./asset-tracker-provider";
import { RetirementStressAssumptions } from "./retirement-stress-assumptions";
import {
  calculateRetirementStressComparison,
  useStoredRetirementStressDraft,
} from "./retirement-stress-planner-model";
import { RetirementStressResults } from "./retirement-stress-results";

function defaultAnnualSpending(input: {
  spendingBaselines: ReturnType<typeof useAssetTracker>["spendingBaselines"];
  startDate: string;
}): number {
  const baseline = activeSpendingBaseline(
    input.spendingBaselines ?? [],
    input.startDate,
  );
  return baseline == null ? 36_000 : annualOrdinarySpending(baseline);
}

function HouseholdAccountSummary({
  accountCount,
  balance,
  currency,
}: Readonly<{ accountCount: number; balance: number; currency: Currency }>) {
  return (
    <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
      Uses {accountCount} open household accounts in {currency} with a current
      net balance of {formatCurrency(balance, currency)}. Unvalued records do
      not fund withdrawals.
    </div>
  );
}

function PlannerResults({
  comparison,
  currency,
  error,
}: Readonly<{
  comparison: RetirementProjectionRangeComparison | null;
  currency: Currency;
  error: string | null;
}>) {
  if (error != null) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {error}
      </p>
    );
  }
  return comparison == null ? null : (
    <RetirementStressResults comparison={comparison} currency={currency} />
  );
}

export function RetirementStressPlanner() {
  const tracker = useAssetTracker();
  const currentMonth = `${new Date().toISOString().slice(0, 7)}-01`;
  const [draft, setDraft] = useStoredRetirementStressDraft(
    defaultAnnualSpending({
      spendingBaselines: tracker.spendingBaselines,
      startDate: currentMonth,
    }),
  );
  const accounts = (tracker.accountDetails ?? []).filter(
    (account) => account.isOpen && account.currency === tracker.baseCurrency,
  );
  const { comparison, error } = useMemo(
    () => calculateRetirementStressComparison({ draft, accounts }),
    [accounts, draft],
  );
  const trackedBalance = accounts.reduce(
    (sum, account) => sum + (account.latestBalance ?? 0),
    0,
  );

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>
          <h2>Retirement stress ranges</h2>
        </CardTitle>
        <CardDescription>
          Named deterministic scenarios, saved in this browser. They are
          comparisons, not probability forecasts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <HouseholdAccountSummary
          accountCount={accounts.length}
          balance={trackedBalance}
          currency={tracker.baseCurrency}
        />
        {accounts.length === 0 && (
          <p className="text-sm text-destructive" role="alert">
            No household accounts have a current balance in the selected
            currency. The tables will show unfunded spending only.
          </p>
        )}
        <RetirementStressAssumptions draft={draft} setDraft={setDraft} />
        <PlannerResults
          comparison={comparison}
          currency={tracker.baseCurrency}
          error={error}
        />
        <p className="text-xs text-muted-foreground">
          Flat withdrawal tax rates are explicit scenario inputs. Account-level
          access policies take precedence. Unsupported tax or access cases stay
          restricted instead of being treated as spendable cash.
        </p>
      </CardContent>
    </Card>
  );
}
