"use client";

import { addDays, format, parseISO } from "date-fns";
import { useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  formatAccountCurrency,
  todayIsoDate,
  upcomingFlowOccurrences,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";

const UPCOMING_DAYS = 30;
const MAX_ROWS = 12;

export function UpcomingFlows() {
  const { accounts, accountDetails, recurringFlows } = useAssetTracker();

  const occurrences = useMemo(() => {
    const from = todayIsoDate();
    const through = format(
      addDays(parseISO(from), UPCOMING_DAYS),
      "yyyy-MM-dd",
    );
    const liabilityBalances = Object.fromEntries(
      accountDetails.map((d) => [d.id, d.latestBalance ?? 0]),
    );
    return upcomingFlowOccurrences(
      recurringFlows,
      from,
      through,
      liabilityBalances,
    );
  }, [recurringFlows, accountDetails]);

  function accountName(id: string | undefined): string {
    if (id == null) return "External";
    return accounts.find((a) => a.id === id)?.name ?? id;
  }

  const shown = occurrences.slice(0, MAX_ROWS);
  const overflow = occurrences.length - shown.length;

  function formatOccurrenceAmount(
    occurrence: (typeof occurrences)[number],
  ): string {
    const sent = formatAccountCurrency(
      Math.round(occurrence.amount * 100) / 100,
      occurrence.flow.currency,
    );
    if (occurrence.flow.conversion == null) return sent;
    const received = formatAccountCurrency(
      occurrence.flow.conversion.received.amount,
      occurrence.flow.conversion.received.currency,
    );
    const fee = occurrence.flow.conversion.fee;
    return fee == null || fee.amount === 0
      ? `${sent} → ${received}`
      : `${sent} → ${received}, ${formatAccountCurrency(fee.amount, fee.currency)} fee`;
  }

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Upcoming</CardTitle>
        <CardDescription>
          Expected flows due in the next {UPCOMING_DAYS} days. Use "Record" on
          an account's flows to turn them into real transfers as they land.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4 sm:px-6">
        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No expected flows in the next {UPCOMING_DAYS} days — add regular
            income or contributions from an account's detail view.
          </p>
        ) : (
          <ul className="min-w-0 divide-y rounded-lg border">
            {shown.map((occurrence) => (
              <li
                key={`${occurrence.flow.id}-${occurrence.date}`}
                className="grid min-w-0 grid-cols-[auto_1fr] gap-x-2 gap-y-1 px-3 py-2 text-sm sm:flex sm:items-center"
              >
                <span className="shrink-0 text-muted-foreground sm:w-24">
                  {occurrence.date}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-medium">{occurrence.flow.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {accountName(occurrence.flow.fromAccountId)} →{" "}
                    {accountName(occurrence.flow.toAccountId)}
                  </p>
                </div>
                <span className="col-span-2 font-mono sm:col-span-1 sm:ml-auto sm:shrink-0">
                  {formatOccurrenceAmount(occurrence)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {overflow > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            +{overflow} more in this period
          </p>
        )}
      </CardContent>
    </Card>
  );
}
