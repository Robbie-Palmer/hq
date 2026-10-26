import { z } from "zod";

import { canonicalJson } from "./canonical-json";
import {
  compareSuggestions,
  sha256,
  type SourceConflict,
  type SourceVerification,
  type Suggestion,
  SuggestionIdSchema,
  SuggestionSchema,
  Utf8SpanSchema,
  verifySuggestionSource,
  WRITING_EDITOR_SCHEMA_VERSION,
} from "./suggestions";

const PROPOSAL_ID_PATTERN = /^proposal:v1:[a-f0-9]{64}$/;

export const ProposalIdSchema = z.string().regex(PROPOSAL_ID_PATTERN);

export const ContextCitationSchema = z.object({
  kind: z.enum(["project", "adr", "terminology", "evidence"]),
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  href: z.string().trim().min(1).optional(),
  freshness: z.enum(["fresh", "stale", "missing", "not-applicable", "unassessed"]),
  observedAt: z.iso.datetime().optional(),
}).strict();

export const ContextWarningSchema = z.object({
  code: z.enum([
    "fact-check-required",
    "missing-context",
    "stale-evidence",
    "terminology-context-missing",
    "unassessed-evidence",
  ]),
  subjectId: z.string().trim().min(1).optional(),
  message: z.string().trim().min(1),
}).strict();

export const PassageEvidenceGateSchema = z.object({
  gateId: z.string().trim().min(1),
  evaluationId: z.string().regex(/^passage-evaluation:v1:[a-f0-9]{64}$/),
  decision: z.enum(["adopt", "reject", "gather-more-evidence"]),
  evaluatedAt: z.iso.datetime(),
}).strict();

export const PassageReviewSchema = z.object({
  kind: z.literal("passage-rewrite"),
  passage: Utf8SpanSchema,
  proposedText: z.string(),
  reason: z.string().trim().min(1),
  context: z.object({
    retrievedAt: z.iso.datetime(),
    graphContentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    citations: z.array(ContextCitationSchema).min(1),
    warnings: z.array(ContextWarningSchema),
  }).strict(),
  authority: z.object({
    factChecking: z.literal("author"),
    publication: z.literal("author"),
  }).strict(),
  evidenceGate: PassageEvidenceGateSchema,
  defaultLoopEligible: z.boolean(),
}).strict().superRefine((review, context) => {
  const shouldBeEligible = review.evidenceGate.decision === "adopt";
  if (review.defaultLoopEligible !== shouldBeEligible) {
    context.addIssue({
      code: "custom",
      message: "default-loop eligibility must match the evidence-gate decision",
      path: ["defaultLoopEligible"],
    });
  }
});

export type PassageReview = z.infer<typeof PassageReviewSchema>;

const ProposalShapeSchema = z.object({
  schemaVersion: z.literal(WRITING_EDITOR_SCHEMA_VERSION),
  recordType: z.literal("writing-proposal"),
  proposalId: ProposalIdSchema,
  migratedFromProposalId: ProposalIdSchema.optional(),
  suggestionIds: z.array(SuggestionIdSchema).min(1),
  suggestions: z.array(SuggestionSchema).min(1),
  review: PassageReviewSchema.optional(),
}).strict();

export type Proposal = z.infer<typeof ProposalShapeSchema>;

export const ProposalSchema = ProposalShapeSchema.superRefine(
  (proposal, context) => {
    const expectedSuggestions = [...proposal.suggestions].sort(compareSuggestions);
    const expectedIds = expectedSuggestions.map(({ suggestionId }) => suggestionId);

    if (new Set(expectedIds).size !== expectedIds.length) {
      context.addIssue({
        code: "custom",
        message: "a proposal cannot contain duplicate suggestions",
        path: ["suggestions"],
      });
    }
    if (
      proposal.suggestionIds.length !== expectedIds.length ||
      proposal.suggestionIds.some((id, index) => id !== expectedIds[index])
    ) {
      context.addIssue({
        code: "custom",
        message: "suggestionIds must match suggestions in canonical order",
        path: ["suggestionIds"],
      });
    }
    if (
      proposal.suggestions.some((suggestion, index) =>
        suggestion.suggestionId !== expectedSuggestions[index]?.suggestionId
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "suggestions must use canonical order",
        path: ["suggestions"],
      });
    }

    const [first] = expectedSuggestions;
    if (
      first &&
      expectedSuggestions.some((suggestion) =>
        suggestion.source.documentId !== first.source.documentId ||
        suggestion.source.revision !== first.source.revision ||
        suggestion.source.contentHash !== first.source.contentHash
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "all proposal suggestions must reference the same source revision",
        path: ["suggestions"],
      });
    }

    const expectedProposalId = proposalId(proposal.schemaVersion, expectedIds);
    if (proposal.proposalId !== expectedProposalId) {
      context.addIssue({
        code: "custom",
        message: `proposalId does not match proposal members; expected ${expectedProposalId}`,
        path: ["proposalId"],
      });
    }
    if (proposal.migratedFromProposalId === proposal.proposalId) {
      context.addIssue({
        code: "custom",
        message: "a migrated proposal must reference a different proposal ID",
        path: ["migratedFromProposalId"],
      });
    }

    if (proposal.review) {
      validatePassageReview(proposal, context);
    }
  },
);

export function proposalId(
  schemaVersion: typeof WRITING_EDITOR_SCHEMA_VERSION,
  suggestionIds: string[],
): string {
  const digest = sha256(canonicalJson({ schemaVersion, suggestionIds })).slice(
    "sha256:".length,
  );
  return `proposal:v1:${digest}`;
}

export function createProposal(
  suggestions: Suggestion[],
  options: {
    migratedFromProposalId?: string;
    review?: z.input<typeof PassageReviewSchema>;
  } = {},
): Proposal {
  const sorted = suggestions
    .map((suggestion) => SuggestionSchema.parse(suggestion))
    .sort(compareSuggestions);
  const suggestionIds = sorted.map(({ suggestionId }) => suggestionId);
  return ProposalSchema.parse({
    schemaVersion: WRITING_EDITOR_SCHEMA_VERSION,
    recordType: "writing-proposal",
    proposalId: proposalId(WRITING_EDITOR_SCHEMA_VERSION, suggestionIds),
    ...options,
    suggestionIds,
    suggestions: sorted,
  });
}

function validatePassageReview(
  proposal: z.infer<typeof ProposalShapeSchema>,
  context: z.RefinementCtx,
): void {
  const review = proposal.review;
  if (!review) return;
  const { startByte, endByte } = review.passage;
  const insidePassage = proposal.suggestions.every(
    (suggestion) =>
      suggestion.span.startByte >= startByte && suggestion.span.endByte <= endByte,
  );
  if (!insidePassage) {
    context.addIssue({
      code: "custom",
      message: "passage-rewrite suggestions must stay inside the selected passage",
      path: ["suggestions"],
    });
    return;
  }
  if (applySuggestionsToPassage(review, proposal.suggestions) !== review.proposedText) {
    context.addIssue({
      code: "custom",
      message: "passage-rewrite suggestions must recreate proposedText byte for byte",
      path: ["review", "proposedText"],
    });
  }
}

function applySuggestionsToPassage(
  review: PassageReview,
  suggestions: Suggestion[],
): string {
  const passageStart = review.passage.startByte;
  const edits = [...suggestions].sort(
    (left, right) =>
      right.span.startByte - left.span.startByte ||
      right.span.endByte - left.span.endByte,
  );
  let result = Buffer.from(review.passage.sourceText, "utf8");
  for (const suggestion of edits) {
    const start = suggestion.span.startByte - passageStart;
    const end = suggestion.span.endByte - passageStart;
    result = Buffer.concat([
      result.subarray(0, start),
      Buffer.from(suggestion.replacement, "utf8"),
      result.subarray(end),
    ]);
  }
  return result.toString("utf8");
}

export type PassageReviewConflict =
  | { kind: "passage-span-out-of-bounds"; proposalId: string }
  | { kind: "passage-span-not-on-utf8-boundary"; proposalId: string }
  | { kind: "passage-source-text-mismatch"; proposalId: string };

export type PassageReviewVerification =
  | { ok: true }
  | { ok: false; conflicts: PassageReviewConflict[] };

export function verifyPassageReviewSource(
  proposal: Proposal,
  source: string,
): PassageReviewVerification {
  const review = proposal.review;
  if (!review) return { ok: true };
  const bytes = Buffer.from(source, "utf8");
  const { startByte, endByte, sourceText } = review.passage;
  if (endByte > bytes.byteLength) {
    return {
      ok: false,
      conflicts: [{ kind: "passage-span-out-of-bounds", proposalId: proposal.proposalId }],
    };
  }
  if (!isUtf8Boundary(bytes, startByte) || !isUtf8Boundary(bytes, endByte)) {
    return {
      ok: false,
      conflicts: [{
        kind: "passage-span-not-on-utf8-boundary",
        proposalId: proposal.proposalId,
      }],
    };
  }
  if (!bytes.subarray(startByte, endByte).equals(Buffer.from(sourceText, "utf8"))) {
    return {
      ok: false,
      conflicts: [{ kind: "passage-source-text-mismatch", proposalId: proposal.proposalId }],
    };
  }
  return { ok: true };
}

function isUtf8Boundary(bytes: Uint8Array, offset: number): boolean {
  const byte = bytes[offset];
  return byte === undefined || (byte & 0xc0) !== 0x80;
}

function conflictKey(conflict: SourceConflict): string {
  if (conflict.kind === "source-hash-mismatch") {
    return `${conflict.kind}:${conflict.expected}:${conflict.actual}`;
  }
  return `${conflict.kind}:${conflict.suggestionId}`;
}

export function verifyProposalSource(
  proposal: Proposal,
  source: string,
): SourceVerification {
  const conflicts = proposal.suggestions.flatMap((suggestion) => {
    const verification = verifySuggestionSource(suggestion, source);
    return verification.ok ? [] : verification.conflicts;
  });
  if (conflicts.length === 0) return { ok: true };

  const unique = new Map(
    conflicts.map((conflict) => [conflictKey(conflict), conflict]),
  );
  return { ok: false, conflicts: [...unique.values()] };
}
