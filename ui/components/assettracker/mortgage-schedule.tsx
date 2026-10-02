"use client";

import { useMemo } from "react";
import { formatAccountCurrency, todayIsoDate } from "@/lib/assettracker";
import {
  type AccountDetailView,
  advanceMortgageTerms,
  buildMortgageSchedule,
  summarizeMortgageCashFlow,
} from "@/lib/domain/assettracker";

export function MortgageSchedule({
  account,
}: Readonly<{ account: AccountDetailView }>) {
  const schedule = useMemo(() => {
    if (
      account.latestBalance == null ||
      account.latestSnapshotDate == null ||
      account.mortgageTerms == null
    )
      return [];
    return buildMortgageSchedule({
      openingBalance: account.latestBalance,
      initialAnnualRate: account.expectedAnnualReturn,
      rateChanges: account.expectedReturnChanges,
      terms: advanceMortgageTerms(
        account.mortgageTerms,
        account.latestSnapshotDate,
      ),
    });
  }, [account]);
  const summary = summarizeMortgageCashFlow(schedule, todayIsoDate());
  if (summary == null) return null;
  const upcoming = schedule
    .filter((payment) => payment.date >= todayIsoDate())
    .slice(0, 12);

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">Mortgage schedule</h3>
        <p className="text-xs text-muted-foreground">
          The next 12 payments use the latest recorded balance. Principal
          reduces the debt. Interest and fees are economic cost.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 rounded-md border p-3 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">Next 12 payments</p>
          <p className="font-semibold">
            {formatAccountCurrency(
              summary.annualRequiredCashFlow,
              account.currency,
            )}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Projected payoff</p>
          <p className="font-semibold">{summary.payoffDate}</p>
        </div>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[660px] text-xs">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-2 py-2 font-medium">Date</th>
              <th className="px-2 py-2 text-right font-medium">Due</th>
              <th className="px-2 py-2 text-right font-medium">Interest</th>
              <th className="px-2 py-2 text-right font-medium">Principal</th>
              <th className="px-2 py-2 text-right font-medium">Fees</th>
              <th className="px-2 py-2 text-right font-medium">Overpayment</th>
              <th className="px-2 py-2 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {upcoming.map((payment) => (
              <tr key={payment.date} className="border-t">
                <td className="whitespace-nowrap px-2 py-2">{payment.date}</td>
                {[
                  payment.totalDue,
                  payment.interest,
                  payment.principal,
                  payment.fees,
                  payment.overpayment,
                  payment.closingBalance,
                ].map((amount, index) => (
                  <td
                    key={`${payment.date}-${index}`}
                    className="whitespace-nowrap px-2 py-2 text-right"
                  >
                    {formatAccountCurrency(amount, account.currency)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
