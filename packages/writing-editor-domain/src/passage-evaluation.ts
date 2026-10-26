import { z } from "zod";

import { canonicalJson } from "./canonical-json";
import {
  PassageEvidenceGateSchema,
  ProposalIdSchema,
} from "./proposals";
import { sha256 } from "./suggestions";

const PreservationResultSchema = z.enum(["preserved", "failed", "unassessed"]);

export const PassageRewriteAssessmentSchema = z.object({
  caseId: z.string().trim().min(1),
  proposalId: ProposalIdSchema,
  outcome: z.enum(["accepted", "rejected", "changed"]),
  factualPreservation: PreservationResultSchema,
  terminologyPreservation: PreservationResultSchema,
  voicePreservation: PreservationResultSchema,
  usefulEdit: z.boolean(),
  reviewMilliseconds: z.number().nonnegative(),
  notes: z.array(z.string().trim().min(1)).default([]),
}).strict();

export const PassageRewriteGateSchema = z.object({
  gateId: z.string().trim().min(1),
  minimumCases: z.number().int().positive(),
  minimumFactualPreservation: z.number().min(0).max(1),
  minimumTerminologyPreservation: z.number().min(0).max(1),
  minimumVoicePreservation: z.number().min(0).max(1),
  minimumUsefulEditYield: z.number().min(0).max(1),
  maximumMedianReviewMilliseconds: z.number().nonnegative(),
  requireAllPreservationAssessed: z.boolean(),
  allowCriticalFailures: z.boolean(),
}).strict();

const CaseFailureSchema = z.object({
  caseId: z.string(),
  proposalId: ProposalIdSchema,
  dimensions: z.array(z.enum(["facts", "terminology", "voice"])).min(1),
  notes: z.array(z.string()),
}).strict();

export const PassageRewriteEvaluationSchema = z.object({
  schemaVersion: z.literal(1),
  recordType: z.literal("passage-rewrite-evaluation"),
  evaluationId: z.string().regex(/^passage-evaluation:v1:[a-f0-9]{64}$/),
  gateId: z.string(),
  decision: z.enum(["adopt", "gather-more-evidence"]),
  sample: z.object({
    cases: z.number().int().nonnegative(),
    preservationAssessmentsComplete: z.boolean(),
  }).strict(),
  metrics: z.object({
    factualPreservation: z.number().min(0).max(1),
    terminologyPreservation: z.number().min(0).max(1),
    voicePreservation: z.number().min(0).max(1),
    usefulEditYield: z.number().min(0).max(1),
    medianReviewMilliseconds: z.number().nonnegative(),
  }).strict(),
  gates: z.record(z.string(), z.boolean()),
  caseFailures: z.array(CaseFailureSchema),
}).strict();

export type PassageRewriteEvaluation = z.infer<typeof PassageRewriteEvaluationSchema>;

export function passageEvidenceGate(
  evaluationInput: z.input<typeof PassageRewriteEvaluationSchema>,
  evaluatedAt: string,
): z.infer<typeof PassageEvidenceGateSchema> {
  const evaluation = PassageRewriteEvaluationSchema.parse(evaluationInput);
  return PassageEvidenceGateSchema.parse({
    gateId: evaluation.gateId,
    evaluationId: evaluation.evaluationId,
    decision: evaluation.decision,
    evaluatedAt,
  });
}

export function evaluatePassageRewrites(input: {
  gate: z.input<typeof PassageRewriteGateSchema>;
  assessments: z.input<typeof PassageRewriteAssessmentSchema>[];
}): PassageRewriteEvaluation {
  const gate = PassageRewriteGateSchema.parse(input.gate);
  const assessments = input.assessments.map((assessment) =>
    PassageRewriteAssessmentSchema.parse(assessment)
  );
  assertUniqueCases(assessments);

  const factualPreservation = preservationRate(
    assessments.map(({ factualPreservation }) => factualPreservation),
  );
  const terminologyPreservation = preservationRate(
    assessments.map(({ terminologyPreservation }) => terminologyPreservation),
  );
  const voicePreservation = preservationRate(
    assessments.map(({ voicePreservation }) => voicePreservation),
  );
  const preservationAssessmentsComplete = assessments.every(
    (assessment) =>
      assessment.factualPreservation !== "unassessed" &&
      assessment.terminologyPreservation !== "unassessed" &&
      assessment.voicePreservation !== "unassessed",
  );
  const caseFailures = assessments.flatMap((assessment) => {
    const dimensions = [
      ...(assessment.factualPreservation === "failed" ? ["facts" as const] : []),
      ...(assessment.terminologyPreservation === "failed"
        ? ["terminology" as const]
        : []),
      ...(assessment.voicePreservation === "failed" ? ["voice" as const] : []),
    ];
    return dimensions.length === 0
      ? []
      : [{
        caseId: assessment.caseId,
        proposalId: assessment.proposalId,
        dimensions,
        notes: assessment.notes,
      }];
  });
  const metrics = {
    factualPreservation,
    terminologyPreservation,
    voicePreservation,
    usefulEditYield: ratio(
      assessments.filter(({ usefulEdit }) => usefulEdit).length,
      assessments.length,
    ),
    medianReviewMilliseconds: median(
      assessments.map(({ reviewMilliseconds }) => reviewMilliseconds),
    ),
  };
  const gates = {
    sampleSize: assessments.length >= gate.minimumCases,
    factualPreservation:
      factualPreservation >= gate.minimumFactualPreservation,
    terminologyPreservation:
      terminologyPreservation >= gate.minimumTerminologyPreservation,
    voicePreservation: voicePreservation >= gate.minimumVoicePreservation,
    usefulEditYield: metrics.usefulEditYield >= gate.minimumUsefulEditYield,
    reviewTime:
      metrics.medianReviewMilliseconds <= gate.maximumMedianReviewMilliseconds,
    preservationAssessed:
      !gate.requireAllPreservationAssessed || preservationAssessmentsComplete,
    criticalFailures: gate.allowCriticalFailures || caseFailures.every(
      ({ dimensions }) => !dimensions.includes("facts") && !dimensions.includes("terminology"),
    ),
  };
  const body = {
    schemaVersion: 1 as const,
    recordType: "passage-rewrite-evaluation" as const,
    gateId: gate.gateId,
    decision: Object.values(gates).every(Boolean)
      ? "adopt" as const
      : "gather-more-evidence" as const,
    sample: { cases: assessments.length, preservationAssessmentsComplete },
    metrics,
    gates,
    caseFailures,
  };
  const digest = sha256(canonicalJson(body)).slice("sha256:".length);
  return PassageRewriteEvaluationSchema.parse({
    ...body,
    evaluationId: `passage-evaluation:v1:${digest}`,
  });
}

type Assessment = z.infer<typeof PassageRewriteAssessmentSchema>;

function assertUniqueCases(assessments: Assessment[]): void {
  const caseIds = assessments.map(({ caseId }) => caseId);
  if (new Set(caseIds).size !== caseIds.length) {
    throw new Error("passage rewrite assessments must use unique case IDs");
  }
}

function preservationRate(values: z.infer<typeof PreservationResultSchema>[]): number {
  const assessed = values.filter((value) => value !== "unassessed");
  return ratio(assessed.filter((value) => value === "preserved").length, assessed.length);
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  const lower = sorted[middle - 1] ?? upper;
  return sorted.length % 2 === 0 ? (lower + upper) / 2 : upper;
}
