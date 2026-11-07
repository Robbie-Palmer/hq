import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@/tests/test-utils";

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
  resolutionStatus: "unresolved" as const,
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
      submissionCount: 2,
      firstSeenAt: "2026-10-29T12:00:00.000Z",
      lastSeenAt: "2026-10-30T12:00:00.000Z",
    },
    {
      termId: "11111111-1111-4111-8111-111111111111",
      observationKey: "import-context",
      rawText: "GREEN ONION",
      locale: "und",
      sourceContext: {
        flow: "recipe" as const,
        resourceId: "imported-recipe-2",
        field: "ingredients",
      },
      provenance: {
        kind: "import" as const,
        actorUserId: "cook-2",
        importJobId: "33333333-3333-4333-8333-333333333333",
      },
      candidateMatches: [
        { slug: "spring-onion", score: 0.89 },
        { slug: "scallion", score: 0.8 },
      ],
      submissionCount: 2,
      firstSeenAt: "2026-10-28T12:00:00.000Z",
      lastSeenAt: "2026-10-29T12:00:00.000Z",
    },
  ],
};

const secondQueueItem = {
  ...queueItem,
  normalizedText: "shallot",
  rawTexts: ["Shallot"],
  submissionCount: 3,
  contexts: queueItem.contexts.map((context) => ({
    ...context,
    termId: "22222222-2222-4222-8222-222222222222",
    rawText: "Shallot",
  })),
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

  it("matches the selected candidate in one click with visible warnings", async () => {
    const user = userEvent.setup();
    render(<TermReviewDashboard />);

    expect(
      await screen.findByRole("heading", { name: "Term review" }),
    ).toBeVisible();
    expect(
      screen.getByRole("navigation", { name: "Unresolved terms" }),
    ).toHaveClass("hidden", "lg:block");
    expect(screen.queryByText(/Repeated submissions come first/)).toBeNull();
    expect(
      screen.getByText("View evidence · 2 sources · 2 possible matches"),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Where it appeared" }),
    ).not.toBeVisible();
    expect(screen.getByText("recipe-1")).not.toBeVisible();

    await user.click(
      screen.getByText("View evidence · 2 sources · 2 possible matches"),
    );

    expect(
      screen.getByRole("heading", { name: "Where it appeared" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Possible matches" }),
    ).toBeVisible();
    expect(screen.getByText("Authored recipe")).toBeVisible();
    expect(screen.getByText("Imported recipe")).toBeVisible();
    expect(screen.getByText("4 submissions across 2 sources.")).toBeVisible();
    expect(
      screen.getByText(/Ingredients · Direct · 30 Oct 2026/),
    ).toBeVisible();
    expect(
      screen.getByText(/Ingredients · Imported · 29 Oct 2026/),
    ).toBeVisible();
    await user.click(screen.getByText("Technical provenance"));
    expect(screen.getByText("recipe-1")).toBeVisible();
    expect(screen.getByText("imported-recipe-2")).toBeVisible();
    expect(
      screen.getByText(/33333333-3333-4333-8333-333333333333/),
    ).toBeVisible();
    expect(
      screen.queryByText(/The ranking is evidence, not a probability/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("91%")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Canonical slug")).toHaveValue("spring-onion");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(
      screen.getByText("The locale is unknown or ambiguous."),
    ).toBeVisible();
    expect(
      screen.getByText("The evidence points to more than one canonical item."),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Match scallion" }));
    expect(screen.getByLabelText("Canonical slug")).toHaveValue("scallion");
    await user.click(screen.getByRole("button", { name: "Match to scallion" }));

    await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
    expect(mocks.submit).toHaveBeenCalledWith({
      target: queueItem,
      command: expect.objectContaining({
        action: "alias",
        idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        targetSlug: "scallion",
        rationale: "Matched to scallion.",
        expectedRegistryVersion: 7,
        localeReview: true,
        collisionReview: true,
        evidence: [
          "spring-onion:0.9100",
          "scallion:0.8300",
          "spring-onion:0.8900",
          "scallion:0.8000",
        ],
      }),
    });
    expect(
      await screen.findByText("Saved. The next term is ready."),
    ).toBeVisible();
  });

  it("supports swipe shortcuts without removing the equivalent controls", async () => {
    let finishFirstSubmit: (() => void) | undefined;
    mocks.submit.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirstSubmit = () =>
            resolve({ decision: { registryVersion: 8 } });
        }),
    );
    mocks.loadQueue.mockReset();
    mocks.loadQueue
      .mockResolvedValueOnce([queueItem, secondQueueItem])
      .mockResolvedValueOnce([]);
    render(<TermReviewDashboard />);

    const card = await screen.findByRole("article", {
      name: "Review Green Onion",
    });
    const backdrop = card.previousElementSibling as HTMLElement;
    expect(
      screen.getByRole("button", { name: "Match to spring-onion" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Not a term" })).toBeVisible();
    expect(card).toHaveClass("duration-200", "motion-reduce:transition-none");

    const slugInput = screen.getByLabelText("Canonical slug");
    fireEvent.touchStart(slugInput, {
      touches: [{ clientX: 20, clientY: 100 }],
    });
    fireEvent.touchEnd(slugInput, {
      changedTouches: [{ clientX: 120, clientY: 102 }],
    });
    expect(mocks.submit).not.toHaveBeenCalled();

    fireEvent.touchStart(card, {
      touches: [{ clientX: 20, clientY: 100 }],
    });
    fireEvent.touchMove(card, {
      touches: [{ clientX: 70, clientY: 102 }],
    });
    expect(card).toHaveStyle({
      transform: "translateX(50px) rotate(1.25deg)",
    });
    fireEvent.touchEnd(card, {
      changedTouches: [{ clientX: 70, clientY: 102 }],
    });
    expect(card).toHaveStyle({
      transform: "translateX(0px) rotate(0deg)",
    });
    expect(mocks.submit).not.toHaveBeenCalled();

    fireEvent.touchStart(card, {
      touches: [{ clientX: 20, clientY: 100 }],
    });
    fireEvent.touchMove(card, {
      touches: [{ clientX: 100, clientY: 102 }],
    });
    expect(card).toHaveStyle({
      transform: "translateX(80px) rotate(2deg)",
    });
    expect(
      within(backdrop).getByText("Match spring onion", { exact: true }),
    ).toHaveStyle({ opacity: "1" });
    fireEvent.touchEnd(card, {
      changedTouches: [{ clientX: 120, clientY: 102 }],
    });

    await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
    expect(mocks.submit).toHaveBeenLastCalledWith({
      target: queueItem,
      command: expect.objectContaining({
        action: "alias",
        targetSlug: "spring-onion",
      }),
    });
    expect(
      await screen.findByRole("article", { name: "Review Shallot" }),
    ).toBeVisible();
    expect(mocks.loadQueue).toHaveBeenCalledOnce();
    const nextCard = screen.getByRole("article", { name: "Review Shallot" });
    const nextBackdrop = nextCard.previousElementSibling as HTMLElement;
    fireEvent.touchStart(nextCard, {
      touches: [{ clientX: 120, clientY: 100 }],
    });
    fireEvent.touchMove(nextCard, {
      touches: [{ clientX: 40, clientY: 102 }],
    });
    expect(nextCard).toHaveStyle({
      transform: "translateX(-80px) rotate(-2deg)",
    });
    expect(
      within(nextBackdrop).getByText("Not a term", { exact: true }),
    ).toHaveStyle({ opacity: "1" });
    fireEvent.touchEnd(nextCard, {
      changedTouches: [{ clientX: 20, clientY: 102 }],
    });

    await waitFor(() =>
      expect(
        screen.getByText("No terms are waiting for review."),
      ).toBeVisible(),
    );
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(screen.getByText("Saving 2 decisions…")).toBeVisible();

    finishFirstSubmit?.();
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
    expect(mocks.submit).toHaveBeenLastCalledWith({
      target: secondQueueItem,
      command: expect.objectContaining({
        action: "reject",
        expectedRegistryVersion: 8,
      }),
    });
    await waitFor(() => expect(mocks.loadQueue).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText(
        "Removed from the review queue. You can undo this now or reverse it from the audit log.",
      ),
    ).toBeVisible();
  });

  it("restores an optimistically advanced card when the save fails", async () => {
    let failSubmit: ((error: Error) => void) | undefined;
    mocks.submit.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          failSubmit = reject;
        }),
    );
    mocks.loadQueue.mockResolvedValueOnce([queueItem, secondQueueItem]);
    render(<TermReviewDashboard />);

    const card = await screen.findByRole("article", {
      name: "Review Green Onion",
    });
    fireEvent.touchStart(card, {
      touches: [{ clientX: 20, clientY: 100 }],
    });
    fireEvent.touchEnd(card, {
      changedTouches: [{ clientX: 120, clientY: 102 }],
    });

    expect(
      await screen.findByRole("article", { name: "Review Shallot" }),
    ).toBeVisible();
    failSubmit?.(
      new Error(
        "This term has an ambiguous locale and requires explicit locale review",
      ),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The evidence changed while this term was open. It is back in the queue for another look.",
    );
    expect(
      screen.getByRole("article", { name: "Review Green Onion" }),
    ).toBeVisible();
  });

  it("generates the slug and display name when creating a canonical item", async () => {
    const user = userEvent.setup();
    render(<TermReviewDashboard />);

    expect(await screen.findByLabelText("Canonical slug")).toHaveValue(
      "spring-onion",
    );
    await user.click(
      screen.getByRole("button", {
        name: "Create new",
      }),
    );

    expect(screen.getByLabelText("Canonical slug")).toHaveValue("green-onion");
    expect(screen.getByLabelText("Display name")).toHaveValue("Green Onion");
    expect(
      screen.getByText("Generated from the submitted term; edit if needed."),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Create canonical item" }),
    );
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
    expect(mocks.submit).toHaveBeenCalledWith({
      target: queueItem,
      command: expect.objectContaining({
        action: "new_canonical",
        targetSlug: "green-onion",
        canonicalName: "Green Onion",
        rationale: "Created canonical item green-onion.",
        localeReview: true,
        collisionReview: true,
      }),
    });
  });

  it("uses three plain-language decisions and removes merge from the flow", async () => {
    const user = userEvent.setup();
    render(<TermReviewDashboard />);
    expect(
      await screen.findByRole("group", { name: "What is it?" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Match existing" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Create new" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Not a term" })).toBeVisible();
    expect(screen.queryByText(/merge/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Skip for later" }),
    ).toBeVisible();
    expect(screen.getByText("You can undo the review decision.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Not a term" }));
    expect(screen.queryByLabelText("Canonical slug")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Mark as not a term" }),
    );
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
    expect(mocks.submit).toHaveBeenCalledWith({
      target: queueItem,
      command: expect.objectContaining({
        action: "reject",
        rationale: "Marked as not a structured term.",
      }),
    });
  });

  it("moves skipped terms to a retrievable later queue and supports immediate undo", async () => {
    const user = userEvent.setup();
    const deferredDecision = {
      id: "44444444-4444-4444-8444-444444444444",
      kind: "ingredient" as const,
      normalizedText: "green onion",
      locale: "und",
      action: "defer" as const,
      targetSlug: null,
      canonicalName: null,
      rationale: "Skipped for later review.",
      evidence: [],
      localeReview: false,
      collisionReview: false,
      decidedByUserId: "admin-1",
      reversesDecisionId: null,
      registryVersion: 8,
      createdAt: "2026-10-31T12:00:00.000Z",
      reprojection: null,
    };
    const reversal = {
      ...deferredDecision,
      id: "55555555-5555-4555-8555-555555555555",
      action: "reversal" as const,
      reversesDecisionId: deferredDecision.id,
      registryVersion: 9,
      createdAt: "2026-10-31T12:01:00.000Z",
    };
    mocks.loadAudit.mockReset();
    mocks.loadAudit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([deferredDecision])
      .mockResolvedValueOnce([reversal, deferredDecision]);
    mocks.loadQueue.mockReset();
    mocks.loadQueue
      .mockResolvedValueOnce([queueItem])
      .mockResolvedValueOnce([
        { ...queueItem, resolutionStatus: "deferred" as const },
      ])
      .mockResolvedValueOnce([queueItem]);
    render(<TermReviewDashboard />);
    await user.click(
      await screen.findByRole("button", { name: "Skip for later" }),
    );

    await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
    expect(mocks.submit).toHaveBeenCalledWith({
      target: queueItem,
      command: expect.objectContaining({
        action: "defer",
        rationale: "Skipped for later review.",
        localeReview: false,
        collisionReview: false,
      }),
    });
    expect(
      await screen.findByText(
        "Skipped for later. It moved to the deferred queue with all evidence intact.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Review (0)" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Later (1)" }));
    expect(
      await screen.findByRole("heading", { name: "Green Onion" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Skip for later" }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Undo last decision" }),
    );
    await waitFor(() =>
      expect(mocks.reverse).toHaveBeenCalledWith(
        deferredDecision,
        "Reviewer undid the previous decision.",
      ),
    );
    expect(
      await screen.findByText("Undone. The term is back in review."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Review (1)" })).toBeVisible();
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
