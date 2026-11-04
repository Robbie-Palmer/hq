import {
  SIDE_INCOME_CURRENCY,
  SIDE_INCOME_JURISDICTION,
  SideIncomeCaseSchema,
  type FinancialFact,
  type SideIncomeCase,
} from "./sideIncome";
import {
  employmentPlusSideTradingCase,
  smallSideIncomeCase,
} from "./sideIncomeSyntheticCases";
import {
  SOLE_TRADER_SCENARIO_VERSION,
  SoleTraderScenarioInputSchema,
  type SoleTraderScenarioInput,
} from "./soleTraderScenario";

const recordedAt = "2026-10-31T00:00:00.000Z";

const costFact = (
  id: string,
  amountPence: number,
  occurredOn: string,
): FinancialFact => ({
  id,
  kind: "business-cost",
  amount: {
    minorUnits: amountPence,
    currency: SIDE_INCOME_CURRENCY,
    jurisdiction: SIDE_INCOME_JURISDICTION,
  },
  owner: { kind: "activity", activityId: "activity:freelance-design" },
  activityId: "activity:freelance-design",
  businessId: "business:design-trade",
  occurredOn,
  taxYear: "2026-27",
  unit: "total",
  status: "forecast",
  lineage: {
    kind: "user-entry",
    sourceId: `synthetic:${id}`,
    sourceRevision: "1",
    observedAt: recordedAt,
    recordedAt,
    parentRecordIds: [],
  },
});

const employmentCaseWithCosts = (): SideIncomeCase =>
  SideIncomeCaseSchema.parse({
    ...employmentPlusSideTradingCase,
    financialFacts: [
      ...employmentPlusSideTradingCase.financialFacts.map((fact) =>
        fact.id === "fact:freelance-revenue"
          ? { ...fact, occurredOn: "2026-06-30" }
          : fact,
      ),
      costFact("fact:freelance-direct-costs", 200_000, "2026-06-30"),
      costFact("fact:bookkeeping", 30_000, "2026-09-30"),
      costFact("fact:accountancy", 50_000, "2027-03-31"),
    ],
  });

const employmentScenario = (
  sideIncomeCase: SideIncomeCase,
  revenueReceivedPence = 900_000,
): SoleTraderScenarioInput =>
  SoleTraderScenarioInputSchema.parse({
    scenarioVersion: SOLE_TRADER_SCENARIO_VERSION,
    sideIncomeCase,
    evaluatedOn: "2026-10-31",
    taxYear: "2026-27",
    personId: "person:owner",
    incomeTaxJurisdiction: "england-and-northern-ireland",
    deductionMethod: "most-beneficial",
    expenseTreatments: [
      {
        factId: "fact:freelance-direct-costs",
        taxTreatment: "allowable",
        category: "direct",
      },
      {
        factId: "fact:bookkeeping",
        taxTreatment: "allowable",
        category: "bookkeeping",
      },
      {
        factId: "fact:accountancy",
        taxTreatment: "allowable",
        category: "accountancy",
      },
    ],
    reliefAtSourcePensionFactIds: ["fact:personal-pension"],
    incomeTaxDeductedAtSourcePence: 1_063_200,
    priorPaymentsOnAccountPence: 0,
    studentLoan: {
      standardPlan: "plan-2",
      postgraduateLoan: false,
      unearnedIncomeFactIds: ["fact:other-taxable-income"],
      standardLoanDeductedByPayePence: 275_535,
      postgraduateLoanDeductedByPayePence: 0,
    },
    cashFlow: {
      openingAvailableCashPence: 0,
      openingTaxReservePence: 0,
      periods: [
        {
          id: "startup-half",
          startsOn: "2026-04-06",
          endsOn: "2026-10-05",
          invoiceReceipts: [
            {
              factId: "fact:freelance-revenue",
              amountPence: Math.min(600_000, revenueReceivedPence),
            },
          ],
          expensePayments: [
            { factId: "fact:freelance-direct-costs", amountPence: 200_000 },
            { factId: "fact:bookkeeping", amountPence: 30_000 },
          ],
          personalWithdrawalsPence: 250_000,
          taxReserveTransferPence: 0,
        },
        {
          id: "growth-half",
          startsOn: "2026-10-06",
          endsOn: "2027-04-05",
          invoiceReceipts: [
            {
              factId: "fact:freelance-revenue",
              amountPence: Math.max(0, revenueReceivedPence - 600_000),
            },
          ],
          expensePayments: [
            { factId: "fact:accountancy", amountPence: 50_000 },
          ],
          personalWithdrawalsPence: 100_000,
          taxReserveTransferPence: 150_000,
        },
      ],
    },
  });

export const employmentPlusTradingSoleTraderScenario = employmentScenario(
  employmentCaseWithCosts(),
);

export const lowRevenueSoleTraderScenario: SoleTraderScenarioInput =
  SoleTraderScenarioInputSchema.parse({
    scenarioVersion: SOLE_TRADER_SCENARIO_VERSION,
    sideIncomeCase: smallSideIncomeCase,
    evaluatedOn: "2026-10-31",
    taxYear: "2026-27",
    personId: "person:owner",
    incomeTaxJurisdiction: "england-and-northern-ireland",
    deductionMethod: "most-beneficial",
    expenseTreatments: [
      {
        factId: "fact:small-costs",
        taxTreatment: "allowable",
        category: "direct",
      },
    ],
    reliefAtSourcePensionFactIds: [],
    incomeTaxDeductedAtSourcePence: 0,
    priorPaymentsOnAccountPence: 0,
    studentLoan: {
      standardPlan: null,
      postgraduateLoan: false,
      unearnedIncomeFactIds: [],
      standardLoanDeductedByPayePence: 0,
      postgraduateLoanDeductedByPayePence: 0,
    },
    cashFlow: {
      openingAvailableCashPence: 0,
      openingTaxReservePence: 0,
      periods: [
        {
          id: "first-year",
          startsOn: "2026-04-06",
          endsOn: "2027-04-05",
          invoiceReceipts: [
            { factId: "fact:small-revenue", amountPence: 40_000 },
          ],
          expensePayments: [
            { factId: "fact:small-costs", amountPence: 15_000 },
          ],
          personalWithdrawalsPence: 10_000,
          taxReserveTransferPence: 0,
        },
      ],
    },
  });

const lossCase = SideIncomeCaseSchema.parse({
  ...smallSideIncomeCase,
  id: "case:sole-trader-loss",
  financialFacts: smallSideIncomeCase.financialFacts.map((fact) =>
    fact.id === "fact:small-costs"
      ? {
          ...fact,
          amount: { ...fact.amount, minorUnits: 80_000 },
          lineage: { ...fact.lineage, sourceRevision: "2" },
        }
      : fact,
  ),
});

export const unsupportedLossSoleTraderScenario: SoleTraderScenarioInput =
  SoleTraderScenarioInputSchema.parse({
    ...lowRevenueSoleTraderScenario,
    sideIncomeCase: lossCase,
    cashFlow: {
      ...lowRevenueSoleTraderScenario.cashFlow,
      periods: lowRevenueSoleTraderScenario.cashFlow.periods.map((period) => ({
        ...period,
        expensePayments: [
          { factId: "fact:small-costs", amountPence: 80_000 },
        ],
      })),
    },
  });

const correctedEmploymentCase = SideIncomeCaseSchema.parse({
  ...employmentCaseWithCosts(),
  id: "case:employment-and-side-trading-corrected",
  financialFacts: employmentCaseWithCosts().financialFacts.map((fact) =>
    fact.id === "fact:freelance-revenue"
      ? {
          ...fact,
          amount: { ...fact.amount, minorUnits: 800_000 },
          lineage: { ...fact.lineage, sourceRevision: "2" },
        }
      : fact,
  ),
});

export const correctedSoleTraderScenario = employmentScenario(
  correctedEmploymentCase,
  700_000,
);

const higherPensionCase = SideIncomeCaseSchema.parse({
  ...employmentCaseWithCosts(),
  id: "case:employment-and-side-trading-higher-pension",
  financialFacts: employmentCaseWithCosts().financialFacts.map((fact) =>
    fact.id === "fact:personal-pension"
      ? {
          ...fact,
          amount: { ...fact.amount, minorUnits: 1_500_000 },
          lineage: { ...fact.lineage, sourceRevision: "2" },
        }
      : fact,
  ),
});

export const higherPensionSoleTraderScenario =
  SoleTraderScenarioInputSchema.parse({
    ...employmentScenario(higherPensionCase),
    incomeTaxDeductedAtSourcePence: 958_600,
  });

const vatThresholdCase = SideIncomeCaseSchema.parse({
  ...employmentCaseWithCosts(),
  id: "case:sole-trader-vat-threshold",
  financialFacts: employmentCaseWithCosts().financialFacts.map((fact) =>
    fact.id === "fact:freelance-revenue"
      ? {
          ...fact,
          amount: { ...fact.amount, minorUnits: 9_500_000 },
          lineage: { ...fact.lineage, sourceRevision: "2" },
        }
      : fact,
  ),
  vatPositions: employmentCaseWithCosts().vatPositions.map((position) => ({
    ...position,
    trailingTwelveMonthTaxableTurnover: {
      ...position.trailingTwelveMonthTaxableTurnover,
      minorUnits: 9_500_000,
    },
  })),
});

export const vatThresholdSoleTraderScenario = employmentScenario(
  vatThresholdCase,
  9_500_000,
);

export const authoritativeSoleTraderExpectations = {
  class4: {
    lowerProfitsLimitPence: 1_257_000,
    upperProfitsLimitPence: 5_027_000,
    mainRateBasisPoints: 600,
    additionalRateBasisPoints: 200,
  },
  paymentsOnAccount: {
    minimumRelevantAmountPence: 100_000,
    instalmentShareBasisPoints: 5_000,
    januaryDueOn: "2028-01-31",
    julyDueOn: "2028-07-31",
  },
  plan2: {
    thresholdPence: 2_938_500,
    rateBasisPoints: 900,
  },
} as const;
