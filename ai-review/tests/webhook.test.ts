import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  parseFindingInteraction,
  parsePullRequestFinalization,
  parseReviewEvent,
  verifyGitHubSignature,
} from "../src/webhook";

describe("verifyGitHubSignature", () => {
  it("accepts a valid sha256 signature", async () => {
    const body = '{"zen":"Keep it logically awesome."}';
    const secret = "test-secret";
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

    await expect(verifyGitHubSignature(body, signature, secret)).resolves.toBe(
      true,
    );
  });

  it("rejects a mismatched signature", async () => {
    await expect(
      verifyGitHubSignature("body", "sha256=deadbeef", "secret"),
    ).resolves.toBe(false);
    await expect(
      verifyGitHubSignature("body", `sha256=${"0".repeat(64)}`, "secret"),
    ).resolves.toBe(false);
  });

  it("rejects missing and malformed signature headers", async () => {
    await expect(verifyGitHubSignature("body", null, "secret")).resolves.toBe(
      false,
    );
    await expect(
      verifyGitHubSignature("body", "sha1=deadbeef", "secret"),
    ).resolves.toBe(false);
  });
});

describe("parseReviewEvent", () => {
  it("extracts the pull request identity without retaining the payload", () => {
    expect(
      parseReviewEvent("pull_request", "delivery-1", {
        action: "synchronize",
        number: 816,
        repository: { full_name: "Robbie-Palmer/hq" },
        pull_request: { head: { sha: "abc123" } },
      }),
    ).toEqual({
      kind: "accepted",
      event: {
        deliveryId: "delivery-1",
        eventName: "pull_request",
        action: "synchronize",
        repository: "Robbie-Palmer/hq",
        pullRequestNumber: 816,
        headSha: "abc123",
        force: false,
      },
    });
  });

  it("ignores issue comments that are not on pull requests", () => {
    expect(
      parseReviewEvent("issue_comment", "delivery-2", {
        action: "created",
        repository: { full_name: "Robbie-Palmer/hq" },
        issue: { number: 1 },
      }),
    ).toEqual({ kind: "ignored", reason: "unsupported-event" });
    expect(
      parseReviewEvent("issue_comment", "delivery-2", {
        action: "created",
        repository: { full_name: "Robbie-Palmer/hq" },
        issue: { number: 1, pull_request: true },
        sender: { login: "robbie" },
        comment: {
          body: "/ai-review",
          author_association: "OWNER",
          user: { login: "robbie" },
        },
      }),
    ).toEqual({ kind: "invalid", reason: "Malformed webhook payload" });
  });

  it("ignores pull request actions that do not warrant a review", () => {
    expect(
      parseReviewEvent("pull_request", "delivery-ignored", {
        action: "labeled",
        repository: { full_name: "Robbie-Palmer/hq" },
        pull_request: { number: 816, head: { sha: "abc123" } },
      }),
    ).toEqual({ kind: "ignored", reason: "unsupported-event" });
  });

  it("requires a non-empty head SHA for pull request events", () => {
    for (const sha of [undefined, ""]) {
      expect(
        parseReviewEvent("pull_request", "delivery-missing-sha", {
          action: "synchronize",
          number: 816,
          repository: { full_name: "Robbie-Palmer/hq" },
          pull_request: { head: { sha } },
        }),
      ).toEqual({ kind: "invalid", reason: "Malformed webhook payload" });
    }
  });

  it("rejects malformed webhook envelopes", () => {
    expect(parseReviewEvent("pull_request", "", null)).toEqual({
      kind: "invalid",
      reason: "Malformed webhook payload",
    });
    expect(
      parseReviewEvent("pull_request", "", {
        action: "opened",
        repository: { full_name: "Robbie-Palmer/hq" },
      }),
    ).toEqual({ kind: "invalid", reason: "Malformed webhook payload" });
    expect(
      parseReviewEvent("pull_request", "delivery", {
        action: "opened",
        repository: { full_name: "Robbie-Palmer/hq" },
      }),
    ).toEqual({ kind: "invalid", reason: "Malformed webhook payload" });
    expect(
      parseReviewEvent("unsupported", "delivery", {
        action: "created",
        repository: { full_name: "Robbie-Palmer/hq" },
      }),
    ).toEqual({ kind: "ignored", reason: "unsupported-event" });
    expect(parseReviewEvent("pull_request", "delivery", [])).toEqual({
      kind: "invalid",
      reason: "Malformed webhook payload",
    });
    expect(
      parseReviewEvent("pull_request_review", "delivery", {
        action: "submitted",
        repository: { full_name: "Robbie-Palmer/hq" },
      }),
    ).toEqual({ kind: "ignored", reason: "unsupported-event" });
  });

  it("extracts pull request issue comments", () => {
    expect(
      parseReviewEvent("issue_comment", "delivery-comment", {
        action: "created",
        repository: { full_name: "Robbie-Palmer/hq" },
        issue: { number: 816, pull_request: {} },
        sender: { login: "robbie" },
        comment: {
          body: "/ai-review",
          author_association: "OWNER",
          user: { login: "robbie" },
        },
      }),
    ).toEqual({
      kind: "accepted",
      event: expect.objectContaining({
        eventName: "issue_comment",
        pullRequestNumber: 816,
        force: true,
      }),
    });
  });

  it("supports an explicit full review command", () => {
    expect(
      parseReviewEvent("issue_comment", "delivery-final", {
        action: "created",
        repository: { full_name: "Robbie-Palmer/hq" },
        issue: { number: 816, pull_request: {} },
        sender: { login: "robbie" },
        comment: {
          body: "/ai-review full",
          author_association: "OWNER",
          user: { login: "robbie" },
        },
      }),
    ).toEqual({
      kind: "accepted",
      event: expect.objectContaining({
        force: true,
      }),
    });
  });

  it("does not spend on review-thread activity", () => {
    expect(
      parseReviewEvent("pull_request_review_thread", "delivery-3", {
        action: "resolved",
        repository: { full_name: "Robbie-Palmer/hq" },
        pull_request: { number: 816 },
      }),
    ).toEqual({ kind: "ignored", reason: "unsupported-event" });
  });

  it("ignores ordinary and untrusted issue comments", () => {
    for (const comment of [
      { body: "looks good", author_association: "OWNER" },
      { body: " /ai-review\n", author_association: "OWNER" },
      { body: "/ai-review", author_association: "NONE" },
    ]) {
      expect(
        parseReviewEvent("issue_comment", "delivery-comment", {
          action: "created",
          repository: { full_name: "Robbie-Palmer/hq" },
          issue: { number: 816, pull_request: {} },
          comment,
        }),
      ).toEqual({ kind: "ignored", reason: "unsupported-event" });
    }
  });
});

describe("parsePullRequestFinalization", () => {
  it("captures merged and unmerged PR closure without scheduling review", () => {
    for (const merged of [true, false]) {
      expect(
        parsePullRequestFinalization("pull_request", `closed-${merged}`, {
          action: "closed",
          number: 816,
          repository: { full_name: "Robbie-Palmer/hq" },
          pull_request: {
            merged,
            closed_at: "2026-08-15T12:00:00Z",
            head: { sha: "abc123" },
          },
        }),
      ).toEqual({
        kind: "accepted",
        event: {
          deliveryId: `closed-${merged}`,
          eventName: "pull_request",
          action: "closed",
          repository: "Robbie-Palmer/hq",
          pullRequestNumber: 816,
          headSha: "abc123",
          finalState: merged ? "merged" : "closed",
          occurredAt: "2026-08-15T12:00:00Z",
        },
      });
    }
  });

  it("rejects malformed closure evidence and ignores other events", () => {
    expect(
      parsePullRequestFinalization("pull_request", "delivery", {
        action: "closed",
        number: 816,
        repository: { full_name: "Robbie-Palmer/hq" },
        pull_request: { head: { sha: "abc123" } },
      }),
    ).toEqual({ kind: "invalid", reason: "Malformed webhook payload" });
    expect(
      parsePullRequestFinalization("pull_request", "delivery", {
        action: "closed",
        number: 816,
        repository: { full_name: "Robbie-Palmer/hq" },
        pull_request: {
          merged: true,
          closed_at: "not-a-timestamp",
          head: { sha: "abc123" },
        },
      }),
    ).toEqual({ kind: "invalid", reason: "Malformed webhook payload" });
    expect(
      parsePullRequestFinalization("pull_request", "delivery", {
        action: "synchronize",
      }),
    ).toEqual({ kind: "ignored", reason: "unsupported-event" });
  });
});

describe("parseFindingInteraction", () => {
  it("accepts explicit dispositions from trusted pull request commenters", () => {
    expect(
      parseFindingInteraction("issue_comment", "feedback-1", {
        action: "created",
        repository: { full_name: "Robbie-Palmer/hq" },
        issue: { number: 816, pull_request: {} },
        sender: { login: "robbie" },
        comment: {
          id: 99,
          body: `/ai-review reject f_${"a".repeat(24)} false positive`,
          author_association: "OWNER",
          user: { login: "robbie" },
          created_at: "2026-08-09T12:00:00Z",
        },
      }),
    ).toEqual({
      kind: "accepted",
      event: expect.objectContaining({
        interactionType: "disposition",
        disposition: "rejected",
        findingId: `f_${"a".repeat(24)}`,
        reason: "false positive",
      }),
    });
    expect(
      parseFindingInteraction("issue_comment", "feedback-fixed", {
        action: "created",
        repository: { full_name: "Robbie-Palmer/hq" },
        issue: { number: 816, pull_request: {} },
        sender: { login: "robbie" },
        comment: {
          id: 100,
          body: `/ai-review confirm-fixed f_${"a".repeat(24)} verified retry`,
          author_association: "OWNER",
          user: { login: "robbie" },
        },
      }),
    ).toEqual({
      kind: "accepted",
      event: expect.objectContaining({
        interactionType: "disposition",
        disposition: "confirmed-fixed",
        findingId: `f_${"a".repeat(24)}`,
        reason: "verified retry",
      }),
    });
  });

  it("rejects feedback from untrusted actors", () => {
    expect(
      parseFindingInteraction("issue_comment", "feedback-2", {
        action: "created",
        repository: { full_name: "Robbie-Palmer/hq" },
        issue: { number: 816, pull_request: {} },
        sender: { login: "outside" },
        comment: {
          body: `/ai-review acknowledge f_${"a".repeat(24)} agreed`,
          author_association: "CONTRIBUTOR",
          user: { login: "outside" },
        },
      }),
    ).toEqual({ kind: "ignored", reason: "unsupported-event" });

    expect(
      parseFindingInteraction("issue_comment", "feedback-spoofed", {
        action: "created",
        repository: { full_name: "Robbie-Palmer/hq" },
        issue: { number: 816, pull_request: {} },
        sender: { login: "outside" },
        comment: {
          body: `/ai-review reject f_${"a".repeat(24)} spoofed actor`,
          author_association: "OWNER",
          user: { login: "robbie" },
        },
      }),
    ).toEqual({ kind: "ignored", reason: "unsupported-event" });
  });

  it("rejects incomplete disposition commands without regex backtracking", () => {
    const body = `/ai-review reject f_${"a".repeat(24)}${" ".repeat(100_000)}`;
    expect(
      parseFindingInteraction("issue_comment", "feedback-incomplete", {
        action: "created",
        repository: { full_name: "Robbie-Palmer/hq" },
        issue: { number: 816, pull_request: {} },
        sender: { login: "robbie" },
        comment: {
          body,
          author_association: "OWNER",
          user: { login: "robbie" },
        },
      }),
    ).toEqual({ kind: "ignored", reason: "unsupported-event" });

    expect(
      parseFindingInteraction("issue_comment", "feedback-too-long", {
        action: "created",
        repository: { full_name: "Robbie-Palmer/hq" },
        issue: { number: 816, pull_request: {} },
        sender: { login: "robbie" },
        comment: {
          body: `/ai-review reject f_${"a".repeat(24)} ${"x".repeat(1_001)}`,
          author_association: "OWNER",
          user: { login: "robbie" },
        },
      }),
    ).toEqual({ kind: "ignored", reason: "unsupported-event" });
  });

  it("validates malformed interaction envelopes and event-specific identities", () => {
    expect(parseFindingInteraction("issue_comment", "feedback", null)).toEqual({
      kind: "invalid",
      reason: "Malformed webhook payload",
    });
    expect(parseFindingInteraction("issue_comment", "", { action: "created" })).toEqual({
      kind: "invalid",
      reason: "Malformed webhook payload",
    });
    expect(
      parseFindingInteraction("issue_comment", "x".repeat(256), {
        action: "created",
        repository: { full_name: "Robbie-Palmer/hq" },
      }),
    ).toEqual({ kind: "invalid", reason: "Malformed webhook payload" });
    expect(
      parseReviewEvent("pull_request", "x".repeat(256), {
        action: "opened",
        number: 816,
        repository: { full_name: "Robbie-Palmer/hq" },
        pull_request: { head: { sha: "abc123" } },
      }),
    ).toEqual({ kind: "invalid", reason: "Malformed webhook payload" });
    expect(
      parseFindingInteraction("issue_comment", "feedback", {
        action: "created",
        repository: { full_name: "Robbie-Palmer/hq" },
      }),
    ).toEqual({ kind: "ignored", reason: "unsupported-event" });
    expect(
      parseFindingInteraction("issue_comment", "feedback", {
        action: "created",
        repository: { full_name: "Robbie-Palmer/hq" },
        sender: { login: "Robbie-Palmer" },
        comment: {
          body: `/ai-review acknowledge f_${"a".repeat(24)} accepted`,
        },
      }),
    ).toEqual({ kind: "invalid", reason: "Malformed webhook payload" });
    expect(
      parseFindingInteraction("pull_request_review_comment", "feedback", {
        action: "created",
        repository: { full_name: "Robbie-Palmer/hq" },
        pull_request: { number: 816 },
        comment: { id: 201 },
      }),
    ).toEqual({ kind: "ignored", reason: "unsupported-event" });
    expect(
      parseFindingInteraction("pull_request_review_thread", "feedback", {
        action: "resolved",
        repository: { full_name: "Robbie-Palmer/hq" },
        pull_request: { number: 816 },
        sender: { login: "Robbie-Palmer" },
        thread: { comments: [] },
      }),
    ).toEqual({ kind: "invalid", reason: "Malformed webhook payload" });
  });

  it("accepts a trusted pull request author and rejects untrusted reply actors", () => {
    const reply = {
      action: "edited",
      repository: { full_name: "Robbie-Palmer/hq" },
      pull_request: {
        number: 816,
        author_association: "MEMBER",
        user: { login: "maintainer" },
      },
      sender: { login: "maintainer" },
      comment: {
        id: 201,
        in_reply_to_id: 200,
        body: "Updated reply",
        created_at: "2026-08-09T12:00:00Z",
      },
    };
    expect(
      parseFindingInteraction(
        "pull_request_review_comment",
        "feedback-author",
        reply,
      ),
    ).toEqual({
      kind: "accepted",
      event: expect.objectContaining({ actor: "maintainer", action: "edited" }),
    });
    expect(
      parseFindingInteraction(
        "pull_request_review_comment",
        "feedback-outsider",
        {
          ...reply,
          pull_request: { number: 816 },
          sender: { login: "outside" },
        },
      ),
    ).toEqual({ kind: "ignored", reason: "unsupported-event" });
  });

  it("captures replies, reaction snapshots, and thread resolution", () => {
    expect(
      parseFindingInteraction("pull_request_review_comment", "feedback-3", {
        action: "created",
        repository: { full_name: "Robbie-Palmer/hq" },
        pull_request: { number: 816 },
        sender: { login: "maintainer" },
        comment: {
          id: 201,
          in_reply_to_id: 200,
          body: "Good catch; fixed in the next commit.",
          author_association: "COLLABORATOR",
          user: { login: "maintainer" },
          reactions: { url: "ignored", "+1": 2, confused: 0 },
        },
      }),
    ).toEqual({
      kind: "accepted",
      event: expect.objectContaining({
        interactionType: "reply",
        rootCommentId: 200,
        commentId: 201,
        reactions: { "+1": 2, confused: 0 },
      }),
    });

    expect(
      parseFindingInteraction(
        "pull_request_review_comment",
        "feedback-disposition-edit",
        {
          action: "edited",
          repository: { full_name: "Robbie-Palmer/hq" },
          pull_request: { number: 816 },
          sender: { login: "maintainer" },
          comment: {
            id: 202,
            in_reply_to_id: 200,
            body: "/ai-review acknowledge legitimate but deferred",
            author_association: "COLLABORATOR",
            user: { login: "maintainer" },
          },
        },
      ),
    ).toEqual({
      kind: "accepted",
      event: expect.objectContaining({
        interactionType: "disposition",
        disposition: "acknowledged",
        reason: "legitimate but deferred",
      }),
    });

    expect(
      parseFindingInteraction(
        "pull_request_review_comment",
        "feedback-disposition",
        {
          action: "created",
          repository: { full_name: "Robbie-Palmer/hq" },
          pull_request: { number: 816 },
          sender: { login: "maintainer" },
          comment: {
            id: 202,
            in_reply_to_id: 200,
            body: "/ai-review reject duplicate of the existing path-safety finding",
            author_association: "COLLABORATOR",
            user: { login: "maintainer" },
          },
        },
      ),
    ).toEqual({
      kind: "accepted",
      event: expect.objectContaining({
        interactionType: "disposition",
        rootCommentId: 200,
        commentId: 202,
        disposition: "rejected",
        reason: "duplicate of the existing path-safety finding",
      }),
    });

    expect(
      parseFindingInteraction("pull_request_review_thread", "feedback-4", {
        action: "resolved",
        repository: { full_name: "Robbie-Palmer/hq" },
        pull_request: { number: 816 },
        sender: { login: "Robbie-Palmer" },
        updated_at: "2026-08-09T12:10:00Z",
        thread: {
          node_id: "PRRT_thread",
          comments: [
            { id: 201, in_reply_to_id: 200 },
            {
              id: 200,
              in_reply_to_id: null,
              reactions: { "+1": 1, heart: 2 },
            },
          ],
        },
      }),
    ).toEqual({
      kind: "accepted",
      event: expect.objectContaining({
        interactionType: "thread",
        action: "resolved",
        rootCommentId: 200,
        threadId: "PRRT_thread",
        occurredAt: "2026-08-09T12:10:00Z",
        reactions: { "+1": 1, heart: 2 },
      }),
    });
  });
});
