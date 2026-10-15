import { z } from "zod";
import {
  IdentifierSchema,
  ProvenanceSchema,
  selectLatestSourceRevisions,
  TimePeriodSchema,
} from "./model";

export const ObservationStateSchema = z.enum([
  "available",
  "partial",
  "unavailable",
  "uncollected",
  "private",
  "withheld",
  "not-applicable",
]);
export type ObservationState = z.infer<typeof ObservationStateSchema>;

export const MetricDefinitionSchema = z
  .object({
    id: IdentifierSchema,
    version: z.string().trim().min(1),
    name: z.string().trim().min(1),
    description: z.string().trim().min(1),
    unit: IdentifierSchema,
    aggregation: z.enum(["count", "sum", "ratio", "distinct-count", "last"]),
    allowedDimensions: z.array(IdentifierSchema),
    provenance: ProvenanceSchema,
  })
  .strict();
export type MetricDefinition = z.infer<typeof MetricDefinitionSchema>;

export const MetricObservationSchema = z
  .object({
    id: IdentifierSchema,
    projectId: IdentifierSchema,
    environmentId: IdentifierSchema.nullable(),
    metricDefinitionId: IdentifierSchema,
    metricDefinitionVersion: z.string().trim().min(1),
    period: TimePeriodSchema,
    dimensions: z.record(IdentifierSchema, z.string().trim().min(1)),
    state: ObservationStateSchema,
    value: z.number().finite().nullable(),
    numerator: z.number().finite().nonnegative().nullable(),
    denominator: z.number().finite().nonnegative().nullable(),
    coverage: z.number().finite().min(0).max(1).nullable(),
    limitation: z.string().trim().min(1).nullable(),
    provenance: ProvenanceSchema,
  })
  .strict()
  .superRefine((observation, context) => {
    const numeric =
      observation.state === "available" || observation.state === "partial";
    if (numeric !== (observation.value !== null)) {
      context.addIssue({
        code: "custom",
        message: "Only available or partial observations can carry a value",
        path: ["value"],
      });
    }
    if (observation.state === "partial" && observation.limitation === null) {
      context.addIssue({
        code: "custom",
        message: "A partial observation must state its limitation",
        path: ["limitation"],
      });
    }
    const hasRatioParts =
      observation.numerator !== null || observation.denominator !== null;
    if (
      hasRatioParts &&
      (observation.numerator === null || observation.denominator === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "A ratio observation needs both numerator and denominator",
        path: ["denominator"],
      });
    }
    if (observation.denominator === 0 && observation.value !== null) {
      context.addIssue({
        code: "custom",
        message: "A zero-denominator observation cannot carry a value",
        path: ["value"],
      });
    }
  });
export type MetricObservation = z.infer<typeof MetricObservationSchema>;

const DerivedInputSchema = z
  .object({
    metricDefinitionId: IdentifierSchema,
    metricDefinitionVersion: z.string().trim().min(1),
    alias: IdentifierSchema,
  })
  .strict();

export const DerivedSeriesDefinitionSchema = z
  .object({
    id: IdentifierSchema,
    version: z.string().trim().min(1),
    outputMetricDefinitionId: IdentifierSchema,
    inputs: z.array(DerivedInputSchema).min(1),
    expression: z.string().trim().min(1),
    provenance: ProvenanceSchema,
  })
  .strict();
export type DerivedSeriesDefinition = z.infer<
  typeof DerivedSeriesDefinitionSchema
>;

export function projectMetricSeries(
  observations: readonly MetricObservation[],
  metricDefinitionId: string,
  projectId: string,
  asOf?: string,
): readonly MetricObservation[] {
  const parsed = observations.map((observation) =>
    MetricObservationSchema.parse(observation),
  );
  return selectLatestSourceRevisions(parsed, asOf)
    .filter(
      (observation) =>
        observation.metricDefinitionId === metricDefinitionId &&
        observation.projectId === projectId,
    )
    .sort(
      (left, right) =>
        left.period.startsAt.localeCompare(right.period.startsAt) ||
        left.id.localeCompare(right.id),
    );
}
