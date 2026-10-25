import { z } from "zod";

import { canonicalJson } from "./canonical-json";
import { DecisionSchema, type Decision } from "./decisions";
import { type ReviewRecords, ReviewRecordsSchema } from "./review";
import { ContentHashSchema, sha256 } from "./suggestions";

const ReviewSessionTimingSchema = z.object({
  startedAt: z.iso.datetime(),
  findingsReviewedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  elapsedMilliseconds: z.number().int().nonnegative(),
}).strict().superRefine((timing, context) => {
  const startedAt = Date.parse(timing.startedAt);
  const findingsReviewedAt = Date.parse(timing.findingsReviewedAt);
  const completedAt = Date.parse(timing.completedAt);
  if (findingsReviewedAt < startedAt || findingsReviewedAt > completedAt) {
    context.addIssue({
      code: "custom",
      message: "findingsReviewedAt must fall within the review session",
      path: ["findingsReviewedAt"],
    });
  }
  if (timing.elapsedMilliseconds !== completedAt - startedAt) {
    context.addIssue({
      code: "custom",
      message: "elapsedMilliseconds must equal the review session interval",
      path: ["elapsedMilliseconds"],
    });
  }
});

export const ReviewReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  recordType: z.literal("writing-review-receipt"),
  documentId: z.string().trim().min(1),
  revision: z.string().trim().min(1),
  recordsHash: ContentHashSchema,
  decisionsHash: ContentHashSchema,
  sourceBeforeHash: ContentHashSchema,
  sourceAfterHash: ContentHashSchema,
  sourceChanged: z.boolean(),
  summary: z.object({
    findings: z.number().int().nonnegative(),
    proposals: z.number().int().nonnegative(),
    accepted: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    changed: z.number().int().nonnegative(),
    reviewMilliseconds: z.number().int().nonnegative(),
  }).strict(),
  sessionTiming: ReviewSessionTimingSchema.optional(),
}).strict();
export type ReviewReceipt = z.infer<typeof ReviewReceiptSchema>;

export type ReviewSessionTiming = {
  startedAt: string;
  findingsReviewedAt: string;
  completedAt: string;
};

export function createReviewReceipt(
  recordsInput: ReviewRecords,
  decisionsInput: Decision[],
  sourceBefore: string,
  sourceAfter: string,
  sessionTiming?: ReviewSessionTiming,
): ReviewReceipt {
  const records = ReviewRecordsSchema.parse(recordsInput);
  const decisions = decisionsInput.map((decision) => DecisionSchema.parse(decision));
  const outcomeCount = (outcome: Decision["outcome"]) =>
    decisions.filter((decision) => decision.outcome === outcome).length;
  return ReviewReceiptSchema.parse({
    schemaVersion: 1,
    recordType: "writing-review-receipt",
    documentId: records.documentId,
    revision: records.revision,
    recordsHash: sha256(canonicalJson(records)),
    decisionsHash: sha256(canonicalJson(decisions)),
    sourceBeforeHash: sha256(sourceBefore),
    sourceAfterHash: sha256(sourceAfter),
    sourceChanged: sourceBefore !== sourceAfter,
    summary: {
      findings: records.findings.length,
      proposals: records.proposals.length,
      accepted: outcomeCount("accepted"),
      rejected: outcomeCount("rejected"),
      changed: outcomeCount("changed"),
      reviewMilliseconds: decisions.reduce((total, decision) => total + Math.max(
        0,
        Date.parse(decision.decidedAt) - Date.parse(decision.reviewStartedAt),
      ), 0),
    },
    ...(sessionTiming ? {
      sessionTiming: {
        ...sessionTiming,
        elapsedMilliseconds:
          Date.parse(sessionTiming.completedAt) - Date.parse(sessionTiming.startedAt),
      },
    } : {}),
  });
}
