import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@/tests/test-utils";

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  loadQueue: vi.fn(),
  loadAudit: vi.fn(),
  submit: vi.fn(),
  reverse: vi.fn(),
  retry: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: mocks.useSession },
}));

vi.mock("@/lib/api/term-resolution", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/term-resolution")>()),
  loadTermReviewQueue: mocks.loadQueue,
  loadTermResolutionAudit: mocks.loadAudit,
  submitTermResolution: mocks.submit,
  reverseTermResolution: mocks.reverse,
  retryTermReprojection: mocks.retry,
}));

import { TermReviewDashboard } from "@/components/recipes/admin/term-review-dashboard";

const queueItem = {
  kind: "ingredient" as const,
  normalizedText: "green onion",
  locale: "und",
  registryVersion: 7,
  rawTexts: ["Green Onion"],
  submissionCount: 4,
  tenantCount: 2,
  lastSeenAt: "2026-10-30T12:00:00.000Z",
  localeReviewRequired: true,
  collisionReviewRequired: true,
  contexts: [
    {
      termId: "11111111-1111-4111-8111-111111111111",
      observationKey: "context",
      rawText: "Green Onion",
      locale: "und",
      sourceContext: {
        flow: "recipe" as const,
        resourceId: "recipe-1",
        field: "ingredients",
      },
      provenance: { kind: "user" as const, actorUserId: "cook-1" },
      candidateMatches: [
        { slug: "spring-onion", score: 0.91 },
        { slug: "scallion", score: 0.83 },
      ],
      submissionCount: 4,
      firstSeenAt: "2026-10-29T12:00:00.000Z",
      lastSeenAt: "2026-10-30T12:00:00.000Z",
    },
  ],
};

describe("TermReviewDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useSession.mockReturnValue({
      data: {
        user: {
          id: "admin-1",
          name: "Reviewer",
          email: "reviewer@example.test",
          role: "admin",
        },
      },
      isPending: false,
    });
    mocks.loadQueue.mockResolvedValue([queueItem]);
    mocks.loadAudit.mockResolvedValue([]);
    mocks.submit.mockResolvedValue(undefined);
    mocks.reverse.mockResolvedValue(undefined);
    mocks.retry.mockResolvedValue(undefined);
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
  });

  it("does not load cross-account evidence for a non-admin", () => {
    mocks.useSession.mockReturnValue({
      data: {
        user: {
          id: "cook-1",
          name: "Cook",
          email: "cook@example.test",
          role: "user",
        },
      },
      isPending: false,
    });

    render(<TermReviewDashboard />);

    expect(screen.getByRole("heading", { name: "Term review" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Administrator access is required",
    );
    expect(mocks.loadQueue).not.toHaveBeenCalled();
    expect(mocks.loadAudit).not.toHaveBeenCalled();
  });

  it("labels evidence and requires explicit locale and collision review", async () => {
    const user = userEvent.setup();
    render(<TermReviewDashboard />);

    expect(
      await screen.findByRole("heading", { name: "Unresolved term review" }),
    ).toBeVisible();
    expect(
      screen.getByRole("navigation", { name: "Unresolved terms" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Submission contexts" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Candidate evidence" }),
    ).toBeVisible();
    expect(
      screen.getByRole("group", { name: "Required review" }),
    ).toBeVisible();

    await user.type(screen.getByLabelText("Canonical slug"), "spring-onion");
    await user.type(
      screen.getByLabelText("Rationale"),
      "Reviewed the regional usage and candidate evidence.",
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: "I reviewed the ambiguous or unknown locale.",
      }),
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: "I reviewed the conflicting candidate matches.",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Record decision" }));

    await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
    expect(mocks.submit).toHaveBeenCalledWith({
      target: queueItem,
      command: expect.objectContaining({
        action: "alias",
        idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        targetSlug: "spring-onion",
        expectedRegistryVersion: 7,
        localeReview: true,
        collisionReview: true,
        evidence: ["spring-onion:0.9100", "scallion:0.8300"],
      }),
    });
    expect(
      await screen.findByText("Decision saved and projections refreshed."),
    ).toBeVisible();
  });

  it("exposes failed reprojection retry and audited reversal actions", async () => {
    const user = userEvent.setup();
    mocks.loadQueue.mockResolvedValue([]);
    mocks.loadAudit.mockResolvedValue([
      {
        id: "22222222-2222-4222-8222-222222222222",
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
        registryVersion: 1,
        createdAt: "2026-10-30T12:00:00.000Z",
        reprojection: {
          status: "failed",
          attemptCount: 1,
          projectedTermCount: 0,
          projectedContextCount: 0,
          lastError: "Temporary database failure",
        },
      },
    ]);

    render(<TermReviewDashboard />);
    await screen.findByRole("heading", { name: "Audit log" });

    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(mocks.retry).toHaveBeenCalledWith(
        "22222222-2222-4222-8222-222222222222",
      ),
    );
    await user.click(screen.getByRole("button", { name: "Reverse" }));
    await waitFor(() => expect(mocks.reverse).toHaveBeenCalledOnce());
  });
});
