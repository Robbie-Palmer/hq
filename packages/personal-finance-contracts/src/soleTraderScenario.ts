import { z } from "zod";
import {
  IsoDateSchema,
  SIDE_INCOME_CONTRACT_VERSION,
  SideIncomeCaseSchema,
  TaxYearSchema,
  type FinancialFact,
} from "./sideIncome";
import {
  evaluateSideIncomeEligibility,
  type RuleEvaluation,
} from "./sideIncomeEligibility";
import {
  findSideIncomeRule,
  UK_SIDE_INCOME_RULESET_VERSION,
} from "./sideIncomeRules";
import {
  calculateSoleTraderCashFlow,
  type SoleTraderCashFlowResult,
  type SoleTraderExpenseTreatment,
} from "./soleTraderCashFlow";
import {
  SUPPORTED_SOLE_TRADER_TAX_YEAR,
  UK_SOLE_TRADER_RULESET_VERSION,
  ukSoleTraderRuleSet,
} from "./soleTraderRules";
import {
  calculateSoleTraderTax,
  type SoleTraderTaxResult,
} from "./soleTraderTax";

export const SOLE_TRADER_SCENARIO_VERSION = 1 as const;
export const SOLE_TRADER_CALCULATION_VERSION = "1" as const;

const PenceSchema = z.number().int().nonnegative();
const IncomeTaxJurisdictionSchema = z.enum([
  "england-and-northern-ireland",
  "scotland",
  "wales",
]);
const FactAmountSchema = z
  .object({ factId: z.string().min(1), amountPence: PenceSchema })
  .strict();

const CashPeriodSchema = z
  .object({
    id: z.string().trim().min(1),
    startsOn: IsoDateSchema,
    endsOn: IsoDateSchema,
    invoiceReceipts: z.array(FactAmountSchema),
    expensePayments: z.array(FactAmountSchema),
    personalWithdrawalsPence: PenceSchema,
    taxReserveTransferPence: PenceSchema,
  })
  .strict();

export const SoleTraderScenarioInputSchema = z
  .object({
    scenarioVersion: z.literal(SOLE_TRADER_SCENARIO_VERSION),
    sideIncomeCase: SideIncomeCaseSchema,
    evaluatedOn: IsoDateSchema,
    taxYear: TaxYearSchema,
    personId: z.string().trim().min(1),
    incomeTaxJurisdiction: IncomeTaxJurisdictionSchema,
    deductionMethod: z.enum([
      "most-beneficial",
      "actual-expenses",
      "trading-allowance",
    ]),
    expenseTreatments: z.array(
      z
        .object({
          factId: z.string().trim().min(1),
          taxTreatment: z.enum(["allowable", "disallowable"]),
          category: z.enum(["direct", "bookkeeping", "accountancy", "other"]),
        })
        .strict(),
    ),
    reliefAtSourcePensionFactIds: z.array(z.string().trim().min(1)),
    incomeTaxDeductedAtSourcePence: PenceSchema,
    priorPaymentsOnAccountPence: PenceSchema,
    studentLoan: z
      .object({
        standardPlan: z.enum(["plan-1", "plan-2", "plan-4", "plan-5"]).nullable(),
        postgraduateLoan: z.boolean(),
        unearnedIncomeFactIds: z.array(z.string().trim().min(1)),
        standardLoanDeductedByPayePence: PenceSchema,
        postgraduateLoanDeductedByPayePence: PenceSchema,
      })
      .strict(),
    cashFlow: z
      .object({
        openingAvailableCashPence: PenceSchema,
        openingTaxReservePence: PenceSchema,
        periods: z.array(CashPeriodSchema).min(1),
      })
      .strict(),
  })
  .strict()
  .superRefine((input, context) => {
    const treatmentIds = input.expenseTreatments.map(({ factId }) => factId);
    if (new Set(treatmentIds).size !== treatmentIds.length) {
      context.addIssue({
        code: "custom",
        message: "Each expense fact can have only one tax treatment",
        path: ["expenseTreatments"],
      });
    }
    const periodIds = input.cashFlow.periods.map(({ id }) => id);
    if (new Set(periodIds).size !== periodIds.length) {
      context.addIssue({
        code: "custom",
        message: "Cash-flow period IDs must be unique",
        path: ["cashFlow", "periods"],
      });
    }
  });

export type SoleTraderScenarioInput = z.infer<
  typeof SoleTraderScenarioInputSchema
>;

type ScenarioIssue = {
  code: string;
  state: "needs-review" | "unsupported";
  detail: string;
};

const sum = (values: readonly number[]) =>
  values.reduce((total, value) => total + value, 0);

const uniqueIssues = (issues: ScenarioIssue[]) =>
  issues.filter(
    (issue, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.code === issue.code && candidate.detail === issue.detail,
      ) === index,
  );

const ruleStatus = (
  rules: Array<{ ruleId: string; status: string }>,
  ruleId: string,
) => rules.find((rule) => rule.ruleId === ruleId)?.status ?? "needs-review";

const deadlineDates = (taxYear: string) => {
  const startYear = Number(taxYear.slice(0, 4));
  const endYear = startYear + 1;
  return {
    registrationDueOn: `${endYear}-10-05`,
    returnAndBalanceDueOn: `${endYear + 1}-01-31`,
    secondPaymentOnAccountDueOn: `${endYear + 1}-07-31`,
  };
};

function selectProfitTreatment({
  actualProfitPence,
  allowanceAvailable,
  deductionMethod,
  grossRevenuePence,
}: {
  actualProfitPence: number;
  allowanceAvailable: boolean;
  deductionMethod: SoleTraderScenarioInput["deductionMethod"];
  grossRevenuePence: number;
}) {
  const tradingAllowancePence = Math.min(100_000, grossRevenuePence);
  const profitUsingActualExpensesPence = Math.max(0, actualProfitPence);
  const profitUsingTradingAllowancePence = Math.max(
    0,
    grossRevenuePence - tradingAllowancePence,
  );
  if (deductionMethod === "actual-expenses" || !allowanceAvailable) {
    return {
      selectedMethod: "actual-expenses" as const,
      taxableProfitPence: profitUsingActualExpensesPence,
      tradingAllowancePence: 0,
    };
  }
  if (
    deductionMethod === "trading-allowance" ||
    profitUsingTradingAllowancePence < profitUsingActualExpensesPence
  ) {
    return {
      selectedMethod: "trading-allowance" as const,
      taxableProfitPence: profitUsingTradingAllowancePence,
      tradingAllowancePence,
    };
  }
  return {
    selectedMethod: "actual-expenses" as const,
    taxableProfitPence: profitUsingActualExpensesPence,
    tradingAllowancePence: 0,
  };
}

type ScenarioScope = {
  selectedFacts: FinancialFact[];
  revenueFacts: FinancialFact[];
  expenseFacts: FinancialFact[];
  issues: ScenarioIssue[];
};

const unsupportedTaxYearIssue = (
  input: SoleTraderScenarioInput,
): ScenarioIssue[] =>
  input.taxYear === SUPPORTED_SOLE_TRADER_TAX_YEAR
    ? []
    : [
        {
          code: "unsupported-tax-year",
          state: "unsupported",
          detail: `${input.taxYear} is outside sole-trader ruleset ${UK_SOLE_TRADER_RULESET_VERSION}.`,
        },
      ];

const expenseTreatmentIssues = (
  expenseFacts: readonly FinancialFact[],
  treatments: readonly SoleTraderExpenseTreatment[],
): ScenarioIssue[] => {
  const factIds = new Set(expenseFacts.map((fact) => fact.id));
  const treatmentIds = new Set(treatments.map((treatment) => treatment.factId));
  const missing = expenseFacts
    .filter((fact) => !treatmentIds.has(fact.id))
    .map((fact) => ({
      code: "missing-expense-treatment",
      state: "needs-review" as const,
      detail: `${fact.id} needs an allowable or disallowable tax treatment.`,
    }));
  const unknown = treatments
    .filter((treatment) => !factIds.has(treatment.factId))
    .map((treatment) => ({
      code: "unknown-expense-treatment",
      state: "needs-review" as const,
      detail: `${treatment.factId} is not a selected sole-trader business cost.`,
    }));
  return [...missing, ...unknown];
};

function selectScenarioScope(input: SoleTraderScenarioInput): ScenarioScope {
  const ownedBusinessIds = new Set(
    input.sideIncomeCase.businessOwnerships
      .filter((ownership) => ownership.personId === input.personId)
      .map((ownership) => ownership.businessId),
  );
  const soleTraderBusinessIds = new Set(
    input.sideIncomeCase.businesses
      .filter(
        (business) =>
          business.structure === "sole-trader" && ownedBusinessIds.has(business.id),
      )
      .map((business) => business.id),
  );
  const selectedFacts = input.sideIncomeCase.financialFacts.filter(
    (fact) =>
      fact.taxYear === input.taxYear &&
      fact.businessId !== null &&
      soleTraderBusinessIds.has(fact.businessId),
  );
  const revenueFacts = selectedFacts.filter(
    (fact) => fact.kind === "gross-revenue",
  );
  const expenseFacts = selectedFacts.filter(
    (fact) => fact.kind === "business-cost",
  );
  const issues = expenseTreatmentIssues(
    expenseFacts,
    input.expenseTreatments,
  );
  if (
    input.sideIncomeCase.businesses.some(
      (business) => business.structure !== "sole-trader",
    )
  ) {
    issues.push({
      code: "non-sole-trader-structure",
      state: "unsupported",
      detail:
        "This calculation accepts sole-trader businesses only. Company, partnership, and umbrella scenarios use separate models.",
    });
  }
  if (soleTraderBusinessIds.size === 0) {
    issues.push({
      code: "missing-sole-trader-business",
      state: "unsupported",
      detail: `${input.personId} has no owned sole-trader business in this case.`,
    });
  }
  if (revenueFacts.length === 0) {
    issues.push({
      code: "missing-gross-revenue",
      state: "needs-review",
      detail: `No sole-trader gross revenue is recorded for ${input.taxYear}.`,
    });
  }
  if (selectedFacts.some((fact) => fact.amount.minorUnits < 0)) {
    issues.push({
      code: "negative-financial-fact",
      state: "unsupported",
      detail: "Negative revenue and cost facts need correction or specialist loss handling.",
    });
  }
  return { selectedFacts, revenueFacts, expenseFacts, issues };
}

const pensionIssues = (input: SoleTraderScenarioInput): ScenarioIssue[] => {
  const factById = new Map(
    input.sideIncomeCase.financialFacts.map((fact) => [fact.id, fact]),
  );
  return input.reliefAtSourcePensionFactIds.flatMap((factId) => {
    const fact = factById.get(factId);
    const valid =
      fact?.kind === "pension-contribution" &&
      fact.taxYear === input.taxYear &&
      fact.owner.kind === "person" &&
      fact.owner.personId === input.personId &&
      fact.amount.minorUnits >= 0;
    return valid
      ? []
      : [
          {
            code: "invalid-pension-relief-fact",
            state: "needs-review" as const,
            detail: `${factId} is not a non-negative relief-at-source pension contribution for ${input.personId} in ${input.taxYear}.`,
          },
        ];
  });
};

const studentLoanIncomeIssues = (
  input: SoleTraderScenarioInput,
): ScenarioIssue[] => {
  const factById = new Map(
    input.sideIncomeCase.financialFacts.map((fact) => [fact.id, fact]),
  );
  return input.studentLoan.unearnedIncomeFactIds.flatMap((factId) => {
    const fact = factById.get(factId);
    const valid =
      fact?.kind === "other-taxable-income" &&
      fact.taxYear === input.taxYear &&
      fact.owner.kind === "person" &&
      fact.owner.personId === input.personId &&
      fact.amount.minorUnits >= 0;
    return valid
      ? []
      : [
          {
            code: "invalid-student-loan-income-fact",
            state: "needs-review" as const,
            detail: `${factId} is not non-negative other taxable income for ${input.personId} in ${input.taxYear}.`,
          },
        ];
  });
};

function calculateProfit(
  input: SoleTraderScenarioInput,
  revenueFacts: readonly FinancialFact[],
  expenseFacts: readonly FinancialFact[],
  soleTraderRules: RuleEvaluation[],
) {
  const treatmentById = new Map(
    input.expenseTreatments.map((treatment) => [treatment.factId, treatment]),
  );
  const grossRevenuePence = sum(
    revenueFacts.map((fact) => fact.amount.minorUnits),
  );
  const totalBusinessCostsPence = sum(
    expenseFacts.map((fact) => fact.amount.minorUnits),
  );
  const allowableExpensesPence = sum(
    expenseFacts
      .filter(
        (fact) => treatmentById.get(fact.id)?.taxTreatment === "allowable",
      )
      .map((fact) => fact.amount.minorUnits),
  );
  const actualTaxProfitPence = grossRevenuePence - allowableExpensesPence;
  const tradingAllowanceStatus = ruleStatus(
    soleTraderRules,
    "uk.sole-trader.trading-allowance",
  );
  const allowanceAvailable = tradingAllowanceStatus === "available";
  const issues: ScenarioIssue[] = [];
  if (actualTaxProfitPence < 0) {
    issues.push({
      code: "unsupported-trading-loss",
      state: "unsupported",
      detail:
        "The recorded allowable costs create a trading loss. Loss relief and carry-forward treatment are not modelled.",
    });
  }
  if (
    input.deductionMethod === "trading-allowance" &&
    !allowanceAvailable
  ) {
    issues.push({
      code: "trading-allowance-unavailable",
      state:
        tradingAllowanceStatus === "needs-review"
          ? "needs-review"
          : "unsupported",
      detail: "The requested trading allowance is not available from the recorded eligibility facts.",
    });
  }
  const treatment = selectProfitTreatment({
    actualProfitPence: actualTaxProfitPence,
    allowanceAvailable,
    deductionMethod: input.deductionMethod,
    grossRevenuePence,
  });
  return {
    profit: {
      grossRevenuePence,
      totalBusinessCostsPence,
      accountingProfitPence: grossRevenuePence - totalBusinessCostsPence,
      allowableExpensesPence,
      disallowableExpensesPence:
        totalBusinessCostsPence - allowableExpensesPence,
      deductionMethod: treatment.selectedMethod,
      tradingAllowancePence: treatment.tradingAllowancePence,
      taxableProfitPence: treatment.taxableProfitPence,
    },
    issues,
  };
}

const taxResult = (
  input: SoleTraderScenarioInput,
  taxableProfitPence: number,
  issues: readonly ScenarioIssue[],
): { tax: SoleTraderTaxResult | null; issues: ScenarioIssue[] } => {
  if (issues.length > 0) return { tax: null, issues: [] };
  const calculated = calculateSoleTraderTax({
    sideIncomeCase: input.sideIncomeCase,
    personId: input.personId,
    taxYear: input.taxYear,
    incomeTaxJurisdiction: input.incomeTaxJurisdiction,
    taxableProfitPence,
    reliefAtSourcePensionFactIds: input.reliefAtSourcePensionFactIds,
    incomeTaxDeductedAtSourcePence: input.incomeTaxDeductedAtSourcePence,
    priorPaymentsOnAccountPence: input.priorPaymentsOnAccountPence,
    studentLoan: input.studentLoan,
  });
  const taxIssues = calculated.unsupported.map((issue) => ({
    code: issue.code,
    state: "unsupported" as const,
    detail: issue.detail,
  }));
  return {
    tax: taxIssues.length === 0 ? calculated : null,
    issues: taxIssues,
  };
};

const vatRegistrationStatus = (
  input: SoleTraderScenarioInput,
  soleTraderRules: RuleEvaluation[],
) => {
  const rule = ruleStatus(soleTraderRules, "uk.vat.registration");
  const everySupplyExempt =
    input.sideIncomeCase.vatPositions.length > 0 &&
    input.sideIncomeCase.vatPositions.every(
      (position) => position.allSuppliesExemptOrOutOfScope === true,
    );
  if (rule === "required") return "required" as const;
  if (everySupplyExempt) return "not-applicable" as const;
  if (rule === "not-required") return "optional" as const;
  return "needs-review" as const;
};

const paymentSchedule = (
  tax: SoleTraderTaxResult | null,
  dates: ReturnType<typeof deadlineDates>,
) =>
  tax === null
    ? []
    : [
        {
          kind: "balancing-payment" as const,
          dueOn: dates.returnAndBalanceDueOn,
          amountPence: tax.payments.balancingPaymentPence,
          creditsNextTaxYear: false,
        },
        {
          kind: "first-payment-on-account" as const,
          dueOn: dates.returnAndBalanceDueOn,
          amountPence: tax.payments.eachPaymentOnAccountPence,
          creditsNextTaxYear: true,
        },
        {
          kind: "second-payment-on-account" as const,
          dueOn: dates.secondPaymentOnAccountDueOn,
          amountPence: tax.payments.eachPaymentOnAccountPence,
          creditsNextTaxYear: true,
        },
      ];

const buildObligations = (
  input: SoleTraderScenarioInput,
  soleTraderRules: RuleEvaluation[],
  tax: SoleTraderTaxResult | null,
) => {
  const dates = deadlineDates(input.taxYear);
  const registrationStatus = ruleStatus(
    soleTraderRules,
    "uk.sole-trader.self-assessment-registration",
  );
  const registrationRequired = registrationStatus === "required";
  const mtdRule = soleTraderRules.find((rule) =>
    rule.ruleId.startsWith("uk.mtd-income-tax"),
  );
  const vatStatus = vatRegistrationStatus(input, soleTraderRules);
  return {
    selfAssessmentRegistration: {
      status: registrationStatus,
      dueOn: registrationRequired ? dates.registrationDueOn : null,
    },
    selfAssessmentReturn: {
      status: registrationRequired ? "required" : "not-required",
      dueOn: registrationRequired ? dates.returnAndBalanceDueOn : null,
    },
    makingTaxDigital: {
      status: mtdRule?.status ?? "needs-review",
      ruleId: mtdRule?.ruleId ?? null,
    },
    vatRegistration: {
      status: vatStatus,
      voluntaryRegistrationAvailable: vatStatus === "optional",
    },
    paymentsOnAccount: {
      required: tax?.payments.paymentsOnAccountRequired ?? null,
      studentLoansExcludedFromBasis: true,
      schedule: paymentSchedule(tax, dates),
    },
  };
};

const buildReserve = (
  tax: SoleTraderTaxResult | null,
  cashFlow: SoleTraderCashFlowResult,
  schedule: ReturnType<typeof paymentSchedule>,
) => {
  const annualLiabilityReservePence = tax?.incremental.totalPence ?? 0;
  const firstDeadlineCashNeedPence = tax === null
    ? 0
    : tax.payments.balancingPaymentPence +
      tax.payments.eachPaymentOnAccountPence;
  const currentReservePence = cashFlow.totals.taxReservePence;
  return {
    annualLiabilityReservePence,
    firstDeadlineCashNeedPence,
    totalScheduledCashPence: sum(schedule.map((payment) => payment.amountPence)),
    currentReservePence,
    annualLiabilityReserveGapPence: Math.max(
      0,
      annualLiabilityReservePence - currentReservePence,
    ),
    firstDeadlineReserveGapPence: Math.max(
      0,
      firstDeadlineCashNeedPence - currentReservePence,
    ),
  };
};

const buildLineage = (
  selectedFacts: readonly FinancialFact[],
  soleTraderRules: RuleEvaluation[],
  tax: SoleTraderTaxResult | null,
) => {
  const relatedRuleIds = soleTraderRules.map((rule) => rule.ruleId);
  const releasedRuleSources = relatedRuleIds.map((ruleId) => {
    const rule = findSideIncomeRule(ruleId);
    return { id: ruleId, title: rule.source.title, url: rule.source.url };
  });
  const sources = [
    ...releasedRuleSources,
    ...ukSoleTraderRuleSet.sources.map((source) => ({
      id: source.id,
      title: source.title,
      url: source.url,
    })),
    ...(tax?.lineage.taxSources ?? []),
  ].filter(
    (source, index, all) =>
      all.findIndex((candidate) => candidate.url === source.url) === index,
  );
  return {
    sideIncomeContractVersion: SIDE_INCOME_CONTRACT_VERSION,
    sideIncomeRulesetVersion: UK_SIDE_INCOME_RULESET_VERSION,
    soleTraderRulesetVersion: UK_SOLE_TRADER_RULESET_VERSION,
    taxRuleDatasetVersion: tax?.lineage.taxRuleDatasetVersion ?? null,
    financialFactIds: selectedFacts.map((fact) => fact.id),
    sourceLineage: selectedFacts.map((fact) => ({
      factId: fact.id,
      ...fact.lineage,
    })),
    ruleIds: [
      ...relatedRuleIds,
      ...(tax?.lineage.ruleIds ?? []),
      ukSoleTraderRuleSet.deadlines.ruleId,
    ],
    sources,
    rounding:
      "Tax rates are applied to pence and each component is rounded to the nearest penny.",
  };
};

export function evaluateSoleTraderScenario(value: SoleTraderScenarioInput) {
  const input = SoleTraderScenarioInputSchema.parse(value);
  const eligibility = evaluateSideIncomeEligibility(input.sideIncomeCase, {
    evaluatedOn: input.evaluatedOn,
    taxYear: input.taxYear,
  });
  const soleTraderRules =
    eligibility.options.find((option) => option.option === "sole-trader")?.rules ?? [];
  const scope = selectScenarioScope(input);
  const calculatedProfit = calculateProfit(
    input,
    scope.revenueFacts,
    scope.expenseFacts,
    soleTraderRules,
  );
  const cashFlow = calculateSoleTraderCashFlow({
    cashFlow: input.cashFlow,
    expenseFacts: scope.expenseFacts,
    expenseTreatments: input.expenseTreatments as SoleTraderExpenseTreatment[],
    revenueFacts: scope.revenueFacts,
  });
  const initialIssues = uniqueIssues([
    ...unsupportedTaxYearIssue(input),
    ...eligibility.issues,
    ...scope.issues,
    ...pensionIssues(input),
    ...studentLoanIncomeIssues(input),
    ...calculatedProfit.issues,
    ...cashFlow.issues.map((issue) => ({
      ...issue,
      state: "needs-review" as const,
    })),
  ]);
  const calculatedTax = taxResult(
    input,
    calculatedProfit.profit.taxableProfitPence,
    initialIssues,
  );
  const issues = uniqueIssues([...initialIssues, ...calculatedTax.issues]);
  const obligations = buildObligations(
    input,
    soleTraderRules,
    calculatedTax.tax,
  );
  const schedule = obligations.paymentsOnAccount.schedule;
  const taxAndLoanPence = calculatedTax.tax?.incremental.totalPence ?? null;
  const netBenefitPence =
    taxAndLoanPence === null
      ? null
      : calculatedProfit.profit.accountingProfitPence - taxAndLoanPence;
  return {
    kind: "uk-sole-trader-side-income-scenario" as const,
    scenarioVersion: SOLE_TRADER_SCENARIO_VERSION,
    calculationVersion: SOLE_TRADER_CALCULATION_VERSION,
    rulesetVersion: UK_SOLE_TRADER_RULESET_VERSION,
    taxYear: input.taxYear,
    evaluatedOn: input.evaluatedOn,
    available: issues.length === 0 && calculatedTax.tax !== null,
    issues,
    profit: calculatedProfit.profit,
    tax: calculatedTax.tax,
    household: {
      incrementalTaxAndLoanPence: taxAndLoanPence,
      netBenefitPence,
    },
    cashFlow,
    reserve: buildReserve(calculatedTax.tax, cashFlow, schedule),
    obligations,
    lineage: buildLineage(
      scope.selectedFacts,
      soleTraderRules,
      calculatedTax.tax,
    ),
  };
}

export type SoleTraderScenarioResult = ReturnType<
  typeof evaluateSoleTraderScenario
>;
