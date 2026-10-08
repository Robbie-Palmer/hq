import { z } from "zod";

export const AUTHORED_TERM_KINDS = ["ingredient", "equipment"] as const;
export const AUTHORED_TERM_RESOLUTION_STATUSES = [
  "unresolved",
  "resolved",
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

/**
 * Keep user text readable while producing one stable comparison value. Unlike
 * a URL slug, this retains non-ASCII letters and punctuation that may carry
 * meaning in an ingredient or equipment name.
 */
export function normalizeAuthoredTerm(value: string, _locale = "und"): string {
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  return normalized.toLowerCase();
}
