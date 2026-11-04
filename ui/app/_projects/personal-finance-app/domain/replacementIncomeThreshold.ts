import {
  addYears,
  differenceInCalendarMonths,
  format,
  isValid,
  parseISO,
} from "date-fns";
import { isLiability } from "./account";
import type { AssetTrackerRepository } from "./assetTrackerRepository";
import type { EmergencyFundAnalysis } from "./emergencyFund";
import {
  calculateJobMoveCompensation,
  compareJobMoveScenario,
  type JobMoveCompensation,
  type JobMoveScenario,
  type JobMoveScenarioComparison,
} from "./jobMoveScenario";

export type ReplacementIncomeGoal =
  | { kind: "avoid-cash-depletion" }
  | { kind: "preserve-cash-reserve"; amount: number }
  | { kind: "avoid-accessible-capital-exhaustion" }
  | { kind: "reach-financial-independence"; targetDate: string };

export type ReplacementIncomeAssumptionSet = {
  id: string;
  name: string;
  annualReturn: number;
  annualInflation: number;
  annualSpending: number;
  annualFeeRate: number;
  earlyReturnShock: number;
  earlyReturnShockYears: number;
};

export type ReplacementIncomeBoundary = {
  candidateAnnualIncome: number;
  annualTakeHomeIncome: number;
  satisfiesGoal: boolean;
};

export type ReplacementIncomeThreshold = {
  startDate: string;
  assumption: ReplacementIncomeAssumptionSet;
  goal: ReplacementIncomeGoal;
  status: "solved" | "impossible" | "non-monotonic";
  explanation: string;
  annualTakeHomeIncome: number | null;
  grossAnnualSalary: number | null;
  annualEmployeePensionContribution: number | null;
  annualEmployerPensionContribution: number | null;
  calculation: JobMoveCompensation["calculation"] | null;
  feasibleTakeHomeRange: { minimum: number; maximum: number } | null;
  boundaries: {
    below: ReplacementIncomeBoundary | null;
    at: ReplacementIncomeBoundary | null;
    above: ReplacementIncomeBoundary | null;
  };
  assumptions: {
    projectionStartDate: string;
    roleStartDate: string;
    unemploymentGapMonths: number;
    redundancyReceipts: Array<{
      name: string;
      date: string;
      amount: number;
      currency: string;
    }>;
    annualSpending: number;
    otherIncome: string[];
    annualReturn: number;
    annualInflation: number;
    annualFeeRate: number;
    earlyReturnShock: number;
    earlyReturnShockYears: number;
    employeePensionRate: number;
    employerPensionRate: number;
    horizonMonths: number;
  };
};

export type ReplacementIncomeThresholdInput = {
  repository: AssetTrackerRepository;
  scenario: JobMoveScenario;
  startDate: string;
  roleStartDates: readonly string[];
  assumptionSets: readonly ReplacementIncomeAssumptionSet[];
  goal: ReplacementIncomeGoal;
  horizonMonths: number;
  annualCurrentExpenditure: number | null;
  financialIndependenceTarget: number | null;
  baselineCompensation: {
    annualTakeHomeIncome: number;
    annualEmployeePensionContribution: number;
    annualEmployerPensionContribution: number;
  } | null;
  emergencyFundAnalysis: EmergencyFundAnalysis | null;
  maximumAnnualIncome?: number;
};

export type ReplacementIncomeThresholdRequest = Pick<
  ReplacementIncomeThresholdInput,
  | "roleStartDates"
  | "assumptionSets"
  | "goal"
  | "horizonMonths"
  | "maximumAnnualIncome"
> & { scenarioId: string };

type Evaluation = {
  candidateAnnualIncome: number;
  compensation: JobMoveCompensation;
  comparison: JobMoveScenarioComparison;
  satisfiesGoal: boolean;
};

const BALANCE_TOLERANCE = 0.5;

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && isValid(parseISO(value));
}

function isoDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function validateStartDates(input: ReplacementIncomeThresholdInput): void {
  if (input.roleStartDates.length === 0) {
    throw new Error("Choose at least one prospective job start date");
  }
  for (const startDate of input.roleStartDates) {
    if (!isIsoDate(startDate)) {
      throw new Error("Job start dates must use YYYY-MM-DD");
    }
    if (startDate < input.scenario.transitionDate) {
      throw new Error("A replacement role cannot start before income stops");
    }
  }
}

function validateGoal(goal: ReplacementIncomeGoal): void {
  if (
    goal.kind === "preserve-cash-reserve" &&
    (!Number.isFinite(goal.amount) || goal.amount < 0)
  ) {
    throw new Error("The cash reserve must be a non-negative amount");
  }
  if (
    goal.kind === "reach-financial-independence" &&
    !isIsoDate(goal.targetDate)
  ) {
    throw new Error("The retirement target date must use YYYY-MM-DD");
  }
}

function validateAssumption(assumption: ReplacementIncomeAssumptionSet): void {
  if (assumption.name.trim() === "") {
    throw new Error("Replacement-income assumption sets need names");
  }
  if (
    assumption.annualReturn <= -1 ||
    assumption.annualInflation <= -1 ||
    assumption.annualFeeRate < 0 ||
    assumption.annualFeeRate >= 1 ||
    assumption.annualSpending < 0 ||
    assumption.earlyReturnShockYears < 0 ||
    !Number.isInteger(assumption.earlyReturnShockYears)
  ) {
    throw new Error(`Invalid assumptions for ${assumption.name}`);
  }
}

function validateInput(input: ReplacementIncomeThresholdInput): void {
  if (input.scenario.employmentStatus !== "employed") {
    throw new Error("Replacement income needs an employed job-move scenario");
  }
  validateStartDates(input);
  if (input.assumptionSets.length === 0) {
    throw new Error("Choose at least one named assumption set");
  }
  if (
    new Set(input.assumptionSets.map(({ id }) => id)).size !==
    input.assumptionSets.length
  ) {
    throw new Error("Replacement-income assumption set IDs must be unique");
  }
  if (!Number.isInteger(input.horizonMonths) || input.horizonMonths < 1) {
    throw new Error("The threshold horizon must be at least one whole month");
  }
  validateGoal(input.goal);
  for (const assumption of input.assumptionSets) {
    validateAssumption(assumption);
  }
}

function repositoryForAssumption(
  repository: AssetTrackerRepository,
  assumption: ReplacementIncomeAssumptionSet,
  startDate: string,
): AssetTrackerRepository {
  const steadyReturn = assumption.annualReturn - assumption.annualFeeRate;
  const shockEndDate = isoDate(
    addYears(parseISO(startDate), assumption.earlyReturnShockYears),
  );
  return {
    ...repository,
    accounts: new Map(
      [...repository.accounts].map(([id, account]) => {
        if (
          isLiability(account.assetType) ||
          account.assetType === "property"
        ) {
          return [id, account];
        }
        return [
          id,
          {
            ...account,
            expectedAnnualReturn: steadyReturn + assumption.earlyReturnShock,
            expectedReturnChanges:
              assumption.earlyReturnShockYears === 0
                ? []
                : [{ date: shockEndDate, rate: steadyReturn }],
          },
        ];
      }),
    ),
    settings: {
      ...repository.settings,
      expectedAnnualInflation: assumption.annualInflation,
    },
  };
}

function supportsGrossConversion(scenario: JobMoveScenario): boolean {
  try {
    return (
      calculateJobMoveCompensation({
        ...scenario,
        annualTakeHomeOverride: undefined,
      }).calculation.kind === "tax-derived"
    );
  } catch {
    return false;
  }
}

function candidateScenario(input: {
  scenario: JobMoveScenario;
  roleStartDate: string;
  annualSpending: number;
  candidateAnnualIncome: number;
  useGross: boolean;
}): JobMoveScenario {
  if (input.useGross) {
    return {
      ...input.scenario,
      roleStartDate: input.roleStartDate,
      baseGrossPay: Math.max(input.candidateAnnualIncome, 1),
      variableGrossPay: 0,
      annualTakeHomeOverride: undefined,
      annualSpendingOverride: input.annualSpending,
    };
  }
  return {
    ...input.scenario,
    roleStartDate: input.roleStartDate,
    annualTakeHomeOverride: input.candidateAnnualIncome,
    annualSpendingOverride: input.annualSpending,
  };
}

export function replacementIncomeGoalSatisfied(
  comparison: JobMoveScenarioComparison,
  goal: ReplacementIncomeGoal,
): boolean {
  if (comparison.timeline.length === 0) return false;
  const scenario = comparison.timeline.map((point) => point.scenario);
  if (scenario.some((point) => point.spendingDrawdown.unfunded > 0.005)) {
    return false;
  }
  switch (goal.kind) {
    case "avoid-cash-depletion":
      return scenario.every((point) => point.cashBalance > BALANCE_TOLERANCE);
    case "preserve-cash-reserve":
      return scenario.every(
        (point) => point.cashBalance + BALANCE_TOLERANCE >= goal.amount,
      );
    case "avoid-accessible-capital-exhaustion":
      return scenario.every(
        (point) => point.accessibleRetirementCapital > BALANCE_TOLERANCE,
      );
    case "reach-financial-independence": {
      const reached = comparison.financialIndependenceDates.scenario;
      return reached != null && reached <= goal.targetDate;
    }
  }
}

function evaluate(input: {
  repository: AssetTrackerRepository;
  base: ReplacementIncomeThresholdInput;
  assumption: ReplacementIncomeAssumptionSet;
  roleStartDate: string;
  candidateAnnualIncome: number;
  useGross: boolean;
}): Evaluation {
  const scenario = candidateScenario({
    scenario: input.base.scenario,
    roleStartDate: input.roleStartDate,
    annualSpending: input.assumption.annualSpending,
    candidateAnnualIncome: input.candidateAnnualIncome,
    useGross: input.useGross,
  });
  const compensation = calculateJobMoveCompensation(scenario);
  const comparison = compareJobMoveScenario({
    repository: input.repository,
    scenario,
    horizonMonths: input.base.horizonMonths,
    startDate: input.base.startDate,
    annualExpenditure: input.assumption.annualSpending,
    annualCurrentExpenditure:
      input.base.annualCurrentExpenditure ?? input.assumption.annualSpending,
    financialIndependenceTarget: input.base.financialIndependenceTarget,
    baselineCompensation: input.base.baselineCompensation,
    emergencyFundAnalysis: input.base.emergencyFundAnalysis,
  });
  return {
    candidateAnnualIncome: input.candidateAnnualIncome,
    compensation,
    comparison,
    satisfiesGoal: replacementIncomeGoalSatisfied(comparison, input.base.goal),
  };
}

function boundary(evaluation: Evaluation): ReplacementIncomeBoundary {
  return {
    candidateAnnualIncome: evaluation.candidateAnnualIncome,
    annualTakeHomeIncome: evaluation.compensation.annualTakeHomePay,
    satisfiesGoal: evaluation.satisfiesGoal,
  };
}

function redundancyReceipts(
  repository: AssetTrackerRepository,
  scenario: JobMoveScenario,
) {
  const included = new Set(scenario.includedFutureCashFlowIds ?? []);
  return repository.futureCashFlows.flatMap((record) => {
    if (!included.has(record.id)) return [];
    return record.stages.flatMap((stage) =>
      stage.direction === "receipt"
        ? [
            {
              name: record.name,
              date: "dueDate" in stage ? stage.dueDate : stage.expectedDate,
              amount: "amount" in stage ? stage.amount : stage.expectedAmount,
              currency: record.currency,
            },
          ]
        : [],
    );
  });
}

function otherIncome(
  repository: AssetTrackerRepository,
  scenario: JobMoveScenario,
): string[] {
  const replaced = new Set(scenario.replacedRecurringFlowIds);
  return repository.recurringFlows.flatMap((flow) =>
    !replaced.has(flow.id) &&
    flow.fromAccountId == null &&
    flow.toAccountId != null
      ? [flow.name]
      : [],
  );
}

function assumptions(input: {
  base: ReplacementIncomeThresholdInput;
  repository: AssetTrackerRepository;
  roleStartDate: string;
  assumption: ReplacementIncomeAssumptionSet;
}): ReplacementIncomeThreshold["assumptions"] {
  return {
    projectionStartDate: input.base.startDate,
    roleStartDate: input.roleStartDate,
    unemploymentGapMonths: Math.max(
      differenceInCalendarMonths(
        parseISO(input.roleStartDate),
        parseISO(input.base.scenario.transitionDate),
      ),
      0,
    ),
    redundancyReceipts: redundancyReceipts(
      input.repository,
      input.base.scenario,
    ),
    annualSpending: input.assumption.annualSpending,
    otherIncome: otherIncome(input.repository, input.base.scenario),
    annualReturn: input.assumption.annualReturn,
    annualInflation: input.assumption.annualInflation,
    annualFeeRate: input.assumption.annualFeeRate,
    earlyReturnShock: input.assumption.earlyReturnShock,
    earlyReturnShockYears: input.assumption.earlyReturnShockYears,
    employeePensionRate: input.base.scenario.employeePensionRate,
    employerPensionRate: input.base.scenario.employerPensionRate,
    horizonMonths: input.base.horizonMonths,
  };
}

function unsolved(input: {
  base: ReplacementIncomeThresholdInput;
  repository: AssetTrackerRepository;
  roleStartDate: string;
  assumption: ReplacementIncomeAssumptionSet;
  status: "impossible" | "non-monotonic";
  explanation: string;
}): ReplacementIncomeThreshold {
  return {
    startDate: input.roleStartDate,
    assumption: input.assumption,
    goal: input.base.goal,
    status: input.status,
    explanation: input.explanation,
    annualTakeHomeIncome: null,
    grossAnnualSalary: null,
    annualEmployeePensionContribution: null,
    annualEmployerPensionContribution: null,
    calculation: null,
    feasibleTakeHomeRange: null,
    boundaries: { below: null, at: null, above: null },
    assumptions: assumptions(input),
  };
}

function missingFinancialIndependenceTarget(input: {
  base: ReplacementIncomeThresholdInput;
  repository: AssetTrackerRepository;
  roleStartDate: string;
  assumption: ReplacementIncomeAssumptionSet;
}): ReplacementIncomeThreshold | null {
  if (
    input.base.goal.kind !== "reach-financial-independence" ||
    input.base.financialIndependenceTarget != null
  ) {
    return null;
  }
  return unsolved({
    ...input,
    status: "impossible",
    explanation:
      "Set a financial-independence target before solving for a retirement date.",
  });
}

function solveOne(input: {
  base: ReplacementIncomeThresholdInput;
  roleStartDate: string;
  assumption: ReplacementIncomeAssumptionSet;
}): ReplacementIncomeThreshold {
  const repository = repositoryForAssumption(
    input.base.repository,
    input.assumption,
    input.base.startDate,
  );
  const missingTarget = missingFinancialIndependenceTarget({
    ...input,
    repository,
  });
  if (missingTarget != null) return missingTarget;
  const useGross = supportsGrossConversion({
    ...input.base.scenario,
    roleStartDate: input.roleStartDate,
  });
  const maximum = Math.floor(input.base.maximumAnnualIncome ?? 1_000_000);
  const run = (candidateAnnualIncome: number) =>
    evaluate({
      repository,
      base: input.base,
      assumption: input.assumption,
      roleStartDate: input.roleStartDate,
      candidateAnnualIncome,
      useGross,
    });
  const samples = Array.from({ length: 11 }, (_, index) =>
    Math.round((maximum * index) / 10),
  ).map(run);
  if (
    samples.some(
      (sample, index) =>
        index > 0 && !sample.satisfiesGoal && samples[index - 1]?.satisfiesGoal,
    )
  ) {
    return unsolved({
      ...input,
      repository,
      status: "non-monotonic",
      explanation:
        "Higher income does not consistently improve this forecast. Pension, tax, or account-access interactions prevent one reliable threshold.",
    });
  }
  const firstPassingSample = samples.find((sample) => sample.satisfiesGoal);
  if (firstPassingSample == null) {
    return unsolved({
      ...input,
      repository,
      status: "impossible",
      explanation: `The goal is not met at the tested maximum annual ${useGross ? "gross salary" : "take-home income"} of ${maximum}. The timing, reserve, or target needs to change.`,
    });
  }
  let low =
    samples[Math.max(samples.indexOf(firstPassingSample) - 1, 0)]
      ?.candidateAnnualIncome ?? 0;
  let high = firstPassingSample.candidateAnnualIncome;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (run(middle).satisfiesGoal) high = middle;
    else low = middle + 1;
  }
  const at = run(low);
  const below = low > 0 ? run(low - 1) : null;
  const above = run(Math.min(low + 1, maximum));
  const maximumEvaluation = samples.at(-1) as Evaluation;
  return {
    startDate: input.roleStartDate,
    assumption: input.assumption,
    goal: input.base.goal,
    status: "solved",
    explanation: useGross
      ? "The app converted the threshold through the reviewed salary and pension rules shown below."
      : "Reviewed tax rules do not cover this offer, so the threshold remains a take-home amount.",
    annualTakeHomeIncome: at.compensation.annualTakeHomePay,
    grossAnnualSalary: useGross ? at.candidateAnnualIncome : null,
    annualEmployeePensionContribution:
      at.compensation.annualEmployeePensionContribution,
    annualEmployerPensionContribution:
      at.compensation.annualEmployerPensionContribution,
    calculation: at.compensation.calculation,
    feasibleTakeHomeRange: {
      minimum: at.compensation.annualTakeHomePay,
      maximum: maximumEvaluation.compensation.annualTakeHomePay,
    },
    boundaries: {
      below: below == null ? null : boundary(below),
      at: boundary(at),
      above: boundary(above),
    },
    assumptions: assumptions({ ...input, repository }),
  };
}

export function solveReplacementIncomeThresholds(
  input: ReplacementIncomeThresholdInput,
): ReplacementIncomeThreshold[] {
  validateInput(input);
  return input.roleStartDates.flatMap((roleStartDate) =>
    input.assumptionSets.map((assumption) =>
      solveOne({ base: input, roleStartDate, assumption }),
    ),
  );
}
