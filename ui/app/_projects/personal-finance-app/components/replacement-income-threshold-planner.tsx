"use client";

import type {
  JobMoveScenario,
  ReplacementIncomeThreshold,
} from "@/app/_projects/personal-finance-app/domain";
import {
  formatAnnualRate,
  formatCurrency,
} from "@/app/_projects/personal-finance-app/lib";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type GoalKind,
  type ReplacementIncomeThresholdPlannerModel,
  useReplacementIncomeThresholdPlanner,
} from "./replacement-income-threshold-planner-model";

type Currency = Parameters<typeof formatCurrency>[1];
const START_DATE_SLOTS = ["first", "second", "third"] as const;

function calculationLabel(result: ReplacementIncomeThreshold): string {
  if (result.calculation?.kind === "tax-derived") {
    return `${result.calculation.taxYear}, rules ${result.calculation.ruleDatasetVersion}`;
  }
  if (result.calculation?.kind === "manual-override") {
    return `Take-home only: ${result.calculation.reasons.join(" ")}`;
  }
  return "Unavailable";
}

function AssumptionSummary({
  result,
  currency,
}: Readonly<{ result: ReplacementIncomeThreshold; currency: Currency }>) {
  const { assumptions } = result;
  const redundancy =
    assumptions.redundancyReceipts.length === 0
      ? "none"
      : assumptions.redundancyReceipts
          .map(
            (receipt) =>
              `${receipt.name} ${receipt.amount} ${receipt.currency} on ${receipt.date}`,
          )
          .join(", ");
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer">Assumptions</summary>
      <p className="mt-2">
        Projection {assumptions.projectionStartDate}; job starts{" "}
        {result.startDate}
        after {assumptions.unemploymentGapMonths} months; redundancy{" "}
        {redundancy}; spending{" "}
        {formatCurrency(assumptions.annualSpending, currency)}; other income{" "}
        {assumptions.otherIncome.join(", ") || "none"}; return{" "}
        {formatAnnualRate(assumptions.annualReturn)}; inflation{" "}
        {formatAnnualRate(assumptions.annualInflation)}; fees{" "}
        {formatAnnualRate(assumptions.annualFeeRate)}; pension rates employee{" "}
        {formatAnnualRate(assumptions.employeePensionRate)} and employer{" "}
        {formatAnnualRate(assumptions.employerPensionRate)}; horizon{" "}
        {assumptions.horizonMonths} months.
      </p>
    </details>
  );
}

function BoundarySummary({
  result,
}: Readonly<{ result: ReplacementIncomeThreshold }>) {
  if (result.status !== "solved") return null;
  return (
    <p className="text-xs text-muted-foreground">
      Below {result.boundaries.below?.satisfiesGoal ? "passes" : "fails"}; at{" "}
      {result.boundaries.at?.satisfiesGoal ? "passes" : "fails"}; above{" "}
      {result.boundaries.above?.satisfiesGoal ? "passes" : "fails"}.
    </p>
  );
}

function ThresholdResultRow({
  result,
  currency,
}: Readonly<{ result: ReplacementIncomeThreshold; currency: Currency }>) {
  const takeHome =
    result.annualTakeHomeIncome == null
      ? result.status
      : formatCurrency(result.annualTakeHomeIncome, currency);
  const gross =
    result.grossAnnualSalary == null
      ? "Not converted"
      : formatCurrency(result.grossAnnualSalary, currency);
  const pension =
    result.annualEmployeePensionContribution == null
      ? "Unavailable"
      : `${formatCurrency(result.annualEmployeePensionContribution, currency)} employee + ${formatCurrency(result.annualEmployerPensionContribution ?? 0, currency)} employer`;
  return (
    <tr className="border-b align-top last:border-0">
      <td className="p-2">{result.startDate}</td>
      <td className="p-2">
        <p>{result.assumption.name}</p>
        <AssumptionSummary result={result} currency={currency} />
      </td>
      <td className="p-2">
        {takeHome}
        <BoundarySummary result={result} />
        <p className="max-w-xs text-xs text-muted-foreground">
          {result.explanation}
        </p>
      </td>
      <td className="p-2">
        {gross}
        <p className="text-xs text-muted-foreground">
          {calculationLabel(result)}
        </p>
      </td>
      <td className="p-2">{pension}</td>
    </tr>
  );
}

function ThresholdResults({
  results,
  currency,
}: Readonly<{ results: ReplacementIncomeThreshold[]; currency: Currency }>) {
  return (
    <div className="overflow-x-auto">
      <table
        className="w-full min-w-3xl text-left text-sm"
        aria-label="Replacement income thresholds by job start and assumption set"
      >
        <thead>
          <tr className="border-b">
            <th className="p-2 font-medium">Job starts</th>
            <th className="p-2 font-medium">Assumptions</th>
            <th className="p-2 font-medium">Minimum take-home</th>
            <th className="p-2 font-medium">Gross salary</th>
            <th className="p-2 font-medium">Pension</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result) => (
            <ThresholdResultRow
              key={`${result.startDate}:${result.assumption.id}`}
              result={result}
              currency={currency}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GoalFields({
  model,
}: Readonly<{ model: ReplacementIncomeThresholdPlannerModel }>) {
  return (
    <>
      <label className="grid gap-1 text-sm" htmlFor="replacement-income-goal">
        <span>Goal</span>
        <select
          className="h-9 rounded-md border border-input bg-background px-3"
          id="replacement-income-goal"
          value={model.goalKind}
          onChange={(event) =>
            model.setGoalKind(event.target.value as GoalKind)
          }
        >
          <option value="avoid-cash-depletion">Avoid cash depletion</option>
          <option value="preserve-cash-reserve">Preserve cash reserve</option>
          <option value="avoid-accessible-capital-exhaustion">
            Avoid accessible-capital exhaustion
          </option>
          <option value="reach-financial-independence">
            Reach FI by target date
          </option>
        </select>
      </label>
      {model.goalKind === "preserve-cash-reserve" ? (
        <label
          className="grid gap-1 text-sm"
          htmlFor="replacement-income-reserve"
        >
          Cash reserve
          <Input
            id="replacement-income-reserve"
            min={0}
            type="number"
            value={model.reserve}
            onChange={(event) => model.setReserve(Number(event.target.value))}
          />
        </label>
      ) : null}
      {model.goalKind === "reach-financial-independence" ? (
        <label
          className="grid gap-1 text-sm"
          htmlFor="replacement-income-target-date"
        >
          FI target date
          <Input
            id="replacement-income-target-date"
            type="date"
            value={model.targetDate}
            onChange={(event) => model.setTargetDate(event.target.value)}
          />
        </label>
      ) : null}
    </>
  );
}

function TimingFields({
  model,
}: Readonly<{ model: ReplacementIncomeThresholdPlannerModel }>) {
  return (
    <>
      <label
        className="grid gap-1 text-sm"
        htmlFor="replacement-income-horizon"
      >
        Forecast horizon, years
        <Input
          id="replacement-income-horizon"
          min={1}
          max={30}
          type="number"
          value={model.horizonYears}
          onChange={(event) =>
            model.setHorizonYears(Number(event.target.value))
          }
        />
      </label>
      {START_DATE_SLOTS.map((slot, index) => (
        <label
          className="grid gap-1 text-sm"
          htmlFor={`replacement-income-start-${index}`}
          key={slot}
        >
          Job start {index + 1}
          <Input
            id={`replacement-income-start-${index}`}
            type="date"
            value={model.startDates[index] ?? ""}
            onChange={(event) =>
              model.updateStartDate(index, event.target.value)
            }
          />
        </label>
      ))}
    </>
  );
}

function PlannerInputs({
  model,
}: Readonly<{ model: ReplacementIncomeThresholdPlannerModel }>) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <GoalFields model={model} />
        <TimingFields model={model} />
      </div>
      <Button type="button" onClick={model.calculate}>
        Calculate thresholds
      </Button>
    </>
  );
}

export function ReplacementIncomeThresholdPlanner({
  scenario,
}: Readonly<{ scenario: JobMoveScenario }>) {
  const model = useReplacementIncomeThresholdPlanner(scenario);
  return (
    <section
      className="space-y-4 rounded-lg border p-4"
      aria-labelledby="replacement-income-heading"
    >
      <div>
        <h3 className="font-semibold" id="replacement-income-heading">
          Replacement income threshold
        </h3>
        <p className="text-sm text-muted-foreground">
          Solve the saved job path instead of guessing salaries. Each row reruns
          the ordinary forecast at the boundary.
        </p>
      </div>
      <PlannerInputs model={model} />
      {model.error != null ? (
        <p className="text-sm text-destructive" role="alert">
          {model.error}
        </p>
      ) : null}
      {model.results != null ? (
        <ThresholdResults results={model.results} currency={model.currency} />
      ) : null}
    </section>
  );
}
