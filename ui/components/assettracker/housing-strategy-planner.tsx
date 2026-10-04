"use client";

import { format, parseISO } from "date-fns";
import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCurrency } from "@/lib/assettracker";
import {
  compareHousingStrategy,
  type HousingStrategyAssumptions,
  type HousingStrategyKind,
} from "@/lib/domain/assettracker";
import { useAssetTracker } from "./asset-tracker-provider";
import {
  createInitialHousingAssumptions,
  HOUSING_STRATEGIES,
  HousingAssumptionControls,
  type HousingMoneyField,
} from "./housing-strategy-assumptions";
import {
  HousingCalculatedMeasures,
  HousingPositionSummary,
  HousingStrategySummary,
  HousingTimelines,
  HousingWarnings,
} from "./housing-strategy-results";

function warningsFor(
  outcomes: ReturnType<typeof compareHousingStrategy>[],
  moveDate: string,
  asOfDate: string,
): string[] {
  const warnings: string[] = [];
  if (moveDate < asOfDate) {
    warnings.push("Move date cannot be before the household position date.");
  }
  for (const outcome of outcomes) {
    if (outcome.fundingShortfall) {
      warnings.push(
        `${outcome.label} requires more funding than the strategy provides. Check the advance or replacement financing.`,
      );
    }
    if (outcome.annualSavings < 0) {
      warnings.push(
        `${outcome.label} spends more than the modelled annual income.`,
      );
    }
  }
  return warnings;
}

export function HousingStrategyPlanner() {
  const { baseCurrency, housingPlanningPosition } = useAssetTracker();
  const [editedAssumptions, setEditedAssumptions] = useState<
    HousingStrategyAssumptions[] | null
  >(null);
  const [editedMoveDate, setEditedMoveDate] = useState<string | null>(null);
  const [editedAnnualSpending, setEditedAnnualSpending] = useState<
    number | null
  >(null);

  if (housingPlanningPosition == null) return null;

  const position = {
    ...housingPlanningPosition,
    annualNonHousingExpenditure:
      editedAnnualSpending ??
      housingPlanningPosition.annualNonHousingExpenditure,
  };
  const moveDate = editedMoveDate ?? position.asOfDate;
  const assumptions =
    editedAssumptions ??
    HOUSING_STRATEGIES.map((kind) =>
      createInitialHousingAssumptions(kind, position),
    );
  const outcomes = assumptions.map((scenario) =>
    compareHousingStrategy(position, {
      ...scenario,
      moveDate: scenario.kind === "stay" ? position.asOfDate : moveDate,
    }),
  );

  function updateScenario(
    kind: HousingStrategyKind,
    field: HousingMoneyField,
    value: number,
  ) {
    setEditedAssumptions(
      assumptions.map((scenario) =>
        scenario.kind === kind ? { ...scenario, [field]: value } : scenario,
      ),
    );
  }

  const money = (value: number) =>
    formatCurrency(Math.round(value), baseCurrency);
  const fiDate = (date: string | null) =>
    date == null ? ">100 years" : format(parseISO(date), "MMM yyyy");

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Housing strategy comparison</CardTitle>
        <CardDescription>
          Compare staying, renting, downsizing, and equity release.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 px-4 sm:px-6">
        <HousingPositionSummary position={position} money={money} />
        <HousingStrategySummary
          outcomes={outcomes}
          money={money}
          fiDate={fiDate}
        />
        <HousingAssumptionControls
          asOfDate={position.asOfDate}
          assumptions={assumptions}
          annualNonHousingExpenditure={position.annualNonHousingExpenditure}
          moveDate={moveDate}
          onAnnualSpendingChange={setEditedAnnualSpending}
          onMoveDateChange={setEditedMoveDate}
          onScenarioChange={updateScenario}
        />
        <HousingWarnings
          warnings={warningsFor(outcomes, moveDate, position.asOfDate)}
        />
        <HousingCalculatedMeasures
          outcomes={outcomes}
          money={money}
          fiDate={fiDate}
        />
        <HousingTimelines outcomes={outcomes} />
      </CardContent>
    </Card>
  );
}
