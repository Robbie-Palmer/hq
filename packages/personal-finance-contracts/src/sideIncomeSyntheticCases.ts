import {
  FULL_OWNERSHIP_BASIS_POINTS,
  SIDE_INCOME_CONTRACT_VERSION,
  SIDE_INCOME_CURRENCY,
  SIDE_INCOME_JURISDICTION,
  SideIncomeCaseSchema,
  type FinancialFact,
  type SideIncomeCase,
  type SourceLineage,
} from "./sideIncome";

const recordedAt = "2026-10-31T00:00:00.000Z";

const lineage = (sourceId: string): SourceLineage => ({
  kind: "user-entry",
  sourceId,
  sourceRevision: "1",
  observedAt: recordedAt,
  recordedAt,
  parentRecordIds: [],
});

const money = (minorUnits: number) => ({
  minorUnits,
  currency: SIDE_INCOME_CURRENCY,
  jurisdiction: SIDE_INCOME_JURISDICTION,
});

const scenarioOwner = (ownerKind: string): FinancialFact["owner"] => {
  if (ownerKind === "person") {
    return { kind: "person", personId: "person:owner" };
  }
  if (ownerKind === "household") {
    return { kind: "household", householdId: "household:synthetic" };
  }
  if (ownerKind === "tax-authority") {
    return {
      kind: "tax-authority",
      jurisdiction: SIDE_INCOME_JURISDICTION,
    };
  }
  return { kind: "business", businessId: "business:software-company" };
};

const baseCase = (id: string) => ({
  contractVersion: SIDE_INCOME_CONTRACT_VERSION,
  id,
  householdId: "household:synthetic",
  recordedAt,
  people: [
    {
      id: "person:owner",
      taxResidence: {
        status: "resident" as const,
        jurisdiction: SIDE_INCOME_JURISDICTION,
        effectiveFrom: "2026-04-06",
        effectiveTo: null,
      },
    },
  ],
  activities: [],
  businesses: [],
  activityOwnerships: [],
  businessOwnerships: [],
  customerArrangements: [],
  employmentArrangements: [],
  financialFacts: [],
  vatPositions: [],
  mtdQualifyingIncome: [
    {
      personId: "person:owner",
      taxReturnYear: "2024-25",
      grossSelfEmploymentAndPropertyIncome: money(0),
      sourceComplete: true,
    },
  ],
  preferences: {
    plannedWithdrawalFactIds: [],
    retainedProfitIntention: "undecided" as const,
    liabilityProtection: "undecided" as const,
    administrationTolerance: "undecided" as const,
  },
});

export const smallSideIncomeCase: SideIncomeCase = SideIncomeCaseSchema.parse({
  ...baseCase("case:small-side-income"),
  activities: [
    {
      id: "activity:craft-sales",
      label: "Occasional craft sales",
      kind: "product-sales",
      startedOn: "2026-06-01",
      endedOn: null,
      expectedVolatility: {
        status: "known",
        expectedAnnualVariationBasisPoints: 5_000,
      },
    },
  ],
  businesses: [
    {
      id: "business:small-trade",
      name: "Small trade",
      structure: "sole-trader",
      jurisdiction: SIDE_INCOME_JURISDICTION,
      incorporatedOn: null,
    },
  ],
  activityOwnerships: [
    {
      activityId: "activity:craft-sales",
      businessId: "business:small-trade",
      effectiveFrom: "2026-06-01",
      effectiveTo: null,
    },
  ],
  businessOwnerships: [
    {
      businessId: "business:small-trade",
      personId: "person:owner",
      ownershipBasisPoints: FULL_OWNERSHIP_BASIS_POINTS,
      effectiveFrom: "2026-06-01",
      effectiveTo: null,
    },
  ],
  customerArrangements: [
    {
      id: "customer:craft-marketplace",
      activityId: "activity:craft-sales",
      customerJurisdiction: SIDE_INCOME_JURISDICTION,
      engagementKind: "sale",
      connectedParty: false,
      currentEmployerRelated: false,
      clientCategory: "consumer",
      offPayrollAssessment: "not-applicable",
      contractStartedOn: "2026-06-01",
      contractEndedOn: null,
      expectedHoursPerWeek: 2,
      expectedWorkingDaysPerYear: 20,
    },
  ],
  financialFacts: [
    {
      id: "fact:small-revenue",
      kind: "gross-revenue",
      amount: money(50_000),
      owner: { kind: "activity", activityId: "activity:craft-sales" },
      activityId: "activity:craft-sales",
      businessId: "business:small-trade",
      occurredOn: "2026-10-01",
      taxYear: "2026-27",
      unit: "total",
      status: "actual",
      lineage: lineage("synthetic:small-revenue"),
    },
    {
      id: "fact:small-costs",
      kind: "business-cost",
      amount: money(15_000),
      owner: { kind: "activity", activityId: "activity:craft-sales" },
      activityId: "activity:craft-sales",
      businessId: "business:small-trade",
      occurredOn: "2026-10-01",
      taxYear: "2026-27",
      unit: "total",
      status: "actual",
      lineage: lineage("synthetic:small-costs"),
    },
  ],
  vatPositions: [
    {
      businessId: "business:small-trade",
      assessedOn: "2026-10-31",
      trailingTwelveMonthTaxableTurnover: money(50_000),
      expectedNextThirtyDayTaxableTurnover: money(5_000),
      allSuppliesExemptOrOutOfScope: false,
    },
  ],
});

export const employmentPlusSideTradingCase: SideIncomeCase =
  SideIncomeCaseSchema.parse({
    ...baseCase("case:employment-and-side-trading"),
    activities: [
      {
        id: "activity:freelance-design",
        label: "Freelance design",
        kind: "freelance-services",
        startedOn: "2026-04-06",
        endedOn: null,
        expectedVolatility: {
          status: "known",
          expectedAnnualVariationBasisPoints: 2_500,
        },
      },
    ],
    businesses: [
      {
        id: "business:design-trade",
        name: "Design trade",
        structure: "sole-trader",
        jurisdiction: SIDE_INCOME_JURISDICTION,
        incorporatedOn: null,
      },
    ],
    activityOwnerships: [
      {
        activityId: "activity:freelance-design",
        businessId: "business:design-trade",
        effectiveFrom: "2026-04-06",
        effectiveTo: null,
      },
    ],
    businessOwnerships: [
      {
        businessId: "business:design-trade",
        personId: "person:owner",
        ownershipBasisPoints: FULL_OWNERSHIP_BASIS_POINTS,
        effectiveFrom: "2026-04-06",
        effectiveTo: null,
      },
    ],
    customerArrangements: [
      {
        id: "customer:design-client",
        activityId: "activity:freelance-design",
        customerJurisdiction: SIDE_INCOME_JURISDICTION,
        engagementKind: "statement-of-work",
        connectedParty: false,
        currentEmployerRelated: false,
        clientCategory: "private-small",
        offPayrollAssessment: "not-applicable",
        contractStartedOn: "2026-04-06",
        contractEndedOn: null,
        expectedHoursPerWeek: 8,
        expectedWorkingDaysPerYear: 90,
      },
    ],
    employmentArrangements: [
      {
        id: "employment:main-job",
        personId: "person:owner",
        kind: "paye-employment",
        employerOrProviderName: "Main employer",
        providerSuitability: "not-applicable",
        activityIds: [],
        payFactIds: ["fact:main-job-salary"],
        startedOn: "2024-01-01",
        endedOn: null,
      },
    ],
    financialFacts: [
      {
        id: "fact:main-job-salary",
        kind: "salary",
        amount: money(6_000_000),
        owner: { kind: "person", personId: "person:owner" },
        activityId: null,
        businessId: null,
        occurredOn: "2026-04-06",
        taxYear: "2026-27",
        unit: "total",
        status: "actual",
        lineage: lineage("synthetic:main-job-salary"),
      },
      {
        id: "fact:freelance-revenue",
        kind: "gross-revenue",
        amount: money(1_000_000),
        owner: { kind: "activity", activityId: "activity:freelance-design" },
        activityId: "activity:freelance-design",
        businessId: "business:design-trade",
        occurredOn: "2026-10-31",
        taxYear: "2026-27",
        unit: "total",
        status: "forecast",
        lineage: lineage("synthetic:freelance-revenue"),
      },
      {
        id: "fact:freelance-rate",
        kind: "assignment-rate",
        amount: money(45_000),
        owner: { kind: "activity", activityId: "activity:freelance-design" },
        activityId: "activity:freelance-design",
        businessId: "business:design-trade",
        occurredOn: "2026-04-06",
        taxYear: "2026-27",
        unit: "day",
        status: "actual",
        lineage: lineage("synthetic:freelance-rate"),
      },
      {
        id: "fact:personal-pension",
        kind: "pension-contribution",
        amount: money(500_000),
        owner: { kind: "person", personId: "person:owner" },
        activityId: null,
        businessId: null,
        occurredOn: "2026-10-31",
        taxYear: "2026-27",
        unit: "total",
        status: "forecast",
        lineage: lineage("synthetic:personal-pension"),
      },
      {
        id: "fact:other-taxable-income",
        kind: "other-taxable-income",
        amount: money(50_000),
        owner: { kind: "person", personId: "person:owner" },
        activityId: null,
        businessId: null,
        occurredOn: "2026-10-31",
        taxYear: "2026-27",
        unit: "total",
        status: "forecast",
        lineage: lineage("synthetic:other-taxable-income"),
      },
    ],
    vatPositions: [
      {
        businessId: "business:design-trade",
        assessedOn: "2026-10-31",
        trailingTwelveMonthTaxableTurnover: money(1_000_000),
        expectedNextThirtyDayTaxableTurnover: money(100_000),
        allSuppliesExemptOrOutOfScope: false,
      },
    ],
    preferences: {
      plannedWithdrawalFactIds: [],
      retainedProfitIntention: "withdraw",
      liabilityProtection: "preferred",
      administrationTolerance: "low",
    },
  });

export const multipleIncomeStreamsCase: SideIncomeCase =
  SideIncomeCaseSchema.parse({
    ...baseCase("case:multiple-income-streams"),
    activities: [
      {
        id: "activity:software-sales",
        label: "Software sales",
        kind: "product-sales",
        startedOn: "2025-01-01",
        endedOn: null,
        expectedVolatility: {
          status: "known",
          expectedAnnualVariationBasisPoints: 1_500,
        },
      },
      {
        id: "activity:subscriptions",
        label: "Software subscriptions",
        kind: "subscription-sales",
        startedOn: "2025-01-01",
        endedOn: null,
        expectedVolatility: {
          status: "known",
          expectedAnnualVariationBasisPoints: 800,
        },
      },
      {
        id: "activity:consulting",
        label: "Technical consulting",
        kind: "contracting-services",
        startedOn: "2026-04-06",
        endedOn: null,
        expectedVolatility: { status: "unknown" },
      },
    ],
    businesses: [
      {
        id: "business:software-company",
        name: "Software Company Ltd",
        structure: "uk-limited-company",
        jurisdiction: SIDE_INCOME_JURISDICTION,
        incorporatedOn: "2025-01-01",
      },
    ],
    activityOwnerships: [
      ...["activity:software-sales", "activity:subscriptions", "activity:consulting"].map(
        (activityId) => ({
          activityId,
          businessId: "business:software-company",
          effectiveFrom: "2026-04-06",
          effectiveTo: null,
        }),
      ),
    ],
    businessOwnerships: [
      {
        businessId: "business:software-company",
        personId: "person:owner",
        ownershipBasisPoints: FULL_OWNERSHIP_BASIS_POINTS,
        effectiveFrom: "2025-01-01",
        effectiveTo: null,
      },
    ],
    customerArrangements: [
      {
        id: "customer:product-buyers",
        activityId: "activity:software-sales",
        customerJurisdiction: SIDE_INCOME_JURISDICTION,
        engagementKind: "sale",
        connectedParty: false,
        currentEmployerRelated: false,
        clientCategory: "consumer",
        offPayrollAssessment: "not-applicable",
        contractStartedOn: "2025-01-01",
        contractEndedOn: null,
        expectedHoursPerWeek: null,
        expectedWorkingDaysPerYear: null,
      },
      {
        id: "customer:subscribers",
        activityId: "activity:subscriptions",
        customerJurisdiction: SIDE_INCOME_JURISDICTION,
        engagementKind: "subscription",
        connectedParty: false,
        currentEmployerRelated: false,
        clientCategory: "consumer",
        offPayrollAssessment: "not-applicable",
        contractStartedOn: "2025-01-01",
        contractEndedOn: null,
        expectedHoursPerWeek: null,
        expectedWorkingDaysPerYear: null,
      },
      {
        id: "customer:consulting-client",
        activityId: "activity:consulting",
        customerJurisdiction: SIDE_INCOME_JURISDICTION,
        engagementKind: "time-based-assignment",
        connectedParty: false,
        currentEmployerRelated: false,
        clientCategory: "private-medium-or-large",
        offPayrollAssessment: "outside",
        contractStartedOn: "2026-04-06",
        contractEndedOn: null,
        expectedHoursPerWeek: 24,
        expectedWorkingDaysPerYear: 150,
      },
    ],
    employmentArrangements: [
      {
        id: "employment:umbrella-option",
        personId: "person:owner",
        kind: "umbrella-employment",
        employerOrProviderName: "Reviewed Umbrella Ltd",
        providerSuitability: "confirmed",
        activityIds: ["activity:consulting"],
        payFactIds: [],
        startedOn: "2026-04-06",
        endedOn: null,
      },
    ],
    financialFacts: [
      ...[
        ["fact:product-revenue", "activity:software-sales", 4_000_000],
        ["fact:subscription-revenue", "activity:subscriptions", 3_000_000],
        ["fact:consulting-revenue", "activity:consulting", 3_000_000],
      ].map(([id, activityId, minorUnits]) => ({
        id,
        kind: "gross-revenue" as const,
        amount: money(Number(minorUnits)),
        owner: { kind: "activity" as const, activityId: String(activityId) },
        activityId: String(activityId),
        businessId: "business:software-company",
        occurredOn: "2026-10-31",
        taxYear: "2026-27",
        unit: "total" as const,
        status: "forecast" as const,
        lineage: lineage(`synthetic:${String(id)}`),
      })),
      {
        id: "fact:consulting-rate",
        kind: "assignment-rate",
        amount: money(80_000),
        owner: { kind: "activity", activityId: "activity:consulting" },
        activityId: "activity:consulting",
        businessId: "business:software-company",
        occurredOn: "2026-04-06",
        taxYear: "2026-27",
        unit: "day",
        status: "actual",
        lineage: lineage("synthetic:consulting-rate"),
      },
      ...[
        ["fact:taxable-profit", "taxable-profit", 6_000_000, "business"],
        ["fact:director-salary", "salary", 1_200_000, "person"],
        ["fact:dividend", "dividend", 1_000_000, "person"],
        ["fact:company-pension", "pension-contribution", 600_000, "person"],
        ["fact:company-cash", "company-cash", 5_000_000, "business"],
        ["fact:household-cash", "household-cash", 2_000_000, "household"],
        ["fact:vat-reserve", "vat", 1_500_000, "tax-authority"],
        ["fact:tax-reserve", "tax-reserve", 1_200_000, "business"],
      ].map(([id, kind, minorUnits, ownerKind]) => ({
        id,
        kind,
        amount: money(Number(minorUnits)),
        owner: scenarioOwner(String(ownerKind)),
        activityId: null,
        businessId: "business:software-company",
        occurredOn: "2026-10-31",
        taxYear: "2026-27",
        unit: "total",
        status: "scenario",
        lineage: lineage(`synthetic:${String(id)}`),
      })),
    ],
    vatPositions: [
      {
        businessId: "business:software-company",
        assessedOn: "2026-10-31",
        trailingTwelveMonthTaxableTurnover: money(10_000_000),
        expectedNextThirtyDayTaxableTurnover: money(700_000),
        allSuppliesExemptOrOutOfScope: false,
      },
    ],
    preferences: {
      plannedWithdrawalFactIds: ["fact:director-salary", "fact:dividend"],
      retainedProfitIntention: "mixed",
      liabilityProtection: "required",
      administrationTolerance: "high",
    },
  });

export const incompleteFactsCase: SideIncomeCase = SideIncomeCaseSchema.parse({
  ...baseCase("case:incomplete-facts"),
  people: [
    {
      id: "person:owner",
      taxResidence: {
        status: "unknown",
        jurisdiction: null,
        effectiveFrom: "2026-04-06",
        effectiveTo: null,
      },
    },
  ],
  activities: [
    {
      id: "activity:unknown-contracting",
      label: "Possible contract work",
      kind: "contracting-services",
      startedOn: "2026-10-01",
      endedOn: null,
      expectedVolatility: { status: "unknown" },
    },
  ],
  businesses: [
    {
      id: "business:unknown",
      name: "Unconfirmed business",
      structure: "unknown",
      jurisdiction: SIDE_INCOME_JURISDICTION,
      incorporatedOn: null,
    },
  ],
  customerArrangements: [
    {
      id: "customer:unknown",
      activityId: "activity:unknown-contracting",
      customerJurisdiction: SIDE_INCOME_JURISDICTION,
      engagementKind: "time-based-assignment",
      connectedParty: "unknown",
      currentEmployerRelated: "unknown",
      clientCategory: "unknown",
      offPayrollAssessment: "not-assessed",
      contractStartedOn: "2026-10-01",
      contractEndedOn: null,
      expectedHoursPerWeek: null,
      expectedWorkingDaysPerYear: null,
    },
  ],
  mtdQualifyingIncome: [
    {
      personId: "person:owner",
      taxReturnYear: "2024-25",
      grossSelfEmploymentAndPropertyIncome: null,
      sourceComplete: false,
    },
  ],
});

export const syntheticSideIncomeCases = [
  smallSideIncomeCase,
  employmentPlusSideTradingCase,
  multipleIncomeStreamsCase,
  incompleteFactsCase,
] as const;
