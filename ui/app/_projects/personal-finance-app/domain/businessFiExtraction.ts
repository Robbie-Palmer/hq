import {
  evaluateLimitedCompanyScenario,
  type LimitedCompanyScenarioInput,
} from "personal-finance-contracts/limited-company-scenario";
import {
  type BusinessFiPensionContribution,
  type BusinessFiPensionTreatment,
  evaluateBusinessFiPensionContribution,
} from "./businessFiPension";
import {
  effectiveFinancialRecords,
  type ShareOwnershipInterest,
  shareOwnershipAt,
} from "./businessWealth";
import type { HouseholdWealthConsolidation } from "./businessWealthConsolidation";

export const BUSINESS_FI_EXTRACTION_CALCULATION_VERSION =
  "business-fi-extraction-v1" as const;

export type BusinessFiCapitalPosition = {
  availableNowPence: number;
  futureAccessiblePence: number;
  pensionWealthPence: number;
  pensionFiEligiblePence: number;
  inputRecordIds: readonly string[];
};

export type BusinessFiLiquidityConstraint = {
  recordId: string;
  companyPeriodId: string;
  effectiveFrom: string;
  effectiveTo?: string;
  acceptedAt: string;
  correctsId?: string;
  operatingReservePence: number;
  companyLiabilitiesPence: number;
  unavailableCashPence: number;
  inputRecordIds: readonly string[];
};

export type BusinessFiPeriodTiming = {
  companyPeriodId: string;
  salaryPaidOn: string;
  dividendPaidOn: string;
  employerPensionContributedOn: string;
  householdCashAvailableOn: string;
};

export type BusinessFiTreatment =
  | {
      kind: "exclude";
      recordId: string;
      reason: string;
    }
  | {
      kind: "limited-company-extraction";
      recordId: string;
      strategyId: string;
      periodTimings: readonly BusinessFiPeriodTiming[];
      deferredExtraction:
        | { kind: "retain" }
        | { kind: "dividend"; availableOn: string };
    };

type BusinessFiPlanBase = {
  id: string;
  label: string;
  planningDate: string;
  asKnownAt: string;
  companyEntityId: string;
  ownerPersonEntityId: string;
  wealth: HouseholdWealthConsolidation;
  capitalPosition: BusinessFiCapitalPosition;
  shareOwnershipInterests: readonly ShareOwnershipInterest[];
  treatment: BusinessFiTreatment;
  reflectedEventIds?: readonly string[];
};

export type BusinessFiPlanInput = BusinessFiPlanBase & {
  limitedCompanyScenario?: LimitedCompanyScenarioInput;
  liquidityConstraints?: readonly BusinessFiLiquidityConstraint[];
  pensionTreatment?: BusinessFiPensionTreatment;
};

export type BusinessFiPlanIssue = {
  kind: string;
  state: "needs-review" | "unsupported";
  detail: string;
  companyPeriodId?: string;
  eventId?: string;
};

export type BusinessFiExtractionEvent = {
  id: string;
  kind:
    | "salary"
    | "dividend"
    | "household-cash"
    | "employer-pension"
    | "deferred-dividend";
  occursOn: string;
  availableOn: string;
  destination: "household-cash" | "pension";
  grossPence: number;
  deductionsPence: number;
  netHouseholdValuePence: number;
  alreadyReflected: boolean;
  countedInFiCapital: boolean;
  inputRecordIds: string[];
};

export type BusinessFiPeriodResult = {
  companyPeriodId: string;
  taxYear: string;
  timing: BusinessFiPeriodTiming;
  ownershipRecordIds: string[];
  household: {
    salaryPence: number;
    dividendsPence: number;
    employerPensionContributionPence: number;
    incrementalPersonalTaxPence: number;
    spendableCashPence: number;
  };
  taxAndAllowances: {
    employerNationalInsurancePence: number;
    employmentAllowanceUsedPence: number;
    pensionTestedInputPence: number;
    pensionAnnualAllowancePence: number;
    pensionCarryForwardAvailablePence: number;
    pensionTotalCapacityPence: number;
    pensionExcessPence: number;
    moneyPurchaseAnnualAllowanceApplies: boolean;
    taxRuleDatasetVersion: string;
    taxRuleIds: string[];
  };
  company: {
    openingCashPence: number;
    closingCashPence: number;
    closingDistributableReservesPence: number;
    unpaidCorporationTaxPence: number;
    unpaidVatPence: number;
    operatingReservePence: number;
    companyLiabilitiesPence: number;
    unavailableCashPence: number;
    liquidCashAfterConstraintsPence: number;
  };
  goalAssessment: {
    householdCashDeficitPence: number;
    employerPensionDeficitPence: number;
    companyCashDeficitPence: number;
    met: boolean;
  };
  events: BusinessFiExtractionEvent[];
};

export type BusinessFiDeduction = {
  kind:
    | "corporation-tax"
    | "vat-reserve"
    | "employer-national-insurance"
    | "personal-tax"
    | "operating-reserve"
    | "company-liabilities"
    | "unavailable-cash"
    | "later-dividend-tax";
  amountPence: number;
  companyPeriodId?: string;
};

export type BusinessFiPlanResult = {
  calculationVersion: typeof BUSINESS_FI_EXTRACTION_CALCULATION_VERSION;
  id: string;
  label: string;
  status: "available" | "blocked" | "excluded";
  treatment: BusinessFiTreatment;
  company: {
    companyEntityId: string;
    grossCompanyValuePence: number | null;
    ownershipShare: number | null;
    netHouseholdValuePence: number | null;
    retainedCompanyCashPence: number;
    retainedDistributableReservesPence: number;
    excludedFromAccessibleCapital: true;
  };
  capital: {
    totalEconomicNetWorthPence: number;
    netWorthComplete: boolean;
    capitalAvailableNowPence: number;
    futureAccessibleCapitalPence: number;
    pensionWealthPence: number;
    fiEligibleCapitalPence: number;
    incrementalFiEligibleCapitalPence: number;
  };
  strategyNetHouseholdValuePence: number;
  periods: BusinessFiPeriodResult[];
  deferredEvent: BusinessFiExtractionEvent | null;
  pensionContributions: BusinessFiPensionContribution[];
  deductions: BusinessFiDeduction[];
  issues: BusinessFiPlanIssue[];
  lineage: {
    treatmentRecordId: string;
    valuationRecordIds: string[];
    ownershipRecordIds: string[];
    constraintRecordIds: string[];
    inputRecordIds: string[];
    limitedCompanyCalculationVersion: string | null;
    limitedCompanyRulesetVersion: string | null;
    taxRuleDatasetVersions: string[];
    ruleIds: string[];
  };
};

const pence = (majorUnits: number): number => Math.round(majorUnits * 100);

function validateCapitalPosition(position: BusinessFiCapitalPosition): void {
  for (const [name, amount] of [
    ["availableNowPence", position.availableNowPence],
    ["futureAccessiblePence", position.futureAccessiblePence],
    ["pensionWealthPence", position.pensionWealthPence],
    ["pensionFiEligiblePence", position.pensionFiEligiblePence],
  ] as const) {
    if (!Number.isInteger(amount) || amount < 0) {
      throw new Error(`${name} must be a non-negative whole-pence amount`);
    }
  }
}

function uniqueIssues(issues: readonly BusinessFiPlanIssue[]) {
  return issues.filter(
    (issue, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.kind === issue.kind &&
          candidate.detail === issue.detail &&
          candidate.companyPeriodId === issue.companyPeriodId &&
          candidate.eventId === issue.eventId,
      ) === index,
  );
}

function activeConstraint(
  constraints: readonly BusinessFiLiquidityConstraint[],
  companyPeriodId: string,
  date: string,
  asKnownAt: string,
): BusinessFiLiquidityConstraint | null {
  return (
    effectiveFinancialRecords(constraints, asKnownAt)
      .filter(
        (constraint) =>
          constraint.companyPeriodId === companyPeriodId &&
          constraint.effectiveFrom <= date &&
          (constraint.effectiveTo == null || date < constraint.effectiveTo),
      )
      .toSorted(
        (left, right) =>
          right.effectiveFrom.localeCompare(left.effectiveFrom) ||
          right.acceptedAt.localeCompare(left.acceptedAt) ||
          right.recordId.localeCompare(left.recordId),
      )[0] ?? null
  );
}

function eventId(
  planId: string,
  companyPeriodId: string,
  kind: BusinessFiExtractionEvent["kind"],
): string {
  return `business-fi:${planId}:${companyPeriodId}:${kind}`;
}

function eventOwnership(input: {
  plan: BusinessFiPlanInput;
  occursOn: string;
  eventId: string;
  companyPeriodId?: string;
  issues: BusinessFiPlanIssue[];
}): string[] {
  const interests = shareOwnershipAt(
    input.plan.shareOwnershipInterests,
    input.plan.companyEntityId,
    input.occursOn,
    input.plan.asKnownAt,
  ).filter(
    ({ ownerEntityId }) => ownerEntityId === input.plan.ownerPersonEntityId,
  );
  if (interests.length === 0) {
    input.issues.push({
      kind: "missing-extraction-ownership",
      state: "needs-review",
      detail: `No ownership interest is recorded for ${input.occursOn}.`,
      eventId: input.eventId,
      ...(input.companyPeriodId == null
        ? {}
        : { companyPeriodId: input.companyPeriodId }),
    });
    return [];
  }
  const unresolved = interests.find(
    ({ fraction }) => fraction.state !== "known",
  );
  if (unresolved != null) {
    input.issues.push({
      kind: "unsupported-extraction-ownership",
      state: "unsupported",
      detail: `Ownership on ${input.occursOn} is not a known supported fraction.`,
      eventId: input.eventId,
      ...(input.companyPeriodId == null
        ? {}
        : { companyPeriodId: input.companyPeriodId }),
    });
    return interests.map(({ recordId }) => recordId);
  }
  const fraction = interests.reduce(
    (total, interest) =>
      total +
      (interest.fraction.state === "known" ? interest.fraction.fraction : 0),
    0,
  );
  if (Math.abs(fraction - 1) > 1e-6) {
    input.issues.push({
      kind: "unsupported-extraction-ownership",
      state: "unsupported",
      detail: `The released extraction contract requires 100% ownership, but the dated share is ${fraction}.`,
      eventId: input.eventId,
      ...(input.companyPeriodId == null
        ? {}
        : { companyPeriodId: input.companyPeriodId }),
    });
  }
  return interests.map(({ recordId }) => recordId);
}

function validateTiming(input: {
  timing: BusinessFiPeriodTiming;
  period: LimitedCompanyScenarioInput["companyPeriods"][number];
  issues: BusinessFiPlanIssue[];
}): void {
  const dates = [
    ["salary", input.timing.salaryPaidOn],
    ["dividend", input.timing.dividendPaidOn],
    ["employer pension", input.timing.employerPensionContributedOn],
    ["household cash", input.timing.householdCashAvailableOn],
  ] as const;
  for (const [label, date] of dates) {
    if (
      date < input.period.accountingPeriodStartsOn ||
      date > input.period.accountingPeriodEndsOn
    ) {
      input.issues.push({
        kind: "invalid-extraction-date",
        state: "needs-review",
        detail: `The ${label} date ${date} is outside ${input.period.id}.`,
        companyPeriodId: input.period.id,
      });
    }
  }
  if (
    input.timing.householdCashAvailableOn < input.timing.salaryPaidOn ||
    input.timing.householdCashAvailableOn < input.timing.dividendPaidOn
  ) {
    input.issues.push({
      kind: "invalid-household-cash-date",
      state: "needs-review",
      detail:
        "Household cash cannot become available before its salary and dividend transfers.",
      companyPeriodId: input.period.id,
    });
  }
}

function extractionEvent(input: {
  id: string;
  kind: BusinessFiExtractionEvent["kind"];
  occursOn: string;
  availableOn: string;
  destination: BusinessFiExtractionEvent["destination"];
  grossPence: number;
  deductionsPence: number;
  netHouseholdValuePence: number;
  reflectedEventIds: ReadonlySet<string>;
  inputRecordIds: readonly string[];
}): BusinessFiExtractionEvent {
  const alreadyReflected = input.reflectedEventIds.has(input.id);
  return {
    id: input.id,
    kind: input.kind,
    occursOn: input.occursOn,
    availableOn: input.availableOn,
    destination: input.destination,
    grossPence: input.grossPence,
    deductionsPence: input.deductionsPence,
    netHouseholdValuePence: input.netHouseholdValuePence,
    alreadyReflected,
    countedInFiCapital: !alreadyReflected && input.netHouseholdValuePence > 0,
    inputRecordIds: [...new Set(input.inputRecordIds)],
  };
}

function baseResult(
  input: BusinessFiPlanInput,
): Pick<BusinessFiPlanResult, "capital" | "company" | "lineage"> {
  const reconciliation = input.wealth.businessReconciliations.find(
    ({ companyEntityId }) => companyEntityId === input.companyEntityId,
  );
  return {
    company: {
      companyEntityId: input.companyEntityId,
      grossCompanyValuePence:
        reconciliation == null
          ? null
          : pence(reconciliation.wholeCompanyAmount),
      ownershipShare: reconciliation?.selectedOwnershipFraction ?? null,
      netHouseholdValuePence:
        reconciliation == null
          ? null
          : pence(reconciliation.selectedInterestAmount),
      retainedCompanyCashPence: 0,
      retainedDistributableReservesPence: 0,
      excludedFromAccessibleCapital: true,
    },
    capital: {
      totalEconomicNetWorthPence: pence(input.wealth.knownSubtotal),
      netWorthComplete: input.wealth.complete,
      capitalAvailableNowPence: input.capitalPosition.availableNowPence,
      futureAccessibleCapitalPence: input.capitalPosition.futureAccessiblePence,
      pensionWealthPence: input.capitalPosition.pensionWealthPence,
      fiEligibleCapitalPence:
        input.capitalPosition.availableNowPence +
        input.capitalPosition.futureAccessiblePence +
        input.capitalPosition.pensionFiEligiblePence,
      incrementalFiEligibleCapitalPence: 0,
    },
    lineage: {
      treatmentRecordId: input.treatment.recordId,
      valuationRecordIds: [...input.wealth.valuationRecordIds],
      ownershipRecordIds: [],
      constraintRecordIds: [],
      inputRecordIds: [...input.capitalPosition.inputRecordIds],
      limitedCompanyCalculationVersion: null,
      limitedCompanyRulesetVersion: null,
      taxRuleDatasetVersions: [],
      ruleIds: [],
    },
  };
}

function excludedPlan(input: BusinessFiPlanInput): BusinessFiPlanResult {
  const base = baseResult(input);
  return {
    calculationVersion: BUSINESS_FI_EXTRACTION_CALCULATION_VERSION,
    id: input.id,
    label: input.label,
    status: "excluded",
    treatment: input.treatment,
    ...base,
    strategyNetHouseholdValuePence: 0,
    periods: [],
    deferredEvent: null,
    pensionContributions: [],
    deductions: [],
    issues: [],
  };
}

function missingExtractionInput(
  input: BusinessFiPlanInput,
  detail: string,
): BusinessFiPlanResult {
  const base = baseResult(input);
  return {
    calculationVersion: BUSINESS_FI_EXTRACTION_CALCULATION_VERSION,
    id: input.id,
    label: input.label,
    status: "blocked",
    treatment: input.treatment,
    ...base,
    strategyNetHouseholdValuePence: 0,
    periods: [],
    deferredEvent: null,
    pensionContributions: [],
    deductions: [],
    issues: [
      { kind: "missing-extraction-input", state: "needs-review", detail },
    ],
  };
}

type LimitedCompanyEvaluation = ReturnType<
  typeof evaluateLimitedCompanyScenario
>;
type LimitedCompanyStrategy = LimitedCompanyEvaluation["strategies"][number];
type LimitedCompanyPeriod = LimitedCompanyStrategy["periods"][number];
type ExtractionTreatment = Extract<
  BusinessFiTreatment,
  { kind: "limited-company-extraction" }
>;

type ExtractionContext = {
  input: BusinessFiPlanInput;
  treatment: ExtractionTreatment;
  scenario: LimitedCompanyScenarioInput;
  pensionTreatment: BusinessFiPensionTreatment;
  evaluated: LimitedCompanyEvaluation;
  strategy: LimitedCompanyStrategy;
  base: ReturnType<typeof baseResult>;
  issues: BusinessFiPlanIssue[];
  reflectedEventIds: ReadonlySet<string>;
  timings: ReadonlyMap<string, BusinessFiPeriodTiming>;
  scenarioPeriods: ReadonlyMap<
    string,
    LimitedCompanyScenarioInput["companyPeriods"][number]
  >;
  periodResults: BusinessFiPeriodResult[];
  pensionContributions: BusinessFiPensionContribution[];
  deductions: BusinessFiDeduction[];
  ownershipRecordIds: Set<string>;
  constraintRecordIds: Set<string>;
};

type PeriodLiquidity = {
  constraint: BusinessFiLiquidityConstraint | null;
  operatingReservePence: number;
  companyLiabilitiesPence: number;
  unavailableCashPence: number;
  liquidCashAfterConstraintsPence: number;
};

function extractionIssues(
  evaluated: LimitedCompanyEvaluation,
  strategyId: string,
): BusinessFiPlanIssue[] {
  return evaluated.issues
    .filter(
      ({ strategyId: issueStrategyId }) =>
        issueStrategyId == null || issueStrategyId === strategyId,
    )
    .map((issue) => ({
      kind: issue.code,
      state: issue.state,
      detail: issue.detail,
      ...(issue.companyPeriodId == null
        ? {}
        : { companyPeriodId: issue.companyPeriodId }),
    }));
}

function createExtractionContext(input: {
  plan: BusinessFiPlanInput;
  treatment: ExtractionTreatment;
  scenario: LimitedCompanyScenarioInput;
  pensionTreatment: BusinessFiPensionTreatment;
  evaluated: LimitedCompanyEvaluation;
  strategy: LimitedCompanyStrategy;
}): ExtractionContext {
  const base = baseResult(input.plan);
  const issues = extractionIssues(input.evaluated, input.treatment.strategyId);
  if (base.company.grossCompanyValuePence == null) {
    issues.push({
      kind: "missing-company-valuation",
      state: "needs-review",
      detail: "The FI plan has no reconciled company valuation.",
    });
  }
  const timingIds = input.treatment.periodTimings.map(
    ({ companyPeriodId }) => companyPeriodId,
  );
  if (new Set(timingIds).size !== timingIds.length) {
    issues.push({
      kind: "duplicate-period-timing",
      state: "needs-review",
      detail: "Each company period must have one dated extraction timing.",
    });
  }
  return {
    input: input.plan,
    treatment: input.treatment,
    scenario: input.scenario,
    pensionTreatment: input.pensionTreatment,
    evaluated: input.evaluated,
    strategy: input.strategy,
    base,
    issues,
    reflectedEventIds: new Set(input.plan.reflectedEventIds ?? []),
    timings: new Map(
      input.treatment.periodTimings.map((timing) => [
        timing.companyPeriodId,
        timing,
      ]),
    ),
    scenarioPeriods: new Map(
      input.scenario.companyPeriods.map((period) => [period.id, period]),
    ),
    periodResults: [],
    pensionContributions: [],
    deductions: [],
    ownershipRecordIds: new Set(),
    constraintRecordIds: new Set(),
  };
}

function resolvePeriodLiquidity(
  context: ExtractionContext,
  period: LimitedCompanyPeriod,
  scenarioPeriod: LimitedCompanyScenarioInput["companyPeriods"][number],
): PeriodLiquidity {
  const constraint = activeConstraint(
    context.input.liquidityConstraints ?? [],
    period.companyPeriodId,
    scenarioPeriod.accountingPeriodEndsOn,
    context.input.asKnownAt,
  );
  if (constraint == null) {
    context.issues.push({
      kind: "missing-liquidity-constraint",
      state: "needs-review",
      detail: `${period.companyPeriodId} has no dated operating reserve and liability constraint.`,
      companyPeriodId: period.companyPeriodId,
    });
  } else {
    context.constraintRecordIds.add(constraint.recordId);
    for (const amount of [
      constraint.operatingReservePence,
      constraint.companyLiabilitiesPence,
      constraint.unavailableCashPence,
    ]) {
      if (!Number.isInteger(amount) || amount < 0) {
        throw new Error(
          `Liquidity constraint ${constraint.recordId} must use whole non-negative pence`,
        );
      }
    }
  }
  const operatingReservePence = constraint?.operatingReservePence ?? 0;
  const companyLiabilitiesPence = constraint?.companyLiabilitiesPence ?? 0;
  const unavailableCashPence = constraint?.unavailableCashPence ?? 0;
  const liquidCashAfterConstraintsPence =
    period.companyCash.cashAfterTaxReservesPence -
    operatingReservePence -
    companyLiabilitiesPence -
    unavailableCashPence;
  if (liquidCashAfterConstraintsPence < 0) {
    context.issues.push({
      kind: "unavailable-company-cash",
      state: "unsupported",
      detail: `${period.companyPeriodId} is short ${Math.abs(liquidCashAfterConstraintsPence)}p after tax, liabilities, operating reserve, and unavailable cash.`,
      companyPeriodId: period.companyPeriodId,
    });
  }
  return {
    constraint,
    operatingReservePence,
    companyLiabilitiesPence,
    unavailableCashPence,
    liquidCashAfterConstraintsPence,
  };
}

function periodOwnership(
  context: ExtractionContext,
  period: LimitedCompanyPeriod,
  timing: BusinessFiPeriodTiming,
): Set<string> {
  const ids = new Set<string>();
  const events = [
    ["salary", timing.salaryPaidOn, period.household.salaryPence],
    ["dividend", timing.dividendPaidOn, period.household.dividendsPence],
    [
      "employer-pension",
      timing.employerPensionContributedOn,
      period.household.employerPensionContributionPence,
    ],
  ] as const;
  for (const [kind, date, amount] of events) {
    if (amount <= 0) continue;
    const id = eventId(context.input.id, period.companyPeriodId, kind);
    const recordIds = eventOwnership({
      plan: context.input,
      occursOn: date,
      eventId: id,
      companyPeriodId: period.companyPeriodId,
      issues: context.issues,
    });
    for (const recordId of recordIds) {
      ids.add(recordId);
      context.ownershipRecordIds.add(recordId);
    }
  }
  return ids;
}

function periodInputRecordIds(
  context: ExtractionContext,
  ownershipIds: ReadonlySet<string>,
  constraint: BusinessFiLiquidityConstraint | null,
): string[] {
  return [
    ...context.evaluated.lineage.financialFactIds,
    ...ownershipIds,
    ...(constraint == null
      ? []
      : [constraint.recordId, ...constraint.inputRecordIds]),
  ];
}

function cashEvents(input: {
  context: ExtractionContext;
  period: LimitedCompanyPeriod;
  timing: BusinessFiPeriodTiming;
  inputRecordIds: readonly string[];
}): BusinessFiExtractionEvent[] {
  const id = (kind: BusinessFiExtractionEvent["kind"]) =>
    eventId(input.context.input.id, input.period.companyPeriodId, kind);
  const shared = {
    destination: "household-cash" as const,
    reflectedEventIds: input.context.reflectedEventIds,
    inputRecordIds: input.inputRecordIds,
  };
  return [
    extractionEvent({
      ...shared,
      id: id("salary"),
      kind: "salary",
      occursOn: input.timing.salaryPaidOn,
      availableOn: input.timing.householdCashAvailableOn,
      grossPence: input.period.household.salaryPence,
      deductionsPence: 0,
      netHouseholdValuePence: 0,
    }),
    extractionEvent({
      ...shared,
      id: id("dividend"),
      kind: "dividend",
      occursOn: input.timing.dividendPaidOn,
      availableOn: input.timing.householdCashAvailableOn,
      grossPence: input.period.household.dividendsPence,
      deductionsPence: 0,
      netHouseholdValuePence: 0,
    }),
    extractionEvent({
      ...shared,
      id: id("household-cash"),
      kind: "household-cash",
      occursOn: input.timing.householdCashAvailableOn,
      availableOn: input.timing.householdCashAvailableOn,
      grossPence:
        input.period.household.salaryPence +
        input.period.household.dividendsPence,
      deductionsPence: input.period.household.incrementalPersonalTaxPence,
      netHouseholdValuePence: input.period.household.spendableCashPence,
    }),
  ];
}

function pensionEvent(input: {
  context: ExtractionContext;
  period: LimitedCompanyPeriod;
  timing: BusinessFiPeriodTiming;
  inputRecordIds: readonly string[];
}): BusinessFiExtractionEvent {
  const id = eventId(
    input.context.input.id,
    input.period.companyPeriodId,
    "employer-pension",
  );
  const pension = evaluateBusinessFiPensionContribution({
    id,
    planningDate: input.context.input.planningDate,
    contributedOn: input.timing.employerPensionContributedOn,
    grossPence: input.period.household.employerPensionContributionPence,
    treatment: input.context.pensionTreatment,
    alreadyReflected: input.context.reflectedEventIds.has(id),
    inputRecordIds: input.inputRecordIds,
  });
  input.context.pensionContributions.push(pension);
  input.context.issues.push(
    ...pension.issues.map((issue) => ({
      kind: issue.kind,
      state: "unsupported" as const,
      detail: issue.detail,
      companyPeriodId: input.period.companyPeriodId,
      eventId: id,
    })),
  );
  const taxAndFees =
    (pension.withdrawalTaxPence ?? 0) + pension.withdrawalFeePence;
  return extractionEvent({
    id,
    kind: "employer-pension",
    occursOn: input.timing.employerPensionContributedOn,
    availableOn:
      pension.accessibleOn ?? input.timing.employerPensionContributedOn,
    destination: "pension",
    grossPence: pension.grossPence,
    deductionsPence: taxAndFees,
    netHouseholdValuePence: pension.supported
      ? Math.max(0, pension.grossPence - taxAndFees)
      : 0,
    reflectedEventIds: input.context.reflectedEventIds,
    inputRecordIds: pension.inputRecordIds,
  });
}

function periodDeductions(
  period: LimitedCompanyPeriod,
  liquidity: PeriodLiquidity,
): BusinessFiDeduction[] {
  const companyPeriodId = period.companyPeriodId;
  return [
    {
      kind: "corporation-tax",
      amountPence: period.profit.corporationTax.corporationTaxPence,
      companyPeriodId,
    },
    {
      kind: "vat-reserve",
      amountPence: period.companyCash.unpaidVatPence,
      companyPeriodId,
    },
    {
      kind: "employer-national-insurance",
      amountPence: period.profit.employerNationalInsurancePence,
      companyPeriodId,
    },
    {
      kind: "personal-tax",
      amountPence: period.household.incrementalPersonalTaxPence,
      companyPeriodId,
    },
    {
      kind: "operating-reserve",
      amountPence: liquidity.operatingReservePence,
      companyPeriodId,
    },
    {
      kind: "company-liabilities",
      amountPence: liquidity.companyLiabilitiesPence,
      companyPeriodId,
    },
    {
      kind: "unavailable-cash",
      amountPence: liquidity.unavailableCashPence,
      companyPeriodId,
    },
  ];
}

function evaluatePeriod(
  context: ExtractionContext,
  period: LimitedCompanyPeriod,
): void {
  const scenarioPeriod = context.scenarioPeriods.get(period.companyPeriodId);
  const timing = context.timings.get(period.companyPeriodId);
  if (scenarioPeriod == null || timing == null) {
    context.issues.push({
      kind: "missing-period-timing",
      state: "needs-review",
      detail: `${period.companyPeriodId} has no complete dated extraction timing.`,
      companyPeriodId: period.companyPeriodId,
    });
    return;
  }
  validateTiming({ timing, period: scenarioPeriod, issues: context.issues });
  const liquidity = resolvePeriodLiquidity(context, period, scenarioPeriod);
  const ownershipIds = periodOwnership(context, period, timing);
  const inputRecordIds = periodInputRecordIds(
    context,
    ownershipIds,
    liquidity.constraint,
  );
  const events = cashEvents({ context, period, timing, inputRecordIds });
  events.push(pensionEvent({ context, period, timing, inputRecordIds }));
  context.deductions.push(...periodDeductions(period, liquidity));
  context.periodResults.push({
    companyPeriodId: period.companyPeriodId,
    taxYear: period.taxYear,
    timing,
    ownershipRecordIds: [...ownershipIds],
    household: {
      salaryPence: period.household.salaryPence,
      dividendsPence: period.household.dividendsPence,
      employerPensionContributionPence:
        period.household.employerPensionContributionPence,
      incrementalPersonalTaxPence: period.household.incrementalPersonalTaxPence,
      spendableCashPence: period.household.spendableCashPence,
    },
    taxAndAllowances: {
      employerNationalInsurancePence: period.payroll.employerNiPence,
      employmentAllowanceUsedPence: period.payroll.employmentAllowanceUsedPence,
      pensionTestedInputPence: period.pension.testedInputPence,
      pensionAnnualAllowancePence: period.pension.annualAllowancePence,
      pensionCarryForwardAvailablePence:
        period.pension.carryForwardAvailablePence,
      pensionTotalCapacityPence: period.pension.totalCapacityPence,
      pensionExcessPence: period.pension.excessPence,
      moneyPurchaseAnnualAllowanceApplies:
        period.pension.moneyPurchaseAnnualAllowanceApplies,
      taxRuleDatasetVersion: period.household.taxRuleDatasetVersion,
      taxRuleIds: period.household.taxRuleIds,
    },
    company: {
      openingCashPence: period.companyCash.openingCashPence,
      closingCashPence: period.companyCash.closingCashPence,
      closingDistributableReservesPence:
        period.profit.closingDistributableReservesPence,
      unpaidCorporationTaxPence: period.companyCash.unpaidCorporationTaxPence,
      unpaidVatPence: period.companyCash.unpaidVatPence,
      operatingReservePence: liquidity.operatingReservePence,
      companyLiabilitiesPence: liquidity.companyLiabilitiesPence,
      unavailableCashPence: liquidity.unavailableCashPence,
      liquidCashAfterConstraintsPence:
        liquidity.liquidCashAfterConstraintsPence,
    },
    goalAssessment: period.goalAssessment,
    events,
  });
}

function evaluatePeriods(context: ExtractionContext): void {
  for (const period of context.strategy.periods) {
    evaluatePeriod(context, period);
  }
}

function deferredExtraction(context: ExtractionContext): {
  event: BusinessFiExtractionEvent | null;
  retainedCompanyCashPence: number;
  retainedDistributableReservesPence: number;
} {
  const endingCash = context.strategy.totals.endingCompanyCashPence;
  const endingReserves =
    context.strategy.totals.endingDistributableReservesPence;
  if (context.treatment.deferredExtraction.kind === "retain") {
    return {
      event: null,
      retainedCompanyCashPence: endingCash,
      retainedDistributableReservesPence: endingReserves,
    };
  }
  const deferred = context.strategy.deferredExtraction;
  const id = eventId(context.input.id, "terminal", "deferred-dividend");
  if (
    deferred.estimatedLaterDividendTaxPence == null ||
    deferred.estimatedLaterHouseholdCashPence == null
  ) {
    context.issues.push({
      kind: "unsupported-later-extraction-tax",
      state: "unsupported",
      detail:
        "The selected later dividend has no supported personal-tax result.",
      eventId: id,
    });
  }
  const supportedLiquidityPence = Math.max(
    0,
    Math.min(
      context.periodResults.at(-1)?.company.liquidCashAfterConstraintsPence ??
        0,
      context.strategy.totals.endingDistributableReservesPence,
    ),
  );
  if (deferred.grossDividendPence > supportedLiquidityPence) {
    context.issues.push({
      kind: "unavailable-later-extraction-cash",
      state: "unsupported",
      detail: `The later dividend needs ${deferred.grossDividendPence}p but only ${supportedLiquidityPence}p remains liquid and distributable after constraints.`,
      eventId: id,
    });
  }
  const availableOn = context.treatment.deferredExtraction.availableOn;
  const finalPeriodEnd = context.scenario.companyPeriods
    .map(({ accountingPeriodEndsOn }) => accountingPeriodEndsOn)
    .toSorted((left, right) => right.localeCompare(left))[0];
  if (finalPeriodEnd != null && availableOn < finalPeriodEnd) {
    context.issues.push({
      kind: "invalid-later-extraction-date",
      state: "needs-review",
      detail: `The later dividend date ${availableOn} precedes the final company period ending ${finalPeriodEnd}.`,
      eventId: id,
    });
  }
  const ownershipIds = eventOwnership({
    plan: context.input,
    occursOn: availableOn,
    eventId: id,
    issues: context.issues,
  });
  for (const recordId of ownershipIds) {
    context.ownershipRecordIds.add(recordId);
  }
  context.deductions.push({
    kind: "later-dividend-tax",
    amountPence: deferred.estimatedLaterDividendTaxPence ?? 0,
  });
  return {
    event: extractionEvent({
      id,
      kind: "deferred-dividend",
      occursOn: availableOn,
      availableOn,
      destination: "household-cash",
      grossPence: deferred.grossDividendPence,
      deductionsPence: deferred.estimatedLaterDividendTaxPence ?? 0,
      netHouseholdValuePence: deferred.estimatedLaterHouseholdCashPence ?? 0,
      reflectedEventIds: context.reflectedEventIds,
      inputRecordIds: [
        ...context.evaluated.lineage.financialFactIds,
        ...ownershipIds,
        ...context.constraintRecordIds,
      ],
    }),
    retainedCompanyCashPence: Math.max(
      0,
      endingCash - deferred.grossDividendPence,
    ),
    retainedDistributableReservesPence: Math.max(
      0,
      endingReserves - deferred.grossDividendPence,
    ),
  };
}

function capitalAdditions(input: {
  context: ExtractionContext;
  deferredEvent: BusinessFiExtractionEvent | null;
  blocked: boolean;
}) {
  const events = [
    ...input.context.periodResults.flatMap(({ events }) => events),
    ...(input.deferredEvent == null ? [] : [input.deferredEvent]),
  ];
  if (input.blocked) {
    for (const event of events) event.countedInFiCapital = false;
  }
  const valueEvents = events.filter(
    ({ kind }) =>
      kind === "household-cash" ||
      kind === "employer-pension" ||
      kind === "deferred-dividend",
  );
  const counted = valueEvents.filter(({ countedInFiCapital }) =>
    Boolean(countedInFiCapital),
  );
  const availableNowPence = counted
    .filter(
      ({ availableOn }) => availableOn <= input.context.input.planningDate,
    )
    .reduce((total, event) => total + event.netHouseholdValuePence, 0);
  const futurePence = counted
    .filter(({ availableOn }) => availableOn > input.context.input.planningDate)
    .reduce((total, event) => total + event.netHouseholdValuePence, 0);
  return {
    availableNowPence,
    futurePence,
    incrementalPence: availableNowPence + futurePence,
    pensionWealthPence: input.blocked
      ? 0
      : input.context.pensionContributions.reduce(
          (total, contribution) => total + contribution.pensionWealthAddedPence,
          0,
        ),
    strategyNetPence: valueEvents.reduce(
      (total, event) => total + event.netHouseholdValuePence,
      0,
    ),
  };
}

function extractionResult(
  context: ExtractionContext,
  deferred: ReturnType<typeof deferredExtraction>,
): BusinessFiPlanResult {
  const issues = uniqueIssues(context.issues);
  const blocked = issues.length > 0 || !context.strategy.feasible;
  const additions = capitalAdditions({
    context,
    deferredEvent: deferred.event,
    blocked,
  });
  const sorted = (values: ReadonlySet<string>) =>
    [...values].sort((left, right) => left.localeCompare(right));
  return {
    calculationVersion: BUSINESS_FI_EXTRACTION_CALCULATION_VERSION,
    id: context.input.id,
    label: context.input.label,
    status: blocked ? "blocked" : "available",
    treatment: context.treatment,
    company: {
      ...context.base.company,
      retainedCompanyCashPence: deferred.retainedCompanyCashPence,
      retainedDistributableReservesPence:
        deferred.retainedDistributableReservesPence,
    },
    capital: {
      ...context.base.capital,
      capitalAvailableNowPence:
        context.base.capital.capitalAvailableNowPence +
        additions.availableNowPence,
      futureAccessibleCapitalPence:
        context.base.capital.futureAccessibleCapitalPence +
        additions.futurePence,
      pensionWealthPence:
        context.base.capital.pensionWealthPence + additions.pensionWealthPence,
      fiEligibleCapitalPence:
        context.base.capital.fiEligibleCapitalPence +
        additions.incrementalPence,
      incrementalFiEligibleCapitalPence: additions.incrementalPence,
    },
    strategyNetHouseholdValuePence: additions.strategyNetPence,
    periods: context.periodResults,
    deferredEvent: deferred.event,
    pensionContributions: context.pensionContributions,
    deductions: context.deductions.filter(({ amountPence }) => amountPence > 0),
    issues,
    lineage: {
      treatmentRecordId: context.treatment.recordId,
      valuationRecordIds: [...context.input.wealth.valuationRecordIds],
      ownershipRecordIds: sorted(context.ownershipRecordIds),
      constraintRecordIds: sorted(context.constraintRecordIds),
      inputRecordIds: [
        ...new Set([
          ...context.base.lineage.inputRecordIds,
          ...context.input.wealth.valuationRecordIds,
          ...context.ownershipRecordIds,
          ...context.constraintRecordIds,
          ...context.evaluated.lineage.financialFactIds,
        ]),
      ],
      limitedCompanyCalculationVersion: context.evaluated.calculationVersion,
      limitedCompanyRulesetVersion: context.evaluated.rulesetVersion,
      taxRuleDatasetVersions: context.evaluated.lineage.taxRuleDatasetVersions,
      ruleIds: context.evaluated.lineage.ruleIds,
    },
  };
}

export function evaluateBusinessFiPlan(
  input: BusinessFiPlanInput,
): BusinessFiPlanResult {
  validateCapitalPosition(input.capitalPosition);
  if (input.wealth.baseCurrency !== "GBP") {
    throw new Error("Limited-company FI extraction currently requires GBP");
  }
  if (input.treatment.kind === "exclude") return excludedPlan(input);
  const treatment = input.treatment;
  if (input.limitedCompanyScenario == null) {
    return missingExtractionInput(
      input,
      "The limited-company scenario is missing.",
    );
  }
  if (input.pensionTreatment == null) {
    return missingExtractionInput(
      input,
      "The pension access treatment is missing.",
    );
  }
  const evaluated = evaluateLimitedCompanyScenario(
    input.limitedCompanyScenario,
  );
  const strategy = evaluated.strategies.find(
    ({ id }) => id === treatment.strategyId,
  );
  if (strategy == null) {
    return missingExtractionInput(
      input,
      `Strategy ${treatment.strategyId} is not in the limited-company scenario.`,
    );
  }
  const context = createExtractionContext({
    plan: input,
    treatment,
    scenario: input.limitedCompanyScenario,
    pensionTreatment: input.pensionTreatment,
    evaluated,
    strategy,
  });
  evaluatePeriods(context);
  return extractionResult(context, deferredExtraction(context));
}

export function compareBusinessFiPlans(
  inputs: readonly BusinessFiPlanInput[],
): BusinessFiPlanResult[] {
  return inputs.map(evaluateBusinessFiPlan).toSorted((left, right) => {
    const statusRank = { available: 0, excluded: 1, blocked: 2 } as const;
    return (
      statusRank[left.status] - statusRank[right.status] ||
      right.capital.fiEligibleCapitalPence -
        left.capital.fiEligibleCapitalPence ||
      left.id.localeCompare(right.id)
    );
  });
}
