import { z } from "zod";
import {
  IdentifierSchema,
  IsoDateSchema,
  TaxYearSchema,
  TimestampSchema,
} from "./sideIncome";

export const SIDE_INCOME_RECOMMENDATION_VERSION = 1 as const;

const PenceSchema = z.number().int().nonnegative();
const BasisPointsSchema = z.number().int().min(0).max(10_000);

export const RecommendationRouteSchema = z.enum([
  "sole-trader",
  "uk-limited-company",
  "umbrella-employment",
  "direct-employment",
]);
export type RecommendationRoute = z.infer<typeof RecommendationRouteSchema>;

export const StatusContextSchema = z.enum([
  "not-applicable",
  "inside",
  "outside",
  "unknown",
  "under-review",
]);

export const RecommendationEligibilitySchema = z
  .object({
    state: z.enum(["eligible", "ineligible", "needs-review", "unsupported"]),
    legalOrStatusBasis: z.string().trim().min(1),
    evidenceIds: z.array(IdentifierSchema),
  })
  .strict();

export const RecommendationEvidenceSchema = z
  .object({
    id: IdentifierSchema,
    kind: z.enum([
      "household-fact",
      "business-fact",
      "legal-status",
      "tax-rule",
      "employment-right",
      "calculation",
    ]),
    label: z.string().trim().min(1),
    value: z.string().trim().min(1),
    sourceId: z.string().trim().min(1),
    sourceRevision: z.string().trim().min(1),
    validOn: IsoDateSchema,
    certainty: z.enum(["actual", "forecast", "scenario", "unknown"]),
  })
  .strict();
export type RecommendationEvidence = z.infer<
  typeof RecommendationEvidenceSchema
>;

export const RecommendationAssumptionSchema = z
  .object({
    id: IdentifierSchema,
    label: z.string().trim().min(1),
    value: z.string().trim().min(1),
    sourceId: z.string().trim().min(1),
    sourceRevision: z.string().trim().min(1),
    status: z.enum(["confirmed", "estimated", "unknown"]),
    editable: z.literal(true),
  })
  .strict();
export type RecommendationAssumption = z.infer<
  typeof RecommendationAssumptionSchema
>;

export const BusinessInputRequirementSchema = z
  .object({
    id: IdentifierSchema,
    label: z.string().trim().min(1),
    state: z.enum(["available", "missing", "unsupported"]),
    sourceEvidenceId: IdentifierSchema.nullable(),
    question: z.string().trim().min(1).nullable(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.state === "missing" && input.question === null) {
      context.addIssue({
        code: "custom",
        message: "A missing business input needs a question",
        path: ["question"],
      });
    }
    if (input.state === "available" && input.sourceEvidenceId === null) {
      context.addIssue({
        code: "custom",
        message: "An available business input needs source evidence",
        path: ["sourceEvidenceId"],
      });
    }
  });

export const RecommendationMetricsSchema = z
  .object({
    incrementalHouseholdCashPence: PenceSchema.nullable(),
    pensionContributionPence: PenceSchema.nullable(),
    retainedCompanyFundsPence: PenceSchema.nullable(),
    totalTaxPence: PenceSchema.nullable(),
    vatCollectedPence: PenceSchema.nullable(),
    vatPaidPence: PenceSchema.nullable(),
    setupCostsPence: PenceSchema.nullable(),
    ongoingCostsPence: PenceSchema.nullable(),
    administrationHours: z.number().nonnegative().nullable(),
    taxReserveRequiredPence: PenceSchema.nullable(),
    runwayMonths: z.number().nonnegative().nullable(),
    employmentRightsScoreBasisPoints: BasisPointsSchema.nullable(),
    liabilityProtectionScoreBasisPoints: BasisPointsSchema.nullable(),
    confidenceScoreBasisPoints: BasisPointsSchema.nullable(),
  })
  .strict();
export type RecommendationMetrics = z.infer<
  typeof RecommendationMetricsSchema
>;

const ComparisonPeriodSchema = z
  .object({
    startsOn: IsoDateSchema,
    endsOn: IsoDateSchema,
    taxYear: TaxYearSchema,
    availableWorkDays: z.number().nonnegative(),
  })
  .strict()
  .refine((period) => period.startsOn <= period.endsOn, {
    message: "The comparison period cannot end before it starts",
    path: ["endsOn"],
  });

export const RecommendationCandidateSchema = z
  .object({
    id: IdentifierSchema,
    route: RecommendationRouteSchema,
    label: z.string().trim().min(1),
    statusContext: StatusContextSchema,
    comparisonPeriod: ComparisonPeriodSchema,
    eligibility: RecommendationEligibilitySchema,
    financialState: z.enum(["supported", "partial", "unavailable"]),
    financialStateReason: z.string().trim().min(1),
    metrics: RecommendationMetricsSchema,
    householdFactIds: z.array(IdentifierSchema),
    businessInputs: z.array(BusinessInputRequirementSchema),
    evidence: z.array(RecommendationEvidenceSchema),
    assumptions: z.array(RecommendationAssumptionSchema),
    accountantQuestions: z.array(z.string().trim().min(1)),
    limitations: z.array(z.string().trim().min(1)),
  })
  .strict()
  .superRefine((candidate, context) => {
    const evidenceIds = candidate.evidence.map(({ id }) => id);
    if (new Set(evidenceIds).size !== evidenceIds.length) {
      context.addIssue({
        code: "custom",
        message: "Candidate evidence IDs must be unique",
        path: ["evidence"],
      });
    }
    const evidenceIdSet = new Set(evidenceIds);
    for (const evidenceId of candidate.eligibility.evidenceIds) {
      if (!evidenceIdSet.has(evidenceId)) {
        context.addIssue({
          code: "custom",
          message: `Eligibility references unknown evidence ${evidenceId}`,
          path: ["eligibility", "evidenceIds"],
        });
      }
    }
    for (const householdFactId of candidate.householdFactIds) {
      if (
        !candidate.evidence.some(
          (item) =>
            item.kind === "household-fact" &&
            item.sourceId === householdFactId,
        )
      ) {
        context.addIssue({
          code: "custom",
          message: `Household fact ${householdFactId} needs source lineage`,
          path: ["householdFactIds"],
        });
      }
    }
    const assumptionIds = candidate.assumptions.map(({ id }) => id);
    if (new Set(assumptionIds).size !== assumptionIds.length) {
      context.addIssue({
        code: "custom",
        message: "Candidate assumption IDs must be unique",
        path: ["assumptions"],
      });
    }
  });
export type RecommendationCandidate = z.infer<
  typeof RecommendationCandidateSchema
>;

export const RecommendationPrioritiesSchema = z
  .object({
    householdCash: z.number().int().min(0).max(5),
    pension: z.number().int().min(0).max(5),
    retainedCompanyFunds: z.number().int().min(0).max(5),
    lowerTax: z.number().int().min(0).max(5),
    lowerCosts: z.number().int().min(0).max(5),
    lowerAdministration: z.number().int().min(0).max(5),
    employmentRights: z.number().int().min(0).max(5),
    liabilityProtection: z.number().int().min(0).max(5),
    certainty: z.number().int().min(0).max(5),
    runway: z.number().int().min(0).max(5),
  })
  .strict()
  .refine((priorities) => Object.values(priorities).some((weight) => weight > 0), {
    message: "At least one recommendation priority needs a positive weight",
  });
export type RecommendationPriorities = z.infer<
  typeof RecommendationPrioritiesSchema
>;

const SensitivityVariableSchema = z.enum([
  "revenue",
  "expenses",
  "pension",
  "extraction",
  "work-availability",
]);

export const RecommendationSensitivityCaseSchema = z
  .object({
    id: IdentifierSchema,
    variable: SensitivityVariableSchema,
    case: z.enum(["low", "base", "high"]),
    value: z.number().nonnegative(),
    unit: z.enum(["pence", "days", "hours"]),
    rulesEffectiveOn: IsoDateSchema,
    ruleVersions: z.array(z.string().trim().min(1)).min(1),
    futureRuleState: z.enum([
      "current-reviewed-rules",
      "changed-rule-assumption",
      "unknown-future-rules",
    ]),
    assumptionIds: z.array(IdentifierSchema),
    outcomes: z.array(
      z
        .object({
          candidateId: IdentifierSchema,
          state: z.enum(["supported", "unavailable"]),
          comparableHouseholdValuePence: z.number().int().nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export type RecommendationSensitivityCase = z.infer<
  typeof RecommendationSensitivityCaseSchema
>;

export const SideIncomeRecommendationInputSchema = z
  .object({
    recommendationVersion: z.literal(SIDE_INCOME_RECOMMENDATION_VERSION),
    id: IdentifierSchema,
    sideIncomeCaseId: IdentifierSchema,
    sideIncomeCaseRevision: z.number().int().positive(),
    evaluatedAt: TimestampSchema,
    comparisonPeriod: ComparisonPeriodSchema,
    householdCashNeedPence: PenceSchema,
    pensionGoalPence: PenceSchema,
    priorities: RecommendationPrioritiesSchema,
    minimumClearWinnerGapBasisPoints: BasisPointsSchema,
    candidates: z.array(RecommendationCandidateSchema).min(1),
    sensitivities: z.array(RecommendationSensitivityCaseSchema),
  })
  .strict()
  .superRefine((input, context) => {
    const candidateIds = input.candidates.map(({ id }) => id);
    if (new Set(candidateIds).size !== candidateIds.length) {
      context.addIssue({
        code: "custom",
        message: "Recommendation candidate IDs must be unique",
        path: ["candidates"],
      });
    }
    const sensitivityIds = input.sensitivities.map(({ id }) => id);
    if (new Set(sensitivityIds).size !== sensitivityIds.length) {
      context.addIssue({
        code: "custom",
        message: "Sensitivity case IDs must be unique",
        path: ["sensitivities"],
      });
    }
    const knownCandidateIds = new Set(candidateIds);
    input.sensitivities.forEach((sensitivity, sensitivityIndex) => {
      sensitivity.outcomes.forEach((outcome, outcomeIndex) => {
        if (!knownCandidateIds.has(outcome.candidateId)) {
          context.addIssue({
            code: "custom",
            message: `Sensitivity references unknown candidate ${outcome.candidateId}`,
            path: [
              "sensitivities",
              sensitivityIndex,
              "outcomes",
              outcomeIndex,
              "candidateId",
            ],
          });
        }
      });
    });
    for (const variable of SensitivityVariableSchema.options) {
      const cases = input.sensitivities.filter(
        (sensitivity) => sensitivity.variable === variable,
      );
      if (
        cases.length > 0 &&
        !["low", "base", "high"].every((name) =>
          cases.some(({ case: caseName }) => caseName === name),
        )
      ) {
        context.addIssue({
          code: "custom",
          message: `${variable} sensitivity needs low, base, and high cases`,
          path: ["sensitivities"],
        });
      }
    }
  });
export type SideIncomeRecommendationInput = z.infer<
  typeof SideIncomeRecommendationInputSchema
>;

const DimensionSchema = z.enum([
  "householdCash",
  "pension",
  "retainedCompanyFunds",
  "lowerTax",
  "lowerCosts",
  "lowerAdministration",
  "employmentRights",
  "liabilityProtection",
  "certainty",
  "runway",
]);
type Dimension = z.infer<typeof DimensionSchema>;

const CandidateIssueSchema = z
  .object({
    code: z.enum([
      "comparison-period-mismatch",
      "work-availability-mismatch",
      "legal-or-status-ineligible",
      "financial-result-unavailable",
      "missing-business-input",
      "missing-priority-metric",
    ]),
    detail: z.string().trim().min(1),
  })
  .strict();

const ScoreContributionSchema = z
  .object({
    dimension: DimensionSchema,
    weight: z.number().int().min(0).max(5),
    rawValue: z.number(),
    normalizedScoreBasisPoints: BasisPointsSchema,
    weightedContribution: z.number().int().nonnegative(),
    explanation: z.string().trim().min(1),
  })
  .strict();

const CandidateAssessmentSchema = z
  .object({
    candidate: RecommendationCandidateSchema,
    legallyEligible: z.boolean(),
    financiallyRankable: z.boolean(),
    issues: z.array(CandidateIssueSchema),
    scoreBasisPoints: BasisPointsSchema.nullable(),
    scoreContributions: z.array(ScoreContributionSchema),
    goalAssessment: z
      .object({
        householdCashNeedPence: PenceSchema,
        householdCashDeficitPence: PenceSchema.nullable(),
        pensionGoalPence: PenceSchema,
        pensionDeficitPence: PenceSchema.nullable(),
        meetsKnownGoals: z.boolean().nullable(),
      })
      .strict(),
    reasons: z.array(z.string().trim().min(1)),
    tradeOffs: z.array(z.string().trim().min(1)),
    rank: z.number().int().positive().nullable(),
  })
  .strict();

const SensitivityResultSchema = z
  .object({
    sensitivity: RecommendationSensitivityCaseSchema,
    leadingCandidateIds: z.array(IdentifierSchema),
    unavailableCandidateIds: z.array(IdentifierSchema),
  })
  .strict();

const BreakEvenRangeSchema = z
  .object({
    variable: SensitivityVariableSchema,
    lowerValue: z.number().nonnegative(),
    upperValue: z.number().nonnegative(),
    unit: z.enum(["pence", "days", "hours"]),
    candidateIds: z.array(IdentifierSchema).min(2),
    lowerCaseId: IdentifierSchema,
    upperCaseId: IdentifierSchema,
    ruleVersions: z.array(z.string().trim().min(1)),
    futureRuleStates: z.array(
      z.enum([
        "current-reviewed-rules",
        "changed-rule-assumption",
        "unknown-future-rules",
      ]),
    ),
    explanation: z.string().trim().min(1),
  })
  .strict();

export const SideIncomeRecommendationResultSchema = z
  .object({
    kind: z.literal("uk-side-income-business-structure-recommendation"),
    recommendationVersion: z.literal(SIDE_INCOME_RECOMMENDATION_VERSION),
    inputId: IdentifierSchema,
    sideIncomeCaseId: IdentifierSchema,
    sideIncomeCaseRevision: z.number().int().positive(),
    evaluatedAt: TimestampSchema,
    status: z.enum([
      "recommended",
      "no-clear-winner",
      "insufficient-information",
      "no-eligible-options",
    ]),
    recommendedCandidateId: IdentifierSchema.nullable(),
    legalEligibilityDeterminedBeforePreferences: z.literal(true),
    minimumClearWinnerGapBasisPoints: BasisPointsSchema,
    winnerGapBasisPoints: BasisPointsSchema.nullable(),
    assessments: z.array(CandidateAssessmentSchema),
    alternativesPreserved: z.array(IdentifierSchema),
    missingBusinessQuestions: z.array(
      z
        .object({
          candidateId: IdentifierSchema,
          inputId: IdentifierSchema,
          question: z.string().trim().min(1),
        })
        .strict(),
    ),
    householdFactIdsUsed: z.array(IdentifierSchema),
    sensitivities: z.array(SensitivityResultSchema),
    breakEvenRanges: z.array(BreakEvenRangeSchema),
    sensitivityCaveat: z.string().trim().min(1),
    explanation: z.string().trim().min(1),
  })
  .strict();
export type SideIncomeRecommendationResult = z.infer<
  typeof SideIncomeRecommendationResultSchema
>;

type MetricDefinition = {
  metric: keyof RecommendationMetrics;
  direction: "higher" | "lower";
  label: string;
};

const metricDefinitions: Record<Dimension, MetricDefinition> = {
  householdCash: {
    metric: "incrementalHouseholdCashPence",
    direction: "higher",
    label: "household cash",
  },
  pension: {
    metric: "pensionContributionPence",
    direction: "higher",
    label: "pension funding",
  },
  retainedCompanyFunds: {
    metric: "retainedCompanyFundsPence",
    direction: "higher",
    label: "retained company funds",
  },
  lowerTax: {
    metric: "totalTaxPence",
    direction: "lower",
    label: "total tax",
  },
  lowerCosts: {
    metric: "ongoingCostsPence",
    direction: "lower",
    label: "ongoing costs",
  },
  lowerAdministration: {
    metric: "administrationHours",
    direction: "lower",
    label: "administration time",
  },
  employmentRights: {
    metric: "employmentRightsScoreBasisPoints",
    direction: "higher",
    label: "employment rights",
  },
  liabilityProtection: {
    metric: "liabilityProtectionScoreBasisPoints",
    direction: "higher",
    label: "liability protection",
  },
  certainty: {
    metric: "confidenceScoreBasisPoints",
    direction: "higher",
    label: "estimate certainty",
  },
  runway: {
    metric: "runwayMonths",
    direction: "higher",
    label: "cash runway",
  },
};

const periodMatches = (
  candidate: RecommendationCandidate,
  shared: SideIncomeRecommendationInput["comparisonPeriod"],
) =>
  candidate.comparisonPeriod.startsOn === shared.startsOn &&
  candidate.comparisonPeriod.endsOn === shared.endsOn &&
  candidate.comparisonPeriod.taxYear === shared.taxYear;

function scoringValue(
  candidate: RecommendationCandidate,
  dimension: Dimension,
) {
  if (dimension === "lowerCosts") {
    const setup = candidate.metrics.setupCostsPence;
    const ongoing = candidate.metrics.ongoingCostsPence;
    return setup === null || ongoing === null ? null : setup + ongoing;
  }
  return candidate.metrics[metricDefinitions[dimension].metric];
}

function candidateIssues(
  candidate: RecommendationCandidate,
  input: SideIncomeRecommendationInput,
) {
  const issues: z.infer<typeof CandidateIssueSchema>[] = [];
  if (!periodMatches(candidate, input.comparisonPeriod)) {
    issues.push({
      code: "comparison-period-mismatch",
      detail: `${candidate.label} does not use the shared comparison dates and tax year.`,
    });
  }
  if (
    candidate.comparisonPeriod.availableWorkDays !==
    input.comparisonPeriod.availableWorkDays
  ) {
    issues.push({
      code: "work-availability-mismatch",
      detail: `${candidate.label} does not use the shared work availability.`,
    });
  }
  if (candidate.eligibility.state !== "eligible") {
    issues.push({
      code: "legal-or-status-ineligible",
      detail: candidate.eligibility.legalOrStatusBasis,
    });
  }
  if (candidate.financialState !== "supported") {
    issues.push({
      code: "financial-result-unavailable",
      detail: candidate.financialStateReason,
    });
  }
  for (const requirement of candidate.businessInputs) {
    if (requirement.state !== "available") {
      issues.push({
        code: "missing-business-input",
        detail:
          requirement.state === "missing"
            ? `${candidate.label} needs ${requirement.label}.`
            : `${candidate.label} cannot use the supplied ${requirement.label}.`,
      });
    }
  }
  for (const dimension of DimensionSchema.options) {
    const definition = metricDefinitions[dimension];
    if (
      input.priorities[dimension] > 0 &&
      scoringValue(candidate, dimension) === null
    ) {
      issues.push({
        code: "missing-priority-metric",
        detail: `${candidate.label} has no supported ${definition.label} value.`,
      });
    }
  }
  return issues;
}

const normalize = (
  value: number,
  values: readonly number[],
  direction: MetricDefinition["direction"],
) => {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  if (minimum === maximum) return 5_000;
  const higherScore = Math.round(((value - minimum) * 10_000) / (maximum - minimum));
  return direction === "higher" ? higherScore : 10_000 - higherScore;
};

const scoreExplanation = (
  label: string,
  rawValue: number,
  score: number,
  weight: number,
) => `${label} is ${rawValue}; normalized score ${score}/10000 at weight ${weight}.`;

function scoreCandidates(
  candidates: RecommendationCandidate[],
  priorities: RecommendationPriorities,
) {
  const rawValues = new Map<Dimension, number[]>();
  for (const dimension of DimensionSchema.options) {
    rawValues.set(
      dimension,
      candidates.flatMap((candidate) => {
        const value = scoringValue(candidate, dimension);
        return value === null ? [] : [value];
      }),
    );
  }
  return candidates.map((candidate) => {
    const contributions = DimensionSchema.options.flatMap((dimension) => {
      const weight = priorities[dimension];
      const definition = metricDefinitions[dimension];
      const rawValue = scoringValue(candidate, dimension);
      if (weight === 0 || rawValue === null) return [];
      const normalizedScoreBasisPoints = normalize(
        rawValue,
        rawValues.get(dimension) ?? [rawValue],
        definition.direction,
      );
      return [
        {
          dimension,
          weight,
          rawValue,
          normalizedScoreBasisPoints,
          weightedContribution: normalizedScoreBasisPoints * weight,
          explanation: scoreExplanation(
            definition.label,
            rawValue,
            normalizedScoreBasisPoints,
            weight,
          ),
        },
      ];
    });
    const weightTotal = contributions.reduce(
      (total, contribution) => total + contribution.weight,
      0,
    );
    const scoreBasisPoints =
      weightTotal === 0
        ? 0
        : Math.round(
            contributions.reduce(
              (total, contribution) =>
                total + contribution.weightedContribution,
              0,
            ) / weightTotal,
          );
    const ordered = [...contributions].sort(
      (left, right) => right.weightedContribution - left.weightedContribution,
    );
    const reasons = ordered.slice(0, 2).map(({ explanation }) => explanation);
    const tradeOffs = ordered
      .filter(({ normalizedScoreBasisPoints }) => normalizedScoreBasisPoints < 5_000)
      .toSorted(
        (left, right) =>
          left.normalizedScoreBasisPoints - right.normalizedScoreBasisPoints,
      )
      .slice(0, 2)
      .map(({ explanation }) => explanation);
    return { candidate, contributions, scoreBasisPoints, reasons, tradeOffs };
  });
}

function sensitivityResults(
  sensitivities: RecommendationSensitivityCase[],
) {
  return sensitivities.map((sensitivity) => {
    const supported = sensitivity.outcomes.filter(
      (outcome) =>
        outcome.state === "supported" &&
        outcome.comparableHouseholdValuePence !== null,
    );
    const maximum =
      supported.length === 0
        ? null
        : Math.max(
            ...supported.map(
              ({ comparableHouseholdValuePence }) =>
                comparableHouseholdValuePence ?? 0,
            ),
          );
    return {
      sensitivity,
      leadingCandidateIds:
        maximum === null
          ? []
          : supported
              .filter(
                ({ comparableHouseholdValuePence }) =>
                  comparableHouseholdValuePence === maximum,
              )
              .map(({ candidateId }) => candidateId),
      unavailableCandidateIds: sensitivity.outcomes
        .filter(({ state }) => state === "unavailable")
        .map(({ candidateId }) => candidateId),
    };
  });
}

function breakEvenRanges(
  results: ReturnType<typeof sensitivityResults>,
) {
  return SensitivityVariableSchema.options.flatMap((variable) => {
    const cases = results
      .filter((result) => result.sensitivity.variable === variable)
      .toSorted(
        (left, right) => left.sensitivity.value - right.sensitivity.value,
      );
    return cases.slice(1).flatMap((upper, index) => {
      const lower = cases[index];
      if (lower === undefined) return [];
      const lowerLeaders = new Set(lower.leadingCandidateIds);
      const changed =
        lowerLeaders.size !== upper.leadingCandidateIds.length ||
        upper.leadingCandidateIds.some((id) => !lowerLeaders.has(id));
      if (!changed || lower.leadingCandidateIds.length === 0 || upper.leadingCandidateIds.length === 0) {
        return [];
      }
      const candidateIds = [
        ...new Set([
          ...lower.leadingCandidateIds,
          ...upper.leadingCandidateIds,
        ]),
      ];
      if (candidateIds.length < 2) return [];
      return [
        {
          variable,
          lowerValue: lower.sensitivity.value,
          upperValue: upper.sensitivity.value,
          unit: upper.sensitivity.unit,
          candidateIds,
          lowerCaseId: lower.sensitivity.id,
          upperCaseId: upper.sensitivity.id,
          ruleVersions: [
            ...new Set([
              ...lower.sensitivity.ruleVersions,
              ...upper.sensitivity.ruleVersions,
            ]),
          ],
          futureRuleStates: [
            ...new Set([
              lower.sensitivity.futureRuleState,
              upper.sensitivity.futureRuleState,
            ]),
          ],
          explanation: `The leading route changes between ${lower.sensitivity.value} and ${upper.sensitivity.value} ${upper.sensitivity.unit}; this is a tested range, not a universal threshold.`,
        },
      ];
    });
  });
}

function recommendationOutcome(
  legallyEligibleCount: number,
  rankableCount: number,
  scored: ReturnType<typeof scoreCandidates>,
  minimumGapBasisPoints: number,
) {
  const top = scored[0];
  const runnerUp = scored[1];
  let winnerGapBasisPoints: number | null = null;
  if (top !== undefined) {
    winnerGapBasisPoints =
      runnerUp === undefined
        ? 10_000
        : top.scoreBasisPoints - runnerUp.scoreBasisPoints;
  }
  const clearWinner =
    top !== undefined &&
    winnerGapBasisPoints !== null &&
    winnerGapBasisPoints >= minimumGapBasisPoints;
  if (legallyEligibleCount === 0) {
    return {
      status: "no-eligible-options" as const,
      recommendedCandidateId: null,
      winnerGapBasisPoints,
    };
  }
  if (rankableCount === 0) {
    return {
      status: "insufficient-information" as const,
      recommendedCandidateId: null,
      winnerGapBasisPoints,
    };
  }
  if (!clearWinner) {
    return {
      status: "no-clear-winner" as const,
      recommendedCandidateId: null,
      winnerGapBasisPoints,
    };
  }
  return {
    status: "recommended" as const,
    recommendedCandidateId: top.candidate.id,
    winnerGapBasisPoints,
  };
}

const recommendationExplanation = (
  outcome: ReturnType<typeof recommendationOutcome>,
  topLabel: string | undefined,
) => {
  if (outcome.status === "recommended") {
    return `${topLabel ?? "The leading option"} has a clear financial score among legally eligible, supported routes.`;
  }
  if (outcome.status === "no-clear-winner") {
    return "The eligible routes are too close under the stated priorities to name a clear winner.";
  }
  if (outcome.status === "insufficient-information") {
    return "At least one route may be legally eligible, but supported financial inputs are incomplete or misaligned.";
  }
  return "No supplied route is legally or status eligible for this comparison.";
};

const goalReason = (
  deficitPence: number | null,
  unknown: string,
  met: string,
  shortfallLabel: string,
) => {
  if (deficitPence === null) return unknown;
  if (deficitPence === 0) return met;
  return `The projection is ${deficitPence}p short of the stated ${shortfallLabel}.`;
};

function goalAssessmentFor(
  metrics: RecommendationMetrics,
  householdCashNeedPence: number,
  pensionGoalPence: number,
) {
  const householdCash = metrics.incrementalHouseholdCashPence;
  const pension = metrics.pensionContributionPence;
  const householdCashDeficitPence =
    householdCash === null
      ? null
      : Math.max(0, householdCashNeedPence - householdCash);
  const pensionDeficitPence =
    pension === null ? null : Math.max(0, pensionGoalPence - pension);
  const goalReasons = [
    goalReason(
      householdCashDeficitPence,
      "Household cash against the stated need is unknown.",
      "The projection meets the stated household cash need.",
      "household cash need",
    ),
    goalReason(
      pensionDeficitPence,
      "Pension funding against the stated goal is unknown.",
      "The projection meets the stated pension goal.",
      "pension goal",
    ),
  ];
  return {
    assessment: {
      householdCashNeedPence,
      householdCashDeficitPence,
      pensionGoalPence,
      pensionDeficitPence,
      meetsKnownGoals:
        householdCashDeficitPence === null || pensionDeficitPence === null
          ? null
          : householdCashDeficitPence === 0 && pensionDeficitPence === 0,
    },
    reasons: goalReasons,
  };
}

function assessmentFor(
  candidate: RecommendationCandidate,
  issues: z.infer<typeof CandidateIssueSchema>[],
  scoredCandidate: ReturnType<typeof scoreCandidates>[number] | undefined,
  rank: number | undefined,
  householdCashNeedPence: number,
  pensionGoalPence: number,
) {
  const goals = goalAssessmentFor(
    candidate.metrics,
    householdCashNeedPence,
    pensionGoalPence,
  );
  return {
    candidate,
    legallyEligible: candidate.eligibility.state === "eligible",
    financiallyRankable: scoredCandidate !== undefined,
    issues,
    scoreBasisPoints: scoredCandidate?.scoreBasisPoints ?? null,
    scoreContributions: scoredCandidate?.contributions ?? [],
    goalAssessment: goals.assessment,
    reasons: [
      ...(scoredCandidate?.reasons ?? [candidate.financialStateReason]),
      ...goals.reasons,
    ],
    tradeOffs: [
      ...(scoredCandidate?.tradeOffs ?? []),
      ...candidate.limitations,
    ],
    rank: rank ?? null,
  };
}

export function evaluateSideIncomeRecommendation(
  value: SideIncomeRecommendationInput,
): SideIncomeRecommendationResult {
  const input = SideIncomeRecommendationInputSchema.parse(value);
  const issueMap = new Map(
    input.candidates.map((candidate) => [
      candidate.id,
      candidateIssues(candidate, input),
    ]),
  );
  const legallyEligible = input.candidates.filter(
    (candidate) => candidate.eligibility.state === "eligible",
  );
  const rankable = legallyEligible.filter(
    (candidate) => (issueMap.get(candidate.id) ?? []).length === 0,
  );
  const scored = scoreCandidates(rankable, input.priorities).toSorted(
    (left, right) =>
      right.scoreBasisPoints - left.scoreBasisPoints ||
      left.candidate.id.localeCompare(right.candidate.id),
  );
  const rankById = new Map(
    scored.map(({ candidate }, index) => [candidate.id, index + 1]),
  );
  const scoreById = new Map(
    scored.map((entry) => [entry.candidate.id, entry]),
  );
  const outcome = recommendationOutcome(
    legallyEligible.length,
    rankable.length,
    scored,
    input.minimumClearWinnerGapBasisPoints,
  );
  const assessments = input.candidates
    .map((candidate) =>
      assessmentFor(
        candidate,
        issueMap.get(candidate.id) ?? [],
        scoreById.get(candidate.id),
        rankById.get(candidate.id),
        input.householdCashNeedPence,
        input.pensionGoalPence,
      ),
    )
    .toSorted((left, right) => {
      if (left.rank !== null && right.rank !== null) return left.rank - right.rank;
      if (left.rank !== null) return -1;
      if (right.rank !== null) return 1;
      return left.candidate.id.localeCompare(right.candidate.id);
    });
  const sensitivity = sensitivityResults(input.sensitivities);
  return SideIncomeRecommendationResultSchema.parse({
    kind: "uk-side-income-business-structure-recommendation",
    recommendationVersion: SIDE_INCOME_RECOMMENDATION_VERSION,
    inputId: input.id,
    sideIncomeCaseId: input.sideIncomeCaseId,
    sideIncomeCaseRevision: input.sideIncomeCaseRevision,
    evaluatedAt: input.evaluatedAt,
    status: outcome.status,
    recommendedCandidateId: outcome.recommendedCandidateId,
    legalEligibilityDeterminedBeforePreferences: true,
    minimumClearWinnerGapBasisPoints: input.minimumClearWinnerGapBasisPoints,
    winnerGapBasisPoints: outcome.winnerGapBasisPoints,
    assessments,
    alternativesPreserved: input.candidates.map(({ id }) => id),
    missingBusinessQuestions: input.candidates.flatMap((candidate) =>
      candidate.businessInputs.flatMap((requirement) =>
        requirement.state === "missing" && requirement.question !== null
          ? [
              {
                candidateId: candidate.id,
                inputId: requirement.id,
                question: requirement.question,
              },
            ]
          : [],
      ),
    ),
    householdFactIdsUsed: [
      ...new Set(input.candidates.flatMap(({ householdFactIds }) => householdFactIds)),
    ],
    sensitivities: sensitivity,
    breakEvenRanges: breakEvenRanges(sensitivity),
    sensitivityCaveat:
      "Sensitivity ranges apply only to the supplied dates, work availability, assumptions, and rule versions. They are not a universal incorporation threshold.",
    explanation: recommendationExplanation(outcome, scored[0]?.candidate.label),
  });
}
