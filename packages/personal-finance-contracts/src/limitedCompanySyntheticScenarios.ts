import {
  FULL_OWNERSHIP_BASIS_POINTS,
  SIDE_INCOME_CONTRACT_VERSION,
  SIDE_INCOME_CURRENCY,
  SIDE_INCOME_JURISDICTION,
  SideIncomeCaseSchema,
  type FinancialFact,
  type SideIncomeCase,
} from "./sideIncome";
import {
  LIMITED_COMPANY_SCENARIO_VERSION,
  LimitedCompanyScenarioInputSchema,
  type LimitedCompanyScenarioInput,
} from "./limitedCompanyScenario";

const recordedAt = "2026-11-06T00:00:00.000Z";

const money = (minorUnits: number) => ({
  minorUnits,
  currency: SIDE_INCOME_CURRENCY,
  jurisdiction: SIDE_INCOME_JURISDICTION,
});

const lineage = (sourceId: string) => ({
  kind: "user-entry" as const,
  sourceId,
  sourceRevision: "1",
  observedAt: recordedAt,
  recordedAt,
  parentRecordIds: [],
});

const companyFact = ({
  amountPence,
  id,
  kind,
  occurredOn,
  taxYear,
}: {
  amountPence: number;
  id: string;
  kind: "gross-revenue" | "business-cost";
  occurredOn: string;
  taxYear: string;
}): FinancialFact => ({
  id,
  kind,
  amount: money(amountPence),
  owner: { kind: "activity", activityId: "activity:software-sales" },
  activityId: "activity:software-sales",
  businessId: "business:software-company",
  occurredOn,
  taxYear,
  unit: "total",
  status: "forecast",
  lineage: lineage(`synthetic:${id}`),
});

const personalSalaryFact = ({
  amountPence,
  id,
  occurredOn,
  taxYear,
}: {
  amountPence: number;
  id: string;
  occurredOn: string;
  taxYear: string;
}): FinancialFact => ({
  id,
  kind: "salary",
  amount: money(amountPence),
  owner: { kind: "person", personId: "person:owner" },
  activityId: null,
  businessId: null,
  occurredOn,
  taxYear,
  unit: "total",
  status: "forecast",
  lineage: lineage(`synthetic:${id}`),
});

export const authoritativeLimitedCompanyCase: SideIncomeCase =
  SideIncomeCaseSchema.parse({
    contractVersion: SIDE_INCOME_CONTRACT_VERSION,
    id: "case:limited-company-two-year",
    householdId: "household:owner",
    recordedAt,
    people: [
      {
        id: "person:owner",
        taxResidence: {
          status: "resident",
          jurisdiction: SIDE_INCOME_JURISDICTION,
          effectiveFrom: "2025-04-06",
          effectiveTo: null,
        },
      },
    ],
    activities: [
      {
        id: "activity:software-sales",
        label: "Software sales",
        kind: "product-sales",
        startedOn: "2025-04-06",
        endedOn: null,
        expectedVolatility: {
          status: "known",
          expectedAnnualVariationBasisPoints: 1_500,
        },
      },
    ],
    businesses: [
      {
        id: "business:software-company",
        name: "Synthetic Software Ltd",
        structure: "uk-limited-company",
        jurisdiction: SIDE_INCOME_JURISDICTION,
        incorporatedOn: "2025-04-06",
      },
    ],
    activityOwnerships: [
      {
        activityId: "activity:software-sales",
        businessId: "business:software-company",
        effectiveFrom: "2025-04-06",
        effectiveTo: null,
      },
    ],
    businessOwnerships: [
      {
        businessId: "business:software-company",
        personId: "person:owner",
        ownershipBasisPoints: FULL_OWNERSHIP_BASIS_POINTS,
        effectiveFrom: "2025-04-06",
        effectiveTo: null,
      },
    ],
    customerArrangements: [
      {
        id: "customer:uk-software-buyers",
        activityId: "activity:software-sales",
        customerJurisdiction: SIDE_INCOME_JURISDICTION,
        engagementKind: "sale",
        connectedParty: false,
        currentEmployerRelated: false,
        clientCategory: "consumer",
        offPayrollAssessment: "not-applicable",
        contractStartedOn: "2025-04-06",
        contractEndedOn: null,
        expectedHoursPerWeek: null,
        expectedWorkingDaysPerYear: null,
      },
    ],
    employmentArrangements: [
      {
        id: "employment:main-job",
        personId: "person:owner",
        kind: "paye-employment",
        employerOrProviderName: "Main Employer Ltd",
        providerSuitability: "not-applicable",
        activityIds: [],
        payFactIds: ["fact:main-job-2025", "fact:main-job-2026"],
        startedOn: "2025-04-06",
        endedOn: null,
      },
    ],
    financialFacts: [
      companyFact({
        id: "fact:company-revenue-2025",
        kind: "gross-revenue",
        amountPence: 4_000_000,
        occurredOn: "2026-03-31",
        taxYear: "2025-26",
      }),
      companyFact({
        id: "fact:direct-costs-2025",
        kind: "business-cost",
        amountPence: 200_000,
        occurredOn: "2026-03-31",
        taxYear: "2025-26",
      }),
      companyFact({
        id: "fact:accountancy-2025",
        kind: "business-cost",
        amountPence: 100_000,
        occurredOn: "2026-03-31",
        taxYear: "2025-26",
      }),
      companyFact({
        id: "fact:company-revenue-2026",
        kind: "gross-revenue",
        amountPence: 10_000_000,
        occurredOn: "2027-03-31",
        taxYear: "2026-27",
      }),
      companyFact({
        id: "fact:direct-costs-2026",
        kind: "business-cost",
        amountPence: 650_000,
        occurredOn: "2027-03-31",
        taxYear: "2026-27",
      }),
      companyFact({
        id: "fact:accountancy-2026",
        kind: "business-cost",
        amountPence: 180_000,
        occurredOn: "2027-03-31",
        taxYear: "2026-27",
      }),
      companyFact({
        id: "fact:bookkeeping-2026",
        kind: "business-cost",
        amountPence: 90_000,
        occurredOn: "2027-03-31",
        taxYear: "2026-27",
      }),
      companyFact({
        id: "fact:payroll-2026",
        kind: "business-cost",
        amountPence: 80_000,
        occurredOn: "2027-03-31",
        taxYear: "2026-27",
      }),
      companyFact({
        id: "fact:confirmation-statement-2026",
        kind: "business-cost",
        amountPence: 5_000,
        occurredOn: "2027-03-31",
        taxYear: "2026-27",
      }),
      personalSalaryFact({
        id: "fact:main-job-2025",
        amountPence: 5_000_000,
        occurredOn: "2026-03-31",
        taxYear: "2025-26",
      }),
      personalSalaryFact({
        id: "fact:main-job-2026",
        amountPence: 5_000_000,
        occurredOn: "2027-03-31",
        taxYear: "2026-27",
      }),
    ],
    vatPositions: [
      {
        businessId: "business:software-company",
        assessedOn: "2026-03-31",
        trailingTwelveMonthTaxableTurnover: money(4_000_000),
        expectedNextThirtyDayTaxableTurnover: money(300_000),
        allSuppliesExemptOrOutOfScope: false,
      },
      {
        businessId: "business:software-company",
        assessedOn: "2026-11-06",
        trailingTwelveMonthTaxableTurnover: money(10_000_000),
        expectedNextThirtyDayTaxableTurnover: money(1_000_000),
        allSuppliesExemptOrOutOfScope: false,
      },
    ],
    mtdQualifyingIncome: [],
    preferences: {
      plannedWithdrawalFactIds: [],
      retainedProfitIntention: "mixed",
      liabilityProtection: "required",
      administrationTolerance: "high",
    },
  });

const firstPeriod = {
  id: "period:2025-26",
  taxYear: "2025-26",
  accountingPeriodStartsOn: "2025-04-06",
  accountingPeriodEndsOn: "2026-03-31",
  revenueFactIds: ["fact:company-revenue-2025"],
  expenseTreatments: [
    {
      factId: "fact:direct-costs-2025",
      corporationTaxTreatment: "allowable" as const,
      category: "direct" as const,
    },
    {
      factId: "fact:accountancy-2025",
      corporationTaxTreatment: "allowable" as const,
      category: "accountancy" as const,
    },
  ],
  exemptDistributionsReceivedPence: 0,
  cash: {
    tradeReceiptsExcludingVatPence: 4_000_000,
    expensePaymentsExcludingVatPence: 300_000,
    outputVatReceivedPence: 0,
    inputVatPaidPence: 0,
    corporationTaxPaidPence: 0,
    vatPaidToHmrcPence: 0,
  },
  vat: {
    registrationStatus: "not-registered" as const,
    schemeUse: "joining" as const,
    scheme: "none" as const,
    taxableTurnoverPence: 4_000_000,
    outputVatPence: 0,
    recoverableInputVatPence: 0,
    flatRatePercentageBasisPoints: null,
    limitedCostBusiness: "no" as const,
    flatRateCapitalInputVatPence: 0,
    flatRateCapitalPurchaseGrossPence: 0,
    allReturnsAndPaymentsUpToDate: "yes" as const,
    hasExcludedCashAccountingTransactions: "no" as const,
    periodEndsOn: "2026-03-31",
  },
  administrationHours: 24,
};

const secondPeriod = {
  id: "period:2026-27",
  taxYear: "2026-27",
  accountingPeriodStartsOn: "2026-04-01",
  accountingPeriodEndsOn: "2027-03-31",
  revenueFactIds: ["fact:company-revenue-2026"],
  expenseTreatments: [
    {
      factId: "fact:direct-costs-2026",
      corporationTaxTreatment: "allowable" as const,
      category: "direct" as const,
    },
    {
      factId: "fact:accountancy-2026",
      corporationTaxTreatment: "allowable" as const,
      category: "accountancy" as const,
    },
    {
      factId: "fact:bookkeeping-2026",
      corporationTaxTreatment: "allowable" as const,
      category: "bookkeeping" as const,
    },
    {
      factId: "fact:payroll-2026",
      corporationTaxTreatment: "allowable" as const,
      category: "payroll" as const,
    },
    {
      factId: "fact:confirmation-statement-2026",
      corporationTaxTreatment: "allowable" as const,
      category: "companies-house" as const,
    },
  ],
  exemptDistributionsReceivedPence: 0,
  cash: {
    tradeReceiptsExcludingVatPence: 10_000_000,
    expensePaymentsExcludingVatPence: 1_005_000,
    outputVatReceivedPence: 2_000_000,
    inputVatPaidPence: 200_000,
    corporationTaxPaidPence: 0,
    vatPaidToHmrcPence: 1_800_000,
  },
  vat: {
    registrationStatus: "registered" as const,
    schemeUse: "joining" as const,
    scheme: "standard-accrual" as const,
    taxableTurnoverPence: 10_000_000,
    outputVatPence: 2_000_000,
    recoverableInputVatPence: 200_000,
    flatRatePercentageBasisPoints: null,
    limitedCostBusiness: "no" as const,
    flatRateCapitalInputVatPence: 0,
    flatRateCapitalPurchaseGrossPence: 0,
    allReturnsAndPaymentsUpToDate: "yes" as const,
    hasExcludedCashAccountingTransactions: "no" as const,
    periodEndsOn: "2027-03-31",
  },
  administrationHours: 30,
};

const pensionAndRetainPlans = [
  {
    companyPeriodId: firstPeriod.id,
    salaryPence: 1_257_000,
    dividendPence: 500_000,
    employerPensionContributionPence: 1_000_000,
    employerPensionReliefEligibility: "eligible" as const,
    employmentAllowanceEligibility: "ineligible-single-director" as const,
    employmentAllowanceRemainingPence: 0,
    otherEmployeeEmployerNiPence: 0,
    baselinePersonalIncomeFactIds: ["fact:main-job-2025"],
    existingPensionInputPence: 0,
    pensionCarryForwardAvailablePence: 0,
    moneyPurchaseAnnualAllowanceApplies: false,
  },
  {
    companyPeriodId: secondPeriod.id,
    salaryPence: 1_257_000,
    dividendPence: 2_000_000,
    employerPensionContributionPence: 2_000_000,
    employerPensionReliefEligibility: "eligible" as const,
    employmentAllowanceEligibility: "ineligible-single-director" as const,
    employmentAllowanceRemainingPence: 0,
    otherEmployeeEmployerNiPence: 0,
    baselinePersonalIncomeFactIds: ["fact:main-job-2026"],
    existingPensionInputPence: 1_000_000,
    pensionCarryForwardAvailablePence: 0,
    moneyPurchaseAnnualAllowanceApplies: false,
  },
];

const cashFirstPlans = [
  {
    ...pensionAndRetainPlans[0],
    salaryPence: 500_000,
    dividendPence: 2_500_000,
    employerPensionContributionPence: 0,
  },
  {
    ...pensionAndRetainPlans[1],
    salaryPence: 500_000,
    dividendPence: 6_000_000,
    employerPensionContributionPence: 0,
    existingPensionInputPence: 0,
  },
];

export const multiPeriodLimitedCompanyScenario: LimitedCompanyScenarioInput =
  LimitedCompanyScenarioInputSchema.parse({
    scenarioVersion: LIMITED_COMPANY_SCENARIO_VERSION,
    sideIncomeCase: authoritativeLimitedCompanyCase,
    evaluatedOn: "2026-11-06",
    companyId: "business:software-company",
    ownerPersonId: "person:owner",
    incomeTaxJurisdiction: "england-and-northern-ireland",
    openingCompanyCashPence: 0,
    openingDistributableReservesPence: 0,
    companiesInAssociatedGroup: 1,
    companyPeriods: [firstPeriod, secondPeriod],
    strategies: [
      {
        id: "strategy:pension-and-retain",
        label: "Fund pension and retain cash",
        periodPlans: pensionAndRetainPlans,
        laterExtraction: {
          taxYear: "2026-27",
          baselinePersonalIncomeFactIds: ["fact:main-job-2026"],
        },
      },
      {
        id: "strategy:cash-first",
        label: "Take feasible dividends now",
        periodPlans: cashFirstPlans,
        laterExtraction: {
          taxYear: "2026-27",
          baselinePersonalIncomeFactIds: ["fact:main-job-2026"],
        },
      },
    ],
    goals: [
      {
        companyPeriodId: firstPeriod.id,
        minimumHouseholdCashPence: 1_000_000,
        minimumEmployerPensionPence: 500_000,
        minimumCompanyCashAfterReservesPence: 200_000,
      },
      {
        companyPeriodId: secondPeriod.id,
        minimumHouseholdCashPence: 2_000_000,
        minimumEmployerPensionPence: 1_000_000,
        minimumCompanyCashAfterReservesPence: 500_000,
      },
    ],
    administration: {
      setupHours: 8,
      hourlyValuePence: 5_000,
      incorporationFeePence: 10_000,
    },
    unsupportedComplexities: [],
  });

export const insufficientProfitLimitedCompanyScenario =
  LimitedCompanyScenarioInputSchema.parse({
    ...multiPeriodLimitedCompanyScenario,
    strategies: [
      {
        ...multiPeriodLimitedCompanyScenario.strategies[0],
        id: "strategy:excess-dividend",
        periodPlans: multiPeriodLimitedCompanyScenario.strategies[0]?.periodPlans.map(
          (plan) =>
            plan.companyPeriodId === firstPeriod.id
              ? { ...plan, dividendPence: 5_000_000 }
              : plan,
        ),
      },
    ],
  });

export function corporationTaxBoundaryScenario(
  taxableRevenuePence: number,
  companiesInAssociatedGroup = 1,
) {
  const revenueFact: FinancialFact = companyFact({
    id: "fact:boundary-revenue",
    kind: "gross-revenue",
    amountPence: taxableRevenuePence,
    occurredOn: "2027-03-31",
    taxYear: "2026-27",
  });
  const sideIncomeCase = SideIncomeCaseSchema.parse({
    ...authoritativeLimitedCompanyCase,
    id: "case:corporation-tax-boundary",
    financialFacts: [
      ...authoritativeLimitedCompanyCase.financialFacts.filter(
        ({ id }) => id === "fact:main-job-2026",
      ),
      revenueFact,
    ],
  });
  return LimitedCompanyScenarioInputSchema.parse({
    ...multiPeriodLimitedCompanyScenario,
    sideIncomeCase,
    companiesInAssociatedGroup,
    companyPeriods: [
      {
        ...secondPeriod,
        revenueFactIds: [revenueFact.id],
        expenseTreatments: [],
        cash: {
          ...secondPeriod.cash,
          tradeReceiptsExcludingVatPence: taxableRevenuePence,
        },
        vat: {
          ...secondPeriod.vat,
          taxableTurnoverPence: taxableRevenuePence,
        },
      },
    ],
    strategies: [
      {
        id: "strategy:boundary",
        label: "Corporation Tax boundary",
        periodPlans: [
          {
            ...pensionAndRetainPlans[1],
            companyPeriodId: secondPeriod.id,
            salaryPence: 0,
            dividendPence: 0,
            employerPensionContributionPence: 0,
            existingPensionInputPence: 0,
          },
        ],
        laterExtraction: {
          taxYear: "2026-27",
          baselinePersonalIncomeFactIds: ["fact:main-job-2026"],
        },
      },
    ],
    goals: [],
  });
}
