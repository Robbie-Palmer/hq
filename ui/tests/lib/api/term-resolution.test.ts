import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("@/lib/api/http", () => ({ apiRequest: mocks.apiRequest }));

import {
  loadTermResolutionAudit,
  loadTermReviewQueue,
  retryTermReprojection,
  reverseTermResolution,
  submitTermResolution,
  type TermResolutionAuditItem,
} from "@/lib/api/term-resolution";

describe("term resolution API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiRequest.mockResolvedValue({});
  });

  it("sends only the strict target identity with a decision", async () => {
    const command = {
      action: "alias",
      idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      rationale: "Reviewed evidence.",
      targetSlug: "spring-onion",
    };
    const queueTarget = {
      kind: "ingredient" as const,
      normalizedText: "scallion",
      locale: "en-US",
      rawTexts: ["Scallion"],
    };

    await submitTermResolution({
      target: queueTarget,
      command,
    });

    expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/api/admin/term-resolutions",
      {
        method: "POST",
        json: {
          target: {
            kind: "ingredient",
            normalizedText: "scallion",
            locale: "en-US",
          },
          command,
        },
      },
    );
  });

  it("loads the ranked queue and audit history", async () => {
    mocks.apiRequest
      .mockResolvedValueOnce({ items: [{ normalizedText: "scallion" }] })
      .mockResolvedValueOnce({ items: [{ id: "decision-1" }] });

    await expect(loadTermReviewQueue()).resolves.toEqual([
      { normalizedText: "scallion" },
    ]);
    await expect(loadTermResolutionAudit()).resolves.toEqual([
      { id: "decision-1" },
    ]);
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(
      1,
      "/api/admin/term-resolutions/queue",
    );
    expect(mocks.apiRequest).toHaveBeenNthCalledWith(
      2,
      "/api/admin/term-resolutions/audit?limit=100",
    );
  });

  it("builds an audited reversal command", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );
    const item = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      kind: "ingredient",
      normalizedText: "scallion",
      locale: "en-US",
      action: "alias",
      targetSlug: "spring-onion",
      canonicalName: null,
      rationale: "Regional synonym.",
      evidence: [],
      localeReview: false,
      collisionReview: false,
      decidedByUserId: "admin-1",
      reversesDecisionId: null,
      registryVersion: 3,
      createdAt: "2026-10-30T12:00:00.000Z",
      reprojection: null,
    } satisfies TermResolutionAuditItem;

    await reverseTermResolution(item, "Incorrect regional mapping.");

    expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/api/admin/term-resolutions",
      {
        method: "POST",
        json: {
          target: {
            kind: "ingredient",
            normalizedText: "scallion",
            locale: "en-US",
          },
          command: {
            action: "reversal",
            idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            rationale: "Incorrect regional mapping.",
            evidence: [],
            localeReview: false,
            collisionReview: false,
            reversesDecisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          },
        },
      },
    );
  });

  it("encodes the decision ID for a reprojection retry", async () => {
    await retryTermReprojection("decision/with space");

    expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/api/admin/term-resolutions/decision%2Fwith%20space/reproject",
      { method: "POST" },
    );
  });
});
