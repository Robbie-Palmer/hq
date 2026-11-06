import {
  calculateHouseholdTaxPosition,
  type HouseholdTaxContribution,
  type HouseholdTaxIncome,
  type HouseholdTaxRequest,
} from "finance-tax-rules/household-tax";
import { z } from "zod";
import {
  IsoDateSchema,
  SIDE_INCOME_CONTRACT_VERSION,
  SideIncomeCaseSchema,
  TaxYearSchema,
  type FinancialFact,
  type SideIncomeCase,
} from "./sideIncome";
import {
  SUPPORTED_LIMITED_COMPANY_TAX_YEARS,
  UK_LIMITED_COMPANY_RULESET_VERSION,
  ukLimitedCompanyRuleSet,
} from "./limitedCompanyRules";

export const LIMITED_COMPANY_SCENARIO_VERSION = 1 as const;
export const LIMITED_COMPANY_CALCULATION_VERSION = "1" as const;

const PenceSchema = z.number().int().nonnegative();
const IdentifierSchema = z.string().trim().min(1);
const IncomeTaxJurisdictionSchema = z.enum([
  "england-and-northern-ireland",
  "scotland",
  "wales",
]);

const ExpenseTreatmentSchema = z
  .object({
    factId: IdentifierSchema,
    corporationTaxTreatment: z.enum(["allowable", "disallowable", "unknown"]),
    category: z.enum([
      "direct",
      "accountancy",
      "bookkeeping",
      "payroll",
      "companies-house",
      "insurance",
      "software",
      "other",
    ]),
  })
  .strict();

const VatInputSchema = z
  .object({
    registrationStatus: z.enum(["not-registered", "registered"]),
    schemeUse: z.enum(["joining", "continuing"]),
    scheme: z.enum([
      "none",
      "standard-accrual",
      "cash-accounting",
      "annual-accounting",
      "flat-rate",
    ]),
    taxableTurnoverPence: PenceSchema,
    outputVatPence: PenceSchema,
    recoverableInputVatPence: PenceSchema,
    flatRatePercentageBasisPoints: z.number().int().min(0).max(10_000).nullable(),
    limitedCostBusiness: z.enum(["yes", "no", "unknown"]),
    flatRateCapitalInputVatPence: PenceSchema,
    flatRateCapitalPurchaseGrossPence: PenceSchema,
    allReturnsAndPaymentsUpToDate: z.enum(["yes", "no", "unknown"]),
    hasExcludedCashAccountingTransactions: z.enum(["yes", "no", "unknown"]),
    periodEndsOn: IsoDateSchema,
  })
  .strict();

const CompanyPeriodSchema = z
  .object({
    id: IdentifierSchema,
    taxYear: TaxYearSchema,
    accountingPeriodStartsOn: IsoDateSchema,
    accountingPeriodEndsOn: IsoDateSchema,
    revenueFactIds: z.array(IdentifierSchema).min(1),
    expenseTreatments: z.array(ExpenseTreatmentSchema),
    exemptDistributionsReceivedPence: PenceSchema,
    cash: z
      .object({
        tradeReceiptsExcludingVatPence: PenceSchema,
        expensePaymentsExcludingVatPence: PenceSchema,
        outputVatReceivedPence: PenceSchema,
        inputVatPaidPence: PenceSchema,
        corporationTaxPaidPence: PenceSchema,
        vatPaidToHmrcPence: PenceSchema,
      })
      .strict(),
    vat: VatInputSchema,
    administrationHours: z.number().nonnegative(),
  })
  .strict();

const PeriodPlanSchema = z
  .object({
    companyPeriodId: IdentifierSchema,
    salaryPence: PenceSchema,
    dividendPence: PenceSchema,
    employerPensionContributionPence: PenceSchema,
    employerPensionReliefEligibility: z.enum([
      "eligible",
      "ineligible",
      "unknown",
    ]),
    employmentAllowanceEligibility: z.enum([
      "eligible",
      "ineligible-single-director",
      "ineligible-other",
      "unknown",
    ]),
    employmentAllowanceRemainingPence: PenceSchema,
    otherEmployeeEmployerNiPence: PenceSchema,
    baselinePersonalIncomeFactIds: z.array(IdentifierSchema),
    existingPensionInputPence: PenceSchema,
    pensionCarryForwardAvailablePence: PenceSchema,
    moneyPurchaseAnnualAllowanceApplies: z.boolean(),
  })
  .strict();

const GoalSchema = z
  .object({
    companyPeriodId: IdentifierSchema,
    minimumHouseholdCashPence: PenceSchema,
    minimumEmployerPensionPence: PenceSchema,
    minimumCompanyCashAfterReservesPence: PenceSchema,
  })
  .strict();

const UnsupportedComplexitySchema = z.enum([
  "benefits-in-kind",
  "chargeable-gains",
  "close-investment-holding-company",
  "cross-border-vat",
  "group-relief",
  "loans-to-participators",
  "multiple-share-classes",
  "off-payroll-working",
  "partial-exemption",
  "research-and-development-relief",
  "ring-fence-profits",
]);

export const LimitedCompanyScenarioInputSchema = z
  .object({
    scenarioVersion: z.literal(LIMITED_COMPANY_SCENARIO_VERSION),
    sideIncomeCase: SideIncomeCaseSchema,
    evaluatedOn: IsoDateSchema,
    companyId: IdentifierSchema,
    ownerPersonId: IdentifierSchema,
    incomeTaxJurisdiction: IncomeTaxJurisdictionSchema,
    openingCompanyCashPence: PenceSchema,
    openingDistributableReservesPence: PenceSchema,
    companiesInAssociatedGroup: z.number().int().positive(),
    companyPeriods: z.array(CompanyPeriodSchema).min(1),
    strategies: z
      .array(
        z
          .object({
            id: IdentifierSchema,
            label: z.string().trim().min(1),
            periodPlans: z.array(PeriodPlanSchema).min(1),
            laterExtraction: z
              .object({
                taxYear: TaxYearSchema,
                baselinePersonalIncomeFactIds: z.array(IdentifierSchema),
              })
              .strict(),
          })
          .strict(),
      )
      .min(1),
    goals: z.array(GoalSchema),
    administration: z
      .object({
        setupHours: z.number().nonnegative(),
        hourlyValuePence: PenceSchema,
        incorporationFeePence: PenceSchema,
      })
      .strict(),
    unsupportedComplexities: z.array(UnsupportedComplexitySchema),
  })
  .strict()
  .superRefine((input, context) => {
    const unique = (
      values: readonly string[],
      path: Array<string | number>,
      message: string,
    ) => {
      if (new Set(values).size !== values.length) {
        context.addIssue({ code: "custom", message, path });
      }
    };
    unique(
      input.companyPeriods.map(({ id }) => id),
      ["companyPeriods"],
      "Company period IDs must be unique",
    );
    unique(
      input.strategies.map(({ id }) => id),
      ["strategies"],
      "Strategy IDs must be unique",
    );
    input.companyPeriods.forEach((period, index) => {
      unique(
        period.revenueFactIds,
        ["companyPeriods", index, "revenueFactIds"],
        "Revenue fact IDs must be unique within a period",
      );
      unique(
        period.expenseTreatments.map(({ factId }) => factId),
        ["companyPeriods", index, "expenseTreatments"],
        "Each expense fact can have only one treatment within a period",
      );
      if (period.accountingPeriodStartsOn > period.accountingPeriodEndsOn) {
        context.addIssue({
          code: "custom",
          message: "An accounting period cannot end before it starts",
          path: ["companyPeriods", index, "accountingPeriodEndsOn"],
        });
      }
    });
    const periodIds = new Set(input.companyPeriods.map(({ id }) => id));
    input.strategies.forEach((strategy, strategyIndex) => {
      unique(
        strategy.periodPlans.map(({ companyPeriodId }) => companyPeriodId),
        ["strategies", strategyIndex, "periodPlans"],
        "A strategy can contain only one plan for each company period",
      );
      strategy.periodPlans.forEach((plan, planIndex) => {
        if (!periodIds.has(plan.companyPeriodId)) {
          context.addIssue({
            code: "custom",
            message: `Unknown company period ${plan.companyPeriodId}`,
            path: ["strategies", strategyIndex, "periodPlans", planIndex],
          });
        }
      });
    });
  });

export type LimitedCompanyScenarioInput = z.infer<
  typeof LimitedCompanyScenarioInputSchema
>;

type ScenarioIssue = {
  code: string;
  state: "needs-review" | "unsupported";
  detail: string;
  strategyId?: string;
  companyPeriodId?: string;
};

type CompanyPeriod = LimitedCompanyScenarioInput["companyPeriods"][number];
type PeriodPlan = LimitedCompanyScenarioInput["strategies"][number]["periodPlans"][number];

const sum = (values: readonly number[]) =>
  values.reduce((total, value) => total + value, 0);

const roundRate = (amountPence: number, rateBasisPoints: number) =>
  Math.round((amountPence * rateBasisPoints) / 10_000);

const uniqueIssues = (issues: ScenarioIssue[]) =>
  issues.filter(
    (issue, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.code === issue.code &&
          candidate.detail === issue.detail &&
          candidate.strategyId === issue.strategyId &&
          candidate.companyPeriodId === issue.companyPeriodId,
      ) === index,
  );

const isoDate = (date: string) => new Date(`${date}T00:00:00.000Z`);

const formatIsoDate = (date: Date) => date.toISOString().slice(0, 10);

const addDays = (date: string, days: number) => {
  const value = isoDate(date);
  value.setUTCDate(value.getUTCDate() + days);
  return formatIsoDate(value);
};

const addMonths = (date: string, months: number) => {
  const value = isoDate(date);
  const day = value.getUTCDate();
  const firstOfTarget = new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + months, 1),
  );
  const lastOfTarget = new Date(
    Date.UTC(
      firstOfTarget.getUTCFullYear(),
      firstOfTarget.getUTCMonth() + 1,
      0,
    ),
  ).getUTCDate();
  firstOfTarget.setUTCDate(Math.min(day, lastOfTarget));
  return formatIsoDate(firstOfTarget);
};

const inclusiveDays = (startsOn: string, endsOn: string) =>
  Math.round((isoDate(endsOn).valueOf() - isoDate(startsOn).valueOf()) / 86_400_000) +
  1;

function selectedFacts(
  sideIncomeCase: SideIncomeCase,
  ids: readonly string[],
) {
  const facts = new Map(
    sideIncomeCase.financialFacts.map((fact) => [fact.id, fact]),
  );
  return ids.map((id) => facts.get(id)).filter((fact) => fact !== undefined);
}

function scopedPeriodFacts(
  input: LimitedCompanyScenarioInput,
  period: CompanyPeriod,
) {
  const factById = new Map(
    input.sideIncomeCase.financialFacts.map((fact) => [fact.id, fact]),
  );
  const issues: ScenarioIssue[] = [];
  const revenueFacts = period.revenueFactIds.flatMap((factId) => {
    const fact = factById.get(factId);
    const valid =
      fact?.kind === "gross-revenue" &&
      fact.businessId === input.companyId &&
      fact.taxYear === period.taxYear &&
      fact.amount.minorUnits >= 0;
    if (valid) return [fact];
    issues.push({
      code: "invalid-company-revenue-fact",
      state: "needs-review",
      detail: `${factId} is not company revenue for ${input.companyId} in ${period.taxYear}.`,
      companyPeriodId: period.id,
    });
    return [];
  });
  const expenseFacts = period.expenseTreatments.flatMap((treatment) => {
    const fact = factById.get(treatment.factId);
    const valid =
      fact?.kind === "business-cost" &&
      fact.businessId === input.companyId &&
      fact.taxYear === period.taxYear &&
      fact.amount.minorUnits >= 0;
    if (valid) return [{ fact, treatment }];
    issues.push({
      code: "invalid-company-expense-fact",
      state: "needs-review",
      detail: `${treatment.factId} is not a company cost for ${input.companyId} in ${period.taxYear}.`,
      companyPeriodId: period.id,
    });
    return [];
  });
  expenseFacts
    .filter(({ treatment }) => treatment.corporationTaxTreatment === "unknown")
    .forEach(({ fact }) => {
      issues.push({
        code: "unknown-expense-tax-treatment",
        state: "needs-review",
        detail: `${fact.id} needs a Corporation Tax treatment before the strategy is feasible.`,
        companyPeriodId: period.id,
      });
    });
  return { revenueFacts, expenseFacts, issues };
}

function companyScopeIssues(input: LimitedCompanyScenarioInput): ScenarioIssue[] {
  const company = input.sideIncomeCase.businesses.find(
    ({ id }) => id === input.companyId,
  );
  const owner = input.sideIncomeCase.people.find(
    ({ id }) => id === input.ownerPersonId,
  );
  const ownership = input.sideIncomeCase.businessOwnerships.find(
    ({ businessId, personId }) =>
      businessId === input.companyId && personId === input.ownerPersonId,
  );
  const issues: ScenarioIssue[] = [];
  if (company?.structure !== "uk-limited-company") {
    issues.push({
      code: "unsupported-company-structure",
      state: "unsupported",
      detail: `${input.companyId} is not a UK limited company in the released side-income case.`,
    });
  }
  if (owner?.taxResidence.status !== "resident" || owner.taxResidence.jurisdiction !== "GB") {
    issues.push({
      code: "unsupported-owner-residence",
      state: "unsupported",
      detail: `${input.ownerPersonId} is not recorded as UK resident.`,
    });
  }
  if (ownership?.ownershipBasisPoints !== 10_000) {
    issues.push({
      code: "unsupported-company-ownership",
      state: "unsupported",
      detail: "The released model supports one owner holding 100% of one ordinary share class.",
    });
  }
  for (const complexity of input.unsupportedComplexities) {
    issues.push({
      code: `unsupported-${complexity}`,
      state: "unsupported",
      detail: `${complexity} is recorded but is outside this limited-company calculation.`,
    });
  }
  const companyActivityIds = new Set(
    input.sideIncomeCase.activityOwnerships
      .filter(({ businessId }) => businessId === input.companyId)
      .map(({ activityId }) => activityId),
  );
  for (const arrangement of input.sideIncomeCase.customerArrangements.filter(
    ({ activityId }) => companyActivityIds.has(activityId),
  )) {
    if (arrangement.customerJurisdiction !== "GB") {
      issues.push({
        code: "unsupported-cross-border-customer",
        state: "unsupported",
        detail: `${arrangement.id} has a non-GB customer and needs a cross-border tax review.`,
      });
    }
    if (arrangement.offPayrollAssessment === "inside") {
      issues.push({
        code: "unsupported-inside-off-payroll-engagement",
        state: "unsupported",
        detail: `${arrangement.id} is inside off-payroll rules and is not company trading revenue here.`,
      });
    }
  }
  return issues;
}

function vatRegistrationStatus(
  input: LimitedCompanyScenarioInput,
  period: CompanyPeriod,
) {
  const position = input.sideIncomeCase.vatPositions
    .filter(
      ({ businessId, assessedOn }) =>
        businessId === input.companyId &&
        assessedOn <= input.evaluatedOn &&
        assessedOn <= period.accountingPeriodEndsOn,
    )
    .sort((left, right) => right.assessedOn.localeCompare(left.assessedOn))[0];
  const rule = ukLimitedCompanyRuleSet.vat;
  if (
    position?.allSuppliesExemptOrOutOfScope === "unknown" ||
    position?.trailingTwelveMonthTaxableTurnover == null ||
    position.expectedNextThirtyDayTaxableTurnover == null
  ) {
    return {
      status: "unknown" as const,
      issues: [
        {
          code: "unknown-vat-registration-position",
          state: "needs-review" as const,
          detail: `VAT registration cannot be resolved for ${period.id}.`,
          companyPeriodId: period.id,
        },
      ],
    };
  }
  const exempt = position.allSuppliesExemptOrOutOfScope === true;
  const required =
    !exempt &&
    (position.trailingTwelveMonthTaxableTurnover.minorUnits >
      rule.registrationThresholdPence ||
      position.expectedNextThirtyDayTaxableTurnover.minorUnits >
        rule.registrationThresholdPence);
  return { status: required ? ("required" as const) : ("optional" as const), issues: [] };
}

function registeredVatSchemeIssues(period: CompanyPeriod): ScenarioIssue[] {
  const { vat } = period;
  const rule = ukLimitedCompanyRuleSet.vat;
  const issues: ScenarioIssue[] = [];
  if (vat.scheme === "none") {
    issues.push({
      code: "missing-vat-scheme",
      state: "needs-review",
      detail: `${period.id} is VAT registered but has no accounting scheme.`,
      companyPeriodId: period.id,
    });
  }
  const thresholdPence =
    vat.schemeUse === "joining"
      ? rule.cashAndAnnualJoinThresholdPence
      : rule.cashAndAnnualLeaveThresholdPence;
  const turnoverTestedScheme =
    vat.scheme === "cash-accounting" || vat.scheme === "annual-accounting";
  if (turnoverTestedScheme && vat.taxableTurnoverPence > thresholdPence) {
    issues.push({
      code: "vat-scheme-turnover-ineligible",
      state: "unsupported",
      detail: `${period.id} exceeds the VAT ${vat.scheme} ${vat.schemeUse} threshold.`,
      companyPeriodId: period.id,
    });
  }
  if (
    vat.scheme === "cash-accounting" &&
    vat.allReturnsAndPaymentsUpToDate !== "yes"
  ) {
    issues.push({
      code: "cash-vat-eligibility-unconfirmed",
      state: "needs-review",
      detail: `${period.id} needs confirmed up-to-date VAT returns and payments for cash accounting.`,
      companyPeriodId: period.id,
    });
  }
  if (
    vat.scheme === "cash-accounting" &&
    vat.hasExcludedCashAccountingTransactions !== "no"
  ) {
    issues.push({
      code: "cash-vat-transactions-unconfirmed",
      state: "needs-review",
      detail: `${period.id} needs confirmation that no excluded cash-accounting transactions apply.`,
      companyPeriodId: period.id,
    });
  }
  return issues;
}

function flatRateVat(period: CompanyPeriod) {
  const { vat } = period;
  const rule = ukLimitedCompanyRuleSet.vat;
  const issues: ScenarioIssue[] = [];
  const thresholdPence =
    vat.schemeUse === "joining"
      ? rule.flatRateJoinThresholdPence
      : rule.flatRateLeaveThresholdPence;
  if (vat.taxableTurnoverPence > thresholdPence) {
    issues.push({
      code: "flat-rate-vat-turnover-ineligible",
      state: "unsupported",
      detail: `${period.id} exceeds the Flat Rate Scheme ${vat.schemeUse} threshold.`,
      companyPeriodId: period.id,
    });
  }
  if (vat.flatRatePercentageBasisPoints == null) {
    issues.push({
      code: "missing-flat-rate-percentage",
      state: "needs-review",
      detail: `${period.id} needs its trade-specific Flat Rate Scheme percentage.`,
      companyPeriodId: period.id,
    });
  }
  if (vat.limitedCostBusiness === "unknown") {
    issues.push({
      code: "unknown-limited-cost-business-status",
      state: "needs-review",
      detail: `${period.id} needs the limited-cost-business test before using a flat rate.`,
      companyPeriodId: period.id,
    });
  }
  if (
    vat.limitedCostBusiness === "yes" &&
    vat.flatRatePercentageBasisPoints !== rule.limitedCostRateBasisPoints
  ) {
    issues.push({
      code: "incorrect-limited-cost-flat-rate",
      state: "needs-review",
      detail: `${period.id} must use the 16.5% limited-cost-business rate.`,
      companyPeriodId: period.id,
    });
  }
  const capitalVatEligible =
    vat.flatRateCapitalPurchaseGrossPence >=
    rule.flatRateCapitalPurchaseMinimumPence;
  if (!capitalVatEligible && vat.flatRateCapitalInputVatPence > 0) {
    issues.push({
      code: "flat-rate-capital-vat-ineligible",
      state: "needs-review",
      detail: `${period.id} claims capital input VAT below the single-purchase threshold.`,
      companyPeriodId: period.id,
    });
  }
  const inputVatReclaimedPence = capitalVatEligible
    ? vat.flatRateCapitalInputVatPence
    : 0;
  return {
    inputVatReclaimedPence,
    liabilityPence: Math.max(
      0,
      roundRate(
        vat.taxableTurnoverPence + vat.outputVatPence,
        vat.flatRatePercentageBasisPoints ?? 0,
      ) - inputVatReclaimedPence,
    ),
    issues,
  };
}

function calculateVat(
  input: LimitedCompanyScenarioInput,
  period: CompanyPeriod,
) {
  const vat = period.vat;
  const rule = ukLimitedCompanyRuleSet.vat;
  const registration = vatRegistrationStatus(input, period);
  const issues: ScenarioIssue[] = [...registration.issues];
  if (registration.status === "required" && vat.registrationStatus !== "registered") {
    issues.push({
      code: "vat-registration-required",
      state: "needs-review",
      detail: `${period.id} exceeds a VAT registration test but is marked not registered.`,
      companyPeriodId: period.id,
    });
  }
  if (vat.registrationStatus === "not-registered") {
    if (
      vat.scheme !== "none" ||
      vat.outputVatPence !== 0 ||
      vat.recoverableInputVatPence !== 0
    ) {
      issues.push({
        code: "invalid-unregistered-vat",
        state: "needs-review",
        detail: `${period.id} cannot use a VAT scheme or reclaim VAT while unregistered.`,
        companyPeriodId: period.id,
      });
    }
    return {
      registrationStatus: registration.status,
      scheme: vat.scheme,
      outputVatPence: 0,
      inputVatReclaimedPence: 0,
      liabilityPence: 0,
      returnDueOn: null,
      passThroughVatIncludedInRevenue: false,
      issues,
    };
  }
  issues.push(...registeredVatSchemeIssues(period));
  let liabilityPence = Math.max(
    0,
    vat.outputVatPence - vat.recoverableInputVatPence,
  );
  let inputVatReclaimedPence = vat.recoverableInputVatPence;
  if (vat.scheme === "flat-rate") {
    const flatRate = flatRateVat(period);
    inputVatReclaimedPence = flatRate.inputVatReclaimedPence;
    liabilityPence = flatRate.liabilityPence;
    issues.push(...flatRate.issues);
  }
  const returnDueOn =
    vat.scheme === "annual-accounting"
      ? addMonths(
          vat.periodEndsOn,
          rule.annualReturnDeadlineCalendarMonths,
        )
      : addDays(
          addMonths(vat.periodEndsOn, rule.returnDeadlineCalendarMonths),
          rule.returnDeadlineExtraDays,
        );
  return {
    registrationStatus: registration.status,
    scheme: vat.scheme,
    outputVatPence: vat.outputVatPence,
    inputVatReclaimedPence,
    liabilityPence,
    returnDueOn,
    passThroughVatIncludedInRevenue: false,
    issues,
  };
}

function directorEmployeeNi(salaryPence: number) {
  const rule = ukLimitedCompanyRuleSet.payroll;
  return (
    roundRate(
      Math.max(
        0,
        Math.min(salaryPence, rule.upperEarningsLimitPence) -
          rule.primaryThresholdPence,
      ),
      rule.employeeMainRateBasisPoints,
    ) +
    roundRate(
      Math.max(0, salaryPence - rule.upperEarningsLimitPence),
      rule.employeeAdditionalRateBasisPoints,
    )
  );
}

function employerNi(plan: PeriodPlan, strategyId: string) {
  const rule = ukLimitedCompanyRuleSet.payroll;
  const directorLiabilityPence = roundRate(
    Math.max(0, plan.salaryPence - rule.secondaryThresholdPence),
    rule.employerRateBasisPoints,
  );
  const grossLiabilityPence =
    directorLiabilityPence + plan.otherEmployeeEmployerNiPence;
  const issues: ScenarioIssue[] = [];
  let allowanceUsedPence = 0;
  if (plan.employmentAllowanceEligibility === "unknown") {
    issues.push({
      code: "unknown-employment-allowance-eligibility",
      state: "needs-review",
      detail: "Employment Allowance eligibility must be confirmed before comparing salary strategies.",
      strategyId,
      companyPeriodId: plan.companyPeriodId,
    });
  } else if (plan.employmentAllowanceEligibility === "eligible") {
    allowanceUsedPence = Math.min(
      grossLiabilityPence,
      plan.employmentAllowanceRemainingPence,
      rule.employmentAllowancePence,
    );
  }
  if (
    plan.employmentAllowanceEligibility === "ineligible-single-director" &&
    plan.otherEmployeeEmployerNiPence > 0
  ) {
    issues.push({
      code: "inconsistent-single-director-employment-allowance",
      state: "needs-review",
      detail: "The plan records other employee employer NI but marks the director as the only liable employee.",
      strategyId,
      companyPeriodId: plan.companyPeriodId,
    });
  }
  return {
    directorLiabilityPence,
    otherEmployeeLiabilityPence: plan.otherEmployeeEmployerNiPence,
    grossLiabilityPence,
    employmentAllowanceUsedPence: allowanceUsedPence,
    employerNiPence: grossLiabilityPence - allowanceUsedPence,
    issues,
  };
}

function corporationTax({
  period,
  taxableProfitPence,
  companiesInAssociatedGroup,
}: {
  period: CompanyPeriod;
  taxableProfitPence: number;
  companiesInAssociatedGroup: number;
}) {
  const rule = ukLimitedCompanyRuleSet.corporationTax;
  const days = inclusiveDays(
    period.accountingPeriodStartsOn,
    period.accountingPeriodEndsOn,
  );
  const lowerLimitPence = Math.floor(
    (rule.lowerLimitPence * days) / 365 / companiesInAssociatedGroup,
  );
  const upperLimitPence = Math.floor(
    (rule.upperLimitPence * days) / 365 / companiesInAssociatedGroup,
  );
  const augmentedProfitsPence =
    taxableProfitPence + period.exemptDistributionsReceivedPence;
  if (taxableProfitPence <= 0) {
    return {
      band: "no-taxable-profit" as const,
      taxableProfitPence,
      augmentedProfitsPence,
      lowerLimitPence,
      upperLimitPence,
      marginalReliefPence: 0,
      corporationTaxPence: 0,
      effectiveRateBasisPoints: 0,
    };
  }
  if (augmentedProfitsPence <= lowerLimitPence) {
    const tax = roundRate(taxableProfitPence, rule.smallProfitsRateBasisPoints);
    return {
      band: "small-profits" as const,
      taxableProfitPence,
      augmentedProfitsPence,
      lowerLimitPence,
      upperLimitPence,
      marginalReliefPence: 0,
      corporationTaxPence: tax,
      effectiveRateBasisPoints: Math.round((tax * 10_000) / taxableProfitPence),
    };
  }
  if (augmentedProfitsPence >= upperLimitPence) {
    const tax = roundRate(taxableProfitPence, rule.mainRateBasisPoints);
    return {
      band: "main-rate" as const,
      taxableProfitPence,
      augmentedProfitsPence,
      lowerLimitPence,
      upperLimitPence,
      marginalReliefPence: 0,
      corporationTaxPence: tax,
      effectiveRateBasisPoints: Math.round((tax * 10_000) / taxableProfitPence),
    };
  }
  const mainRateTaxPence = roundRate(
    taxableProfitPence,
    rule.mainRateBasisPoints,
  );
  const marginalReliefPence = Math.round(
    ((upperLimitPence - augmentedProfitsPence) *
      rule.marginalReliefNumerator *
      taxableProfitPence) /
      rule.marginalReliefDenominator /
      augmentedProfitsPence,
  );
  const tax = mainRateTaxPence - marginalReliefPence;
  return {
    band: "marginal-relief" as const,
    taxableProfitPence,
    augmentedProfitsPence,
    lowerLimitPence,
    upperLimitPence,
    marginalReliefPence,
    corporationTaxPence: tax,
    effectiveRateBasisPoints: Math.round((tax * 10_000) / taxableProfitPence),
  };
}

const factEvidence = (fact: FinancialFact) => ({
  kind: fact.status === "actual" ? ("observed" as const) : ("assumption" as const),
  timing: fact.status === "actual" ? ("to-date" as const) : ("year-end" as const),
  sourceRecordId: fact.id,
  detail: `${fact.kind} from ${fact.lineage.sourceId} revision ${fact.lineage.sourceRevision}`,
});

function personalIncomeRecords(
  input: LimitedCompanyScenarioInput,
  taxYear: string,
  factIds: readonly string[],
): HouseholdTaxIncome[] {
  const records: HouseholdTaxIncome[] = [];
  for (const fact of selectedFacts(input.sideIncomeCase, factIds)) {
    const owned =
      fact.taxYear === taxYear &&
      fact.owner.kind === "person" &&
      fact.owner.personId === input.ownerPersonId;
    if (!owned) continue;
    if (fact.kind === "salary" || fact.kind === "other-taxable-income") {
      records.push({
        id: fact.id,
        memberId: input.ownerPersonId,
        employmentId: `baseline:${fact.id}`,
        kind: "employment",
        amountPence: fact.amount.minorUnits,
        evidence: factEvidence(fact),
      });
    }
    if (fact.kind === "dividend") {
      records.push({
        id: fact.id,
        memberId: input.ownerPersonId,
        kind: "dividend",
        amountPence: fact.amount.minorUnits,
        evidence: factEvidence(fact),
      });
    }
  }
  return records;
}

function householdRequest({
  input,
  taxYear,
  baselineFactIds,
  salaryPence,
  dividendPence,
  employerPensionContributionPence,
  existingPensionInputPence,
}: {
  input: LimitedCompanyScenarioInput;
  taxYear: string;
  baselineFactIds: readonly string[];
  salaryPence: number;
  dividendPence: number;
  employerPensionContributionPence: number;
  existingPensionInputPence: number;
}): HouseholdTaxRequest {
  const incomes = personalIncomeRecords(input, taxYear, baselineFactIds);
  if (salaryPence > 0) {
    incomes.push({
      id: "scenario:company-salary",
      memberId: input.ownerPersonId,
      employmentId: `scenario:${input.companyId}`,
      kind: "employment",
      amountPence: salaryPence,
      evidence: {
        kind: "assumption",
        timing: "year-end",
        sourceRecordId: "scenario:company-salary",
        detail: "Gross director salary in the limited-company strategy",
      },
    });
  }
  if (dividendPence > 0) {
    incomes.push({
      id: "scenario:company-dividend",
      memberId: input.ownerPersonId,
      kind: "dividend",
      amountPence: dividendPence,
      evidence: {
        kind: "assumption",
        timing: "year-end",
        sourceRecordId: "scenario:company-dividend",
        detail: "Dividend declared by the limited company",
      },
    });
  }
  const contributions: HouseholdTaxContribution[] = [];
  if (existingPensionInputPence > 0) {
    contributions.push({
      id: "scenario:existing-pension-input",
      memberId: input.ownerPersonId,
      accountId: `pension:${input.ownerPersonId}`,
      kind: "pension",
      amountPence: existingPensionInputPence,
      pensionMethod: "salary-sacrifice",
      employerContribution: true,
      evidence: {
        kind: "assumption",
        timing: "year-end",
        sourceRecordId: "scenario:existing-pension-input",
        detail: "Other pension input supplied for annual-allowance testing",
      },
    });
  }
  if (employerPensionContributionPence > 0) {
    contributions.push({
      id: "scenario:company-employer-pension",
      memberId: input.ownerPersonId,
      accountId: `pension:${input.ownerPersonId}`,
      kind: "pension",
      amountPence: employerPensionContributionPence,
      pensionMethod: "salary-sacrifice",
      employerContribution: true,
      evidence: {
        kind: "assumption",
        timing: "year-end",
        sourceRecordId: "scenario:company-employer-pension",
        detail: "Employer contribution to the director's registered pension scheme",
      },
    });
  }
  return {
    taxYear,
    people: [
      {
        memberId: input.ownerPersonId,
        displayName: input.ownerPersonId,
        jurisdiction: input.incomeTaxJurisdiction,
        residence: "full-year-uk",
        hasTaxableBenefits: false,
        nationalInsuranceCategory: "A",
        isCompanyDirector: false,
        flexiblyAccessedPension: false,
        evidence: {
          kind: "assumption",
          sourceRecordId: `residence:${input.ownerPersonId}`,
          detail: "UK residence from the released side-income contract",
        },
      },
    ],
    accounts: [
      {
        id: `pension:${input.ownerPersonId}`,
        memberId: input.ownerPersonId,
        name: "Director pension",
        wrapper: "pension",
        holdingRecordIds: [],
      },
    ],
    incomes,
    disposals: [],
    contributions,
    unsupportedCases: [],
  };
}

const personalTaxExcludingNi = (
  person: ReturnType<typeof calculateHouseholdTaxPosition>["people"][number],
) =>
  person.incomeTax.amountPence +
  person.savingsTax.amountPence +
  person.dividendTax.amountPence +
  person.capitalGainsTax.amountPence;

function personalExtraction(
  input: LimitedCompanyScenarioInput,
  period: CompanyPeriod,
  plan: PeriodPlan,
) {
  const baseline = calculateHouseholdTaxPosition(
    householdRequest({
      input,
      taxYear: period.taxYear,
      baselineFactIds: plan.baselinePersonalIncomeFactIds,
      salaryPence: 0,
      dividendPence: 0,
      employerPensionContributionPence: 0,
      existingPensionInputPence: plan.existingPensionInputPence,
    }),
  );
  const withExtraction = calculateHouseholdTaxPosition(
    householdRequest({
      input,
      taxYear: period.taxYear,
      baselineFactIds: plan.baselinePersonalIncomeFactIds,
      salaryPence: plan.salaryPence,
      dividendPence: plan.dividendPence,
      employerPensionContributionPence:
        plan.employerPensionContributionPence,
      existingPensionInputPence: plan.existingPensionInputPence,
    }),
  );
  const baselinePerson = baseline.people[0];
  const scenarioPerson = withExtraction.people[0];
  if (baselinePerson === undefined || scenarioPerson === undefined) {
    throw new Error("Household tax calculation returned no owner");
  }
  const employeeNiPence = directorEmployeeNi(plan.salaryPence);
  const incrementalIncomeAndDividendTaxPence = Math.max(
    0,
    personalTaxExcludingNi(scenarioPerson) -
      personalTaxExcludingNi(baselinePerson),
  );
  const pensionRule = ukLimitedCompanyRuleSet.pension;
  const baseAnnualAllowancePence = plan.moneyPurchaseAnnualAllowanceApplies
    ? pensionRule.moneyPurchaseAnnualAllowancePence
    : scenarioPerson.allowances.pensionAllowancePence;
  const testedPensionInputPence =
    plan.existingPensionInputPence + plan.employerPensionContributionPence;
  const pensionCapacityPence = plan.moneyPurchaseAnnualAllowanceApplies
    ? baseAnnualAllowancePence
    : baseAnnualAllowancePence + plan.pensionCarryForwardAvailablePence;
  const issues: ScenarioIssue[] = scenarioPerson.unsupported
    .filter(({ code }) => code !== "pension-annual-allowance-charge")
    .map(({ code, detail }) => ({
      code,
      detail,
      state: "unsupported" as const,
      companyPeriodId: period.id,
    }));
  if (testedPensionInputPence > pensionCapacityPence) {
    issues.push({
      code: "unsupported-pension-annual-allowance-charge",
      state: "unsupported",
      detail: `${period.id} pension input exceeds the modelled annual allowance and available carry forward.`,
      companyPeriodId: period.id,
    });
  }
  return {
    grossSalaryPence: plan.salaryPence,
    dividendsPence: plan.dividendPence,
    employeeNationalInsurancePence: employeeNiPence,
    incrementalIncomeAndDividendTaxPence,
    totalPersonalTaxPence:
      employeeNiPence + incrementalIncomeAndDividendTaxPence,
    spendableHouseholdCashPence:
      plan.salaryPence +
      plan.dividendPence -
      employeeNiPence -
      incrementalIncomeAndDividendTaxPence,
    employerPensionContributionPence:
      plan.employerPensionContributionPence,
    pension: {
      testedInputPence: testedPensionInputPence,
      annualAllowancePence: baseAnnualAllowancePence,
      carryForwardAvailablePence: plan.pensionCarryForwardAvailablePence,
      totalCapacityPence: pensionCapacityPence,
      moneyPurchaseAnnualAllowanceApplies:
        plan.moneyPurchaseAnnualAllowanceApplies,
      excessPence: Math.max(0, testedPensionInputPence - pensionCapacityPence),
    },
    taxRuleDatasetVersion: withExtraction.lineage.ruleDatasetVersion,
    ruleIds: withExtraction.lineage.ruleIds,
    sources: withExtraction.lineage.sources,
    issues,
  };
}

function laterExtractionTax({
  amountPence,
  baselineFactIds,
  input,
  taxYear,
}: {
  amountPence: number;
  baselineFactIds: readonly string[];
  input: LimitedCompanyScenarioInput;
  taxYear: string;
}) {
  const baseline = calculateHouseholdTaxPosition(
    householdRequest({
      input,
      taxYear,
      baselineFactIds,
      salaryPence: 0,
      dividendPence: 0,
      employerPensionContributionPence: 0,
      existingPensionInputPence: 0,
    }),
  );
  const extracted = calculateHouseholdTaxPosition(
    householdRequest({
      input,
      taxYear,
      baselineFactIds,
      salaryPence: 0,
      dividendPence: amountPence,
      employerPensionContributionPence: 0,
      existingPensionInputPence: 0,
    }),
  );
  const baselinePerson = baseline.people[0];
  const extractedPerson = extracted.people[0];
  const issues: ScenarioIssue[] = extracted.unsupported.map(({ code, detail }) => ({
    code,
    detail,
    state: "unsupported",
  }));
  if (baselinePerson === undefined || extractedPerson === undefined) {
    return { amountPence, taxPence: null, netPence: null, issues };
  }
  const taxPence = Math.max(
    0,
    personalTaxExcludingNi(extractedPerson) -
      personalTaxExcludingNi(baselinePerson),
  );
  return {
    amountPence,
    taxPence,
    netPence: amountPence - taxPence,
    issues,
  };
}

function periodDeadlines(
  input: LimitedCompanyScenarioInput,
  period: CompanyPeriod,
  vatReturnDueOn: string | null,
) {
  const company = input.sideIncomeCase.businesses.find(
    ({ id }) => id === input.companyId,
  );
  const rule = ukLimitedCompanyRuleSet.administration;
  return {
    firstAccountsDueOn:
      company?.incorporatedOn == null
        ? null
        : addMonths(
            company.incorporatedOn,
            rule.firstAccountsMonthsAfterIncorporation,
          ),
    annualAccountsDueOn: addMonths(
      period.accountingPeriodEndsOn,
      rule.annualAccountsMonthsAfterPeriodEnd,
    ),
    corporationTaxPaymentDueOn: addDays(
      addMonths(
        period.accountingPeriodEndsOn,
        rule.corporationTaxPaymentMonthsAfterPeriodEnd,
      ),
      rule.corporationTaxPaymentExtraDays,
    ),
    companyTaxReturnDueOn: addMonths(
      period.accountingPeriodEndsOn,
      rule.companyTaxReturnMonthsAfterPeriodEnd,
    ),
    confirmationStatementDueOn:
      company?.incorporatedOn == null
        ? null
        : addDays(
            addMonths(company.incorporatedOn, rule.confirmationReviewMonths),
            rule.confirmationFilingDays,
          ),
    vatReturnAndPaymentDueOn: vatReturnDueOn,
    payroll: {
      fullPaymentSubmission: "on-or-before-each-payday" as const,
      employerPaymentSummaryDay: 19,
      electronicPaymentDay: rule.payrollElectronicPaymentDay,
    },
  };
}

function strategyResult(
  input: LimitedCompanyScenarioInput,
  strategy: LimitedCompanyScenarioInput["strategies"][number],
  globalIssues: ScenarioIssue[],
) {
  const plansByPeriod = new Map(
    strategy.periodPlans.map((plan) => [plan.companyPeriodId, plan]),
  );
  const orderedPeriods = [...input.companyPeriods].sort((left, right) =>
    left.accountingPeriodStartsOn.localeCompare(right.accountingPeriodStartsOn),
  );
  let companyCashPence = input.openingCompanyCashPence;
  let distributableReservesPence = input.openingDistributableReservesPence;
  let outstandingCorporationTaxPence = 0;
  let outstandingVatPence = 0;
  let terminalCashAfterReservesPence = input.openingCompanyCashPence;
  const issues: ScenarioIssue[] = globalIssues.map((issue) => ({
    ...issue,
    strategyId: strategy.id,
  }));
  const plannedPeriods: Array<{ period: CompanyPeriod; plan: PeriodPlan }> = [];
  for (const period of orderedPeriods) {
    const plan = plansByPeriod.get(period.id);
    if (plan === undefined) {
      issues.push({
        code: "missing-strategy-period",
        state: "needs-review",
        detail: `${strategy.id} has no plan for ${period.id}.`,
        strategyId: strategy.id,
        companyPeriodId: period.id,
      });
    } else {
      plannedPeriods.push({ period, plan });
    }
  }
  const periodResults = plannedPeriods.map(({ period, plan }) => {
    const scoped = scopedPeriodFacts(input, period);
    const vat = calculateVat(input, period);
    const ni = employerNi(plan, strategy.id);
    const grossRevenuePence = sum(
      scoped.revenueFacts.map((fact) => fact.amount.minorUnits),
    );
    const totalOperatingCostsPence = sum(
      scoped.expenseFacts.map(({ fact }) => fact.amount.minorUnits),
    );
    const allowableOperatingCostsPence = sum(
      scoped.expenseFacts
        .filter(
          ({ treatment }) =>
            treatment.corporationTaxTreatment === "allowable",
        )
        .map(({ fact }) => fact.amount.minorUnits),
    );
    const disallowableOperatingCostsPence =
      totalOperatingCostsPence - allowableOperatingCostsPence;
    if (plan.employerPensionReliefEligibility === "unknown") {
      issues.push({
        code: "unknown-employer-pension-relief",
        state: "needs-review",
        detail: `${strategy.id} needs the wholly and exclusively pension test for ${period.id}.`,
        strategyId: strategy.id,
        companyPeriodId: period.id,
      });
    }
    const deductiblePensionPence =
      plan.employerPensionReliefEligibility === "eligible"
        ? plan.employerPensionContributionPence
        : 0;
    const accountingProfitPence =
      grossRevenuePence -
      totalOperatingCostsPence -
      plan.salaryPence -
      ni.employerNiPence -
      plan.employerPensionContributionPence;
    const taxableProfitBeforeLossesPence =
      grossRevenuePence -
      allowableOperatingCostsPence -
      plan.salaryPence -
      ni.employerNiPence -
      deductiblePensionPence;
    if (taxableProfitBeforeLossesPence < 0) {
      issues.push({
        code: "unsupported-company-loss-relief",
        state: "unsupported",
        detail: `${period.id} has a company tax loss. Carry-back, carry-forward, and group relief are not modelled.`,
        strategyId: strategy.id,
        companyPeriodId: period.id,
      });
    }
    const tax = corporationTax({
      period,
      taxableProfitPence: Math.max(0, taxableProfitBeforeLossesPence),
      companiesInAssociatedGroup: input.companiesInAssociatedGroup,
    });
    const profitAfterCorporationTaxPence =
      accountingProfitPence - tax.corporationTaxPence;
    const availableDistributablePence = Math.max(
      0,
      distributableReservesPence + profitAfterCorporationTaxPence,
    );
    if (plan.dividendPence > availableDistributablePence) {
      issues.push({
        code: "insufficient-distributable-profits",
        state: "unsupported",
        detail: `${strategy.id} declares ${plan.dividendPence}p but ${period.id} has ${availableDistributablePence}p of distributable profits.`,
        strategyId: strategy.id,
        companyPeriodId: period.id,
      });
    }
    const personal = personalExtraction(input, period, plan);
    const openingCashPence = companyCashPence;
    companyCashPence +=
      period.cash.tradeReceiptsExcludingVatPence +
      period.cash.outputVatReceivedPence -
      period.cash.expensePaymentsExcludingVatPence -
      period.cash.inputVatPaidPence -
      period.cash.corporationTaxPaidPence -
      period.cash.vatPaidToHmrcPence -
      plan.salaryPence -
      ni.employerNiPence -
      plan.employerPensionContributionPence -
      plan.dividendPence;
    if (companyCashPence < 0) {
      issues.push({
        code: "insufficient-company-cash",
        state: "unsupported",
        detail: `${strategy.id} leaves negative company cash in ${period.id}.`,
        strategyId: strategy.id,
        companyPeriodId: period.id,
      });
    }
    distributableReservesPence = Math.max(
      0,
      availableDistributablePence - plan.dividendPence,
    );
    outstandingCorporationTaxPence =
      Math.max(
        0,
        outstandingCorporationTaxPence +
          tax.corporationTaxPence -
          period.cash.corporationTaxPaidPence,
      );
    outstandingVatPence = Math.max(
      0,
      outstandingVatPence +
        vat.liabilityPence -
        period.cash.vatPaidToHmrcPence,
    );
    const unpaidCorporationTaxPence = Math.max(
      0,
      outstandingCorporationTaxPence,
    );
    const unpaidVatPence = Math.max(0, outstandingVatPence);
    const companyCashAfterReservesPence = Math.max(
      0,
      companyCashPence - unpaidCorporationTaxPence - unpaidVatPence,
    );
    terminalCashAfterReservesPence = companyCashAfterReservesPence;
    const goal = input.goals.find(
      ({ companyPeriodId }) => companyPeriodId === period.id,
    );
    const goalAssessment = {
      householdCashDeficitPence: Math.max(
        0,
        (goal?.minimumHouseholdCashPence ?? 0) -
          personal.spendableHouseholdCashPence,
      ),
      employerPensionDeficitPence: Math.max(
        0,
        (goal?.minimumEmployerPensionPence ?? 0) -
          plan.employerPensionContributionPence,
      ),
      companyCashDeficitPence: Math.max(
        0,
        (goal?.minimumCompanyCashAfterReservesPence ?? 0) -
          companyCashAfterReservesPence,
      ),
    };
    issues.push(
      ...scoped.issues.map((issue) => ({ ...issue, strategyId: strategy.id })),
      ...vat.issues.map((issue) => ({ ...issue, strategyId: strategy.id })),
      ...ni.issues,
      ...personal.issues.map((issue) => ({ ...issue, strategyId: strategy.id })),
    );
    const categoryCostsPence = Object.fromEntries(
      [
        "direct",
        "accountancy",
        "bookkeeping",
        "payroll",
        "companies-house",
        "insurance",
        "software",
        "other",
      ].map((category) => [
        category,
        sum(
          scoped.expenseFacts
            .filter(({ treatment }) => treatment.category === category)
            .map(({ fact }) => fact.amount.minorUnits),
        ),
      ]),
    );
    return {
        companyPeriodId: period.id,
        taxYear: period.taxYear,
        profit: {
          grossRevenuePence,
          totalOperatingCostsPence,
          categoryCostsPence,
          allowableOperatingCostsPence,
          disallowableOperatingCostsPence,
          salaryPence: plan.salaryPence,
          employerNationalInsurancePence: ni.employerNiPence,
          employerPensionContributionPence:
            plan.employerPensionContributionPence,
          deductibleEmployerPensionPence: deductiblePensionPence,
          accountingProfitPence,
          taxableProfitPence: tax.taxableProfitPence,
          corporationTax: tax,
          profitAfterCorporationTaxPence,
          distributableProfitBeforeDividendPence:
            availableDistributablePence,
          dividendDeclaredPence: plan.dividendPence,
          closingDistributableReservesPence: distributableReservesPence,
        },
        payroll: {
          grossSalaryPence: plan.salaryPence,
          employeeNationalInsurancePence:
            personal.employeeNationalInsurancePence,
          directorLiabilityPence: ni.directorLiabilityPence,
          otherEmployeeLiabilityPence: ni.otherEmployeeLiabilityPence,
          grossLiabilityPence: ni.grossLiabilityPence,
          employmentAllowanceUsedPence: ni.employmentAllowanceUsedPence,
          employerNiPence: ni.employerNiPence,
        },
        pension: personal.pension,
        vat: {
          registrationStatus: vat.registrationStatus,
          scheme: vat.scheme,
          outputVatPence: vat.outputVatPence,
          inputVatReclaimedPence: vat.inputVatReclaimedPence,
          liabilityPence: vat.liabilityPence,
          returnDueOn: vat.returnDueOn,
          passThroughVatIncludedInRevenue:
            vat.passThroughVatIncludedInRevenue,
        },
        household: {
          salaryPence: plan.salaryPence,
          dividendsPence: plan.dividendPence,
          employerPensionContributionPence:
            plan.employerPensionContributionPence,
          incrementalPersonalTaxPence: personal.totalPersonalTaxPence,
          spendableCashPence: personal.spendableHouseholdCashPence,
          taxRuleDatasetVersion: personal.taxRuleDatasetVersion,
          taxRuleIds: personal.ruleIds,
        },
        companyCash: {
          openingCashPence,
          closingCashPence: companyCashPence,
          unpaidCorporationTaxPence,
          unpaidVatPence,
          cashAfterTaxReservesPence: companyCashAfterReservesPence,
          separatelyOwnedByCompany: true,
        },
        administration: {
          hours: period.administrationHours,
          valuedTimePence:
            period.administrationHours * input.administration.hourlyValuePence,
        },
        deadlines: periodDeadlines(input, period, vat.returnDueOn),
        goalAssessment: {
          ...goalAssessment,
          met:
            goalAssessment.householdCashDeficitPence === 0 &&
            goalAssessment.employerPensionDeficitPence === 0 &&
            goalAssessment.companyCashDeficitPence === 0,
        },
      };
  });
  const terminalExtractionAmountPence = Math.min(
    terminalCashAfterReservesPence,
    distributableReservesPence,
  );
  const deferredExtraction = laterExtractionTax({
    amountPence: terminalExtractionAmountPence,
    baselineFactIds: strategy.laterExtraction.baselinePersonalIncomeFactIds,
    input,
    taxYear: strategy.laterExtraction.taxYear,
  });
  issues.push(
    ...deferredExtraction.issues.map((issue) => ({
      ...issue,
      strategyId: strategy.id,
    })),
  );
  const totalGoalDeficitPence = sum(
    periodResults.flatMap(({ goalAssessment }) => [
      goalAssessment.householdCashDeficitPence,
      goalAssessment.employerPensionDeficitPence,
      goalAssessment.companyCashDeficitPence,
    ]),
  );
  const ownIssues = uniqueIssues(issues);
  const blockingIssues = ownIssues.filter(
    ({ state }) => state === "unsupported" || state === "needs-review",
  );
  return {
    id: strategy.id,
    label: strategy.label,
    feasible: blockingIssues.length === 0,
    issues: ownIssues,
    periods: periodResults,
    totals: {
      householdSpendableCashPence: sum(
        periodResults.map(({ household }) => household.spendableCashPence),
      ),
      employerPensionContributionPence: sum(
        periodResults.map(
          ({ household }) => household.employerPensionContributionPence,
        ),
      ),
      personalTaxPence: sum(
        periodResults.map(
          ({ household }) => household.incrementalPersonalTaxPence,
        ),
      ),
      corporationTaxPence: sum(
        periodResults.map(
          ({ profit }) => profit.corporationTax.corporationTaxPence,
        ),
      ),
      employerNationalInsurancePence: sum(
        periodResults.map(
          ({ profit }) => profit.employerNationalInsurancePence,
        ),
      ),
      operatingCostsPence: sum(
        periodResults.map(({ profit }) => profit.totalOperatingCostsPence),
      ),
      valuedAdministrationTimePence:
        input.administration.setupHours * input.administration.hourlyValuePence +
        sum(
          periodResults.map(
            ({ administration }) => administration.valuedTimePence,
          ),
        ),
      endingCompanyCashPence: companyCashPence,
      endingDistributableReservesPence: distributableReservesPence,
      totalGoalDeficitPence,
    },
    deferredExtraction: {
      taxYear: strategy.laterExtraction.taxYear,
      grossDividendPence: deferredExtraction.amountPence,
      estimatedLaterDividendTaxPence: deferredExtraction.taxPence,
      estimatedLaterHouseholdCashPence: deferredExtraction.netPence,
      assumption:
        "The terminal amount is extracted as one dividend using the selected future year's baseline personal income. Company cash and reserves remain separate until then.",
    },
  };
}

function buildLineage(
  input: LimitedCompanyScenarioInput,
  strategies: ReturnType<typeof strategyResult>[],
) {
  const factIds = new Set(
    input.companyPeriods.flatMap((period) => [
      ...period.revenueFactIds,
      ...period.expenseTreatments.map(({ factId }) => factId),
    ]),
  );
  const facts = selectedFacts(input.sideIncomeCase, [...factIds]);
  const taxSources = strategies.flatMap((strategy) =>
    strategy.periods.flatMap((period) => {
      const plan = input.strategies
        .find(({ id }) => id === strategy.id)
        ?.periodPlans.find(
          ({ companyPeriodId }) => companyPeriodId === period.companyPeriodId,
        );
      if (plan === undefined) return [];
      const tax = calculateHouseholdTaxPosition(
        householdRequest({
          input,
          taxYear: period.taxYear,
          baselineFactIds: plan.baselinePersonalIncomeFactIds,
          salaryPence: plan.salaryPence,
          dividendPence: plan.dividendPence,
          employerPensionContributionPence:
            plan.employerPensionContributionPence,
          existingPensionInputPence: plan.existingPensionInputPence,
        }),
      );
      return tax.lineage.sources;
    }),
  );
  const sources = [
    ...ukLimitedCompanyRuleSet.sources.map(({ id, title, url }) => ({
      id,
      title,
      url,
    })),
    ...taxSources,
  ].filter(
    (source, index, all) =>
      all.findIndex(({ url }) => url === source.url) === index,
  );
  return {
    sideIncomeContractVersion: SIDE_INCOME_CONTRACT_VERSION,
    limitedCompanyRulesetVersion: UK_LIMITED_COMPANY_RULESET_VERSION,
    taxRuleDatasetVersions: [
      ...new Set(
        strategies.flatMap((strategy) =>
          strategy.periods.map(
            ({ household }) => household.taxRuleDatasetVersion,
          ),
        ),
      ),
    ],
    financialFactIds: facts.map(({ id }) => id),
    sourceLineage: facts.map((fact) => ({ factId: fact.id, ...fact.lineage })),
    ruleIds: [
      ukLimitedCompanyRuleSet.corporationTax.ruleId,
      ukLimitedCompanyRuleSet.payroll.ruleId,
      ukLimitedCompanyRuleSet.pension.ruleId,
      ukLimitedCompanyRuleSet.vat.ruleId,
      ukLimitedCompanyRuleSet.administration.ruleId,
      ...new Set(
        strategies.flatMap((strategy) =>
          strategy.periods.flatMap(({ household }) => household.taxRuleIds),
        ),
      ),
    ],
    sources,
    rounding:
      "Rates are applied to pence. Tax components and marginal relief are rounded to the nearest penny.",
  };
}

export function evaluateLimitedCompanyScenario(
  value: LimitedCompanyScenarioInput,
) {
  const input = LimitedCompanyScenarioInputSchema.parse(value);
  const globalIssues = companyScopeIssues(input);
  for (const period of input.companyPeriods) {
    if (
      !SUPPORTED_LIMITED_COMPANY_TAX_YEARS.includes(
        period.taxYear as (typeof SUPPORTED_LIMITED_COMPANY_TAX_YEARS)[number],
      )
    ) {
      globalIssues.push({
        code: "unsupported-tax-year",
        state: "unsupported",
        detail: `${period.taxYear} is outside limited-company ruleset ${UK_LIMITED_COMPANY_RULESET_VERSION}.`,
        companyPeriodId: period.id,
      });
    }
    const days = inclusiveDays(
      period.accountingPeriodStartsOn,
      period.accountingPeriodEndsOn,
    );
    if (days > 366) {
      globalIssues.push({
        code: "unsupported-long-accounting-period",
        state: "unsupported",
        detail: `${period.id} exceeds the 12-month Corporation Tax period supported by this model.`,
        companyPeriodId: period.id,
      });
    }
    const corporationTaxRule = ukLimitedCompanyRuleSet.corporationTax;
    if (
      period.accountingPeriodStartsOn < corporationTaxRule.effectiveFrom ||
      (corporationTaxRule.effectiveTo != null &&
        period.accountingPeriodEndsOn > corporationTaxRule.effectiveTo)
    ) {
      globalIssues.push({
        code: "unsupported-corporation-tax-period",
        state: "unsupported",
        detail: `${period.id} falls outside the reviewed Corporation Tax effective dates.`,
        companyPeriodId: period.id,
      });
    }
  }
  const strategies = input.strategies.map((strategy) =>
    strategyResult(input, strategy, globalIssues),
  );
  const comparison = [...strategies]
    .sort((left, right) => {
      if (left.feasible !== right.feasible) return left.feasible ? -1 : 1;
      const deficit =
        left.totals.totalGoalDeficitPence - right.totals.totalGoalDeficitPence;
      if (deficit !== 0) return deficit;
      return (
        right.totals.householdSpendableCashPence -
        left.totals.householdSpendableCashPence
      );
    })
    .map((strategy, rank) => ({
      rank: rank + 1,
      strategyId: strategy.id,
      feasible: strategy.feasible,
      totalGoalDeficitPence: strategy.totals.totalGoalDeficitPence,
      householdSpendableCashPence:
        strategy.totals.householdSpendableCashPence,
      employerPensionContributionPence:
        strategy.totals.employerPensionContributionPence,
      endingCompanyCashPence: strategy.totals.endingCompanyCashPence,
    }));
  const setupFeeDifferencePence =
    input.administration.incorporationFeePence -
    ukLimitedCompanyRuleSet.administration.incorporationOnlineFeePence;
  const issues = uniqueIssues([
    ...globalIssues,
    ...(setupFeeDifferencePence === 0
      ? []
      : [
          {
            code: "nonstandard-incorporation-fee",
            state: "needs-review" as const,
            detail: `The supplied incorporation fee differs by ${setupFeeDifferencePence}p from the effective-dated online fee.`,
          },
        ]),
    ...strategies.flatMap(({ issues: strategyIssues }) => strategyIssues),
  ]);
  return {
    kind: "uk-limited-company-side-income-scenario" as const,
    scenarioVersion: LIMITED_COMPANY_SCENARIO_VERSION,
    calculationVersion: LIMITED_COMPANY_CALCULATION_VERSION,
    rulesetVersion: UK_LIMITED_COMPANY_RULESET_VERSION,
    evaluatedOn: input.evaluatedOn,
    companyId: input.companyId,
    ownerPersonId: input.ownerPersonId,
    available: strategies.some(({ feasible }) => feasible),
    issues,
    entityBoundary: {
      companyCashIsHouseholdCash: false,
      vatIncludedInCompanyRevenue: false,
      retainedProfitRequiresLaterExtraction: true,
    },
    setup: {
      incorporationFeePence: input.administration.incorporationFeePence,
      setupHours: input.administration.setupHours,
      valuedSetupTimePence:
        input.administration.setupHours * input.administration.hourlyValuePence,
    },
    strategies,
    comparison,
    recommendedStrategyId:
      comparison.find(({ feasible }) => feasible)?.strategyId ?? null,
    lineage: buildLineage(input, strategies),
  };
}

export type LimitedCompanyScenarioResult = ReturnType<
  typeof evaluateLimitedCompanyScenario
>;
