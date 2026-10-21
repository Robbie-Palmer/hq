"use client";

import { differenceInCalendarMonths, format, parseISO } from "date-fns";
import Link from "next/link";
import { useMemo } from "react";
import { formatCurrency } from "@/lib/assettracker";
import type { CashFlowDecision } from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";

function signedCurrency(value: number, currency: "GBP" | "USD" | "EUR") {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${formatCurrency(rounded, currency)}`;
}

function signedMonths(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} months`;
}

export function goalDateChange(
  baseline: string | null,
  expected: string | null,
): string {
  if (expected == null) {
    if (baseline == null) {
      return "does not reach the FI target within the comparison horizon.";
    }
    return `moves the FI target beyond the comparison horizon, from ${format(parseISO(baseline), "MMM yyyy")} on the committed-only path.`;
  }
  if (baseline == null) {
    return `reaches the FI target around ${format(parseISO(expected), "MMM yyyy")}, while the committed-only path does not reach it within the comparison horizon.`;
  }
  const months = differenceInCalendarMonths(
    parseISO(expected),
    parseISO(baseline),
  );
  if (months === 0) {
    return `leaves the plan-aware FI date at ${format(parseISO(expected), "MMM yyyy")}.`;
  }
  const direction = months > 0 ? "delay" : "advance";
  return `moves the plan-aware FI date from ${format(parseISO(baseline), "MMM yyyy")} to ${format(parseISO(expected), "MMM yyyy")}, a ${Math.abs(months)}-month ${direction}.`;
}

export function DecisionScenarioSummary() {
  const tracker = useAssetTracker();
  const decisions = tracker.futureCashFlows.filter(
    (record): record is CashFlowDecision => record.kind === "decision",
  );
  const featured =
    decisions.find(({ status }) => status === "selected") ?? decisions[0];
  const comparison = useMemo(
    () =>
      featured == null
        ? null
        : tracker.compareDecisionScenario({
            decisionIds: [featured.id],
            horizonMonths: 60,
            reserveMonths: null,
          }),
    [featured, tracker.compareDecisionScenario],
  );
  const horizon = comparison?.timeline.at(-1);
  if (featured == null || comparison == null || horizon == null) return null;

  return (
    <section className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 className="text-sm font-medium">Decision outlook</h3>
        <p className="text-sm text-muted-foreground">
          {featured.name}{" "}
          {goalDateChange(
            comparison.goalDates.baseline,
            comparison.goalDates.expected,
          )}{" "}
          Its five-year portfolio effect is{" "}
          <span className="font-medium text-foreground">
            {signedCurrency(
              horizon.expected.totalBalance - horizon.baseline.totalBalance,
              tracker.baseCurrency,
            )}
          </span>
          , with a runway effect of{" "}
          <span className="font-medium text-foreground">
            {signedMonths(
              horizon.expected.totalMonths - horizon.baseline.totalMonths,
            )}
          </span>
          {"."}
        </p>
      </div>
      <Link
        href="/assettracker/decisions#scenario-comparison"
        className="shrink-0 text-sm font-medium underline underline-offset-4"
      >
        Compare decisions
      </Link>
    </section>
  );
}
