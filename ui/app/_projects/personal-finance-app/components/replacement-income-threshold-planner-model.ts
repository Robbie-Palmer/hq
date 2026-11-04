"use client";

import { addMonths, addYears, format, parseISO } from "date-fns";
import { useState } from "react";
import type {
  JobMoveScenario,
  ReplacementIncomeAssumptionSet,
  ReplacementIncomeGoal,
  ReplacementIncomeThreshold,
} from "@/app/_projects/personal-finance-app/domain";
import { useAssetTracker } from "./asset-tracker-provider";

export type GoalKind = ReplacementIncomeGoal["kind"];

function dateFrom(date: string, months: number): string {
  return format(addMonths(parseISO(date), months), "yyyy-MM-dd");
}

function defaultStartDates(scenario: JobMoveScenario): string[] {
  const first = scenario.roleStartDate ?? scenario.transitionDate;
  return [first, dateFrom(first, 3), dateFrom(first, 6)];
}

function assumptionSets(
  annualSpending: number,
): ReplacementIncomeAssumptionSet[] {
  return [
    {
      id: "conservative",
      name: "Conservative",
      annualReturn: 0.03,
      annualInflation: 0.035,
      annualSpending: annualSpending * 1.1,
      annualFeeRate: 0.0075,
      earlyReturnShock: -0.2,
      earlyReturnShockYears: 1,
    },
    {
      id: "central",
      name: "Central",
      annualReturn: 0.065,
      annualInflation: 0.025,
      annualSpending,
      annualFeeRate: 0.005,
      earlyReturnShock: 0,
      earlyReturnShockYears: 0,
    },
    {
      id: "optimistic",
      name: "Optimistic",
      annualReturn: 0.09,
      annualInflation: 0.02,
      annualSpending: annualSpending * 0.9,
      annualFeeRate: 0.0025,
      earlyReturnShock: 0,
      earlyReturnShockYears: 0,
    },
  ];
}

function thresholdGoal(input: {
  goalKind: GoalKind;
  reserve: number;
  targetDate: string;
}): ReplacementIncomeGoal {
  if (input.goalKind === "preserve-cash-reserve") {
    return { kind: input.goalKind, amount: input.reserve };
  }
  if (input.goalKind === "reach-financial-independence") {
    return { kind: input.goalKind, targetDate: input.targetDate };
  }
  return { kind: input.goalKind };
}

export function useReplacementIncomeThresholdPlanner(
  scenario: JobMoveScenario,
) {
  const tracker = useAssetTracker();
  const initialDates = defaultStartDates(scenario);
  const annualSpending =
    scenario.annualSpendingOverride ??
    tracker.financialIndependence.representativeAnnualExpenditure ??
    36_000;
  const [goalKind, setGoalKind] = useState<GoalKind>("avoid-cash-depletion");
  const [reserve, setReserve] = useState(12_000);
  const [targetDate, setTargetDate] = useState(() =>
    format(addYears(parseISO(initialDates[0] as string), 10), "yyyy-MM-dd"),
  );
  const [startDates, setStartDates] = useState(initialDates);
  const [horizonYears, setHorizonYears] = useState(10);
  const [results, setResults] = useState<ReplacementIncomeThreshold[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const updateStartDate = (index: number, value: string) =>
    setStartDates((current) =>
      current.map((date, candidate) => (candidate === index ? value : date)),
    );
  const calculate = () => {
    setError(null);
    try {
      setResults(
        tracker.solveReplacementIncomeThresholds({
          scenarioId: scenario.id,
          roleStartDates: startDates,
          goal: thresholdGoal({ goalKind, reserve, targetDate }),
          horizonMonths: horizonYears * 12,
          assumptionSets: assumptionSets(annualSpending),
        }),
      );
    } catch (cause) {
      setResults(null);
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not solve the threshold",
      );
    }
  };
  return {
    calculate,
    currency: tracker.baseCurrency,
    error,
    goalKind,
    horizonYears,
    reserve,
    results,
    setGoalKind,
    setHorizonYears,
    setReserve,
    setTargetDate,
    startDates,
    targetDate,
    updateStartDate,
  };
}

export type ReplacementIncomeThresholdPlannerModel = ReturnType<
  typeof useReplacementIncomeThresholdPlanner
>;
