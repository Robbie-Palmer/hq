import { evaluateLimitedCompanyScenario } from "./limitedCompanyScenario";
import {
  corporationTaxBoundaryScenario,
  multiPeriodLimitedCompanyScenario,
} from "./limitedCompanySyntheticScenarios";
import { evaluateSoleTraderScenario } from "./soleTraderScenario";
import {
  employmentPlusTradingSoleTraderScenario,
  lowRevenueSoleTraderScenario,
} from "./soleTraderSyntheticScenarios";
import {
  SIDE_INCOME_RECOMMENDATION_VERSION,
  SideIncomeRecommendationInputSchema,
  type RecommendationCandidate,
  type RecommendationMetrics,
  type RecommendationPriorities,
  type RecommendationRoute,
  type RecommendationSensitivityCase,
  type SideIncomeRecommendationInput,
} from "./sideIncomeRecommendation";
import { evaluateUmbrellaScenario } from "./umbrellaScenario";
import {
  authoritativeUmbrellaScenario,
  fixableOmissionsUmbrellaScenario,
} from "./umbrellaSyntheticScenarios";

const evaluatedAt = "2026-11-06T12:00:00.000Z";
const comparisonPeriod = {
  startsOn: "2026-04-06",
  endsOn: "2027-04-05",
  taxYear: "2026-27",
  availableWorkDays: 260,
} as const;

const defaultPriorities: RecommendationPriorities = {
  householdCash: 5,
  pension: 3,
  retainedCompanyFunds: 2,
  lowerTax: 3,
  lowerCosts: 3,
  lowerAdministration: 2,
  employmentRights: 2,
  liabilityProtection: 2,
  certainty: 3,
  runway: 2,
};

const metrics = (
  overrides: Partial<RecommendationMetrics>,
): RecommendationMetrics => ({
  incrementalHouseholdCashPence: 0,
  pensionContributionPence: 0,
  retainedCompanyFundsPence: 0,
  totalTaxPence: 0,
  vatCollectedPence: 0,
  vatPaidPence: 0,
  setupCostsPence: 0,
  ongoingCostsPence: 0,
  administrationHours: 0,
  taxReserveRequiredPence: 0,
  runwayMonths: 0,
  employmentRightsScoreBasisPoints: 0,
  liabilityProtectionScoreBasisPoints: 0,
  confidenceScoreBasisPoints: 8_000,
  ...overrides,
});

type CandidateOptions = {
  id: string;
  route: RecommendationRoute;
  label: string;
  statusContext?: "not-applicable" | "inside" | "outside" | "unknown" | "under-review";
  eligibility?: "eligible" | "ineligible" | "needs-review" | "unsupported";
  legalBasis: string;
  financialState?: "supported" | "partial" | "unavailable";
  financialStateReason?: string;
  metrics: RecommendationMetrics;
  missingInput?: { id: string; label: string; question: string };
  assumptions?: Array<{
    id: string;
    label: string;
    value: string;
    status: "confirmed" | "estimated" | "unknown";
  }>;
  limitations?: string[];
};

const candidate = (options: CandidateOptions): RecommendationCandidate => {
  const evidenceId = `evidence:${options.id}:legal`;
  const businessEvidenceId = `evidence:${options.id}:business-costs`;
  return {
    id: options.id,
    route: options.route,
    label: options.label,
    statusContext: options.statusContext ?? "not-applicable",
    comparisonPeriod,
    eligibility: {
      state: options.eligibility ?? "eligible",
      legalOrStatusBasis: options.legalBasis,
      evidenceIds: [evidenceId],
    },
    financialState: options.financialState ?? "supported",
    financialStateReason:
      options.financialStateReason ?? "A released calculator result is available.",
    metrics: options.metrics,
    householdFactIds: ["fact:main-job-salary", "fact:household-cash-need"],
    businessInputs:
      options.missingInput === undefined
        ? [
            {
              id: `input:${options.id}:costs`,
              label: "business costs",
              state: "available",
              sourceEvidenceId: businessEvidenceId,
              question: null,
            },
          ]
        : [
            {
              id: options.missingInput.id,
              label: options.missingInput.label,
              state: "missing",
              sourceEvidenceId: null,
              question: options.missingInput.question,
            },
          ],
    evidence: [
      {
        id: "evidence:household:main-job-salary",
        kind: "household-fact",
        label: "Main-job PAYE salary",
        value: "Existing household fact",
        sourceId: "fact:main-job-salary",
        sourceRevision: "1",
        validOn: "2026-11-06",
        certainty: "actual",
      },
      {
        id: "evidence:household:cash-need",
        kind: "household-fact",
        label: "Household cash need",
        value: "Existing household plan",
        sourceId: "fact:household-cash-need",
        sourceRevision: "1",
        validOn: "2026-11-06",
        certainty: "forecast",
      },
      {
        id: businessEvidenceId,
        kind: "business-fact",
        label: `${options.label} business costs`,
        value: `${options.metrics.ongoingCostsPence ?? "unknown"}p ongoing costs`,
        sourceId: `business-costs:${options.id}`,
        sourceRevision: "1",
        validOn: "2026-11-06",
        certainty: "scenario",
      },
      {
        id: evidenceId,
        kind: "legal-status",
        label: `${options.label} eligibility`,
        value: options.legalBasis,
        sourceId: `synthetic:${options.id}`,
        sourceRevision: "1",
        validOn: "2026-11-06",
        certainty:
          options.statusContext === "unknown" ||
          options.statusContext === "under-review"
            ? "unknown"
            : "actual",
      },
      {
        id: `evidence:${options.id}:calculation`,
        kind: "calculation",
        label: `${options.label} financial projection`,
        value: `${options.metrics.incrementalHouseholdCashPence ?? "unknown"}p household cash`,
        sourceId: `calculator:${options.id}`,
        sourceRevision: "1",
        validOn: "2026-11-06",
        certainty: "scenario",
      },
    ],
    assumptions: (options.assumptions ?? [
      {
        id: `assumption:${options.id}:work`,
        label: "available work",
        value: "260 days",
        status: "estimated" as const,
      },
    ]).map((assumption) => ({
      ...assumption,
      sourceId: `synthetic:${options.id}`,
      sourceRevision: "1",
      editable: true as const,
    })),
    accountantQuestions: [
      `Confirm the tax treatment and status basis for ${options.label}.`,
    ],
    limitations: options.limitations ?? [],
  };
};

const soleTraderResult = evaluateSoleTraderScenario(
  employmentPlusTradingSoleTraderScenario,
);
const lowRevenueResult = evaluateSoleTraderScenario(
  lowRevenueSoleTraderScenario,
);
const limitedBoundaryResult = evaluateLimitedCompanyScenario(
  corporationTaxBoundaryScenario(10_000_000),
);
const growingCompanyScenario = structuredClone(
  multiPeriodLimitedCompanyScenario,
);
growingCompanyScenario.companyPeriods = growingCompanyScenario.companyPeriods.filter(
  ({ taxYear }) => taxYear === "2026-27",
);
growingCompanyScenario.strategies = growingCompanyScenario.strategies.map(
  (strategy) => ({
    ...strategy,
    periodPlans: strategy.periodPlans.filter(
      ({ companyPeriodId }) => companyPeriodId === "period:2026-27",
    ),
  }),
);
growingCompanyScenario.goals = growingCompanyScenario.goals.filter(
  ({ companyPeriodId }) => companyPeriodId === "period:2026-27",
);
const growingCompanyResult = evaluateLimitedCompanyScenario(
  growingCompanyScenario,
);
const umbrellaResult = evaluateUmbrellaScenario(authoritativeUmbrellaScenario);
const unknownStatusUmbrellaResult = evaluateUmbrellaScenario(
  fixableOmissionsUmbrellaScenario,
);

const smallSoleTraderCandidate = candidate({
  id: "candidate:small-product:sole-trader",
  route: "sole-trader",
  label: "Sole trader",
  legalBasis: "UK product sales can be carried on by the individual.",
  metrics: metrics({
    incrementalHouseholdCashPence:
      lowRevenueResult.household.netBenefitPence,
    totalTaxPence: lowRevenueResult.tax?.incremental.totalPence ?? null,
    ongoingCostsPence: lowRevenueResult.profit.totalBusinessCostsPence,
    administrationHours: 8,
    taxReserveRequiredPence:
      lowRevenueResult.reserve.annualLiabilityReservePence,
    runwayMonths: 4,
    confidenceScoreBasisPoints: 9_000,
  }),
  limitations: ["The individual remains personally liable for the trade."],
});

const smallCompanyCandidate = candidate({
  id: "candidate:small-product:company",
  route: "uk-limited-company",
  label: "UK limited company",
  legalBasis: "A UK company can carry on the product activity.",
  metrics: metrics({
    incrementalHouseholdCashPence: 5_000,
    retainedCompanyFundsPence: 8_000,
    totalTaxPence: 8_000,
    setupCostsPence: 10_000,
    ongoingCostsPence: 120_000,
    administrationHours: 35,
    taxReserveRequiredPence: 8_000,
    runwayMonths: 1,
    liabilityProtectionScoreBasisPoints: 9_000,
    confidenceScoreBasisPoints: 6_000,
  }),
  limitations: ["Company administration costs exceed much of the small projected profit."],
});

const irrelevantUmbrellaCandidate = candidate({
  id: "candidate:small-product:umbrella",
  route: "umbrella-employment",
  label: "Umbrella employment",
  eligibility: "ineligible",
  legalBasis: "Umbrella employment does not cover product sales.",
  financialState: "unavailable",
  financialStateReason: "There is no service assignment for an umbrella employer.",
  metrics: metrics({
    incrementalHouseholdCashPence: 9_999_999,
    employmentRightsScoreBasisPoints: 10_000,
  }),
});

const irrelevantDirectCandidate = candidate({
  id: "candidate:small-product:direct",
  route: "direct-employment",
  label: "Direct employment",
  eligibility: "ineligible",
  legalBasis: "No employer has offered employment for the product-sales activity.",
  financialState: "unavailable",
  financialStateReason: "No direct-employment offer exists.",
  metrics: metrics({ incrementalHouseholdCashPence: 9_999_999 }),
});

const recommendationInput = (
  overrides: Partial<SideIncomeRecommendationInput> &
    Pick<SideIncomeRecommendationInput, "id" | "sideIncomeCaseId" | "candidates">,
) =>
  SideIncomeRecommendationInputSchema.parse({
    recommendationVersion: SIDE_INCOME_RECOMMENDATION_VERSION,
    sideIncomeCaseRevision: 1,
    evaluatedAt,
    comparisonPeriod,
    householdCashNeedPence: 1_200_000,
    pensionGoalPence: 600_000,
    priorities: defaultPriorities,
    minimumClearWinnerGapBasisPoints: 500,
    sensitivities: [],
    ...overrides,
  });

export const smallProductAlongsidePayeRecommendationScenario =
  recommendationInput({
    id: "recommendation:small-product-paye",
    sideIncomeCaseId: "case:small-product-paye",
    candidates: [
      smallSoleTraderCandidate,
      smallCompanyCandidate,
      irrelevantUmbrellaCandidate,
      irrelevantDirectCandidate,
    ],
  });

const growingSoleTraderCandidate = candidate({
  id: "candidate:growing:sole-trader",
  route: "sole-trader",
  label: "Sole trader",
  legalBasis: "The UK single-owner activity is eligible for sole trading.",
  metrics: metrics({
    incrementalHouseholdCashPence:
      soleTraderResult.household.netBenefitPence,
    pensionContributionPence: 500_000,
    totalTaxPence: soleTraderResult.tax?.incremental.totalPence ?? null,
    ongoingCostsPence: soleTraderResult.profit.totalBusinessCostsPence,
    administrationHours: 18,
    taxReserveRequiredPence:
      soleTraderResult.reserve.firstDeadlineCashNeedPence,
    runwayMonths: 3,
    confidenceScoreBasisPoints: 8_000,
  }),
});

const growingStrategy = growingCompanyResult.strategies.find(
  ({ id }) => id === "strategy:pension-and-retain",
);
if (growingStrategy === undefined) {
  throw new Error("The growing-company synthetic strategy is missing");
}

const growingCompanyCandidate = candidate({
  id: "candidate:growing:company",
  route: "uk-limited-company",
  label: "UK limited company with retained profit",
  legalBasis: "The single-owner UK company and activities are supported.",
  metrics: metrics({
    incrementalHouseholdCashPence:
      growingStrategy.totals.householdSpendableCashPence,
    pensionContributionPence:
      growingStrategy.totals.employerPensionContributionPence,
    retainedCompanyFundsPence: growingStrategy.totals.endingCompanyCashPence,
    totalTaxPence:
      growingStrategy.totals.personalTaxPence +
      growingStrategy.totals.corporationTaxPence +
      growingStrategy.totals.employerNationalInsurancePence,
    vatCollectedPence: growingStrategy.periods.reduce(
      (total, period) => total + period.vat.outputVatPence,
      0,
    ),
    vatPaidPence: growingStrategy.periods.reduce(
      (total, period) => total + period.vat.liabilityPence,
      0,
    ),
    setupCostsPence: growingCompanyResult.setup.incorporationFeePence,
    ongoingCostsPence: growingStrategy.totals.operatingCostsPence,
    administrationHours:
      growingCompanyResult.setup.setupHours +
      growingStrategy.periods.reduce(
        (total, period) => total + period.administration.hours,
        0,
      ),
    taxReserveRequiredPence: growingStrategy.periods.at(-1)?.companyCash
      .unpaidCorporationTaxPence ?? 0,
    runwayMonths: 12,
    liabilityProtectionScoreBasisPoints: 9_000,
    confidenceScoreBasisPoints: 8_000,
  }),
  assumptions: [
    {
      id: "assumption:growing:extraction",
      label: "future extraction",
      value: growingStrategy.deferredExtraction.assumption,
      status: "estimated",
    },
  ],
});

const sensitivityCases = (
  leftId: string,
  rightId: string,
): RecommendationSensitivityCase[] => {
  const variables = [
    ["revenue", "pence", [5_000_000, 10_000_000, 15_000_000]],
    ["expenses", "pence", [300_000, 1_000_000, 2_000_000]],
    ["pension", "pence", [0, 1_000_000, 3_000_000]],
    ["extraction", "pence", [1_000_000, 4_000_000, 8_000_000]],
    ["work-availability", "days", [120, 200, 260]],
  ] as const;
  const caseNames = ["low", "base", "high"] as const;
  const rightLeadsByVariable = {
    revenue: [false, true, true],
    expenses: [true, false, false],
    pension: [false, false, true],
    extraction: [true, false, false],
    "work-availability": [false, false, true],
  } as const;
  return variables.flatMap(([variable, unit, values]) =>
    values.map((value, caseIndex) => {
      const rightLeads = rightLeadsByVariable[variable][caseIndex] ?? false;
      return {
        id: `sensitivity:${variable}:${caseNames[caseIndex]}`,
        variable,
        case: caseNames[caseIndex] ?? "base",
        value,
        unit,
        rulesEffectiveOn: "2026-11-06",
        ruleVersions: ["2026-27"],
        futureRuleState:
          caseIndex === 2
            ? ("changed-rule-assumption" as const)
            : ("current-reviewed-rules" as const),
        assumptionIds: ["assumption:growing:extraction"],
        outcomes: [
          {
            candidateId: leftId,
            state: "supported" as const,
            comparableHouseholdValuePence: rightLeads ? 4_000_000 : 6_000_000,
          },
          {
            candidateId: rightId,
            state: "supported" as const,
            comparableHouseholdValuePence: rightLeads ? 7_000_000 : 5_000_000,
          },
        ],
      };
    }),
  );
};

export const growingRetainedProfitRecommendationScenario = recommendationInput({
  id: "recommendation:growing-retained-profit",
  sideIncomeCaseId: growingCompanyResult.companyId,
  householdCashNeedPence: 2_000_000,
  pensionGoalPence: 2_000_000,
  priorities: {
    ...defaultPriorities,
    pension: 5,
    retainedCompanyFunds: 5,
    liabilityProtection: 4,
  },
  candidates: [growingSoleTraderCandidate, growingCompanyCandidate],
  sensitivities: sensitivityCases(
    growingSoleTraderCandidate.id,
    growingCompanyCandidate.id,
  ),
});

const umbrellaCandidate = candidate({
  id: "candidate:contract:umbrella",
  route: "umbrella-employment",
  label: "Umbrella employment",
  legalBasis: "A reviewed umbrella employer and employment arrangement are confirmed.",
  metrics: metrics({
    incrementalHouseholdCashPence: umbrellaResult.payslip.netCashPence,
    pensionContributionPence: umbrellaResult.pension.available
      ? umbrellaResult.pension.employeeGrossContributionPence +
        umbrellaResult.pension.employerContributionPence
      : null,
    totalTaxPence:
      (umbrellaResult.payslip.incomeTaxPence ?? 0) +
      (umbrellaResult.payslip.employeeNationalInsurancePence ?? 0) +
      (umbrellaResult.payslip.studentLoanPence ?? 0) +
      (umbrellaResult.payslip.postgraduateLoanPence ?? 0) +
      umbrellaResult.reconciliation.employerCosts.employerNationalInsurancePence +
      umbrellaResult.reconciliation.employerCosts.apprenticeshipLevyPence,
    ongoingCostsPence: umbrellaResult.reconciliation.umbrellaMarginPence,
    administrationHours: 5,
    runwayMonths: 2,
    employmentRightsScoreBasisPoints: 7_000,
    liabilityProtectionScoreBasisPoints: 8_000,
    confidenceScoreBasisPoints: 9_000,
  }),
});

const directComparison = umbrellaResult.comparisons.directEmployment;
if (directComparison === null) {
  throw new Error("The direct-employment synthetic comparison is missing");
}
const directCandidate = candidate({
  id: "candidate:contract:direct",
  route: "direct-employment",
  label: "Direct employment",
  legalBasis: "A direct-employment offer is supplied for the same work period.",
  metrics: metrics({
    incrementalHouseholdCashPence: directComparison.netCashPence,
    pensionContributionPence: directComparison.pensionPence,
    totalTaxPence: directComparison.payroll?.available
      ? directComparison.payroll.components.incomeTaxPence +
        directComparison.payroll.components.employeeNationalInsurancePence +
        directComparison.studentLoans.totalPence
      : null,
    administrationHours: 2,
    runwayMonths: 3,
    employmentRightsScoreBasisPoints: 10_000,
    liabilityProtectionScoreBasisPoints: 9_000,
    confidenceScoreBasisPoints: 9_000,
  }),
});

const companyComparison = umbrellaResult.comparisons.company;
if (companyComparison === null) {
  throw new Error("The outside-company synthetic comparison is missing");
}
const outsideCompanyCandidate = candidate({
  id: "candidate:contract:company-outside",
  route: "uk-limited-company",
  label: "Limited company, supplied outside status",
  statusContext: "outside",
  legalBasis: "Dated supplied evidence records the engagement as outside off-payroll rules.",
  metrics: metrics({
    incrementalHouseholdCashPence: companyComparison.netCashPence,
    pensionContributionPence: companyComparison.pensionPence,
    retainedCompanyFundsPence: companyComparison.retainedCompanyCashPence,
    totalTaxPence: limitedBoundaryResult.strategies[0]?.totals.corporationTaxPence ?? null,
    administrationHours: 42,
    runwayMonths: 10,
    liabilityProtectionScoreBasisPoints: 9_000,
    confidenceScoreBasisPoints: 7_000,
  }),
  limitations: ["The status evidence must continue to match actual working practices."],
});

export const eligibleUmbrellaContractRecommendationScenario =
  recommendationInput({
    id: "recommendation:eligible-umbrella-contract",
    sideIncomeCaseId: "case:contract-comparison",
    candidates: [umbrellaCandidate, directCandidate, outsideCompanyCandidate],
  });

export const irrelevantUmbrellaRecommendationScenario = recommendationInput({
  id: "recommendation:irrelevant-umbrella",
  sideIncomeCaseId: "case:product-sales-only",
  candidates: [smallSoleTraderCandidate, irrelevantUmbrellaCandidate],
});

const unknownCompanyCandidate = candidate({
  id: "candidate:contract:company-unknown",
  route: "uk-limited-company",
  label: "Limited company with unresolved status",
  statusContext: "under-review",
  eligibility: "needs-review",
  legalBasis: "No final inside or outside status decision has been supplied.",
  financialState: "partial",
  financialStateReason:
    unknownStatusUmbrellaResult.offPayrollStatus.suppliedEngagementEvidence.issues[0]
      ?.detail ?? "Off-payroll status is unresolved.",
  metrics: metrics({
    incrementalHouseholdCashPence: 9_999_999,
    retainedCompanyFundsPence: 9_999_999,
    confidenceScoreBasisPoints: 0,
  }),
  assumptions: [
    {
      id: "assumption:status:unknown",
      label: "off-payroll status",
      value: "under review",
      status: "unknown",
    },
  ],
});

export const unknownStatusRecommendationScenario = recommendationInput({
  id: "recommendation:unknown-status",
  sideIncomeCaseId: "case:unknown-contract-status",
  candidates: [umbrellaCandidate, directCandidate, unknownCompanyCandidate],
});

const divergentSoleTraderCandidate: RecommendationCandidate = {
  ...structuredClone(growingSoleTraderCandidate),
  metrics: {
    ...growingSoleTraderCandidate.metrics,
    incrementalHouseholdCashPence: 8_000_000,
    pensionContributionPence: 0,
    retainedCompanyFundsPence: 0,
  },
};

const divergentCompanyCandidate: RecommendationCandidate = {
  ...structuredClone(growingCompanyCandidate),
  metrics: {
    ...growingCompanyCandidate.metrics,
    incrementalHouseholdCashPence: 3_000_000,
    pensionContributionPence: 3_000_000,
    retainedCompanyFundsPence: 7_000_000,
  },
};

export const divergentCashPreferenceRecommendationScenario = recommendationInput({
  id: "recommendation:preference-cash",
  sideIncomeCaseId: "case:divergent-preferences",
  priorities: {
    householdCash: 5,
    pension: 0,
    retainedCompanyFunds: 0,
    lowerTax: 1,
    lowerCosts: 1,
    lowerAdministration: 1,
    employmentRights: 0,
    liabilityProtection: 0,
    certainty: 1,
    runway: 0,
  },
  candidates: [divergentSoleTraderCandidate, divergentCompanyCandidate],
});

export const divergentPensionPreferenceRecommendationScenario =
  recommendationInput({
    id: "recommendation:preference-pension",
    sideIncomeCaseId: "case:divergent-preferences",
    priorities: {
      householdCash: 0,
      pension: 5,
      retainedCompanyFunds: 5,
      lowerTax: 0,
      lowerCosts: 0,
      lowerAdministration: 0,
      employmentRights: 0,
      liabilityProtection: 2,
      certainty: 1,
      runway: 2,
    },
    candidates: [divergentSoleTraderCandidate, divergentCompanyCandidate],
  });

export const recommendationBoundaryFixtures = {
  ineligibleHighCash: recommendationInput({
    id: "recommendation:boundary:ineligible-high-cash",
    sideIncomeCaseId: "case:boundary:ineligible-high-cash",
    candidates: [smallSoleTraderCandidate, irrelevantUmbrellaCandidate],
  }),
  missingBusinessInput: recommendationInput({
    id: "recommendation:boundary:missing-input",
    sideIncomeCaseId: "case:boundary:missing-input",
    candidates: [
      candidate({
        id: "candidate:boundary:missing-input",
        route: "uk-limited-company",
        label: "Company with missing extraction plan",
        legalBasis: "The route is legally available.",
        metrics: smallCompanyCandidate.metrics,
        missingInput: {
          id: "input:extraction-plan",
          label: "planned extraction",
          question: "How much company profit must reach the household this year?",
        },
      }),
    ],
  }),
  insideCompany: recommendationInput({
    id: "recommendation:boundary:inside",
    sideIncomeCaseId: "case:boundary:inside",
    candidates: [
      candidate({
        id: "candidate:boundary:inside-company",
        route: "uk-limited-company",
        label: "Limited company, supplied inside status",
        statusContext: "inside",
        eligibility: "ineligible",
        legalBasis:
          "The released company calculator does not treat inside-status receipts as ordinary company trading revenue.",
        financialState: "unavailable",
        financialStateReason: "A deemed-employment calculation is not supported.",
        metrics: metrics({ incrementalHouseholdCashPence: 10_000_000 }),
      }),
      umbrellaCandidate,
    ],
  }),
} as const;

export const savedSideIncomeRecommendationScenarios = [
  smallProductAlongsidePayeRecommendationScenario,
  growingRetainedProfitRecommendationScenario,
  eligibleUmbrellaContractRecommendationScenario,
  irrelevantUmbrellaRecommendationScenario,
  unknownStatusRecommendationScenario,
  divergentCashPreferenceRecommendationScenario,
  divergentPensionPreferenceRecommendationScenario,
] as const;
