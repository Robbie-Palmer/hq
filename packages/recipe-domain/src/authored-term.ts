import { z } from "zod";

export const AUTHORED_TERM_KINDS = ["ingredient", "equipment"] as const;
export const AUTHORED_TERM_RESOLUTION_STATUSES = [
  "unresolved",
  "resolved",
  "deferred",
  "rejected",
] as const;
export const TERM_RESOLUTION_ACTIONS = [
  "alias",
  "new_canonical",
  "merge",
  "defer",
  "reject",
  "reversal",
] as const;

export const AuthoredTermKindSchema = z.enum(AUTHORED_TERM_KINDS);
export const AuthoredTermResolutionStatusSchema = z.enum(
  AUTHORED_TERM_RESOLUTION_STATUSES,
);

export const AuthoredTermCandidateSchema = z.object({
  slug: z.string().min(1).max(200),
  score: z.number().min(0).max(1),
});

export const AuthoredTermSourceContextSchema = z
  .object({
    flow: z.enum(["recipe", "pantry", "diet", "equipment"]),
    resourceId: z.string().min(1).max(200).optional(),
    field: z.string().min(1).max(100).optional(),
  })
  .strict();

export const AuthoredTermProvenanceSchema = z
  .object({
    kind: z.enum(["user", "import"]),
    actorUserId: z.string().min(1).max(128),
    importJobId: z.uuid().optional(),
  })
  .strict();

export const TermResolutionActionSchema = z.enum(TERM_RESOLUTION_ACTIONS);

const TermResolutionCommandBaseSchema = z.object({
  idempotencyKey: z.uuid().max(36),
  rationale: z.string().trim().min(1).max(2_000),
  evidence: z.array(z.string().trim().min(1).max(1_000)).max(20).default([]),
  expectedRegistryVersion: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER)
    .meta({ format: "int64" })
    .optional(),
  localeReview: z.boolean().default(false),
  collisionReview: z.boolean().default(false),
});

export const TermResolutionCommandSchema = z.discriminatedUnion("action", [
  TermResolutionCommandBaseSchema.extend({
    action: z.literal("alias"),
    targetSlug: z.string().trim().min(1).max(200),
  }).strict(),
  TermResolutionCommandBaseSchema.extend({
    action: z.literal("new_canonical"),
    targetSlug: z.string().trim().min(1).max(200),
    canonicalName: z.string().trim().min(1).max(200),
  }).strict(),
  TermResolutionCommandBaseSchema.extend({
    action: z.literal("merge"),
    targetSlug: z.string().trim().min(1).max(200),
  }).strict(),
  TermResolutionCommandBaseSchema.extend({
    action: z.literal("defer"),
  }).strict(),
  TermResolutionCommandBaseSchema.extend({
    action: z.literal("reject"),
  }).strict(),
  TermResolutionCommandBaseSchema.extend({
    action: z.literal("reversal"),
    reversesDecisionId: z.uuid().max(36),
  }).strict(),
]);

export type AuthoredTermKind = z.infer<typeof AuthoredTermKindSchema>;
export type AuthoredTermResolutionStatus = z.infer<
  typeof AuthoredTermResolutionStatusSchema
>;
export type AuthoredTermCandidate = z.infer<
  typeof AuthoredTermCandidateSchema
>;
export type AuthoredTermSourceContext = z.infer<
  typeof AuthoredTermSourceContextSchema
>;
export type AuthoredTermProvenance = z.infer<
  typeof AuthoredTermProvenanceSchema
>;
export type TermResolutionAction = z.infer<typeof TermResolutionActionSchema>;
export type TermResolutionCommand = z.infer<
  typeof TermResolutionCommandSchema
>;

export type TermReviewQueueItem = {
  kind: AuthoredTermKind;
  normalizedText: string;
  locale: string;
  submissionCount: number;
  tenantCount: number;
  lastSeenAt: Date;
};

/**
 * Keep user text readable while producing one stable comparison value. Unlike
 * a URL slug, this retains non-ASCII letters and punctuation that may carry
 * meaning in an ingredient or equipment name.
 */
export function normalizeAuthoredTerm(value: string, _locale = "und"): string {
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  return normalized.toLowerCase();
}

export function rankTermReviewQueue<T extends TermReviewQueueItem>(
  items: readonly T[],
): T[] {
  return [...items].sort(
    (left, right) =>
      right.submissionCount - left.submissionCount ||
      right.tenantCount - left.tenantCount ||
      right.lastSeenAt.getTime() - left.lastSeenAt.getTime() ||
      left.kind.localeCompare(right.kind) ||
      left.normalizedText.localeCompare(right.normalizedText) ||
      left.locale.localeCompare(right.locale),
  );
}

export function termNeedsLocaleReview(
  locale: string,
  observedLocales: readonly string[],
): boolean {
  return (
    locale === "und" ||
    new Set(observedLocales.filter((value) => value !== "und")).size > 1
  );
}

export function termHasCandidateCollision(
  candidateSlugs: readonly string[],
): boolean {
  return new Set(candidateSlugs.filter(Boolean)).size > 1;
}

export function authoredTermObservationKey(input: {
  locale: string;
  sourceContext: AuthoredTermSourceContext;
  provenance: AuthoredTermProvenance;
}): string {
  const parts = [
    input.locale,
    input.sourceContext.flow,
    input.sourceContext.resourceId ?? "",
    input.sourceContext.field ?? "",
    input.provenance.kind,
    input.provenance.actorUserId,
    input.provenance.importJobId ?? "",
  ];
  return parts
    .map((value) => value.replaceAll("%", "%25").replaceAll("|", "%7C"))
    .join("|");
}
