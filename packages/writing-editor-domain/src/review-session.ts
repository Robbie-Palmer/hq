import {
  createDecision,
  type Decision,
  type DecisionTiming,
} from "./decisions";
import type { Proposal } from "./proposals";
import {
  applyDecisions,
  type ReviewRecords,
  validateRecordedDecisions,
} from "./review";

export type ReviewAnswer =
  | { outcome: "accepted" | "rejected" }
  | { outcome: "changed"; replacement: string }
  | { outcome: "quit" };

export type ReviewSessionResult =
  | { status: "paused"; decisions: Decision[] }
  | { status: "completed"; decisions: Decision[]; source: string };

export async function runReviewSession(options: {
  source: string;
  records: ReviewRecords;
  existingDecisions?: unknown[];
  decide: (proposal: Proposal, reviewStartedAt: string) => Promise<ReviewAnswer>;
  recordDecision: (decision: Decision) => Promise<void>;
  now?: () => string;
}): Promise<ReviewSessionResult> {
  const now = options.now ?? (() => new Date().toISOString());
  const decisions = validateRecordedDecisions(
    options.existingDecisions ?? [],
    options.records.proposals,
  );
  const reviewed = new Set(decisions.map(({ proposalId }) => proposalId));

  for (const proposal of options.records.proposals) {
    if (reviewed.has(proposal.proposalId)) continue;
    const reviewStartedAt = now();
    const answer = await options.decide(proposal, reviewStartedAt);
    if (answer.outcome === "quit") {
      return { status: "paused", decisions };
    }
    const timing: DecisionTiming = {
      reviewStartedAt,
      decidedAt: now(),
    };
    const decision = answer.outcome === "changed"
      ? createDecision(proposal, "changed", answer.replacement, timing)
      : createDecision(proposal, answer.outcome, timing);
    applyDecisions(options.source, [...decisions, decision]);
    await options.recordDecision(decision);
    decisions.push(decision);
  }

  return {
    status: "completed",
    decisions,
    source: applyDecisions(options.source, decisions),
  };
}
