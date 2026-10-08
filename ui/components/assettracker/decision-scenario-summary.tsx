"use client";

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

export function DecisionScenarioSummary() {
  const tracker = useAssetTracker();
  const decisions = tracker.futureCashFlows.filter(
    (record): record is CashFlowDecision => record.kind === "decision",
  );
  const selected = decisions.filter(({ status }) => status === "selected");
  const featured = selected[0] ?? decisions[0];
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
  if (featured == null || horizon == null) return null;

  return (
    <section className="flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 className="text-sm font-medium">Decision outlook</h3>
        <p className="text-sm text-muted-foreground">
          {featured.name} is expected to change the five-year portfolio by{" "}
          <span className="font-medium text-foreground">
            {signedCurrency(
              horizon.expected.totalBalance - horizon.baseline.totalBalance,
              tracker.baseCurrency,
            )}
          </span>{" "}
          and runway by{" "}
          <span className="font-medium text-foreground">
            {signedMonths(
              horizon.expected.totalMonths - horizon.baseline.totalMonths,
            )}
          </span>
          .
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
