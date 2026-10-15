import { z } from "zod";

export const PROJECT_ECONOMICS_CONTRACT_VERSION = 1 as const;

export const IdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9][a-z0-9._:/-]*$/);

export const TimestampSchema = z.iso.datetime();

export const TimePeriodSchema = z
  .object({
    startsAt: TimestampSchema,
    endsAt: TimestampSchema,
  })
  .strict()
  .refine((period) => period.startsAt < period.endsAt, {
    message: "A time period must end after it starts",
    path: ["endsAt"],
  });
export type TimePeriod = z.infer<typeof TimePeriodSchema>;

export const EffectivePeriodSchema = z
  .object({
    startsAt: TimestampSchema,
    endsAt: TimestampSchema.nullable(),
  })
  .strict()
  .refine(
    (period) => period.endsAt === null || period.startsAt < period.endsAt,
    {
      message: "An effective period must end after it starts",
      path: ["endsAt"],
    },
  );
export type EffectivePeriod = z.infer<typeof EffectivePeriodSchema>;

export const ProjectSchema = z
  .object({
    id: IdentifierSchema,
    name: z.string().trim().min(1),
    visibility: z.enum(["public", "private"]),
  })
  .strict();
export type Project = z.infer<typeof ProjectSchema>;

export const EnvironmentSchema = z
  .object({
    id: IdentifierSchema,
    projectId: IdentifierSchema,
    name: z.string().trim().min(1),
    kind: z.enum(["development", "preview", "staging", "production"]),
  })
  .strict();
export type Environment = z.infer<typeof EnvironmentSchema>;

export const ProviderSchema = z
  .object({
    id: IdentifierSchema,
    name: z.string().trim().min(1),
  })
  .strict();
export type Provider = z.infer<typeof ProviderSchema>;

export const ProviderAccountSchema = z
  .object({
    id: IdentifierSchema,
    providerId: IdentifierSchema,
    label: z.string().trim().min(1),
    visibility: z.enum(["private", "restricted"]),
  })
  .strict();
export type ProviderAccount = z.infer<typeof ProviderAccountSchema>;

export const BillingPeriodSchema = z
  .object({
    id: IdentifierSchema,
    providerAccountId: IdentifierSchema,
    period: TimePeriodSchema,
    status: z.enum(["open", "provisional", "final", "corrected"]),
    issuedAt: TimestampSchema.nullable(),
  })
  .strict();
export type BillingPeriod = z.infer<typeof BillingPeriodSchema>;

export const SourceIdentitySchema = z
  .object({
    providerId: IdentifierSchema,
    accountId: IdentifierSchema.nullable(),
    sourceType: IdentifierSchema,
    externalId: z.string().trim().min(1).max(500),
  })
  .strict();
export type SourceIdentity = z.infer<typeof SourceIdentitySchema>;

export const SourceRevisionSchema = z
  .object({
    identity: SourceIdentitySchema,
    revision: z.string().trim().min(1).max(500),
    observedAt: TimestampSchema,
    ingestedAt: TimestampSchema,
    ingestionRunId: IdentifierSchema,
  })
  .strict();
export type SourceRevision = z.infer<typeof SourceRevisionSchema>;

export const MethodRevisionSchema = z
  .object({
    id: IdentifierSchema,
    version: z.string().trim().min(1).max(100),
  })
  .strict();
export type MethodRevision = z.infer<typeof MethodRevisionSchema>;

export const ProvenanceSchema = z
  .object({
    source: SourceRevisionSchema,
    method: MethodRevisionSchema,
  })
  .strict();
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const IngestionRunSchema = z
  .object({
    id: IdentifierSchema,
    providerId: IdentifierSchema,
    collector: MethodRevisionSchema,
    startedAt: TimestampSchema,
    completedAt: TimestampSchema.nullable(),
    status: z.enum(["running", "succeeded", "partial", "failed"]),
    sourceRevision: z.string().trim().min(1).nullable(),
  })
  .strict()
  .superRefine((run, context) => {
    if (run.status === "running" && run.completedAt !== null) {
      context.addIssue({
        code: "custom",
        message: "A running ingestion cannot have a completion time",
        path: ["completedAt"],
      });
    }
    if (run.status !== "running" && run.completedAt === null) {
      context.addIssue({
        code: "custom",
        message: "A finished ingestion needs a completion time",
        path: ["completedAt"],
      });
    }
    if (run.completedAt !== null && run.completedAt < run.startedAt) {
      context.addIssue({
        code: "custom",
        message: "An ingestion cannot complete before it starts",
        path: ["completedAt"],
      });
    }
  });
export type IngestionRun = z.infer<typeof IngestionRunSchema>;

export const ProjectPlatformAdoptionSchema = z
  .object({
    id: IdentifierSchema,
    projectId: IdentifierSchema,
    platformId: IdentifierSchema,
    state: z.enum(["adopted", "not-adopted", "excluded"]),
    effectivePeriod: EffectivePeriodSchema,
    rationale: z.string().trim().min(1),
    provenance: ProvenanceSchema,
  })
  .strict();
export type ProjectPlatformAdoption = z.infer<
  typeof ProjectPlatformAdoptionSchema
>;

export function sourceIdentityKey(identity: SourceIdentity): string {
  const source = SourceIdentitySchema.parse(identity);
  return JSON.stringify([
    source.providerId,
    source.accountId,
    source.sourceType,
    source.externalId,
  ]);
}

export function sourceRevisionKey(source: SourceRevision): string {
  const revision = SourceRevisionSchema.parse(source);
  return JSON.stringify([sourceIdentityKey(revision.identity), revision.revision]);
}

export interface ProvenancedRecord {
  readonly provenance: Provenance;
}

const compareSourceRevision = (
  left: SourceRevision,
  right: SourceRevision,
): number =>
  left.observedAt.localeCompare(right.observedAt) ||
  left.ingestedAt.localeCompare(right.ingestedAt) ||
  left.revision.localeCompare(right.revision);

export function selectLatestSourceRevisions<T extends ProvenancedRecord>(
  records: readonly T[],
  asOf?: string,
): readonly T[] {
  const normalizedAsOf = asOf === undefined ? undefined : TimestampSchema.parse(asOf);
  const latest = new Map<string, T>();
  for (const record of records) {
    const source = SourceRevisionSchema.parse(record.provenance.source);
    if (normalizedAsOf !== undefined && source.ingestedAt > normalizedAsOf) continue;
    const key = sourceIdentityKey(source.identity);
    const current = latest.get(key);
    if (
      current === undefined ||
      compareSourceRevision(current.provenance.source, source) < 0
    ) {
      latest.set(key, record);
    }
  }
  return [...latest.values()].sort((left, right) =>
    sourceIdentityKey(left.provenance.source.identity).localeCompare(
      sourceIdentityKey(right.provenance.source.identity),
    ),
  );
}

export interface EffectiveRecord {
  readonly effectivePeriod: EffectivePeriod;
}

export function resolveEffectiveRecord<T extends EffectiveRecord>(
  records: readonly T[],
  at: string,
): T | undefined {
  const timestamp = TimestampSchema.parse(at);
  const matches = records.filter(
    ({ effectivePeriod }) =>
      effectivePeriod.startsAt <= timestamp &&
      (effectivePeriod.endsAt === null || timestamp < effectivePeriod.endsAt),
  );
  if (matches.length > 1) {
    throw new Error(`Multiple records are effective at ${timestamp}`);
  }
  return matches[0];
}
