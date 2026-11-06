import {
  calculateHistoricalSalary,
  type HistoricalSalaryResult,
} from "finance-tax-rules/historical-salary";
import {
  calculateWorkplacePension,
  workplacePensionEmployeeContributionSchema,
  workplacePensionEmployerPolicySchema,
  type WorkplacePensionResult,
} from "finance-tax-rules/workplace-pension";
import { z } from "zod";
import {
  evaluateLimitedCompanyScenario,
  LimitedCompanyScenarioInputSchema,
} from "./limitedCompanyScenario";
import {
  evaluateOffPayrollStatusEvidence,
  OffPayrollStatusEvidenceSchema,
} from "./offPayrollStatus";
import { IsoDateSchema, TaxYearSchema, TimestampSchema } from "./sideIncome";
import {
  resolveMinimumWageRule,
  resolveUmbrellaPayrollRule,
  UK_UMBRELLA_RULESET_VERSION,
  ukUmbrellaRuleSet,
  type MinimumWageCategory,
  type UmbrellaPayPeriod,
} from "./umbrellaRules";

export const UMBRELLA_SCENARIO_VERSION = 1 as const;
export const UMBRELLA_CALCULATION_VERSION = "1" as const;

const PenceSchema = z.number().int().nonnegative();
const BasisPointsSchema = z.number().int().min(0).max(10_000);
const IdentifierSchema = z.string().trim().min(1);
const IncomeTaxJurisdictionSchema = z.enum([
  "england-and-northern-ireland",
  "scotland",
  "wales",
]);
const PayPeriodSchema = z.enum(["weekly", "monthly"]);

const PensionArrangementSchema = z
  .object({
    providerArrangementStatus: z.enum(["confirmed", "not-reviewed", "unknown"]),
    employee: workplacePensionEmployeeContributionSchema,
    employer: workplacePensionEmployerPolicySchema,
  })
  .strict();

const StudentLoanSchema = z
  .object({
    standardPlan: z.enum(["plan-1", "plan-2", "plan-4", "plan-5"]).nullable(),
    postgraduateLoan: z.boolean(),
  })
  .strict();

const RightsSchema = z
  .object({
    paidHolidayDays: z.number().nonnegative(),
    paidSickDays: z.number().nonnegative(),
    sickPay: z.enum(["contractual", "statutory-only", "none", "unknown"]),
  })
  .strict();

const WorkBasisSchema = z
  .object({
    workedDays: z.number().nonnegative(),
    unpaidNonWorkingDays: z.number().nonnegative(),
    workerPaidExpensesPence: PenceSchema,
    rights: RightsSchema,
  })
  .strict();

const AssignmentPeriodSchema = z
  .object({
    id: IdentifierSchema,
    paidOn: IsoDateSchema,
    assignmentRatePence: PenceSchema,
    rateUnit: z.enum(["day", "hour"]),
    workedUnits: z.number().nonnegative(),
    workedHours: z.number().nonnegative(),
    assignmentBonusPence: PenceSchema,
    marginCharged: z.boolean(),
  })
  .strict();

const MarginSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("fixed-per-charged-period"),
      amountPence: PenceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("percentage-of-assignment-revenue"),
      rateBasisPoints: BasisPointsSchema,
    })
    .strict(),
  z.object({ kind: z.literal("annual-fixed"), amountPence: PenceSchema }).strict(),
]);

const HolidayPaySchema = z.discriminatedUnion("method", [
  z
    .object({
      method: z.literal("rolled-up"),
      workerPattern: z.enum(["irregular-hours", "part-year", "regular-hours", "unknown"]),
      rateBasisPoints: BasisPointsSchema,
    })
    .strict(),
  z
    .object({
      method: z.literal("accrued-52-week-reference"),
      workerPattern: z.enum(["irregular-hours", "part-year", "regular-hours", "unknown"]),
      accrualRateBasisPoints: BasisPointsSchema,
      openingReservePence: PenceSchema,
      paidByPeriodPence: z.array(PenceSchema),
    })
    .strict(),
  z
    .object({
      method: z.literal("unknown"),
      workerPattern: z.enum(["irregular-hours", "part-year", "regular-hours", "unknown"]),
    })
    .strict(),
]);

const LevySchema = z
  .object({
    providerAssessment: z.enum([
      "confirmed-over-threshold",
      "confirmed-not-over-threshold",
      "unknown",
    ]),
    providerAnnualPayBillPence: PenceSchema.nullable(),
    evidenceReference: z.string().trim().min(1).nullable(),
  })
  .strict();

const DirectEmploymentComparisonSchema = z
  .object({
    id: IdentifierSchema,
    label: z.string().trim().min(1),
    workBasis: WorkBasisSchema,
    grossPayByPeriodPence: z.array(PenceSchema),
    pension: PensionArrangementSchema,
    studentLoan: StudentLoanSchema,
    otherDeductionsPence: PenceSchema,
    reimbursedExpensesPence: PenceSchema,
  })
  .strict();

const CompanyComparisonSchema = z
  .object({
    strategyId: IdentifierSchema,
    workBasis: WorkBasisSchema,
    scenario: LimitedCompanyScenarioInputSchema,
  })
  .strict();

export const UmbrellaScenarioInputSchema = z
  .object({
    scenarioVersion: z.literal(UMBRELLA_SCENARIO_VERSION),
    id: IdentifierSchema,
    label: z.string().trim().min(1),
    savedAt: TimestampSchema,
    revision: z.number().int().positive(),
    evaluatedOn: IsoDateSchema,
    taxYear: TaxYearSchema,
    incomeTaxJurisdiction: IncomeTaxJurisdictionSchema,
    payPeriod: PayPeriodSchema,
    providerSuitability: z.enum(["confirmed", "rejected", "not-reviewed"]),
    nationalInsuranceCategory: z.string().regex(/^[A-Z]$/),
    minimumWageCategory: z.enum([
      "age-21-and-over",
      "age-18-to-20",
      "under-18",
      "apprentice",
    ]),
    assignmentPeriods: z.array(AssignmentPeriodSchema).min(1),
    margin: MarginSchema,
    apprenticeshipLevy: LevySchema,
    holidayPay: HolidayPaySchema,
    pension: PensionArrangementSchema,
    studentLoan: StudentLoanSchema,
    otherTaxableIncomePence: PenceSchema,
    otherDeductionsPence: PenceSchema,
    reimbursedExpensesPence: PenceSchema,
    workBasis: WorkBasisSchema,
    comparisonBasis: z
      .object({
        startsOn: IsoDateSchema,
        endsOn: IsoDateSchema,
        availableWorkDays: z.number().nonnegative(),
        pensionTargetPence: PenceSchema,
      })
      .strict(),
    offPayrollStatusEvidence: OffPayrollStatusEvidenceSchema,
    comparisons: z
      .object({
        directEmployment: DirectEmploymentComparisonSchema.nullable(),
        company: CompanyComparisonSchema.nullable(),
      })
      .strict(),
  })
  .strict()
  .superRefine((input, context) => {
    const expectedPeriods = input.payPeriod === "weekly" ? 52 : 12;
    if (input.assignmentPeriods.length !== expectedPeriods) {
      context.addIssue({
        code: "custom",
        path: ["assignmentPeriods"],
        message: `Expected ${expectedPeriods} ${input.payPeriod} assignment periods.`,
      });
    }
    const periodIds = input.assignmentPeriods.map(({ id }) => id);
    if (new Set(periodIds).size !== periodIds.length) {
      context.addIssue({
        code: "custom",
        path: ["assignmentPeriods"],
        message: "Assignment period IDs must be unique.",
      });
    }
    if (
      input.holidayPay.method === "accrued-52-week-reference" &&
      input.holidayPay.paidByPeriodPence.length !== expectedPeriods
    ) {
      context.addIssue({
        code: "custom",
        path: ["holidayPay", "paidByPeriodPence"],
        message: `Expected ${expectedPeriods} ${input.payPeriod} holiday payment amounts.`,
      });
    }
    const direct = input.comparisons.directEmployment;
    if (direct !== null && direct.grossPayByPeriodPence.length !== expectedPeriods) {
      context.addIssue({
        code: "custom",
        path: ["comparisons", "directEmployment", "grossPayByPeriodPence"],
        message: `Expected ${expectedPeriods} ${input.payPeriod} direct-employment pay amounts.`,
      });
    }
    if (input.comparisonBasis.startsOn > input.comparisonBasis.endsOn) {
      context.addIssue({
        code: "custom",
        path: ["comparisonBasis", "endsOn"],
        message: "The comparison period cannot end before it starts.",
      });
    }
  });

export type UmbrellaScenarioInput = z.infer<typeof UmbrellaScenarioInputSchema>;
type PensionArrangement = z.infer<typeof PensionArrangementSchema>;
type StudentLoan = z.infer<typeof StudentLoanSchema>;

type ScenarioIssue = {
  code: string;
  state: "needs-review" | "unsupported";
  detail: string;
  periodId?: string;
  comparison?: "direct-employment" | "company";
};

const sum = (values: readonly number[]) =>
  values.reduce((total, value) => total + value, 0);

const roundRate = (amountPence: number, rateBasisPoints: number) =>
  Math.round((amountPence * rateBasisPoints) / 10_000);

function distribute(total: number, weights: readonly number[]): number[] {
  if (weights.length === 0) return [];
  const weightTotal = sum(weights);
  const effectiveWeights = weightTotal === 0 ? weights.map(() => 1) : weights;
  const effectiveTotal = sum(effectiveWeights);
  const remainderTargets = effectiveWeights.flatMap((weight, index) =>
    weight > 0 ? [index] : [],
  );
  const values = effectiveWeights.map((weight) =>
    Math.floor((total * weight) / effectiveTotal),
  );
  let remainder = total - sum(values);
  let index = 0;
  while (remainder > 0) {
    const target = remainderTargets[index % remainderTargets.length] ?? 0;
    values[target] = (values[target] ?? 0) + 1;
    remainder -= 1;
    index += 1;
  }
  return values;
}

function assignmentRevenue(period: UmbrellaScenarioInput["assignmentPeriods"][number]) {
  return Math.round(period.assignmentRatePence * period.workedUnits) + period.assignmentBonusPence;
}

function marginByPeriod(input: UmbrellaScenarioInput, revenue: readonly number[]) {
  const margin = input.margin;
  if (margin.kind === "percentage-of-assignment-revenue") {
    return revenue.map((amount) => roundRate(amount, margin.rateBasisPoints));
  }
  if (margin.kind === "fixed-per-charged-period") {
    return input.assignmentPeriods.map((period) =>
      period.marginCharged ? margin.amountPence : 0,
    );
  }
  return distribute(margin.amountPence, revenue);
}

function employeePensionMethod(pension: PensionArrangement) {
  return pension.employee.kind === "explicit-amount" ||
    pension.employee.kind === "percentage"
    ? pension.employee.taxTreatment
    : "net-pay";
}

function pensionForGross(
  input: Pick<UmbrellaScenarioInput, "evaluatedOn" | "payPeriod" | "pension">,
  grossByPeriodPence: readonly number[],
): WorkplacePensionResult {
  const grossPayPence = sum(grossByPeriodPence);
  return calculateWorkplacePension({
    effectiveDate: input.evaluatedOn,
    payPeriod: input.payPeriod,
    annualGrossPayPence: grossPayPence,
    annualQualifyingEarningsPayPence: grossPayPence,
    qualifyingEarningsVariablePaymentsPence: [...grossByPeriodPence],
    annualPensionablePayPence: grossPayPence,
    employee: input.pension.employee,
    employer: input.pension.employer,
  });
}

function postSacrificePeriods(
  grossByPeriodPence: readonly number[],
  pension: WorkplacePensionResult,
) {
  if (!pension.available) return [...grossByPeriodPence];
  return grossByPeriodPence.map((gross, index) =>
    Math.max(0, gross - (pension.salarySacrificeByPeriodPence[index] ?? 0)),
  );
}

function employerNationalInsurance(
  earningsByPeriodPence: readonly number[],
  rateBasisPoints: number,
  thresholdPence: number,
) {
  return earningsByPeriodPence.map((earnings) =>
    roundRate(Math.max(0, earnings - thresholdPence), rateBasisPoints),
  );
}

function holidayAmounts(
  input: UmbrellaScenarioInput,
  basePayByPeriodPence: readonly number[],
) {
  const holidayPay = input.holidayPay;
  if (holidayPay.method === "rolled-up") {
    const paid = basePayByPeriodPence.map((amount) =>
      roundRate(amount, holidayPay.rateBasisPoints),
    );
    return {
      accruedByPeriodPence: paid.map(() => 0),
      paidByPeriodPence: paid,
      openingReservePence: 0,
      closingReservePence: 0,
    };
  }
  if (holidayPay.method === "accrued-52-week-reference") {
    const accrued = basePayByPeriodPence.map((amount) =>
      roundRate(amount, holidayPay.accrualRateBasisPoints),
    );
    const paid = holidayPay.paidByPeriodPence;
    return {
      accruedByPeriodPence: accrued,
      paidByPeriodPence: paid,
      openingReservePence: holidayPay.openingReservePence,
      closingReservePence: Math.max(
        0,
        holidayPay.openingReservePence + sum(accrued) - sum(paid),
      ),
    };
  }
  return {
    accruedByPeriodPence: basePayByPeriodPence.map(() => 0),
    paidByPeriodPence: basePayByPeriodPence.map(() => 0),
    openingReservePence: 0,
    closingReservePence: 0,
  };
}

type CostProjection = ReturnType<typeof projectEmploymentCost>;

function projectEmploymentCost(
  input: UmbrellaScenarioInput,
  basePayPence: number,
  availableByPeriodPence: readonly number[],
  employerNiRule: {
    rateBasisPoints: number;
    thresholdPence: number;
  },
) {
  const basePayByPeriodPence = distribute(basePayPence, availableByPeriodPence);
  const holiday = holidayAmounts(input, basePayByPeriodPence);
  const grossByPeriodPence = basePayByPeriodPence.map(
    (base, index) => base + (holiday.paidByPeriodPence[index] ?? 0),
  );
  const pension = pensionForGross(input, grossByPeriodPence);
  const earningsByPeriodPence = postSacrificePeriods(grossByPeriodPence, pension);
  const employerNiByPeriodPence =
    input.nationalInsuranceCategory === "A"
      ? employerNationalInsurance(
          earningsByPeriodPence,
          employerNiRule.rateBasisPoints,
          employerNiRule.thresholdPence,
        )
      : grossByPeriodPence.map(() => 0);
  const levyPence =
    input.apprenticeshipLevy.providerAssessment === "confirmed-over-threshold"
      ? roundRate(
          sum(earningsByPeriodPence),
          ukUmbrellaRuleSet.apprenticeshipLevy.rateBasisPoints,
        )
      : 0;
  const employerPensionPence = pension.available
    ? pension.employerContributionPence
    : 0;
  const holidayCostPence =
    input.holidayPay.method === "rolled-up"
      ? sum(holiday.paidByPeriodPence)
      : sum(holiday.accruedByPeriodPence);
  return {
    basePayByPeriodPence,
    holiday,
    grossByPeriodPence,
    pension,
    earningsByPeriodPence,
    employerNiByPeriodPence,
    levyPence,
    employerPensionPence,
    totalAssignmentCostPence:
      basePayPence +
      holidayCostPence +
      sum(employerNiByPeriodPence) +
      levyPence +
      employerPensionPence,
  };
}

function solveEmploymentCost(
  input: UmbrellaScenarioInput,
  availableByPeriodPence: readonly number[],
  employerNiRule: { rateBasisPoints: number; thresholdPence: number },
) {
  const budgetPence = sum(availableByPeriodPence);
  let low = 0;
  let high = budgetPence;
  let selected: CostProjection = projectEmploymentCost(
    input,
    0,
    availableByPeriodPence,
    employerNiRule,
  );
  const assignmentBudgetShortfallPence = Math.max(
    0,
    selected.totalAssignmentCostPence - budgetPence,
  );
  if (assignmentBudgetShortfallPence > 0) {
    return {
      ...selected,
      budgetPence,
      assignmentBudgetShortfallPence,
      unallocatedAssignmentBalancePence: 0,
    };
  }
  while (low <= high) {
    const candidate = Math.floor((low + high) / 2);
    const projection = projectEmploymentCost(
      input,
      candidate,
      availableByPeriodPence,
      employerNiRule,
    );
    if (projection.totalAssignmentCostPence <= budgetPence) {
      selected = projection;
      low = candidate + 1;
    } else {
      high = candidate - 1;
    }
  }
  return {
    ...selected,
    budgetPence,
    assignmentBudgetShortfallPence: 0,
    unallocatedAssignmentBalancePence:
      budgetPence - selected.totalAssignmentCostPence,
  };
}

function studentLoanDeductions(
  studentLoan: StudentLoan,
  earningsByPeriodPence: readonly number[],
  payPeriod: UmbrellaPayPeriod,
  payrollRule: NonNullable<ReturnType<typeof resolveUmbrellaPayrollRule>>,
) {
  const standardThreshold =
    studentLoan.standardPlan === null
      ? null
      : payrollRule.studentLoans.thresholdsPence[studentLoan.standardPlan];
  const standardPence =
    standardThreshold === null
      ? 0
      : sum(
          earningsByPeriodPence.map((earnings) =>
            roundRate(
              Math.max(0, earnings - standardThreshold[payPeriod]),
              payrollRule.studentLoans.standardRateBasisPoints,
            ),
          ),
        );
  const postgraduateThreshold =
    payrollRule.studentLoans.thresholdsPence.postgraduate[payPeriod];
  const postgraduatePence = studentLoan.postgraduateLoan
    ? sum(
        earningsByPeriodPence.map((earnings) =>
          roundRate(
            Math.max(0, earnings - postgraduateThreshold),
            payrollRule.studentLoans.postgraduateRateBasisPoints,
          ),
        ),
      )
    : 0;
  return {
    standardPence,
    postgraduatePence,
    totalPence: standardPence + postgraduatePence,
    standardPlanSupported:
      studentLoan.standardPlan === null || standardThreshold !== null,
  };
}

function salaryCalculation({
  effectiveDate,
  grossByPeriodPence,
  incomeTaxJurisdiction,
  nationalInsuranceCategory,
  otherDeductionsPence,
  otherTaxableIncomePence,
  payPeriod,
  pension,
  pensionResult,
  taxYear,
}: {
  effectiveDate: string;
  grossByPeriodPence: readonly number[];
  incomeTaxJurisdiction: UmbrellaScenarioInput["incomeTaxJurisdiction"];
  nationalInsuranceCategory: string;
  otherDeductionsPence: number;
  otherTaxableIncomePence: number;
  payPeriod: UmbrellaPayPeriod;
  pension: PensionArrangement;
  pensionResult: WorkplacePensionResult;
  taxYear: string;
}): HistoricalSalaryResult | null {
  if (nationalInsuranceCategory !== "A" || !pensionResult.available) return null;
  const postSacrificeEarningsPence = postSacrificePeriods(
    grossByPeriodPence,
    pensionResult,
  );
  return calculateHistoricalSalary({
    effectiveDate,
    taxYear,
    jurisdiction: incomeTaxJurisdiction,
    contractualGrossPayPence: sum(grossByPeriodPence),
    otherTaxableIncomePence,
    otherDeductionsPence,
    nationalInsuranceCategory: "A",
    isCompanyDirector: false,
    nationalInsurancePeriods: {
      payPeriod,
      postSacrificeEarningsPence,
    },
    pension: {
      method: employeePensionMethod(pension),
      employeeGrossContributionPence:
        pensionResult.employeeGrossContributionPence,
      employeeCashDeductionPence: pensionResult.employeeCashDeductionPence,
      salarySacrificePence: pensionResult.salarySacrificePence,
      employerContributionPence: pensionResult.employerContributionPence,
      providerTaxReliefPence: pensionResult.providerTaxReliefPence,
    },
    assumptions: [
      {
        id: "umbrella-paye-precision",
        value: "Annual Income Tax liability estimate with supplied pay-period National Insurance earnings",
      },
    ],
  });
}

function uniqueIssues(issues: ScenarioIssue[]) {
  return issues.filter(
    (issue, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.code === issue.code &&
          candidate.detail === issue.detail &&
          candidate.periodId === issue.periodId &&
          candidate.comparison === issue.comparison,
      ) === index,
  );
}

function payrollAndProviderIssues(
  input: UmbrellaScenarioInput,
  payrollRule: ReturnType<typeof resolveUmbrellaPayrollRule>,
): ScenarioIssue[] {
  const issues: ScenarioIssue[] = [];
  if (payrollRule === undefined) {
    issues.push({
      code: "unsupported-payroll-rule-period",
      state: "unsupported",
      detail: `${input.evaluatedOn} and ${input.taxYear} do not have a reviewed umbrella payroll rule.`,
    });
  }
  if (input.providerSuitability !== "confirmed") {
    issues.push({
      code: "umbrella-provider-not-confirmed",
      state: "needs-review",
      detail: "Confirm the umbrella employer and its employment arrangement before relying on the comparison.",
    });
  }
  if (input.nationalInsuranceCategory !== "A") {
    issues.push({
      code: "unsupported-national-insurance-category",
      state: "unsupported",
      detail: `National Insurance category ${input.nationalInsuranceCategory} is recorded but only category A is calculated.`,
    });
  }
  return issues;
}

function levyIssues(input: UmbrellaScenarioInput): ScenarioIssue[] {
  const issues: ScenarioIssue[] = [];
  if (input.apprenticeshipLevy.providerAssessment === "unknown") {
    issues.push({
      code: "apprenticeship-levy-applicability-unknown",
      state: "needs-review",
      detail: "The umbrella provider must confirm whether its pay bill and allowance make the levy applicable.",
    });
  }
  if (
    input.apprenticeshipLevy.providerAssessment !== "unknown" &&
    input.apprenticeshipLevy.evidenceReference === null
  ) {
    issues.push({
      code: "apprenticeship-levy-evidence-missing",
      state: "needs-review",
      detail: "The levy assessment needs a provider statement or reconciliation reference.",
    });
  }
  if (
    input.apprenticeshipLevy.providerAssessment === "confirmed-over-threshold" &&
    input.apprenticeshipLevy.providerAnnualPayBillPence !== null &&
    input.apprenticeshipLevy.providerAnnualPayBillPence <=
      ukUmbrellaRuleSet.apprenticeshipLevy.annualPayBillThresholdPence
  ) {
    issues.push({
      code: "apprenticeship-levy-assessment-conflict",
      state: "needs-review",
      detail: "The provider assessment says the levy applies, but the supplied annual pay bill does not exceed the official threshold.",
    });
  }
  return issues;
}

function pensionAndHolidayIssues(
  input: UmbrellaScenarioInput,
  projection: CostProjection,
): ScenarioIssue[] {
  const issues: ScenarioIssue[] = [];
  if (input.pension.providerArrangementStatus !== "confirmed") {
    issues.push({
      code: "pension-arrangement-not-confirmed",
      state: "needs-review",
      detail: "Confirm the provider's workplace pension basis, rates, and contribution method.",
    });
  }
  if (!projection.pension.available) {
    issues.push(
      ...projection.pension.reasons.map((reason) => ({
        code: reason.code,
        state: "unsupported" as const,
        detail: reason.detail,
      })),
    );
  }
  if (input.holidayPay.method === "unknown") {
    issues.push({
      code: "holiday-pay-method-unknown",
      state: "needs-review",
      detail: "Record whether holiday pay is rolled up or paid from an accrued 52-week reference amount.",
    });
  }
  if (
    input.holidayPay.method === "rolled-up" &&
    !ukUmbrellaRuleSet.holidayPay.eligibleWorkerPatterns.includes(
      input.holidayPay.workerPattern as "irregular-hours" | "part-year",
    )
  ) {
    issues.push({
      code: "rolled-up-holiday-pay-not-supported-for-worker-pattern",
      state: "unsupported",
      detail: "Rolled-up holiday pay is supported only for an irregular-hours or part-year worker.",
    });
  }
  if (
    input.holidayPay.method === "rolled-up" &&
    input.holidayPay.rateBasisPoints !==
      ukUmbrellaRuleSet.holidayPay.statutoryRolledUpRateBasisPoints
  ) {
    issues.push({
      code: "nonstandard-rolled-up-holiday-rate",
      state: "needs-review",
      detail: `The supplied rolled-up rate is ${input.holidayPay.rateBasisPoints} basis points rather than the reviewed statutory 1207 basis points.`,
    });
  }
  if (
    input.holidayPay.method === "accrued-52-week-reference" &&
    sum(input.holidayPay.paidByPeriodPence) >
      input.holidayPay.openingReservePence +
        sum(projection.holiday.accruedByPeriodPence)
  ) {
    issues.push({
      code: "holiday-pay-release-exceeds-reserve",
      state: "unsupported",
      detail: "Holiday pay released in the scenario exceeds the opening reserve plus current accrual.",
    });
  }
  return issues;
}

function ruleAndInputIssues(
  input: UmbrellaScenarioInput,
  payrollRule: ReturnType<typeof resolveUmbrellaPayrollRule>,
  projection: CostProjection,
) {
  return [
    ...payrollAndProviderIssues(input, payrollRule),
    ...levyIssues(input),
    ...pensionAndHolidayIssues(input, projection),
  ];
}

function minimumWageIssues(
  input: UmbrellaScenarioInput,
  projection: CostProjection,
) {
  const issues: ScenarioIssue[] = [];
  for (const [index, period] of input.assignmentPeriods.entries()) {
    if (period.workedHours === 0) continue;
    const rule = resolveMinimumWageRule(period.paidOn);
    if (rule === undefined) {
      issues.push({
        code: "unsupported-minimum-wage-date",
        state: "unsupported",
        detail: `${period.paidOn} has no reviewed minimum-wage rule.`,
        periodId: period.id,
      });
      continue;
    }
    const basicPay = projection.basePayByPeriodPence[index] ?? 0;
    const sacrifice = projection.pension.available
      ? projection.pension.salarySacrificeByPeriodPence[index] ?? 0
      : 0;
    const minimumPay = Math.ceil(
      period.workedHours *
        rule.hourlyRatesPence[input.minimumWageCategory as MinimumWageCategory],
    );
    if (Math.max(0, basicPay - sacrifice) < minimumPay) {
      issues.push({
        code: "minimum-wage-shortfall",
        state: "unsupported",
        detail: `${period.id} has ${Math.max(0, basicPay - sacrifice)}p of post-sacrifice basic pay against a ${minimumPay}p minimum.`,
        periodId: period.id,
      });
    }
  }
  return issues;
}

function workBasisIssues(
  shared: UmbrellaScenarioInput["comparisonBasis"],
  basis: z.infer<typeof WorkBasisSchema>,
  comparison: "direct-employment" | "company",
) {
  const representedDays =
    basis.workedDays +
    basis.unpaidNonWorkingDays +
    basis.rights.paidHolidayDays +
    basis.rights.paidSickDays;
  if (Math.abs(representedDays - shared.availableWorkDays) < 0.001) return [];
  return [
    {
      code: "comparison-work-availability-mismatch",
      state: "unsupported" as const,
      detail: `${comparison} represents ${representedDays} days against ${shared.availableWorkDays} shared available days.`,
      comparison,
    },
  ];
}

function evaluateDirectEmploymentComparison(
  input: UmbrellaScenarioInput,
  payrollRule: NonNullable<ReturnType<typeof resolveUmbrellaPayrollRule>>,
) {
  const direct = input.comparisons.directEmployment;
  if (direct === null) return null;
  const pension = pensionForGross(
    {
      evaluatedOn: input.evaluatedOn,
      payPeriod: input.payPeriod,
      pension: direct.pension,
    },
    direct.grossPayByPeriodPence,
  );
  const payroll = salaryCalculation({
    effectiveDate: input.evaluatedOn,
    grossByPeriodPence: direct.grossPayByPeriodPence,
    incomeTaxJurisdiction: input.incomeTaxJurisdiction,
    nationalInsuranceCategory: input.nationalInsuranceCategory,
    otherDeductionsPence: direct.otherDeductionsPence,
    otherTaxableIncomePence: input.otherTaxableIncomePence,
    payPeriod: input.payPeriod,
    pension: direct.pension,
    pensionResult: pension,
    taxYear: input.taxYear,
  });
  const earnings = postSacrificePeriods(direct.grossPayByPeriodPence, pension);
  const loans = studentLoanDeductions(
    direct.studentLoan,
    earnings,
    input.payPeriod,
    payrollRule,
  );
  const issues = workBasisIssues(
    input.comparisonBasis,
    direct.workBasis,
    "direct-employment",
  );
  if (!pension.available) {
    issues.push(
      ...pension.reasons.map(({ code, detail }) => ({
        code,
        detail,
        state: "unsupported" as const,
        comparison: "direct-employment" as const,
      })),
    );
  }
  if (payroll === null || !payroll.available) {
    issues.push({
      code: "direct-employment-payroll-unavailable",
      detail: "The direct-employment PAYE estimate is unavailable for the supplied rules and pension arrangement.",
      state: "unsupported",
      comparison: "direct-employment",
    });
  }
  const takeHome = payroll?.available ? payroll.components.takeHomePayPence : null;
  return {
    route: "direct-employment" as const,
    id: direct.id,
    label: direct.label,
    state: issues.length === 0 ? ("supported" as const) : ("unsupported" as const),
    issues,
    workBasis: direct.workBasis,
    grossPayPence: sum(direct.grossPayByPeriodPence),
    netCashPence:
      takeHome === null
        ? null
        : takeHome -
          loans.totalPence +
          direct.reimbursedExpensesPence -
          direct.workBasis.workerPaidExpensesPence,
    pensionPence: pension.available
      ? pension.employeeGrossContributionPence + pension.employerContributionPence
      : null,
    studentLoans: loans,
    payroll,
  };
}

function companyStatusIssues(
  status: ReturnType<typeof evaluateOffPayrollStatusEvidence>,
): ScenarioIssue[] {
  if (status.relevant && status.status === "outside" && status.issues.length === 0) {
    return [];
  }
  return [
    {
      code:
        status.status === "inside"
          ? "inside-off-payroll-company-comparison-unsupported"
          : "company-status-not-confirmed-outside",
      state: status.status === "inside" ? "unsupported" : "needs-review",
      detail:
        status.status === "inside"
          ? "The merged limited-company contract does not calculate a deemed-employment inside-IR35 company route."
          : "A company comparison needs complete supplied evidence that the service engagement is outside the off-payroll rules.",
      comparison: "company",
    },
  ];
}

function companyStrategyIssues(
  strategyId: string,
  feasible: boolean | undefined,
): ScenarioIssue[] {
  return feasible === true
    ? []
    : [
        {
          code: "company-strategy-unavailable",
          state: "unsupported",
          detail: `${strategyId} is missing or infeasible in the supplied limited-company scenario.`,
          comparison: "company",
        },
      ];
}

function companyPeriodIssues(
  taxYear: string,
  companyTaxYears: Set<string>,
): ScenarioIssue[] {
  return companyTaxYears.size === 1 && companyTaxYears.has(taxYear)
    ? []
    : [
        {
          code: "company-comparison-period-mismatch",
          state: "unsupported",
          detail: "The company comparison must use the same single tax year as the umbrella scenario.",
          comparison: "company",
        },
      ];
}

function evaluateCompanyComparison(input: UmbrellaScenarioInput) {
  const company = input.comparisons.company;
  if (company === null) return null;
  const status = evaluateOffPayrollStatusEvidence(input.offPayrollStatusEvidence);
  const result = evaluateLimitedCompanyScenario(company.scenario);
  const strategy = result.strategies.find(({ id }) => id === company.strategyId);
  const companyTaxYears = new Set(
    company.scenario.companyPeriods.map(({ taxYear }) => taxYear),
  );
  const issues: ScenarioIssue[] = [
    ...workBasisIssues(input.comparisonBasis, company.workBasis, "company"),
    ...companyStatusIssues(status),
    ...companyStrategyIssues(company.strategyId, strategy?.feasible),
    ...companyPeriodIssues(input.taxYear, companyTaxYears),
  ];
  return {
    route: "limited-company" as const,
    strategyId: company.strategyId,
    state: issues.length === 0 ? ("supported" as const) : ("unsupported" as const),
    issues,
    workBasis: company.workBasis,
    netCashPence: strategy?.totals.householdSpendableCashPence ?? null,
    deferredNetCashPence:
      strategy?.deferredExtraction.estimatedLaterHouseholdCashPence ?? null,
    retainedCompanyCashPence: strategy?.totals.endingCompanyCashPence ?? null,
    pensionPence: strategy?.totals.employerPensionContributionPence ?? null,
    result,
  };
}

function employerNiRuleFor(
  input: UmbrellaScenarioInput,
  payrollRule: ReturnType<typeof resolveUmbrellaPayrollRule>,
) {
  if (payrollRule === undefined) {
    return { rateBasisPoints: 0, thresholdPence: 0 };
  }
  return {
    rateBasisPoints: payrollRule.employerNationalInsurance.rateBasisPoints,
    thresholdPence:
      payrollRule.employerNationalInsurance.secondaryThresholdPence[
        input.payPeriod
      ],
  };
}

function calculationIssues(
  input: UmbrellaScenarioInput,
  payroll: HistoricalSalaryResult | null,
  loans: ReturnType<typeof studentLoanDeductions> | null,
  projection: ReturnType<typeof solveEmploymentCost>,
): ScenarioIssue[] {
  const issues: ScenarioIssue[] = [];
  if (loans !== null && !loans.standardPlanSupported) {
    issues.push({
      code: "unsupported-student-loan-plan-period",
      state: "unsupported",
      detail: `${input.studentLoan.standardPlan} does not have a payroll threshold in ${input.taxYear}.`,
    });
  }
  if (payroll === null || !payroll.available) {
    issues.push({
      code: "umbrella-payroll-unavailable",
      state: "unsupported",
      detail: "The PAYE estimate is unavailable for the supplied rules, National Insurance category, or pension arrangement.",
    });
  }
  if (projection.unallocatedAssignmentBalancePence > 100) {
    issues.push({
      code: "assignment-balance-not-allocated",
      state: "needs-review",
      detail: `${projection.unallocatedAssignmentBalancePence}p remains after solving the assignment-to-gross reconciliation.`,
    });
  }
  if (projection.assignmentBudgetShortfallPence > 0) {
    issues.push({
      code: "assignment-budget-insufficient",
      state: "unsupported",
      detail: `Employer costs exceed the assignment budget by ${projection.assignmentBudgetShortfallPence}p before gross pay.`,
    });
  }
  return issues;
}

function netCashFor(
  input: UmbrellaScenarioInput,
  payroll: HistoricalSalaryResult | null,
  loans: ReturnType<typeof studentLoanDeductions> | null,
) {
  if (payroll === null || !payroll.available || loans === null) return null;
  return (
    payroll.components.takeHomePayPence -
    loans.totalPence +
    input.reimbursedExpensesPence -
    input.workBasis.workerPaidExpensesPence
  );
}

function payslipResult(
  input: UmbrellaScenarioInput,
  payroll: HistoricalSalaryResult | null,
  loans: ReturnType<typeof studentLoanDeductions> | null,
  projection: ReturnType<typeof solveEmploymentCost>,
  contractualGrossPayPence: number,
  netCashPence: number | null,
) {
  const payrollComponents = payroll?.available ? payroll.components : null;
  const pension = projection.pension.available ? projection.pension : null;
  return {
    contractualGrossPayPence,
    taxablePayPence: payrollComponents?.taxablePayPence ?? null,
    salarySacrificePence: pension?.salarySacrificePence ?? null,
    incomeTaxPence: payrollComponents?.incomeTaxPence ?? null,
    employeeNationalInsurancePence:
      payrollComponents?.employeeNationalInsurancePence ?? null,
    employeePensionCashDeductionPence:
      pension?.employeeCashDeductionPence ?? null,
    providerPensionTaxReliefPence: pension?.providerTaxReliefPence ?? null,
    studentLoanPence: loans?.standardPence ?? null,
    postgraduateLoanPence: loans?.postgraduatePence ?? null,
    otherDeductionsPence: input.otherDeductionsPence,
    employeeTakeHomePence: payrollComponents?.takeHomePayPence ?? null,
    reimbursedExpensesPence: input.reimbursedExpensesPence,
    workerPaidExpensesPence: input.workBasis.workerPaidExpensesPence,
    netCashPence,
  };
}

function comparisonResult(
  input: UmbrellaScenarioInput,
  issues: readonly ScenarioIssue[],
  netCashPence: number | null,
  projection: ReturnType<typeof solveEmploymentCost>,
  directEmployment: ReturnType<typeof evaluateDirectEmploymentComparison>,
  company: ReturnType<typeof evaluateCompanyComparison>,
) {
  const pensionPence = projection.pension.available
    ? projection.pension.employeeGrossContributionPence +
      projection.pension.employerContributionPence
    : null;
  return {
    sharedBasis: input.comparisonBasis,
    umbrella: {
      route: "umbrella-employment" as const,
      state: issues.length === 0 ? ("supported" as const) : ("needs-review" as const),
      netCashPence,
      pensionPence,
      workBasis: input.workBasis,
    },
    directEmployment,
    company,
  };
}

function scenarioLineage(
  input: UmbrellaScenarioInput,
  payrollRule: ReturnType<typeof resolveUmbrellaPayrollRule>,
  payroll: HistoricalSalaryResult | null,
  projection: ReturnType<typeof solveEmploymentCost>,
) {
  const minimumWageRuleIds = [
    ...new Set(
      input.assignmentPeriods.flatMap((period) => {
        const rule = resolveMinimumWageRule(period.paidOn);
        return rule === undefined ? [] : [rule.ruleId];
      }),
    ),
  ];
  return {
    umbrellaRulesetVersion: UK_UMBRELLA_RULESET_VERSION,
    payrollRuleId: payrollRule?.ruleId ?? null,
    minimumWageRuleIds,
    pensionRuleId: projection.pension.available
      ? projection.pension.lineage.pensionRuleId
      : null,
    salaryRuleIds: payroll?.available
      ? payroll.lineage.rules.map(({ id }) => id)
      : [],
    sources: ukUmbrellaRuleSet.sources,
    rounding:
      "Rates are applied to pence. Assignment units are rounded to pence, and each pay-period National Insurance and loan amount is rounded to the nearest penny.",
  };
}

export function evaluateUmbrellaScenario(value: UmbrellaScenarioInput) {
  const input = UmbrellaScenarioInputSchema.parse(value);
  const payrollRule = resolveUmbrellaPayrollRule(input.taxYear, input.evaluatedOn);
  const employerNiRule = employerNiRuleFor(input, payrollRule);
  const revenueByPeriodPence = input.assignmentPeriods.map(assignmentRevenue);
  const marginByPeriodPence = marginByPeriod(input, revenueByPeriodPence);
  const availableByPeriodPence = revenueByPeriodPence.map((revenue, index) =>
    Math.max(0, revenue - (marginByPeriodPence[index] ?? 0)),
  );
  const projection = solveEmploymentCost(
    input,
    availableByPeriodPence,
    employerNiRule,
  );
  const payroll = salaryCalculation({
    effectiveDate: input.evaluatedOn,
    grossByPeriodPence: projection.grossByPeriodPence,
    incomeTaxJurisdiction: input.incomeTaxJurisdiction,
    nationalInsuranceCategory: input.nationalInsuranceCategory,
    otherDeductionsPence: input.otherDeductionsPence,
    otherTaxableIncomePence: input.otherTaxableIncomePence,
    payPeriod: input.payPeriod,
    pension: input.pension,
    pensionResult: projection.pension,
    taxYear: input.taxYear,
  });
  const loans =
    payrollRule === undefined
      ? null
      : studentLoanDeductions(
          input.studentLoan,
          projection.earningsByPeriodPence,
          input.payPeriod,
          payrollRule,
        );
  const issues = uniqueIssues([
    ...ruleAndInputIssues(input, payrollRule, projection),
    ...minimumWageIssues(input, projection),
    ...calculationIssues(input, payroll, loans, projection),
  ]);
  const status = evaluateOffPayrollStatusEvidence(input.offPayrollStatusEvidence);
  const directEmployment =
    payrollRule === undefined
      ? null
      : evaluateDirectEmploymentComparison(input, payrollRule);
  const company = evaluateCompanyComparison(input);
  const netCashPence = netCashFor(input, payroll, loans);
  const assignmentRevenuePence = sum(revenueByPeriodPence);
  const marginPence = sum(marginByPeriodPence);
  const employerNationalInsurancePence = sum(
    projection.employerNiByPeriodPence,
  );
  const holidayAccruedPence = sum(projection.holiday.accruedByPeriodPence);
  const holidayPaidPence = sum(projection.holiday.paidByPeriodPence);
  const contractualGrossPayPence = sum(projection.grossByPeriodPence);
  const reconciliationSourcesPence =
    assignmentRevenuePence + projection.holiday.openingReservePence;
  const reconciliationUsesPence =
    marginPence +
    sum(projection.basePayByPeriodPence) +
    holidayPaidPence +
    employerNationalInsurancePence +
    projection.levyPence +
    projection.employerPensionPence +
    projection.holiday.closingReservePence +
    projection.unallocatedAssignmentBalancePence;

  return {
    kind: "uk-umbrella-employment-scenario" as const,
    scenarioVersion: UMBRELLA_SCENARIO_VERSION,
    calculationVersion: UMBRELLA_CALCULATION_VERSION,
    rulesetVersion: UK_UMBRELLA_RULESET_VERSION,
    savedScenario: {
      id: input.id,
      label: input.label,
      savedAt: input.savedAt,
      revision: input.revision,
    },
    taxYear: input.taxYear,
    evaluatedOn: input.evaluatedOn,
    available: issues.length === 0 && netCashPence !== null,
    issues,
    assignment: {
      payPeriod: input.payPeriod,
      assignmentRevenuePence,
      workedDays: input.workBasis.workedDays,
      workedHours: sum(input.assignmentPeriods.map(({ workedHours }) => workedHours)),
      workingPeriods: input.assignmentPeriods.filter(
        (period) => period.workedUnits > 0,
      ).length,
      rates: input.assignmentPeriods.map(
        ({ id, assignmentRatePence, rateUnit, workedUnits, assignmentBonusPence }) => ({
          periodId: id,
          assignmentRatePence,
          rateUnit,
          workedUnits,
          assignmentBonusPence,
        }),
      ),
    },
    reconciliation: {
      assignmentRevenuePence,
      openingHolidayReservePence: projection.holiday.openingReservePence,
      umbrellaMarginPence: marginPence,
      employerCosts: {
        employerNationalInsurancePence,
        apprenticeshipLevyPence: projection.levyPence,
        employerPensionContributionPence: projection.employerPensionPence,
      },
      holidayPay: {
        method: input.holidayPay.method,
        accruedPence: holidayAccruedPence,
        paidPence: holidayPaidPence,
        closingReservePence: projection.holiday.closingReservePence,
      },
      baseGrossPayPence: sum(projection.basePayByPeriodPence),
      contractualGrossPayPence,
      unallocatedAssignmentBalancePence:
        projection.unallocatedAssignmentBalancePence,
      assignmentBudgetShortfallPence:
        projection.assignmentBudgetShortfallPence,
      sourceTotalPence: reconciliationSourcesPence,
      useTotalPence: reconciliationUsesPence,
      differencePence: reconciliationSourcesPence - reconciliationUsesPence,
      employerCostsAreGrossPayDeductions: false,
    },
    payslip: payslipResult(
      input,
      payroll,
      loans,
      projection,
      contractualGrossPayPence,
      netCashPence,
    ),
    pension: projection.pension,
    rights: input.workBasis.rights,
    workBasis: input.workBasis,
    offPayrollStatus: {
      suppliedEngagementEvidence: status,
      umbrellaEmploymentApplicability: "not-applicable" as const,
      explanation:
        "The umbrella route is employment. The supplied off-payroll evidence applies only to a relevant service engagement through the worker's own intermediary.",
    },
    comparisons: comparisonResult(
      input,
      issues,
      netCashPence,
      projection,
      directEmployment,
      company,
    ),
    periods: input.assignmentPeriods.map((period, index) => ({
      periodId: period.id,
      paidOn: period.paidOn,
      assignmentRevenuePence: revenueByPeriodPence[index] ?? 0,
      umbrellaMarginPence: marginByPeriodPence[index] ?? 0,
      baseGrossPayPence: projection.basePayByPeriodPence[index] ?? 0,
      holidayPaidPence: projection.holiday.paidByPeriodPence[index] ?? 0,
      holidayAccruedPence: projection.holiday.accruedByPeriodPence[index] ?? 0,
      contractualGrossPayPence: projection.grossByPeriodPence[index] ?? 0,
      postSacrificeEarningsPence:
        projection.earningsByPeriodPence[index] ?? 0,
      employerNationalInsurancePence:
        projection.employerNiByPeriodPence[index] ?? 0,
    })),
    lineage: scenarioLineage(input, payrollRule, payroll, projection),
  };
}

export type UmbrellaScenarioResult = ReturnType<
  typeof evaluateUmbrellaScenario
>;
