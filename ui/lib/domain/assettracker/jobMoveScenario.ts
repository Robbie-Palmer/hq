import {
  addDays,
  addMonths,
  differenceInCalendarMonths,
  format,
  parseISO,
} from "date-fns";
import {
  calculateHistoricalSalary,
  type HistoricalSalaryResult,
} from "finance-tax-rules/historical-salary";
import { z } from "zod";
import { AccountIdSchema, accountLiquidity, isLiability } from "./account";
import type { AssetTrackerRepository } from "./assetTrackerRepository";
import { type Currency, CurrencySchema } from "./currency";
import type { EmergencyFundAnalysis } from "./emergencyFund";
import { convertMoneyAtDate } from "./portfolioValuation";
import {
  monthlyReceivedAmount,
  type RecurringFlow,
  recurringFlowReceivedMoney,
} from "./recurringFlow";
import {
  buildRunwayScenarioProjection,
  type RunwayScenarioPoint,
  type SpendingDrawdown,
} from "./runwayForecast";
import { SalaryPayFrequencySchema } from "./salaryHistory";

const PensionMethodSchema = z.enum(["salarySacrifice", "netPay"]);

const JobMoveScenarioBaseSchema = z.object({
  name: z.string().trim().min(1, "Scenario name is required"),
  /** Household member whose employment income changes in this scenario. */
  householdMemberId: z.string().trim().min(1).optional(),
  employmentStatus: z.enum(["employed", "unemployed"]),
  /** First day the current-role forecast no longer applies. */
  transitionDate: z.iso.date(),
  /** First day of the prospective role. The gap is the time between both dates. */
  roleStartDate: z.iso.date().optional(),
  employer: z.string().trim().min(1).optional(),
  baseGrossPay: z.number().nonnegative().default(0),
  variableGrossPay: z.number().nonnegative().default(0),
  payFrequency: SalaryPayFrequencySchema.default("monthly"),
  currency: CurrencySchema,
  jurisdiction: z.string().trim().min(1).default("England"),
  employeePensionRate: z.number().min(0).max(1).default(0),
  employeePensionMethod: PensionMethodSchema.default("salarySacrifice"),
  employerPensionRate: z.number().min(0).max(1).default(0),
  /** Annual take-home pay supplied when reviewed tax rules cannot calculate it. */
  annualTakeHomeOverride: z.number().nonnegative().optional(),
  /** Optional annual spending used only for this hypothetical path. */
  annualSpendingOverride: z.number().positive().optional(),
  destinationAccountId: AccountIdSchema.optional(),
  pensionAccountId: AccountIdSchema.optional(),
  replacedRecurringFlowIds: z
    .array(z.string().min(1))
    .min(1, "Choose at least one current-role cash flow to replace"),
});

function validateJobMoveScenario(
  scenario: z.infer<typeof JobMoveScenarioBaseSchema>,
  context: z.RefinementCtx,
) {
  if (scenario.employmentStatus === "unemployed") return;
  if (scenario.roleStartDate == null) {
    context.addIssue({
      code: "custom",
      path: ["roleStartDate"],
      message: "A prospective role needs a start date",
    });
  } else if (scenario.roleStartDate < scenario.transitionDate) {
    context.addIssue({
      code: "custom",
      path: ["roleStartDate"],
      message: "The new role cannot start before the current role ends",
    });
  }
  if (scenario.employer == null) {
    context.addIssue({
      code: "custom",
      path: ["employer"],
      message: "Employer is required for a prospective role",
    });
  }
  if (scenario.baseGrossPay + scenario.variableGrossPay <= 0) {
    context.addIssue({
      code: "custom",
      path: ["baseGrossPay"],
      message: "Gross compensation must be greater than zero",
    });
  }
  if (scenario.destinationAccountId == null) {
    context.addIssue({
      code: "custom",
      path: ["destinationAccountId"],
      message: "Choose the account that receives take-home pay",
    });
  }
  if (
    scenario.employeePensionRate + scenario.employerPensionRate > 0 &&
    scenario.pensionAccountId == null
  ) {
    context.addIssue({
      code: "custom",
      path: ["pensionAccountId"],
      message: "Choose the account that receives pension contributions",
    });
  }
}

export const JobMoveScenarioInputSchema = JobMoveScenarioBaseSchema.superRefine(
  validateJobMoveScenario,
);
export type JobMoveScenarioInput = z.input<typeof JobMoveScenarioInputSchema>;

export const JobMoveScenarioSchema = z
  .object({
    id: z.string().trim().min(1),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    ...JobMoveScenarioBaseSchema.shape,
  })
  .superRefine(validateJobMoveScenario);
export type JobMoveScenario = z.infer<typeof JobMoveScenarioSchema>;

export const SaveJobMoveScenarioInputSchema = z.object({
  id: z.string().trim().min(1).optional(),
  scenario: JobMoveScenarioInputSchema,
});
export type SaveJobMoveScenarioInput = z.input<
  typeof SaveJobMoveScenarioInputSchema
>;

export const JobMoveScenarioIdInputSchema = z.object({
  id: z.string().trim().min(1),
});
export type JobMoveScenarioIdInput = z.infer<
  typeof JobMoveScenarioIdInputSchema
>;

export type JobMoveCompensation = {
  annualTakeHomePay: number;
  annualEmployeePensionContribution: number;
  annualEmployerPensionContribution: number;
  calculation:
    | {
        kind: "tax-derived";
        calculationVersion: string;
        ruleDatasetVersion: string;
        taxYear: string;
      }
    | { kind: "manual-override"; reasons: string[] }
    | { kind: "not-applicable" };
};

export type JobMoveScenarioComparison = {
  scenarioId: string;
  warnings: string[];
  compensation: {
    baselineAnnualTakeHomePay: number | null;
    baselineAnnualPensionContribution: number | null;
    scenarioAnnualTakeHomePay: number;
    scenarioAnnualEmployeePensionContribution: number;
    scenarioAnnualEmployerPensionContribution: number;
    currency: Currency;
  };
  calculation: JobMoveCompensation["calculation"];
  timeline: Array<{
    date: string;
    baseline: {
      cashBalance: number;
      totalBalance: number;
      liquidBalance: number;
      liquidMonths: number;
      totalMonths: number;
      emergencyFundBalance: number | null;
      emergencyFundMonths: number | null;
      spendingDrawdown: SpendingDrawdown;
    };
    scenario: {
      cashBalance: number;
      totalBalance: number;
      liquidBalance: number;
      liquidMonths: number;
      totalMonths: number;
      emergencyFundBalance: number | null;
      emergencyFundMonths: number | null;
      spendingDrawdown: SpendingDrawdown;
    };
  }>;
  milestones: Array<{
    date: string;
    kind:
      | "income-stops"
      | "new-role-starts"
      | "cash-exhausted"
      | "liquid-assets-exhausted"
      | "unfunded-gap"
      | "fi-target-lost"
      | "fi-target-reached";
    label: string;
    detail: string;
  }>;
  financialIndependenceTarget: number | null;
  financialIndependenceDates: {
    baseline: string | null;
    scenario: string | null;
  };
};

type BaselineCompensation = {
  annualTakeHomeIncome: number;
  annualEmployeePensionContribution: number;
  annualEmployerPensionContribution: number;
} | null;

type CompensationTotals = {
  annualTakeHomePay: number;
  annualEmployeePensionContribution: number;
  annualEmployerPensionContribution: number;
};

function taxYearForDate(date: string): string {
  const year = Number(date.slice(0, 4));
  const startYear = date.slice(5) < "04-06" ? year - 1 : year;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

function taxJurisdiction(value: string) {
  const normalised = value.trim().toLowerCase().replaceAll("&", "and");
  if (normalised === "scotland") return "scotland" as const;
  if (normalised === "wales") return "wales" as const;
  if (
    normalised === "england" ||
    normalised === "northern ireland" ||
    normalised === "england and wales" ||
    normalised === "england and northern ireland"
  ) {
    return "england-and-northern-ireland" as const;
  }
  return null;
}

function reviewedTaxResult(
  scenario: JobMoveScenario,
  annualEmployeePensionContribution: number,
  annualEmployerPensionContribution: number,
): { result: HistoricalSalaryResult | null; reasons: string[] } {
  const reasons: string[] = [];
  if (scenario.currency !== "GBP") {
    reasons.push("Reviewed salary tax calculations currently require GBP.");
  }
  const jurisdiction = taxJurisdiction(scenario.jurisdiction);
  if (jurisdiction == null) {
    reasons.push(
      "The jurisdiction is not covered by the reviewed UK salary rules.",
    );
  }
  if (reasons.length > 0 || jurisdiction == null) {
    return { result: null, reasons };
  }
  const effectiveDate = scenario.roleStartDate ?? scenario.transitionDate;
  const grossPay = scenario.baseGrossPay + scenario.variableGrossPay;
  const hasPension =
    annualEmployeePensionContribution + annualEmployerPensionContribution > 0;
  const employeePensionPence = Math.round(
    annualEmployeePensionContribution * 100,
  );
  const result = calculateHistoricalSalary({
    effectiveDate,
    taxYear: taxYearForDate(effectiveDate),
    jurisdiction,
    contractualGrossPayPence: Math.round(grossPay * 100),
    otherTaxableIncomePence: 0,
    otherDeductionsPence: 0,
    nationalInsuranceCategory: "A",
    isCompanyDirector: false,
    pension: hasPension
      ? {
          method:
            scenario.employeePensionMethod === "salarySacrifice"
              ? "salary-sacrifice"
              : "net-pay",
          employeeGrossContributionPence: employeePensionPence,
          employeeCashDeductionPence:
            scenario.employeePensionMethod === "netPay"
              ? employeePensionPence
              : 0,
          salarySacrificePence:
            scenario.employeePensionMethod === "salarySacrifice"
              ? employeePensionPence
              : 0,
          employerContributionPence: Math.round(
            annualEmployerPensionContribution * 100,
          ),
          providerTaxReliefPence: 0,
        }
      : null,
    assumptions: [
      { id: "job-move-scenario", value: scenario.id },
      {
        id: "variable-gross-pay-pence",
        value: Math.round(scenario.variableGrossPay * 100),
      },
      { id: "national-insurance-category", value: "A" },
      { id: "company-director", value: false },
      { id: "other-taxable-income-pence", value: 0 },
      { id: "other-deductions-pence", value: 0 },
    ],
  });
  return {
    result,
    reasons: result.available ? [] : result.reasons.map(({ detail }) => detail),
  };
}

export function calculateJobMoveCompensation(
  scenario: JobMoveScenario,
): JobMoveCompensation {
  if (scenario.employmentStatus === "unemployed") {
    return {
      annualTakeHomePay: 0,
      annualEmployeePensionContribution: 0,
      annualEmployerPensionContribution: 0,
      calculation: { kind: "not-applicable" },
    };
  }
  const grossPay = scenario.baseGrossPay + scenario.variableGrossPay;
  const annualEmployeePensionContribution =
    grossPay * scenario.employeePensionRate;
  const annualEmployerPensionContribution =
    grossPay * scenario.employerPensionRate;
  const { result, reasons } = reviewedTaxResult(
    scenario,
    annualEmployeePensionContribution,
    annualEmployerPensionContribution,
  );
  if (result?.available) {
    return {
      annualTakeHomePay: result.components.takeHomePayPence / 100,
      annualEmployeePensionContribution:
        result.components.employeePensionContributionPence / 100,
      annualEmployerPensionContribution:
        result.components.employerPensionContributionPence / 100,
      calculation: {
        kind: "tax-derived",
        calculationVersion: result.lineage.calculationVersion,
        ruleDatasetVersion: result.lineage.ruleDatasetVersion,
        taxYear: result.lineage.taxYear,
      },
    };
  }
  if (scenario.annualTakeHomeOverride == null) {
    throw new Error(
      `Enter an annual take-home override. ${reasons.join(" ")}`.trim(),
    );
  }
  return {
    annualTakeHomePay: scenario.annualTakeHomeOverride,
    annualEmployeePensionContribution,
    annualEmployerPensionContribution,
    calculation: { kind: "manual-override", reasons },
  };
}

function dayBefore(date: string): string {
  return format(addDays(parseISO(date), -1), "yyyy-MM-dd");
}

function withoutReplacedFlows(
  flows: readonly RecurringFlow[],
  scenario: JobMoveScenario,
): RecurringFlow[] {
  const replaced = new Set(scenario.replacedRecurringFlowIds);
  return flows.flatMap((flow) => {
    if (!replaced.has(flow.id)) return [flow];
    if (flow.startDate >= scenario.transitionDate) return [];
    const endDate = dayBefore(scenario.transitionDate);
    return [
      {
        ...flow,
        endDate:
          flow.endDate == null || flow.endDate > endDate
            ? endDate
            : flow.endDate,
      },
    ];
  });
}

function scenarioFlows(
  repository: AssetTrackerRepository,
  scenario: JobMoveScenario,
  compensation: JobMoveCompensation,
  valuationDate: string,
): { flows: RecurringFlow[]; warnings: string[] } {
  const flows = withoutReplacedFlows(repository.recurringFlows, scenario);
  if (scenario.employmentStatus === "unemployed")
    return { flows, warnings: [] };
  const startDate = scenario.roleStartDate ?? scenario.transitionDate;
  const convertAnnual = (amount: number) =>
    convertMoneyAtDate(
      repository,
      { amount, currency: scenario.currency },
      valuationDate,
    );
  const gross = convertAnnual(
    scenario.baseGrossPay + scenario.variableGrossPay,
  );
  const takeHome = convertAnnual(compensation.annualTakeHomePay);
  const employeePension = convertAnnual(
    compensation.annualEmployeePensionContribution,
  );
  const employerPension = convertAnnual(
    compensation.annualEmployerPensionContribution,
  );
  if (
    gross == null ||
    takeHome == null ||
    employeePension == null ||
    employerPension == null ||
    scenario.destinationAccountId == null
  ) {
    return {
      flows,
      warnings: [
        `The ${scenario.currency} offer could not be converted to ${repository.settings.baseCurrency} from accepted exchange-rate observations.`,
      ],
    };
  }
  const additions: RecurringFlow[] = [
    {
      id: `job-move:${scenario.id}:take-home`,
      name: `${scenario.name} take-home pay`,
      toAccountId: scenario.destinationAccountId,
      amount: takeHome / 12,
      grossAmount: gross / 12,
      currency: repository.settings.baseCurrency,
      compensationKind: "takeHomeIncome",
      frequency: "monthly",
      startDate,
    },
  ];
  if (scenario.pensionAccountId != null && employeePension > 0) {
    additions.push({
      id: `job-move:${scenario.id}:employee-pension`,
      name: `${scenario.name} employee pension`,
      toAccountId: scenario.pensionAccountId,
      amount: employeePension / 12,
      currency: repository.settings.baseCurrency,
      compensationKind: "employeePension",
      frequency: "monthly",
      startDate,
    });
  }
  if (scenario.pensionAccountId != null && employerPension > 0) {
    additions.push({
      id: `job-move:${scenario.id}:employer-pension`,
      name: `${scenario.name} employer pension`,
      toAccountId: scenario.pensionAccountId,
      amount: employerPension / 12,
      currency: repository.settings.baseCurrency,
      compensationKind: "employerPension",
      frequency: "monthly",
      startDate,
    });
  }
  return { flows: [...flows, ...additions], warnings: [] };
}

function replacedCompensation(
  repository: AssetTrackerRepository,
  scenario: JobMoveScenario,
  asOfDate: string,
): CompensationTotals | null {
  const replaced = new Set(scenario.replacedRecurringFlowIds);
  const totals: CompensationTotals = {
    annualTakeHomePay: 0,
    annualEmployeePensionContribution: 0,
    annualEmployerPensionContribution: 0,
  };
  for (const flow of repository.recurringFlows) {
    if (
      !replaced.has(flow.id) ||
      flow.compensationKind == null ||
      flow.startDate > asOfDate ||
      (flow.endDate != null && flow.endDate < asOfDate)
    ) {
      continue;
    }
    const money = recurringFlowReceivedMoney(flow);
    if (money == null) continue;
    const baseAmount = convertMoneyAtDate(repository, money, asOfDate);
    if (baseAmount == null) return null;
    const annualAmount =
      baseAmount * (monthlyReceivedAmount(flow) / money.amount) * 12;
    switch (flow.compensationKind) {
      case "takeHomeIncome":
      case "sideIncome":
        totals.annualTakeHomePay += annualAmount;
        break;
      case "employeePension":
        totals.annualEmployeePensionContribution += annualAmount;
        break;
      case "employerPension":
        totals.annualEmployerPensionContribution += annualAmount;
        break;
    }
  }
  return totals;
}

function goalDate(
  points: readonly { date: string; totalBalance: number }[],
  target: number | null,
): string | null {
  if (target == null || target <= 0) return null;
  return (
    points.find(
      (point, index) =>
        point.totalBalance >= target &&
        points.slice(index).every(({ totalBalance }) => totalBalance >= target),
    )?.date ?? null
  );
}

function emergencyFundAtPoint(
  accountBalances: Readonly<Record<string, number>>,
  analysis: EmergencyFundAnalysis | null,
) {
  if (analysis == null) return { balance: null, months: null };
  const balance = analysis.sources.reduce((total, source) => {
    if (!source.included) return total;
    const accountBalance = Math.max(accountBalances[source.accountId] ?? 0, 0);
    return (
      total +
      Math.max(
        accountBalance * (1 - source.policy.capitalRiskRate) -
          source.policy.withdrawalFee,
        0,
      )
    );
  }, 0);
  return {
    balance,
    months:
      analysis.monthlyEssentialNeed <= 0
        ? null
        : balance / analysis.monthlyEssentialNeed,
  };
}

function firstExhaustion(
  points: readonly RunwayScenarioPoint[],
  afterDate: string,
  balance: (point: RunwayScenarioPoint) => number,
) {
  return points.find((point, index) => {
    const previous = points[index - 1];
    return (
      point.date >= afterDate &&
      balance(point) <= 0.5 &&
      previous != null &&
      balance(previous) > 0.5
    );
  });
}

function largestAvailableAccount(
  repository: AssetTrackerRepository,
  point: RunwayScenarioPoint,
  liquidity: "liquid" | "illiquid",
) {
  return Array.from(repository.accounts.values())
    .filter(
      (account) =>
        account.closedAt == null &&
        !isLiability(account.assetType) &&
        accountLiquidity(account) === liquidity &&
        (point.accountBalances[account.id] ?? 0) > 0,
    )
    .toSorted(
      (left, right) =>
        (point.accountBalances[right.id] ?? 0) -
        (point.accountBalances[left.id] ?? 0),
    )[0];
}

function forecastMilestones(
  repository: AssetTrackerRepository,
  scenario: JobMoveScenario,
  points: readonly RunwayScenarioPoint[],
  financialIndependenceTarget: number | null,
): JobMoveScenarioComparison["milestones"] {
  const firstDate = points[0]?.date;
  const lastDate = points.at(-1)?.date;
  const withinForecast = (date: string) =>
    firstDate != null &&
    lastDate != null &&
    date >= firstDate &&
    date <= lastDate;
  const milestones: JobMoveScenarioComparison["milestones"] = [];
  if (withinForecast(scenario.transitionDate)) {
    milestones.push({
      date: scenario.transitionDate,
      kind: "income-stops",
      label: "Current pay stops",
      detail: "Selected pay and pension flows stop from this date.",
    });
  }
  if (
    scenario.roleStartDate != null &&
    withinForecast(scenario.roleStartDate)
  ) {
    milestones.push({
      date: scenario.roleStartDate,
      kind: "new-role-starts",
      label: "New role starts",
      detail: "The prospective role starts contributing pay and pensions.",
    });
  }
  const cashExhausted = firstExhaustion(
    points,
    scenario.transitionDate,
    ({ cashBalance }) => cashBalance,
  );
  if (cashExhausted != null) {
    const next = largestAvailableAccount(repository, cashExhausted, "liquid");
    milestones.push({
      date: cashExhausted.date,
      kind: "cash-exhausted",
      label: "Cash exhausted",
      detail:
        next == null
          ? "The forecast has no cash left and needs other liquid assets."
          : `The forecast starts drawing on ${next.name}.`,
    });
  }
  const liquidExhausted = firstExhaustion(
    points,
    scenario.transitionDate,
    ({ liquidBalance }) => liquidBalance,
  );
  if (liquidExhausted != null) {
    const next = largestAvailableAccount(
      repository,
      liquidExhausted,
      "illiquid",
    );
    milestones.push({
      date: liquidExhausted.date,
      kind: "liquid-assets-exhausted",
      label: "Liquid assets exhausted",
      detail:
        next == null
          ? "The forecast has no liquid assets left."
          : `${next.name} is next in the model. Selling or borrowing against it needs a real-world decision.`,
    });
  }
  const unfunded = points.find(
    (point) =>
      point.date >= scenario.transitionDate &&
      point.monthlyBreakdown.spendingDrawdown.unfunded > 0,
  );
  if (unfunded != null) {
    milestones.push({
      date: unfunded.date,
      kind: "unfunded-gap",
      label: "Assets exhausted",
      detail:
        "The model has no remaining asset balance to fund projected spending.",
    });
  }
  if (financialIndependenceTarget != null) {
    const lost = points.find((point, index) => {
      const previous = points[index - 1];
      return (
        point.date >= scenario.transitionDate &&
        point.totalBalance < financialIndependenceTarget &&
        previous != null &&
        previous.totalBalance >= financialIndependenceTarget
      );
    });
    const reached = points.find((point, index) => {
      const previous = points[index - 1];
      return (
        point.date >= scenario.transitionDate &&
        point.totalBalance >= financialIndependenceTarget &&
        previous != null &&
        previous.totalBalance < financialIndependenceTarget
      );
    });
    if (lost != null) {
      milestones.push({
        date: lost.date,
        kind: "fi-target-lost",
        label: "FI target lost",
        detail: "Projected net worth falls below the current FI target.",
      });
    }
    if (reached != null) {
      milestones.push({
        date: reached.date,
        kind: "fi-target-reached",
        label: "FI target reached",
        detail: "Projected net worth reaches the current FI target.",
      });
    }
  }
  return milestones.toSorted((left, right) =>
    left.date.localeCompare(right.date),
  );
}

export function compareJobMoveScenario(input: {
  repository: AssetTrackerRepository;
  scenario: JobMoveScenario;
  horizonMonths: number;
  startDate: string;
  annualExpenditure: number | null;
  annualCurrentExpenditure: number | null;
  financialIndependenceTarget: number | null;
  baselineCompensation: BaselineCompensation;
  emergencyFundAnalysis: EmergencyFundAnalysis | null;
}): JobMoveScenarioComparison {
  const compensation = calculateJobMoveCompensation(input.scenario);
  const comparisonStartDate =
    input.scenario.transitionDate > input.startDate
      ? input.scenario.transitionDate
      : input.startDate;
  const wholeLeadInMonths = Math.max(
    differenceInCalendarMonths(
      parseISO(comparisonStartDate),
      parseISO(input.startDate),
    ),
    0,
  );
  const leadInMonths =
    format(
      addMonths(parseISO(input.startDate), wholeLeadInMonths),
      "yyyy-MM-dd",
    ) < comparisonStartDate
      ? wholeLeadInMonths + 1
      : wholeLeadInMonths;
  const projectionMonths = leadInMonths + input.horizonMonths;
  const baseline = buildRunwayScenarioProjection({
    repository: input.repository,
    annualExpenditure: input.annualExpenditure,
    annualCurrentExpenditure: input.annualCurrentExpenditure,
    startDate: input.startDate,
    months: projectionMonths,
    decisionSelection: {
      decisionIds: input.repository.futureCashFlows.flatMap((record) =>
        record.kind === "decision" && record.status === "selected"
          ? [record.id]
          : [],
      ),
      amount: "expected",
      timing: "expected",
    },
  });
  const scenarioFlowResult = scenarioFlows(
    input.repository,
    input.scenario,
    compensation,
    input.startDate,
  );
  const scenarioRepository = {
    ...input.repository,
    recurringFlows: scenarioFlowResult.flows,
  };
  const projected = buildRunwayScenarioProjection({
    repository: scenarioRepository,
    annualExpenditure: input.annualExpenditure,
    annualCurrentExpenditure: input.annualCurrentExpenditure,
    expenditureChange:
      input.scenario.annualSpendingOverride == null
        ? undefined
        : {
            startDate: input.scenario.transitionDate,
            annualExpenditure: input.scenario.annualSpendingOverride,
            annualCurrentExpenditure: input.scenario.annualSpendingOverride,
          },
    startDate: input.startDate,
    months: projectionMonths,
    decisionSelection: {
      decisionIds: input.repository.futureCashFlows.flatMap((record) =>
        record.kind === "decision" && record.status === "selected"
          ? [record.id]
          : [],
      ),
      amount: "expected",
      timing: "expected",
    },
  });
  const timeline = baseline.flatMap((baselinePoint, index) => {
    if (baselinePoint.date < comparisonStartDate) return [];
    const scenarioPoint = projected[index];
    if (scenarioPoint == null) return [];
    const baselineEmergencyFund = emergencyFundAtPoint(
      baselinePoint.accountBalances,
      input.emergencyFundAnalysis,
    );
    const scenarioEmergencyFund = emergencyFundAtPoint(
      scenarioPoint.accountBalances,
      input.emergencyFundAnalysis,
    );
    return [
      {
        date: baselinePoint.date,
        baseline: {
          cashBalance: baselinePoint.cashBalance,
          totalBalance: baselinePoint.totalBalance,
          liquidBalance: baselinePoint.liquidBalance,
          liquidMonths: baselinePoint.liquidMonths,
          totalMonths: baselinePoint.totalMonths,
          emergencyFundBalance: baselineEmergencyFund.balance,
          emergencyFundMonths: baselineEmergencyFund.months,
          spendingDrawdown: baselinePoint.monthlyBreakdown.spendingDrawdown,
        },
        scenario: {
          cashBalance: scenarioPoint.cashBalance,
          totalBalance: scenarioPoint.totalBalance,
          liquidBalance: scenarioPoint.liquidBalance,
          liquidMonths: scenarioPoint.liquidMonths,
          totalMonths: scenarioPoint.totalMonths,
          emergencyFundBalance: scenarioEmergencyFund.balance,
          emergencyFundMonths: scenarioEmergencyFund.months,
          spendingDrawdown: scenarioPoint.monthlyBreakdown.spendingDrawdown,
        },
      },
    ];
  });
  const replaced = replacedCompensation(
    input.repository,
    input.scenario,
    input.startDate,
  );
  const baselineTakeHome =
    input.baselineCompensation?.annualTakeHomeIncome ?? null;
  const baselineEmployeePension =
    input.baselineCompensation?.annualEmployeePensionContribution ?? null;
  const baselineEmployerPension =
    input.baselineCompensation?.annualEmployerPensionContribution ?? null;
  const scenarioTakeHome =
    baselineTakeHome == null || replaced == null
      ? compensation.annualTakeHomePay
      : baselineTakeHome -
        replaced.annualTakeHomePay +
        compensation.annualTakeHomePay;
  const scenarioEmployeePension =
    baselineEmployeePension == null || replaced == null
      ? compensation.annualEmployeePensionContribution
      : baselineEmployeePension -
        replaced.annualEmployeePensionContribution +
        compensation.annualEmployeePensionContribution;
  const scenarioEmployerPension =
    baselineEmployerPension == null || replaced == null
      ? compensation.annualEmployerPensionContribution
      : baselineEmployerPension -
        replaced.annualEmployerPensionContribution +
        compensation.annualEmployerPensionContribution;
  return {
    scenarioId: input.scenario.id,
    warnings: scenarioFlowResult.warnings,
    compensation: {
      baselineAnnualTakeHomePay: baselineTakeHome,
      baselineAnnualPensionContribution:
        input.baselineCompensation == null
          ? null
          : input.baselineCompensation.annualEmployeePensionContribution +
            input.baselineCompensation.annualEmployerPensionContribution,
      scenarioAnnualTakeHomePay: scenarioTakeHome,
      scenarioAnnualEmployeePensionContribution: scenarioEmployeePension,
      scenarioAnnualEmployerPensionContribution: scenarioEmployerPension,
      currency: input.repository.settings.baseCurrency,
    },
    calculation: compensation.calculation,
    timeline,
    milestones: forecastMilestones(
      input.repository,
      input.scenario,
      projected,
      input.financialIndependenceTarget,
    ),
    financialIndependenceTarget: input.financialIndependenceTarget,
    financialIndependenceDates: {
      baseline: goalDate(
        baseline.filter(({ date }) => date >= comparisonStartDate),
        input.financialIndependenceTarget,
      ),
      scenario: goalDate(
        projected.filter(({ date }) => date >= comparisonStartDate),
        input.financialIndependenceTarget,
      ),
    },
  };
}
