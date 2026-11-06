import { z } from "zod";
import {
  IdentifierSchema,
  TimestampSchema,
} from "./sideIncome";
import {
  RecommendationEvidenceSchema,
  RecommendationMetricsSchema,
  SideIncomeRecommendationResultSchema,
  type SideIncomeRecommendationResult,
} from "./sideIncomeRecommendation";

export const SIDE_INCOME_RECOMMENDATION_DECISION_VERSION = 1 as const;

export const RecommendationReviewSignalSchema = z
  .object({
    id: IdentifierSchema,
    kind: z.enum([
      "revenue",
      "employment",
      "household-cash-need",
      "cost",
      "rule-version",
    ]),
    value: z.string().trim().min(1),
    sourceId: z.string().trim().min(1),
    sourceRevision: z.string().trim().min(1),
    certainty: z.enum(["actual", "forecast", "scenario", "unknown"]),
  })
  .strict();
export type RecommendationReviewSignal = z.infer<
  typeof RecommendationReviewSignalSchema
>;

const RecalculationSchema = z
  .object({
    id: IdentifierSchema,
    recalculatedAt: TimestampSchema,
    reason: z.string().trim().min(1),
    correctedFactIds: z.array(IdentifierSchema),
    recommendation: SideIncomeRecommendationResultSchema,
  })
  .strict();

const ActualObservationSchema = z
  .object({
    id: IdentifierSchema,
    candidateId: IdentifierSchema,
    observedAt: TimestampSchema,
    metrics: RecommendationMetricsSchema,
    evidence: z.array(RecommendationEvidenceSchema),
    note: z.string().trim().min(1),
    divergenceSources: z.array(
      z
        .object({
          kind: z.enum([
            "changed-assumption",
            "changed-reality",
            "unexplained",
          ]),
          label: z.string().trim().min(1),
          impactPence: z.number().int().nullable(),
          sourceEvidenceIds: z.array(IdentifierSchema),
        })
        .strict(),
    ),
  })
  .strict();

const ReviewEventSchema = z
  .object({
    id: IdentifierSchema,
    triggeredAt: TimestampSchema,
    signalId: IdentifierSchema,
    kind: RecommendationReviewSignalSchema.shape.kind,
    previousValue: z.string().trim().min(1),
    currentValue: z.string().trim().min(1),
    previousCertainty: RecommendationReviewSignalSchema.shape.certainty,
    currentCertainty: RecommendationReviewSignalSchema.shape.certainty,
    reason: z.string().trim().min(1),
    state: z.enum(["review-required", "reviewed"]),
    recalculationId: IdentifierSchema.nullable(),
  })
  .strict();

export const SideIncomeRecommendationDecisionSchema = z
  .object({
    decisionVersion: z.literal(SIDE_INCOME_RECOMMENDATION_DECISION_VERSION),
    id: IdentifierSchema,
    savedAt: TimestampSchema,
    chosenCandidateId: IdentifierSchema,
    action: z
      .object({
        kind: z.enum([
          "continue-current-route",
          "prepare-manual-change",
          "review-with-accountant",
        ]),
        detail: z.string().trim().min(1),
      })
      .strict(),
    rationale: z.string().trim().min(1),
    originalRecommendation: SideIncomeRecommendationResultSchema,
    originalReviewSignals: z.array(RecommendationReviewSignalSchema),
    recalculations: z.array(RecalculationSchema),
    actualObservations: z.array(ActualObservationSchema),
    reviews: z.array(ReviewEventSchema),
  })
  .strict()
  .superRefine((decision, context) => {
    const chosen = decision.originalRecommendation.assessments.find(
      ({ candidate }) => candidate.id === decision.chosenCandidateId,
    );
    if (chosen === undefined) {
      context.addIssue({
        code: "custom",
        message: "The chosen candidate must be in the saved comparison",
        path: ["chosenCandidateId"],
      });
    } else if (!chosen.legallyEligible) {
      context.addIssue({
        code: "custom",
        message: "A user preference cannot select a legally ineligible route",
        path: ["chosenCandidateId"],
      });
    }
    const signalIds = decision.originalReviewSignals.map(({ id }) => id);
    if (new Set(signalIds).size !== signalIds.length) {
      context.addIssue({
        code: "custom",
        message: "Review signal IDs must be unique",
        path: ["originalReviewSignals"],
      });
    }
  });
export type SideIncomeRecommendationDecision = z.infer<
  typeof SideIncomeRecommendationDecisionSchema
>;

export const CreateSideIncomeRecommendationDecisionSchema = z
  .object({
    id: SideIncomeRecommendationDecisionSchema.shape.id,
    savedAt: SideIncomeRecommendationDecisionSchema.shape.savedAt,
    chosenCandidateId:
      SideIncomeRecommendationDecisionSchema.shape.chosenCandidateId,
    action: SideIncomeRecommendationDecisionSchema.shape.action,
    rationale: SideIncomeRecommendationDecisionSchema.shape.rationale,
    originalRecommendation:
      SideIncomeRecommendationDecisionSchema.shape.originalRecommendation,
    originalReviewSignals:
      SideIncomeRecommendationDecisionSchema.shape.originalReviewSignals,
  })
  .strict();

export function createSideIncomeRecommendationDecision(
  value: z.input<typeof CreateSideIncomeRecommendationDecisionSchema>,
) {
  const input = CreateSideIncomeRecommendationDecisionSchema.parse(value);
  return SideIncomeRecommendationDecisionSchema.parse({
    decisionVersion: SIDE_INCOME_RECOMMENDATION_DECISION_VERSION,
    ...input,
    recalculations: [],
    actualObservations: [],
    reviews: [],
  });
}

export function appendSideIncomeRecommendationRecalculation(
  decisionValue: SideIncomeRecommendationDecision,
  recalculationValue: z.input<typeof RecalculationSchema>,
) {
  const decision = SideIncomeRecommendationDecisionSchema.parse(decisionValue);
  const recalculation = RecalculationSchema.parse(recalculationValue);
  if (
    recalculation.recommendation.sideIncomeCaseId !==
    decision.originalRecommendation.sideIncomeCaseId
  ) {
    throw new Error("A recalculation must use the original side-income case identity");
  }
  if (
    recalculation.recommendation.sideIncomeCaseRevision <=
    decision.originalRecommendation.sideIncomeCaseRevision
  ) {
    throw new Error("A recalculation must use a later side-income case revision");
  }
  if (
    decision.recalculations.some(({ id }) => id === recalculation.id)
  ) {
    throw new Error(`Recalculation ${recalculation.id} already exists`);
  }
  return SideIncomeRecommendationDecisionSchema.parse({
    ...decision,
    recalculations: [...decision.recalculations, recalculation],
  });
}

export function appendSideIncomeActualObservation(
  decisionValue: SideIncomeRecommendationDecision,
  observationValue: z.input<typeof ActualObservationSchema>,
) {
  const decision = SideIncomeRecommendationDecisionSchema.parse(decisionValue);
  const observation = ActualObservationSchema.parse(observationValue);
  if (observation.candidateId !== decision.chosenCandidateId) {
    throw new Error("Actual results must identify the chosen route");
  }
  if (
    decision.actualObservations.some(({ id }) => id === observation.id)
  ) {
    throw new Error(`Actual observation ${observation.id} already exists`);
  }
  return SideIncomeRecommendationDecisionSchema.parse({
    ...decision,
    actualObservations: [...decision.actualObservations, observation],
  });
}

const reconciledMetricNames = [
  "incrementalHouseholdCashPence",
  "pensionContributionPence",
  "retainedCompanyFundsPence",
  "totalTaxPence",
  "vatCollectedPence",
  "vatPaidPence",
  "setupCostsPence",
  "ongoingCostsPence",
  "taxReserveRequiredPence",
] as const;

export function reconcileSideIncomeRecommendationDecision(
  decisionValue: SideIncomeRecommendationDecision,
) {
  const decision = SideIncomeRecommendationDecisionSchema.parse(decisionValue);
  const chosen = decision.originalRecommendation.assessments.find(
    ({ candidate }) => candidate.id === decision.chosenCandidateId,
  );
  if (chosen === undefined) throw new Error("The chosen candidate is missing");
  return decision.actualObservations.map((observation) => ({
    observationId: observation.id,
    observedAt: observation.observedAt,
    candidateId: observation.candidateId,
    variances: reconciledMetricNames.map((metric) => {
      const expected = chosen.candidate.metrics[metric];
      const actual = observation.metrics[metric];
      return {
        metric,
        expected,
        actual,
        variance:
          expected === null || actual === null ? null : actual - expected,
      };
    }),
    divergenceSources: observation.divergenceSources,
    uncertaintyPreserved:
      observation.evidence.some(({ certainty }) => certainty === "unknown") ||
      chosen.candidate.assumptions.some(({ status }) => status === "unknown"),
  }));
}

export function detectSideIncomeRecommendationReviewTriggers(
  decisionValue: SideIncomeRecommendationDecision,
  currentSignalValues: RecommendationReviewSignal[],
  triggeredAt: string,
) {
  const decision = SideIncomeRecommendationDecisionSchema.parse(decisionValue);
  const currentSignals = currentSignalValues.map((signal) =>
    RecommendationReviewSignalSchema.parse(signal),
  );
  const currentById = new Map(currentSignals.map((signal) => [signal.id, signal]));
  return decision.originalReviewSignals.flatMap((previous) => {
    const current = currentById.get(previous.id);
    if (
      current !== undefined &&
      current.value === previous.value &&
      current.sourceRevision === previous.sourceRevision &&
      current.certainty === previous.certainty
    ) {
      return [];
    }
    return [
      ReviewEventSchema.parse({
        id: `review:${previous.id}:${triggeredAt.replaceAll(/[^0-9]/g, "")}`,
        triggeredAt,
        signalId: previous.id,
        kind: previous.kind,
        previousValue: previous.value,
        currentValue: current?.value ?? "not supplied",
        previousCertainty: previous.certainty,
        currentCertainty: current?.certainty ?? "unknown",
        reason:
          current === undefined
            ? `${previous.kind} evidence is no longer supplied.`
            : `${previous.kind} changed or has a new source revision.`,
        state: "review-required",
        recalculationId: null,
      }),
    ];
  });
}

export function appendSideIncomeRecommendationReviews(
  decisionValue: SideIncomeRecommendationDecision,
  reviewValues: z.input<typeof ReviewEventSchema>[],
) {
  const decision = SideIncomeRecommendationDecisionSchema.parse(decisionValue);
  const reviews = reviewValues.map((review) => ReviewEventSchema.parse(review));
  const existingIds = new Set(decision.reviews.map(({ id }) => id));
  if (reviews.some(({ id }) => existingIds.has(id))) {
    throw new Error("A review event with the same identity already exists");
  }
  return SideIncomeRecommendationDecisionSchema.parse({
    ...decision,
    reviews: [...decision.reviews, ...reviews],
  });
}

export const AccountantReviewPacketSchema = z
  .object({
    decisionId: IdentifierSchema,
    generatedAt: TimestampSchema,
    chosenCandidateId: IdentifierSchema,
    originalCaseRevision: z.number().int().positive(),
    latestCaseRevision: z.number().int().positive(),
    comparison: SideIncomeRecommendationResultSchema,
    legalAndStatusPosition: z.array(
      z
        .object({
          candidateId: IdentifierSchema,
          state: z.enum([
            "eligible",
            "ineligible",
            "needs-review",
            "unsupported",
          ]),
          basis: z.string().trim().min(1),
        })
        .strict(),
    ),
    questions: z.array(z.string().trim().min(1)),
    uncertainAssumptions: z.array(
      z
        .object({
          candidateId: IdentifierSchema,
          assumptionId: IdentifierSchema,
          label: z.string().trim().min(1),
          value: z.string().trim().min(1),
          status: z.enum(["estimated", "unknown"]),
        })
        .strict(),
    ),
    unresolvedInputs: SideIncomeRecommendationResultSchema.shape.missingBusinessQuestions,
    limitations: z.array(z.string().trim().min(1)),
    automaticActions: z.array(z.never()).length(0),
    disclaimer: z.string().trim().min(1),
  })
  .strict();

export function buildSideIncomeAccountantReviewPacket(
  decisionValue: SideIncomeRecommendationDecision,
  generatedAt: string,
) {
  const decision = SideIncomeRecommendationDecisionSchema.parse(decisionValue);
  const latest = decision.recalculations.at(-1)?.recommendation;
  const comparison: SideIncomeRecommendationResult =
    latest ?? decision.originalRecommendation;
  return AccountantReviewPacketSchema.parse({
    decisionId: decision.id,
    generatedAt,
    chosenCandidateId: decision.chosenCandidateId,
    originalCaseRevision: decision.originalRecommendation.sideIncomeCaseRevision,
    latestCaseRevision: comparison.sideIncomeCaseRevision,
    comparison,
    legalAndStatusPosition: comparison.assessments.map(({ candidate }) => ({
      candidateId: candidate.id,
      state: candidate.eligibility.state,
      basis: candidate.eligibility.legalOrStatusBasis,
    })),
    questions: [
      ...new Set(
        comparison.assessments.flatMap(
          ({ candidate }) => candidate.accountantQuestions,
        ),
      ),
    ],
    uncertainAssumptions: comparison.assessments.flatMap(({ candidate }) =>
      candidate.assumptions.flatMap((assumption) =>
        assumption.status === "confirmed"
          ? []
          : [
              {
                candidateId: candidate.id,
                assumptionId: assumption.id,
                label: assumption.label,
                value: assumption.value,
                status: assumption.status,
              },
            ],
      ),
    ),
    unresolvedInputs: comparison.missingBusinessQuestions,
    limitations: [
      ...new Set(
        comparison.assessments.flatMap(({ candidate }) => candidate.limitations),
      ),
    ],
    automaticActions: [],
    disclaimer:
      "This packet records a comparison and questions. It does not incorporate a company, register with HMRC, determine employment status, or give a legal guarantee.",
  });
}
