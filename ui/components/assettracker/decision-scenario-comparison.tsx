"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  CashFlowDecision,
  DecisionScenarioComparison as Comparison,
  EmergencyFundPlan,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";
import { DecisionScenarioResults } from "./decision-scenario-results";

const HORIZON_OPTIONS = [1, 3, 5, 10] as const;
const NO_RESERVE_PREFERENCE = "none";

function DecisionChoice({
  decision,
  checked,
  caseName,
  onChange,
}: Readonly<{
  decision: CashFlowDecision;
  checked: boolean;
  caseName: string;
  onChange(checked: boolean): void;
}>) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
      <input
        type="checkbox"
        className="mt-1 size-4"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{decision.name}</span>
          <Badge variant="outline">{caseName}</Badge>
        </span>
        <span className="mt-1 block text-xs text-muted-foreground">
          {decision.importance ?? "No importance note"}
          {decision.confidence == null
            ? " · Confidence not entered"
            : ` · ${(decision.confidence * 100).toFixed(0)}% confidence`}
          {` · ${decision.reversibility.replace("-", " ")}`}
        </span>
      </span>
    </label>
  );
}

function HorizonSelect({
  horizonYears,
  setHorizonYears,
}: Readonly<{
  horizonYears: number;
  setHorizonYears(value: number): void;
}>) {
  return (
    <Select
      value={String(horizonYears)}
      onValueChange={(value) => setHorizonYears(Number(value))}
    >
      <SelectTrigger
        aria-label="Decision comparison horizon"
        size="sm"
        className="w-28"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {HORIZON_OPTIONS.map((years) => (
          <SelectItem key={years} value={String(years)}>
            {years} {years === 1 ? "year" : "years"}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ReserveSelect({
  reserveMonths,
  activeReservePlan,
  setReserveMonths,
}: Readonly<{
  reserveMonths: number | null;
  activeReservePlan?: EmergencyFundPlan;
  setReserveMonths(value: number | null): void;
}>) {
  return (
    <Select
      value={
        reserveMonths == null ? NO_RESERVE_PREFERENCE : String(reserveMonths)
      }
      onValueChange={(value) =>
        setReserveMonths(value === NO_RESERVE_PREFERENCE ? null : Number(value))
      }
    >
      <SelectTrigger
        aria-label="Reserve warning preference"
        size="sm"
        className="w-40"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_RESERVE_PREFERENCE}>
          No reserve warning
        </SelectItem>
        {(activeReservePlan?.coverageMonths ?? []).map((months) => (
          <SelectItem key={months} value={String(months)}>
            Warn below {months} months
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ComparisonControls(
  props: Readonly<{
    horizonYears: number;
    reserveMonths: number | null;
    activeReservePlan?: EmergencyFundPlan;
    setHorizonYears(value: number): void;
    setReserveMonths(value: number | null): void;
  }>,
) {
  return (
    <div className="flex flex-wrap gap-2">
      <HorizonSelect {...props} />
      <ReserveSelect {...props} />
    </div>
  );
}

function useDecisionComparisonModel() {
  const tracker = useAssetTracker();
  const decisions = useMemo(
    () =>
      tracker.futureCashFlows.filter(
        (record): record is CashFlowDecision => record.kind === "decision",
      ),
    [tracker.futureCashFlows],
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    const selected = decisions
      .filter(({ status }) => status === "selected")
      .map(({ id }) => id);
    return selected.length > 0
      ? selected
      : decisions.slice(0, 1).map(({ id }) => id);
  });
  const [horizonYears, setHorizonYears] = useState(5);
  const activeReservePlan = tracker.emergencyFundPlans.find(
    ({ status }) => status === "active",
  );
  const [reserveMonths, setReserveMonths] = useState<number | null>(
    activeReservePlan?.coverageMonths[0] ?? null,
  );
  const comparison = useMemo<Comparison>(
    () =>
      tracker.compareDecisionScenario({
        decisionIds: selectedIds,
        horizonMonths: horizonYears * 12,
        reserveMonths,
      }),
    [horizonYears, reserveMonths, selectedIds, tracker.compareDecisionScenario],
  );
  const caseNames = new Map(
    tracker.planningCases.map(({ id, name }) => [id, name]),
  );
  const setDecision = (id: string, checked: boolean) =>
    setSelectedIds((current) =>
      checked
        ? Array.from(new Set([...current, id]))
        : current.filter((candidate) => candidate !== id),
    );
  return {
    ...tracker,
    activeReservePlan,
    caseNames,
    comparison,
    decisions,
    horizonYears,
    reserveMonths,
    selectedIds,
    setDecision,
    setHorizonYears,
    setReserveMonths,
  };
}

function ComparisonMessages({
  comparison,
  decisions,
}: Readonly<{ comparison: Comparison; decisions: CashFlowDecision[] }>) {
  const dependencies = comparison.includedDependencyIds.map(
    (id) => decisions.find((decision) => decision.id === id)?.name ?? id,
  );
  return (
    <>
      {dependencies.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Included dependencies: {dependencies.join(", ")}.
        </p>
      )}
      {comparison.warnings.map((warning) => (
        <p
          key={warning}
          className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs"
        >
          {warning}
        </p>
      ))}
    </>
  );
}

export function DecisionScenarioComparison() {
  const model = useDecisionComparisonModel();
  if (model.decisions.length === 0) return null;
  return (
    <section
      className="space-y-4 border-t pt-5"
      aria-labelledby="decision-comparison-heading"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 id="decision-comparison-heading" className="text-sm font-medium">
            Compare decisions with committed-only plans
          </h3>
          <p className="text-xs text-muted-foreground">
            Commitments form the baseline. Selected choices and their
            dependencies are overlays, not affordability scores.
          </p>
        </div>
        <ComparisonControls {...model} />
      </div>
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="mb-2 text-xs font-medium">Decision overlays</legend>
        {model.decisions.map((decision) => (
          <DecisionChoice
            key={decision.id}
            decision={decision}
            checked={model.selectedIds.includes(decision.id)}
            caseName={
              decision.planningCaseId == null
                ? "No planning case"
                : (model.caseNames.get(decision.planningCaseId) ??
                  decision.planningCaseId)
            }
            onChange={(checked) => model.setDecision(decision.id, checked)}
          />
        ))}
      </fieldset>
      <ComparisonMessages
        comparison={model.comparison}
        decisions={model.decisions}
      />
      {model.selectedIds.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          Select one or more decisions to compare them with active commitments.
        </p>
      ) : (
        <DecisionScenarioResults
          comparison={model.comparison}
          currency={model.baseCurrency}
          reserveMonths={model.reserveMonths}
        />
      )}
    </section>
  );
}
