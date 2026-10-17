import { z } from "zod";
import { CurrencySchema } from "./currency";

export const DecisionLineageKindSchema = z.enum([
  "financial-fact",
  "rate",
  "tax-rule",
  "assumption",
]);
export type DecisionLineageKind = z.infer<typeof DecisionLineageKindSchema>;

export const DecisionLineageItemSchema = z.object({
  id: z.string().min(1),
  kind: DecisionLineageKindSchema,
  label: z.string().trim().min(1),
  value: z.string().trim().min(1),
  source: z.string().trim().min(1),
  validAt: z.iso.date(),
  version: z.string().trim().min(1).optional(),
});
export type DecisionLineageItem = z.infer<typeof DecisionLineageItemSchema>;

export const DecisionForecastCheckpointSchema = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1),
  dueDate: z.iso.date(),
  expectedAmount: z.number(),
  currency: CurrencySchema,
});
export type DecisionForecastCheckpoint = z.infer<
  typeof DecisionForecastCheckpointSchema
>;

const DecisionForecastSnapshotBaseSchema = z.object({
  capturedAt: z.iso.datetime({ offset: true }),
  calculationVersion: z.string().trim().min(1),
  lineage: z.array(DecisionLineageItemSchema).min(4),
  checkpoints: z.array(DecisionForecastCheckpointSchema).min(1),
});

function validateForecastLineage(
  forecast: { lineage: DecisionLineageItem[] },
  context: z.core.$RefinementCtx,
) {
  for (const kind of DecisionLineageKindSchema.options) {
    if (!forecast.lineage.some((item) => item.kind === kind)) {
      context.addIssue({
        code: "custom",
        message: `Forecast lineage must include a ${kind}`,
        path: ["lineage"],
      });
    }
  }
}

export const DecisionForecastSnapshotSchema =
  DecisionForecastSnapshotBaseSchema.superRefine(validateForecastLineage);
export type DecisionForecastSnapshot = z.infer<
  typeof DecisionForecastSnapshotSchema
>;

export const DecisionDivergenceSourceSchema = z.object({
  kind: z.enum(["changed-assumption", "changed-reality"]),
  label: z.string().trim().min(1),
  impactAmount: z.number(),
});
export type DecisionDivergenceSource = z.infer<
  typeof DecisionDivergenceSourceSchema
>;

export const DecisionObservationSchema = z.object({
  id: z.string().min(1),
  checkpointId: z.string().min(1),
  observedAt: z.iso.datetime({ offset: true }),
  actualAmount: z.number(),
  note: z.string().trim().min(1),
  divergenceSources: z.array(DecisionDivergenceSourceSchema),
});
export type DecisionObservation = z.infer<typeof DecisionObservationSchema>;

export const DecisionInterpretationSchema = z.object({
  id: z.string().min(1),
  createdAt: z.iso.datetime({ offset: true }),
  reason: z.string().trim().min(1),
  revisedRationale: z.string().trim().min(1),
  assumptionChanges: z
    .array(
      z.object({
        label: z.string().trim().min(1),
        previousValue: z.string().trim().min(1),
        revisedValue: z.string().trim().min(1),
      }),
    )
    .min(1),
});
export type DecisionInterpretation = z.infer<
  typeof DecisionInterpretationSchema
>;

export const TrackedFinancialDecisionRecordSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("tracked"),
  question: z.string().trim().min(1),
  decisionDate: z.iso.date(),
  selectedScenario: z.object({
    id: z.string().min(1),
    label: z.string().trim().min(1),
  }),
  rationale: z.string().trim().min(1),
  action: z.string().trim().min(1),
  forecast: DecisionForecastSnapshotSchema,
  observations: z.array(DecisionObservationSchema).default([]),
  interpretations: z.array(DecisionInterpretationSchema).default([]),
});
export type TrackedFinancialDecisionRecord = z.infer<
  typeof TrackedFinancialDecisionRecordSchema
>;

export const LegacyMortgageDecisionRecordSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("mortgage"),
  title: z.string().trim().min(1),
  scenarioId: z.string().min(1),
  recordedAt: z.iso.date(),
  status: z.literal("recorded"),
});

export const FinancialDecisionRecordSchema = z.discriminatedUnion("kind", [
  LegacyMortgageDecisionRecordSchema,
  TrackedFinancialDecisionRecordSchema,
]);
export type FinancialDecisionRecord = z.infer<
  typeof FinancialDecisionRecordSchema
>;

export const CreateDecisionRecordInputSchema =
  TrackedFinancialDecisionRecordSchema.omit({
    id: true,
    kind: true,
    observations: true,
    interpretations: true,
    forecast: true,
  }).extend({
    forecast: DecisionForecastSnapshotBaseSchema.omit({
      capturedAt: true,
    }).superRefine(validateForecastLineage),
  });
export type CreateDecisionRecordInput = z.input<
  typeof CreateDecisionRecordInputSchema
>;

export const RecordDecisionObservationInputSchema = z.object({
  decisionId: z.string().min(1),
  checkpointId: z.string().min(1),
  actualAmount: z.number(),
  note: z.string().trim().min(1),
  divergenceSources: z.array(DecisionDivergenceSourceSchema),
});
export type RecordDecisionObservationInput = z.input<
  typeof RecordDecisionObservationInputSchema
>;

export const AddDecisionInterpretationInputSchema = z.object({
  decisionId: z.string().min(1),
  reason: z.string().trim().min(1),
  revisedRationale: z.string().trim().min(1),
  assumptionChanges: DecisionInterpretationSchema.shape.assumptionChanges,
});
export type AddDecisionInterpretationInput = z.input<
  typeof AddDecisionInterpretationInputSchema
>;

export type DecisionReconciliation = {
  checkpoint: DecisionForecastCheckpoint;
  observation: DecisionObservation | null;
  variance: number | null;
  largestDivergenceSources: DecisionDivergenceSource[];
};

export function reconcileDecisionRecord(
  decision: TrackedFinancialDecisionRecord,
): DecisionReconciliation[] {
  const observations = new Map(
    decision.observations.map((observation) => [
      observation.checkpointId,
      observation,
    ]),
  );
  return decision.forecast.checkpoints.map((checkpoint) => {
    const observation = observations.get(checkpoint.id) ?? null;
    return {
      checkpoint,
      observation,
      variance:
        observation == null
          ? null
          : observation.actualAmount - checkpoint.expectedAmount,
      largestDivergenceSources:
        observation?.divergenceSources
          .toSorted(
            (left, right) =>
              Math.abs(right.impactAmount) - Math.abs(left.impactAmount),
          )
          .slice(0, 3) ?? [],
    };
  });
}
