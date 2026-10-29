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
import {
  calculateWorkplacePension,
  type WorkplacePensionEmployeeContribution,
  type WorkplacePensionEmployerPolicy,
  workplacePensionEmployerPolicySchema,
} from "finance-tax-rules/workplace-pension";
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

const PensionMethodSchema = z.enum([
  "salarySacrifice",
  "netPay",
  "reliefAtSource",
]);

const employeeTaxTreatment = {
  salarySacrifice: "salary-sacrifice",
  netPay: "net-pay",
  reliefAtSource: "relief-at-source",
} as const;

export const EmploymentRoleFactsSchema = z
  .object({
    employer: z.string().trim().min(1, "Current employer is required"),
    annualTakeHomePay: z.number().nonnegative(),
    baseGrossPay: z.number().nonnegative().optional(),
    variableGrossPay: z.number().nonnegative().optional(),
    annualEmployeePensionContribution: z.number().nonnegative(),
    annualEmployerPensionContribution: z.number().nonnegative(),
    currency: CurrencySchema,
    jurisdiction: z.string().trim().min(1),
    activeFrom: z.iso.date(),
    activeTo: z.iso.date(),
  })
  .refine((role) => role.activeTo >= role.activeFrom, {
    message: "Current role end must be on or after its start",
    path: ["activeTo"],
  });
export type EmploymentRoleFacts = z.infer<typeof EmploymentRoleFactsSchema>;

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
  employeePensionBasis: z
    .enum(["grossPay", "qualifyingEarnings", "pensionablePay"])
    .optional(),
  employerPensionRate: z.number().min(0).max(1).default(0),
  employerPensionBasis: z
    .enum(["grossPay", "qualifyingEarnings", "pensionablePay"])
    .optional(),
  employerPensionPolicy: workplacePensionEmployerPolicySchema.optional(),
  annualPensionablePay: z.number().nonnegative().optional(),
  variablePayPensionTreatment: z
    .enum(["singlePayment", "spreadEvenly"])
    .optional(),
  annualEmployeePensionOverride: z.number().nonnegative().optional(),
  annualEmployerPensionOverride: z.number().nonnegative().optional(),
  /** Annual take-home pay supplied when reviewed tax rules cannot calculate it. */
  annualTakeHomeOverride: z.number().nonnegative().optional(),
  /** Optional annual spending used only for this hypothetical path. */
  annualSpendingOverride: z.number().positive().optional(),
  /** Explicit facts for the role being left. Older saved scenarios may omit them. */
  currentRole: EmploymentRoleFactsSchema.optional(),
  destinationAccountId: AccountIdSchema.optional(),
  pensionAccountId: AccountIdSchema.optional(),
  /** Generic receipts and payments that belong only to this path. */
  includedFutureCashFlowIds: z.array(z.string().trim().min(1)).optional(),
  replacedRecurringFlowIds: z
    .array(z.string().min(1))
    .min(1, "Choose at least one current-role cash flow to replace"),
});

function validateJobMoveScenario(
  scenario: z.infer<typeof JobMoveScenarioBaseSchema>,
  context: z.RefinementCtx,
) {
  if (
    scenario.currentRole != null &&
    scenario.currentRole.activeTo !== scenario.transitionDate
  ) {
    context.addIssue({
      code: "custom",
      path: ["currentRole", "activeTo"],
      message: "Current role end must match the income stop date",
    });
  }
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
    (scenario.employeePensionRate + scenario.employerPensionRate > 0 ||
      (scenario.annualEmployeePensionOverride ?? 0) > 0 ||
      (scenario.annualEmployerPensionOverride ?? 0) > 0 ||
      (scenario.employerPensionPolicy != null &&
        scenario.employerPensionPolicy.kind !== "none")) &&
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
  annualProviderPensionTaxRelief: number;
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
    scenarioAnnualProviderPensionTaxRelief: number;
    currency: Currency;
  };
  calculation: JobMoveCompensation["calculation"];
  timeline: Array<{
    date: string;
    baseline: {
      cashBalance: number;
      totalBalance: number;
      liquidBalance: number;
      accessibleRetirementCapital: number;
      pensionCapital: number;
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
      accessibleRetirementCapital: number;
      pensionCapital: number;
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
  annualEmployeePensionCashDeduction: number,
  annualProviderPensionTaxRelief: number,
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
          method: employeeTaxTreatment[scenario.employeePensionMethod],
          employeeGrossContributionPence: employeePensionPence,
          employeeCashDeductionPence: Math.round(
            annualEmployeePensionCashDeduction * 100,
          ),
          salarySacrificePence:
            scenario.employeePensionMethod === "salarySacrifice"
              ? employeePensionPence
              : 0,
          employerContributionPence: Math.round(
            annualEmployerPensionContribution * 100,
          ),
          providerTaxReliefPence: Math.round(
            annualProviderPensionTaxRelief * 100,
          ),
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

const contributionBasis = {
  grossPay: "gross-pay",
  qualifyingEarnings: "qualifying-earnings",
  pensionablePay: "pensionable-pay",
} as const;

const pensionPayPeriod = {
  weekly: "weekly",
  fortnightly: "fortnightly",
  fourWeekly: "four-weekly",
  monthly: "monthly",
  quarterly: "quarterly",
  annual: "annual",
  irregular: "annual",
} as const;

function jobMoveEmployeeContribution(
  scenario: JobMoveScenario,
): WorkplacePensionEmployeeContribution {
  if (scenario.annualEmployeePensionOverride != null) {
    return {
      kind: "explicit-amount",
      taxTreatment: employeeTaxTreatment[scenario.employeePensionMethod],
      grossAmountPence: Math.round(
        scenario.annualEmployeePensionOverride * 100,
      ),
    };
  }
  if (scenario.employeePensionRate === 0) return { kind: "none" };
  if (scenario.employeePensionBasis == null) return { kind: "unknown" };
  return {
    kind: "percentage",
    taxTreatment: employeeTaxTreatment[scenario.employeePensionMethod],
    basis: contributionBasis[scenario.employeePensionBasis],
    rateBasisPoints: Math.round(scenario.employeePensionRate * 10_000),
  };
}

function jobMoveEmployerPolicy(
  scenario: JobMoveScenario,
): WorkplacePensionEmployerPolicy {
  if (scenario.annualEmployerPensionOverride != null) {
    return {
      kind: "explicit-amount",
      amountPence: Math.round(scenario.annualEmployerPensionOverride * 100),
    };
  }
  if (scenario.employerPensionPolicy != null) {
    return scenario.employerPensionPolicy;
  }
  if (scenario.employerPensionRate === 0) return { kind: "none" };
  if (scenario.employerPensionBasis == null) return { kind: "unknown" };
  return {
    kind: "flat-rate",
    basis: contributionBasis[scenario.employerPensionBasis],
    rateBasisPoints: Math.round(scenario.employerPensionRate * 10_000),
    schemeMinimumRateBasisPoints: 0,
  };
}

function usesQualifyingEarnings(
  employee: WorkplacePensionEmployeeContribution,
  employer: WorkplacePensionEmployerPolicy,
): boolean {
  return (
    (employee.kind === "percentage" &&
      employee.basis === "qualifying-earnings") ||
    ((employer.kind === "flat-rate" || employer.kind === "matching") &&
      employer.basis === "qualifying-earnings")
  );
}

function calculateJobMovePension(scenario: JobMoveScenario) {
  const employee = jobMoveEmployeeContribution(scenario);
  const employer = jobMoveEmployerPolicy(scenario);
  const qualifyingEarnings = usesQualifyingEarnings(employee, employer);
  if (qualifyingEarnings && scenario.payFrequency === "irregular") {
    throw new Error(
      "Qualifying earnings need a regular pay reference period or explicit pension amount overrides.",
    );
  }
  if (
    qualifyingEarnings &&
    scenario.variableGrossPay > 0 &&
    scenario.variablePayPensionTreatment == null
  ) {
    throw new Error(
      "Choose whether variable pay is one payment or spread across pay periods before calculating qualifying earnings.",
    );
  }
  const grossPay = scenario.baseGrossPay + scenario.variableGrossPay;
  const result = calculateWorkplacePension({
    effectiveDate: scenario.roleStartDate ?? scenario.transitionDate,
    payPeriod: pensionPayPeriod[scenario.payFrequency],
    annualGrossPayPence: Math.round(grossPay * 100),
    annualQualifyingEarningsPayPence: Math.round(grossPay * 100),
    qualifyingEarningsVariablePaymentsPence:
      scenario.variablePayPensionTreatment === "singlePayment"
        ? [Math.round(scenario.variableGrossPay * 100)]
        : [],
    annualPensionablePayPence:
      scenario.annualPensionablePay == null
        ? undefined
        : Math.round(scenario.annualPensionablePay * 100),
    employee,
    employer,
  });
  if (!result.available) {
    throw new Error(result.reasons.map(({ detail }) => detail).join(" "));
  }
  return result;
}

export function calculateJobMoveCompensation(
  scenario: JobMoveScenario,
): JobMoveCompensation {
  if (scenario.employmentStatus === "unemployed") {
    return {
      annualTakeHomePay: 0,
      annualEmployeePensionContribution: 0,
      annualEmployerPensionContribution: 0,
      annualProviderPensionTaxRelief: 0,
      calculation: { kind: "not-applicable" },
    };
  }
  const pension = calculateJobMovePension(scenario);
  const annualEmployeePensionContribution =
    pension.employeeGrossContributionPence / 100;
  const annualEmployerPensionContribution =
    pension.employerContributionPence / 100;
  const annualEmployeePensionCashDeduction =
    pension.employeeCashDeductionPence / 100;
  const annualProviderPensionTaxRelief = pension.providerTaxReliefPence / 100;
  const { result, reasons } = reviewedTaxResult(
    scenario,
    annualEmployeePensionContribution,
    annualEmployerPensionContribution,
    annualEmployeePensionCashDeduction,
    annualProviderPensionTaxRelief,
  );
  if (result?.available) {
    return {
      annualTakeHomePay: result.components.takeHomePayPence / 100,
      annualEmployeePensionContribution:
        result.components.employeePensionContributionPence / 100,
      annualEmployerPensionContribution:
        result.components.employerPensionContributionPence / 100,
      annualProviderPensionTaxRelief:
        result.components.providerTaxReliefPence / 100,
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
    annualProviderPensionTaxRelief,
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

function capitalAtPoint(
  repository: AssetTrackerRepository,
  point: RunwayScenarioPoint,
) {
  let accessibleRetirementCapital = 0;
  let pensionCapital = 0;
  for (const account of repository.accounts.values()) {
    if (isLiability(account.assetType)) continue;
    const balance = Math.max(point.accountBalances[account.id] ?? 0, 0);
    if (account.taxWrapper === "pension") pensionCapital += balance;
    const policy = account.accessPolicy;
    const isAccessible =
      account.assetType !== "property" &&
      policy?.canFundOrdinarySpending !== false &&
      (account.taxWrapper !== "pension" ||
        policy?.accessibleFromDate != null) &&
      (policy?.accessibleFromDate == null ||
        policy.accessibleFromDate <= point.date) &&
      policy?.taxTreatment?.kind !== "unsupported";
    if (isAccessible) accessibleRetirementCapital += balance;
  }
  return { accessibleRetirementCapital, pensionCapital };
}

function pathRepositories(
  repository: AssetTrackerRepository,
  scenario: JobMoveScenario,
) {
  const includedIds = new Set(scenario.includedFutureCashFlowIds ?? []);
  const scopedIds = new Set([
    ...repository.jobMoveScenarios.flatMap(
      (candidate) => candidate.includedFutureCashFlowIds ?? [],
    ),
    ...includedIds,
  ]);
  const shared = repository.futureCashFlows.filter(
    (record) => !scopedIds.has(record.id),
  );
  const included = repository.futureCashFlows.filter((record) =>
    includedIds.has(record.id),
  );
  return {
    baseline: { ...repository, futureCashFlows: shared },
    scenario: {
      ...repository,
      futureCashFlows: [...shared, ...included],
    },
  };
}

function selectedDecisionIds(
  repository: AssetTrackerRepository,
  pathIds: readonly string[] = [],
) {
  const selectedForPath = new Set(pathIds);
  return repository.futureCashFlows.flatMap((record) =>
    record.kind === "decision" &&
    (record.status === "selected" || selectedForPath.has(record.id))
      ? [record.id]
      : [],
  );
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

type CompareJobMoveScenarioInput = {
  repository: AssetTrackerRepository;
  scenario: JobMoveScenario;
  horizonMonths: number;
  startDate: string;
  annualExpenditure: number | null;
  annualCurrentExpenditure: number | null;
  financialIndependenceTarget: number | null;
  baselineCompensation: BaselineCompensation;
  emergencyFundAnalysis: EmergencyFundAnalysis | null;
};

function comparisonWindow(input: CompareJobMoveScenarioInput) {
  const startDate =
    input.scenario.transitionDate > input.startDate
      ? input.scenario.transitionDate
      : input.startDate;
  const wholeMonths = Math.max(
    differenceInCalendarMonths(parseISO(startDate), parseISO(input.startDate)),
    0,
  );
  const boundary = format(
    addMonths(parseISO(input.startDate), wholeMonths),
    "yyyy-MM-dd",
  );
  const leadInMonths = boundary < startDate ? wholeMonths + 1 : wholeMonths;
  return { startDate, projectionMonths: leadInMonths + input.horizonMonths };
}

function comparisonTimeline(input: {
  baseline: readonly RunwayScenarioPoint[];
  projected: readonly RunwayScenarioPoint[];
  baselineRepository: AssetTrackerRepository;
  scenarioRepository: AssetTrackerRepository;
  comparisonStartDate: string;
  emergencyFundAnalysis: EmergencyFundAnalysis | null;
}): JobMoveScenarioComparison["timeline"] {
  return input.baseline.flatMap((baselinePoint, index) => {
    if (baselinePoint.date < input.comparisonStartDate) return [];
    const scenarioPoint = input.projected[index];
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
          ...capitalAtPoint(input.baselineRepository, baselinePoint),
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
          ...capitalAtPoint(input.scenarioRepository, scenarioPoint),
          liquidMonths: scenarioPoint.liquidMonths,
          totalMonths: scenarioPoint.totalMonths,
          emergencyFundBalance: scenarioEmergencyFund.balance,
          emergencyFundMonths: scenarioEmergencyFund.months,
          spendingDrawdown: scenarioPoint.monthlyBreakdown.spendingDrawdown,
        },
      },
    ];
  });
}

function explicitReplacedCompensation(
  input: CompareJobMoveScenarioInput,
): CompensationTotals | null {
  const role = input.scenario.currentRole;
  if (role == null) return null;
  const converted = [
    role.annualTakeHomePay,
    role.annualEmployeePensionContribution,
    role.annualEmployerPensionContribution,
  ].map((amount) =>
    convertMoneyAtDate(
      input.repository,
      { amount, currency: role.currency },
      input.startDate,
    ),
  );
  const [takeHome, employeePension, employerPension] = converted;
  if (takeHome == null || employeePension == null || employerPension == null) {
    return null;
  }
  return {
    annualTakeHomePay: takeHome,
    annualEmployeePensionContribution: employeePension,
    annualEmployerPensionContribution: employerPension,
  };
}

function comparisonCompensation(
  input: CompareJobMoveScenarioInput,
  next: JobMoveCompensation,
): {
  value: JobMoveScenarioComparison["compensation"];
  warnings: string[];
} {
  const explicit = explicitReplacedCompensation(input);
  const inferred = replacedCompensation(
    input.repository,
    input.scenario,
    input.startDate,
  );
  const replaced = input.scenario.currentRole == null ? inferred : explicit;
  const baselineTakeHome =
    input.baselineCompensation?.annualTakeHomeIncome ?? null;
  const baselineEmployeePension =
    input.baselineCompensation?.annualEmployeePensionContribution ?? null;
  const baselineEmployerPension =
    input.baselineCompensation?.annualEmployerPensionContribution ?? null;
  const replace = (baseline: number | null, prior: number, future: number) =>
    baseline == null || replaced == null
      ? future
      : Math.max(baseline - prior, 0) + future;
  const warnings: string[] = [];
  if (input.scenario.currentRole == null) {
    warnings.push(
      "Current-role facts are inherited from the existing forecast. Add an explicit current role before relying on this comparison for an employment-exit decision.",
    );
  } else if (explicit == null) {
    warnings.push(
      `The ${input.scenario.currentRole.currency} current role could not be converted to ${input.repository.settings.baseCurrency} from accepted exchange-rate observations.`,
    );
  }
  return {
    warnings,
    value: {
      baselineAnnualTakeHomePay: baselineTakeHome,
      baselineAnnualPensionContribution:
        baselineEmployeePension == null || baselineEmployerPension == null
          ? null
          : baselineEmployeePension + baselineEmployerPension,
      scenarioAnnualTakeHomePay: replace(
        baselineTakeHome,
        replaced?.annualTakeHomePay ?? 0,
        next.annualTakeHomePay,
      ),
      scenarioAnnualEmployeePensionContribution: replace(
        baselineEmployeePension,
        replaced?.annualEmployeePensionContribution ?? 0,
        next.annualEmployeePensionContribution,
      ),
      scenarioAnnualEmployerPensionContribution: replace(
        baselineEmployerPension,
        replaced?.annualEmployerPensionContribution ?? 0,
        next.annualEmployerPensionContribution,
      ),
      scenarioAnnualProviderPensionTaxRelief:
        next.annualProviderPensionTaxRelief,
      currency: input.repository.settings.baseCurrency,
    },
  };
}

export function compareJobMoveScenario(
  input: CompareJobMoveScenarioInput,
): JobMoveScenarioComparison {
  const compensation = calculateJobMoveCompensation(input.scenario);
  const repositories = pathRepositories(input.repository, input.scenario);
  const window = comparisonWindow(input);
  const baseline = buildRunwayScenarioProjection({
    repository: repositories.baseline,
    annualExpenditure: input.annualExpenditure,
    annualCurrentExpenditure: input.annualCurrentExpenditure,
    startDate: input.startDate,
    months: window.projectionMonths,
    decisionSelection: {
      decisionIds: selectedDecisionIds(repositories.baseline),
      amount: "expected",
      timing: "expected",
    },
  });
  const scenarioFlowResult = scenarioFlows(
    repositories.scenario,
    input.scenario,
    compensation,
    input.startDate,
  );
  const scenarioRepository = {
    ...repositories.scenario,
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
    months: window.projectionMonths,
    decisionSelection: {
      decisionIds: selectedDecisionIds(
        scenarioRepository,
        input.scenario.includedFutureCashFlowIds ?? [],
      ),
      amount: "expected",
      timing: "expected",
    },
  });
  const timeline = comparisonTimeline({
    baseline,
    projected,
    baselineRepository: repositories.baseline,
    scenarioRepository,
    comparisonStartDate: window.startDate,
    emergencyFundAnalysis: input.emergencyFundAnalysis,
  });
  const comparedCompensation = comparisonCompensation(input, compensation);
  return {
    scenarioId: input.scenario.id,
    warnings: [
      ...scenarioFlowResult.warnings,
      ...comparedCompensation.warnings,
    ],
    compensation: comparedCompensation.value,
    calculation: compensation.calculation,
    timeline,
    milestones: forecastMilestones(
      scenarioRepository,
      input.scenario,
      projected,
      input.financialIndependenceTarget,
    ),
    financialIndependenceTarget: input.financialIndependenceTarget,
    financialIndependenceDates: {
      baseline: goalDate(
        baseline.filter(({ date }) => date >= window.startDate),
        input.financialIndependenceTarget,
      ),
      scenario: goalDate(
        projected.filter(({ date }) => date >= window.startDate),
        input.financialIndependenceTarget,
      ),
    },
  };
}
