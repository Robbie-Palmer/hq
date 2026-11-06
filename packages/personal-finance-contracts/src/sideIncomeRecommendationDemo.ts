import {
  evaluateSideIncomeRecommendation,
  type SideIncomeRecommendationInput,
} from "./sideIncomeRecommendation";
import {
  appendSideIncomeActualObservation,
  appendSideIncomeRecommendationRecalculation,
  appendSideIncomeRecommendationReviews,
  buildSideIncomeAccountantReviewPacket,
  createSideIncomeRecommendationDecision,
  detectSideIncomeRecommendationReviewTriggers,
  reconcileSideIncomeRecommendationDecision,
  type RecommendationReviewSignal,
} from "./sideIncomeRecommendationDecision";
import {
  divergentCashPreferenceRecommendationScenario,
  divergentPensionPreferenceRecommendationScenario,
  eligibleUmbrellaContractRecommendationScenario,
  growingRetainedProfitRecommendationScenario,
  recommendationBoundaryFixtures,
  smallProductAlongsidePayeRecommendationScenario,
  unknownStatusRecommendationScenario,
} from "./sideIncomeRecommendationSyntheticScenarios";

export const SIDE_INCOME_RECOMMENDATION_DEMO_SEED_VERSION = 1 as const;

const comparisonCard = (
  id: string,
  title: string,
  description: string,
  input: SideIncomeRecommendationInput,
) => ({
  id,
  title,
  description,
  input,
  result: evaluateSideIncomeRecommendation(input),
});

const comparisonCards = [
  comparisonCard(
    "demo:recommendation:small-product",
    "Small product income alongside PAYE",
    "Sole trader wins on accessible cash and lower administration. Employment routes remain visible but ineligible for product sales.",
    smallProductAlongsidePayeRecommendationScenario,
  ),
  comparisonCard(
    "demo:recommendation:growing-business",
    "Growing business with retained profit",
    "A limited company best fits the pension and retained-profit goals. The result includes tested ranges for revenue, expenses, pension, extraction, and available workdays.",
    growingRetainedProfitRecommendationScenario,
  ),
  comparisonCard(
    "demo:recommendation:contract-routes",
    "Contract work with three eligible routes",
    "Direct employment, umbrella employment, and supplied outside-status company work are compared over aligned dates without treating them as interchangeable.",
    eligibleUmbrellaContractRecommendationScenario,
  ),
  comparisonCard(
    "demo:recommendation:status-review",
    "Contract status still under review",
    "The unresolved company route keeps its forecast evidence but cannot enter the financial ranking until its status is settled.",
    unknownStatusRecommendationScenario,
  ),
  comparisonCard(
    "demo:recommendation:cash-priority",
    "Household cash needed now",
    "The sole-trader route wins when accessible household cash is the stated priority.",
    divergentCashPreferenceRecommendationScenario,
  ),
  comparisonCard(
    "demo:recommendation:pension-priority",
    "Pension and retained funds matter most",
    "The same route finances produce a company recommendation when pension funding and retained cash become the stated priorities.",
    divergentPensionPreferenceRecommendationScenario,
  ),
  comparisonCard(
    "demo:recommendation:missing-input",
    "Extraction plan not supplied",
    "The comparison asks one business-specific question instead of inventing the missing household extraction requirement.",
    recommendationBoundaryFixtures.missingBusinessInput,
  ),
] as const;

const originalRecommendation = evaluateSideIncomeRecommendation(
  growingRetainedProfitRecommendationScenario,
);

const originalReviewSignals: RecommendationReviewSignal[] = [
  {
    id: "signal:demo:revenue",
    kind: "revenue",
    value: "£100,000 forecast",
    sourceId: "forecast:demo:revenue:2026-27",
    sourceRevision: "1",
    certainty: "forecast",
  },
  {
    id: "signal:demo:employment",
    kind: "employment",
    value: "PAYE employment active",
    sourceId: "employment:demo:main-job",
    sourceRevision: "1",
    certainty: "actual",
  },
  {
    id: "signal:demo:household-cash",
    kind: "household-cash-need",
    value: "£20,000",
    sourceId: "plan:demo:household-cash:2026-27",
    sourceRevision: "1",
    certainty: "forecast",
  },
  {
    id: "signal:demo:costs",
    kind: "cost",
    value: "£10,050 forecast",
    sourceId: "forecast:demo:business-costs:2026-27",
    sourceRevision: "1",
    certainty: "forecast",
  },
  {
    id: "signal:demo:rules",
    kind: "rule-version",
    value: "2026-27",
    sourceId: "uk-limited-company-rules",
    sourceRevision: "2026-11-06",
    certainty: "actual",
  },
];

const correctedInput = structuredClone(
  growingRetainedProfitRecommendationScenario,
);
correctedInput.id = "recommendation:demo:growing-business:corrected";
correctedInput.sideIncomeCaseRevision = 2;
const correctedCompany = correctedInput.candidates.find(
  ({ id }) => id === "candidate:growing:company",
);
if (correctedCompany === undefined) {
  throw new Error("The demo company candidate is missing");
}
correctedCompany.metrics.incrementalHouseholdCashPence = 1_950_000;
correctedCompany.metrics.ongoingCostsPence =
  (correctedCompany.metrics.ongoingCostsPence ?? 0) + 200_000;
const correctedRecommendation = evaluateSideIncomeRecommendation(correctedInput);

let savedDecision = createSideIncomeRecommendationDecision({
  id: "decision:demo:growing-business",
  savedAt: "2026-11-06T14:00:00.000Z",
  chosenCandidateId: "candidate:growing:company",
  action: {
    kind: "review-with-accountant",
    detail: "Review the extraction and employer-pension assumptions before changing structure.",
  },
  rationale:
    "The company route best matches the stated pension and retained-profit goals after costs and administration.",
  originalRecommendation,
  originalReviewSignals,
});

savedDecision = appendSideIncomeRecommendationRecalculation(savedDecision, {
  id: "recalculation:demo:cost-correction",
  recalculatedAt: "2026-11-20T09:00:00.000Z",
  reason: "The bookkeeping and accountancy forecast increased by £2,000.",
  correctedFactIds: ["forecast:demo:business-costs:2026-27"],
  recommendation: correctedRecommendation,
});

const chosenAssessment = originalRecommendation.assessments.find(
  ({ candidate }) => candidate.id === savedDecision.chosenCandidateId,
);
if (chosenAssessment === undefined) {
  throw new Error("The demo decision candidate is missing");
}

savedDecision = appendSideIncomeActualObservation(savedDecision, {
  id: "actual:demo:first-quarter",
  candidateId: savedDecision.chosenCandidateId,
  observedAt: "2027-01-31T12:00:00.000Z",
  metrics: {
    ...chosenAssessment.candidate.metrics,
    incrementalHouseholdCashPence: 1_850_000,
    totalTaxPence: null,
  },
  evidence: [
    {
      id: "evidence:demo:bank-cash",
      kind: "household-fact",
      label: "Cash transferred to the household",
      value: "£18,500",
      sourceId: "bank-import:demo:2027-01",
      sourceRevision: "1",
      validOn: "2027-01-31",
      certainty: "actual",
    },
    {
      id: "evidence:demo:tax-estimate",
      kind: "tax-rule",
      label: "Final tax liability",
      value: "Return not filed",
      sourceId: "corporation-tax-return:demo:2026-27",
      sourceRevision: "draft",
      validOn: "2027-01-31",
      certainty: "unknown",
    },
  ],
  note: "The cash transfer is observed. The final tax liability is still unknown.",
  divergenceSources: [
    {
      kind: "changed-reality",
      label: "A customer paid after the observation date",
      impactPence:
        1_850_000 -
        (chosenAssessment.candidate.metrics.incrementalHouseholdCashPence ?? 0),
      sourceEvidenceIds: ["evidence:demo:bank-cash"],
    },
  ],
});

const currentReviewSignals = originalReviewSignals.map((signal) => {
  if (signal.kind === "revenue") {
    return {
      ...signal,
      value: "£112,000 forecast",
      sourceRevision: "2",
    };
  }
  if (signal.kind === "cost") {
    return {
      ...signal,
      value: "£12,050 forecast",
      sourceRevision: "2",
    };
  }
  return signal;
});
const reviewEvents = detectSideIncomeRecommendationReviewTriggers(
  savedDecision,
  currentReviewSignals,
  "2027-02-01T08:00:00.000Z",
);
savedDecision = appendSideIncomeRecommendationReviews(
  savedDecision,
  reviewEvents,
);

export const sideIncomeRecommendationDemoSeed = {
  seedVersion: SIDE_INCOME_RECOMMENDATION_DEMO_SEED_VERSION,
  generatedAt: "2027-02-01T09:00:00.000Z",
  comparisonCards,
  savedDecision,
  reconciliation: reconcileSideIncomeRecommendationDecision(savedDecision),
  accountantReviewPacket: buildSideIncomeAccountantReviewPacket(
    savedDecision,
    "2027-02-01T09:00:00.000Z",
  ),
} as const;
