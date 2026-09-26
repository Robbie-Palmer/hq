import { z } from "zod";

import { ProposalIdSchema, ProposalSchema } from "./proposals";
import { WRITING_EDITOR_SCHEMA_VERSION } from "./suggestions";

const DecisionBaseSchema = z.object({
  schemaVersion: z.literal(WRITING_EDITOR_SCHEMA_VERSION),
  recordType: z.literal("writing-decision"),
  proposalId: ProposalIdSchema,
  proposal: ProposalSchema,
  reviewStartedAt: z.iso.datetime({ offset: true }),
  decidedAt: z.iso.datetime({ offset: true }),
});

export const AcceptedDecisionSchema = DecisionBaseSchema.extend({
  outcome: z.literal("accepted"),
}).strict();

export const RejectedDecisionSchema = DecisionBaseSchema.extend({
  outcome: z.literal("rejected"),
}).strict();

export const ChangedDecisionSchema = DecisionBaseSchema.extend({
  outcome: z.literal("changed"),
  replacement: z.string(),
}).strict();

export const DecisionSchema = z
  .discriminatedUnion("outcome", [
    AcceptedDecisionSchema,
    RejectedDecisionSchema,
    ChangedDecisionSchema,
  ])
  .superRefine((decision, context) => {
    if (decision.proposalId !== decision.proposal.proposalId) {
      context.addIssue({
        code: "custom",
        message: "proposalId must match the embedded proposal",
        path: ["proposalId"],
      });
    }
    if (Date.parse(decision.decidedAt) < Date.parse(decision.reviewStartedAt)) {
      context.addIssue({
        code: "custom",
        message: "decidedAt must not precede reviewStartedAt",
        path: ["decidedAt"],
      });
    }
  });

export type Decision = z.infer<typeof DecisionSchema>;
export type DecisionOutcome = Decision["outcome"];

export function createDecision(
  proposal: z.input<typeof ProposalSchema>,
  outcome: "accepted" | "rejected",
  timing: DecisionTiming,
): Decision;
export function createDecision(
  proposal: z.input<typeof ProposalSchema>,
  outcome: "changed",
  replacement: string,
  timing: DecisionTiming,
): Decision;
export function createDecision(
  proposal: z.input<typeof ProposalSchema>,
  outcome: DecisionOutcome,
  replacementOrTiming: string | DecisionTiming,
  changedTiming?: DecisionTiming,
): Decision {
  const replacement = typeof replacementOrTiming === "string"
    ? replacementOrTiming
    : undefined;
  const timing = typeof replacementOrTiming === "string"
    ? changedTiming
    : replacementOrTiming;
  if (outcome !== "changed" && replacement !== undefined) {
    throw new Error(`${outcome} decisions cannot include a replacement`);
  }
  if (!timing) {
    throw new Error("a decision requires review timing");
  }
  const parsedProposal = ProposalSchema.parse(proposal);
  const candidate = {
    schemaVersion: WRITING_EDITOR_SCHEMA_VERSION,
    recordType: "writing-decision" as const,
    proposalId: parsedProposal.proposalId,
    proposal: parsedProposal,
    outcome,
    ...timing,
    ...(outcome === "changed" ? { replacement } : {}),
  };
  return DecisionSchema.parse(candidate);
}

export type DecisionTiming = {
  reviewStartedAt: string;
  decidedAt: string;
};
