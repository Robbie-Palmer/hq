import {
  FindingOutcomeRecordSchema,
  type FindingOutcomeValue,
  type FindingOutcomeRecord,
} from "./records";
import { isRecord } from "ts-base/records";
type FindingOutcome = FindingOutcomeValue;

export type { FindingOutcomeRecord } from "./records";

export const DEFAULT_FINDING_OUTCOME_EVALUATOR_VERSION =
  "deterministic-outcomes-v1";

export type FindingOutcomeBasis =
  | "explicit-disposition"
  | "later-reviewed-head"
  | "pull-request-finalization"
  | "outcome-window";

export type FindingOutcomeKind = "adjudicated" | "censored" | "workflow";

export type FindingOutcomeManualOverride = {
  actor: string;
  deliveryId: string;
  reason: string;
};

export type FindingInteractionSummary = {
  deliveryIds: string[];
  replies: number;
  threadResolutions: number;
  threadUnresolutions: number;
  positiveReactions: number;
  negativeReactions: number;
};

export type FinalizedFindingEvaluation =
  | {
      outcome: FindingOutcome;
      basis: FindingOutcomeBasis;
      confidence: number;
      status: "resolved";
      evidence: Record<string, unknown>;
    }
  | {
      status: "incomplete";
      evidence: Record<string, unknown>;
    }
  | {
      status: "manual-adjudication-required";
      evidence: Record<string, unknown>;
    };

export type FindingInteractionRow = {
  delivery_id: string;
  payload_json: string;
};

export function buildFindingOutcomeRecord(options: {
  repository: string;
  pullRequestNumber: number;
  findingId: string;
  outcome: FindingOutcome;
  basis: FindingOutcomeBasis;
  confidence: number;
  evaluatorVersion: string;
  manualOverride?: FindingOutcomeManualOverride;
  sourceId: string;
  outcomeVersion: number;
  occurredAt: string;
  recordedAt: string;
  evidence: Record<string, unknown>;
}): FindingOutcomeRecord {
  const occurredAt = Date.parse(options.occurredAt);
  return FindingOutcomeRecordSchema.parse({
    schemaVersion: 2,
    recordType: "finding-outcome",
    outcomeVersion: options.outcomeVersion,
    repository: options.repository,
    pullRequestNumber: options.pullRequestNumber,
    findingId: options.findingId,
    outcome: options.outcome,
    outcomeKind: findingOutcomeKind(options.outcome),
    basis: options.basis,
    confidence: options.confidence,
    evaluatorVersion: options.evaluatorVersion,
    manualOverride: options.manualOverride ?? null,
    sourceId: options.sourceId,
    evidence: options.evidence,
    occurredAt: Number.isFinite(occurredAt)
      ? new Date(occurredAt).toISOString()
      : options.occurredAt,
    recordedAt: options.recordedAt,
  });
}

export function findingOutcomeKind(
  outcome: FindingOutcome,
): FindingOutcomeKind {
  if (outcome === "no-observable-response") return "workflow";
  if (outcome === "superseded") return "censored";
  return "adjudicated";
}

function parseInteractionPayload(
  payloadJson: string,
): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function interactionCommentKey(
  payload: Record<string, unknown>,
  deliveryId: string,
): string {
  return typeof payload.commentId === "number"
    ? `comment:${payload.commentId}`
    : `delivery:${deliveryId}`;
}

function updateReplyState(
  replies: Set<string>,
  payload: Record<string, unknown>,
  commentKey: string,
): void {
  if (payload.interactionType !== "reply") return;
  if (payload.action === "deleted") replies.delete(commentKey);
  else replies.add(commentKey);
}

function updateThreadState(
  threadStates: Map<string, "resolved" | "unresolved">,
  payload: Record<string, unknown>,
  deliveryId: string,
): void {
  if (
    payload.interactionType !== "thread" ||
    (payload.action !== "resolved" && payload.action !== "unresolved")
  ) {
    return;
  }
  let threadId = `delivery:${deliveryId}`;
  if (typeof payload.rootCommentId === "number") {
    threadId = `comment:${payload.rootCommentId}`;
  }
  if (typeof payload.threadId === "string") {
    threadId = payload.threadId;
  }
  threadStates.set(threadId, payload.action);
}

function reactionSnapshot(
  payload: Record<string, unknown>,
): Record<string, number> | undefined {
  if (!isRecord(payload.reactions)) return undefined;
  return Object.fromEntries(
    Object.entries(payload.reactions).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" &&
        Number.isSafeInteger(entry[1]) &&
        entry[1] >= 0,
    ),
  );
}

function countReactions(
  reactionSnapshots: Map<string, Record<string, number>>,
  names: string[],
): number {
  return [...reactionSnapshots.values()].reduce(
    (total, snapshot) =>
      total + names.reduce((sum, name) => sum + (snapshot[name] ?? 0), 0),
    0,
  );
}

export function summarizeFindingInteractions(
  rows: FindingInteractionRow[],
): FindingInteractionSummary {
  const replies = new Set<string>();
  const threadStates = new Map<string, "resolved" | "unresolved">();
  const reactionSnapshots = new Map<string, Record<string, number>>();
  const deliveryIds: string[] = [];
  for (const row of rows) {
    const payload = parseInteractionPayload(row.payload_json);
    if (!payload) continue;
    deliveryIds.push(row.delivery_id);
    const commentKey = interactionCommentKey(payload, row.delivery_id);
    updateReplyState(replies, payload, commentKey);
    updateThreadState(threadStates, payload, row.delivery_id);
    const reactions = reactionSnapshot(payload);
    if (reactions) {
      reactionSnapshots.set(
        commentKey,
        payload.action === "deleted" ? {} : reactions,
      );
    }
  }
  return {
    deliveryIds,
    replies: replies.size,
    threadResolutions: [...threadStates.values()].filter(
      (state) => state === "resolved",
    ).length,
    threadUnresolutions: [...threadStates.values()].filter(
      (state) => state === "unresolved",
    ).length,
    positiveReactions: countReactions(reactionSnapshots, [
      "+1",
      "heart",
      "hooray",
      "rocket",
    ]),
    negativeReactions: countReactions(reactionSnapshots, ["-1", "confused"]),
  };
}

export function evaluateFinalizedFinding(options: {
  disposition: string | null;
  finalHeadWasReviewed: boolean;
  affectedCodeRemains: boolean;
  outcomeWindowElapsed: boolean;
  interactions: FindingInteractionSummary;
  laterResolutionVerdict?: "fixed" | "still-present" | "uncertain";
}): FinalizedFindingEvaluation {
  const evidence = {
    finalHeadWasReviewed: options.finalHeadWasReviewed,
    affectedCodeRemains: options.affectedCodeRemains,
    outcomeWindowElapsed: options.outcomeWindowElapsed,
    interactions: options.interactions,
    laterResolutionVerdict: options.laterResolutionVerdict,
  };
  if (
    options.disposition === "acknowledged" ||
    options.disposition === "rejected"
  ) {
    return {
      status: "resolved",
      outcome: options.disposition,
      basis: "explicit-disposition",
      confidence: 1,
      evidence,
    };
  }
  if (options.finalHeadWasReviewed && !options.affectedCodeRemains) {
    return {
      status: "resolved",
      outcome: "superseded",
      basis: "pull-request-finalization",
      confidence: 1,
      evidence,
    };
  }
  if (!options.outcomeWindowElapsed) {
    return { status: "incomplete", evidence };
  }
  const interactionCount =
    options.interactions.replies +
    options.interactions.threadResolutions +
    options.interactions.threadUnresolutions +
    options.interactions.positiveReactions +
    options.interactions.negativeReactions;
  if (
    interactionCount > 0 ||
    options.laterResolutionVerdict === "fixed"
  ) {
    return { status: "manual-adjudication-required", evidence };
  }
  return {
    status: "resolved",
    outcome: "no-observable-response",
    basis: "outcome-window",
    confidence: 1,
    evidence: {
      ...evidence,
      correctnessJudgment: false,
    },
  };
}
