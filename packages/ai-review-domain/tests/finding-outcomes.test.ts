import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  buildFindingOutcomeRecord,
  evaluateFinalizedFinding,
  findingOutcomeKind,
  summarizeFindingInteractions,
} from "../src/finding-outcomes";

const noInteractions = {
  deliveryIds: [],
  replies: 0,
  threadResolutions: 0,
  threadUnresolutions: 0,
  positiveReactions: 0,
  negativeReactions: 0,
};

describe("finding outcomes", () => {
  it("waits for the outcome window before recording silence", () => {
    expect(
      evaluateFinalizedFinding({
        disposition: null,
        finalHeadWasReviewed: true,
        affectedCodeRemains: true,
        outcomeWindowElapsed: false,
        interactions: noInteractions,
      }),
    ).toMatchObject({ status: "incomplete" });
    expect(
      evaluateFinalizedFinding({
        disposition: null,
        finalHeadWasReviewed: true,
        affectedCodeRemains: true,
        outcomeWindowElapsed: true,
        interactions: noInteractions,
      }),
    ).toMatchObject({
      status: "resolved",
      outcome: "no-observable-response",
      basis: "outcome-window",
      evidence: { correctnessJudgment: false },
    });
  });

  it("sends conflicting or ambiguous evidence to manual adjudication", () => {
    expect(
      evaluateFinalizedFinding({
        disposition: null,
        finalHeadWasReviewed: true,
        affectedCodeRemains: true,
        outcomeWindowElapsed: true,
        interactions: {
          ...noInteractions,
          deliveryIds: ["reply-1", "thread-1"],
          replies: 1,
          threadResolutions: 1,
          negativeReactions: 1,
        },
        laterResolutionVerdict: "fixed",
      }),
    ).toMatchObject({ status: "manual-adjudication-required" });
  });

  it("classifies explicit dispositions and superseded code", () => {
    expect(
      evaluateFinalizedFinding({
        disposition: "rejected",
        finalHeadWasReviewed: false,
        affectedCodeRemains: true,
        outcomeWindowElapsed: false,
        interactions: noInteractions,
      }),
    ).toMatchObject({
      status: "resolved",
      outcome: "rejected",
      basis: "explicit-disposition",
    });
    expect(
      evaluateFinalizedFinding({
        disposition: null,
        finalHeadWasReviewed: true,
        affectedCodeRemains: false,
        outcomeWindowElapsed: false,
        interactions: noInteractions,
      }),
    ).toMatchObject({
      status: "resolved",
      outcome: "superseded",
      basis: "pull-request-finalization",
    });
  });

  it("summarizes the latest replies, thread states, and reactions", () => {
    const row = (delivery_id: string, payload: unknown) => ({
      delivery_id,
      payload_json:
        typeof payload === "string" ? payload : JSON.stringify(payload),
    });
    expect(
      summarizeFindingInteractions([
        row("invalid-json", "{"),
        row("invalid-shape", []),
        row("reply-created", {
          interactionType: "reply",
          action: "created",
          commentId: 10,
          reactions: { "+1": 2, confused: 1, invalid: -1 },
        }),
        row("reply-deleted", {
          interactionType: "reply",
          action: "deleted",
          commentId: 10,
          reactions: { "+1": 2 },
        }),
        row("reply-kept", {
          interactionType: "reply",
          action: "created",
          reactions: { heart: 1, rocket: 1, ignored: "one" },
        }),
        row("thread-resolved", {
          interactionType: "thread",
          action: "resolved",
          rootCommentId: 20,
        }),
        row("thread-unresolved", {
          interactionType: "thread",
          action: "unresolved",
          rootCommentId: 20,
        }),
        row("thread-id", {
          interactionType: "thread",
          action: "resolved",
          threadId: "thread-2",
          reactions: { hooray: 1, "-1": 2 },
        }),
        row("thread-delivery-fallback", {
          interactionType: "thread",
          action: "resolved",
        }),
      ]),
    ).toEqual({
      deliveryIds: [
        "reply-created",
        "reply-deleted",
        "reply-kept",
        "thread-resolved",
        "thread-unresolved",
        "thread-id",
        "thread-delivery-fallback",
      ],
      replies: 1,
      threadResolutions: 2,
      threadUnresolutions: 1,
      positiveReactions: 3,
      negativeReactions: 2,
    });
  });

  it("assigns semantic kinds to every outcome", () => {
    expect(findingOutcomeKind("confirmed-fixed")).toBe("adjudicated");
    expect(findingOutcomeKind("superseded")).toBe("censored");
    expect(findingOutcomeKind("no-observable-response")).toBe("workflow");
  });

  it("builds a portable versioned record", () => {
    expect(
      buildFindingOutcomeRecord({
        repository: "owner/repository",
        pullRequestNumber: 42,
        findingId: `f_${"a".repeat(24)}`,
        outcome: "confirmed-fixed",
        basis: "later-reviewed-head",
        confidence: 0.95,
        evaluatorVersion: "deterministic-outcomes-v1",
        manualOverride: {
          actor: "maintainer",
          deliveryId: "override-1",
          reason: "Verified against the final diff",
        },
        sourceId: "review:run:finding",
        outcomeVersion: 2,
        occurredAt: "2026-08-15T12:00:00Z",
        recordedAt: "2026-08-15T12:00:01Z",
        evidence: { outcomeHeadSha: "abc" },
      }),
    ).toMatchObject({
      schemaVersion: 2,
      recordType: "finding-outcome",
      outcomeVersion: 2,
      outcome: "confirmed-fixed",
      outcomeKind: "adjudicated",
      confidence: 0.95,
      evaluatorVersion: "deterministic-outcomes-v1",
      manualOverride: { actor: "maintainer" },
      evidence: { outcomeHeadSha: "abc" },
    });
  });

  it("normalizes Date.parse-compatible outcome timestamps", () => {
    const record = buildFindingOutcomeRecord({
      repository: "owner/repository",
      pullRequestNumber: 42,
      findingId: `f_${"a".repeat(24)}`,
      outcome: "superseded",
      basis: "pull-request-finalization",
      confidence: 1,
      evaluatorVersion: "deterministic-outcomes-v1",
      sourceId: "finalization:42",
      outcomeVersion: 1,
      occurredAt: "2026-08-15T14:00+02:00",
      recordedAt: "2026-08-15T12:00:01Z",
      evidence: {},
    });

    expect(record.occurredAt).toBe("2026-08-15T12:00:00.000Z");
  });

  it("routes invalid outcome timestamps through schema validation", () => {
    expect(() => buildFindingOutcomeRecord({
      repository: "owner/repository",
      pullRequestNumber: 42,
      findingId: `f_${"a".repeat(24)}`,
      outcome: "superseded",
      basis: "pull-request-finalization",
      confidence: 1,
      evaluatorVersion: "deterministic-outcomes-v1",
      sourceId: "finalization:42",
      outcomeVersion: 1,
      occurredAt: "not-a-timestamp",
      recordedAt: "2026-08-15T12:00:01Z",
      evidence: {},
    })).toThrow(ZodError);
  });
});
