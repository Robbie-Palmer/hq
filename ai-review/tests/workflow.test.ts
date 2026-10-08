import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env, ReviewWorkflowParams } from "../src/env";

const engine = vi.hoisted(() => ({
  claimReview: vi.fn(),
  combineScoutRuns: vi.fn(),
  completeReview: vi.fn(),
  failReview: vi.fn(),
  identifyReviewArtifacts: vi.fn(),
  mergeFindings: vi.fn(),
  modelFailureCostUsd: vi.fn(),
  prepareReview: vi.fn(),
  publishReview: vi.fn(),
  publishSkippedReview: vi.fn(),
  recordReview: vi.fn(),
  recordReviewTerminal: vi.fn(),
  runScouts: vi.fn(),
}));

vi.mock("../src/review-engine", () => engine);

import { ReviewWorkflow } from "../src/index";

const payload: ReviewWorkflowParams = {
  deliveryId: "delivery-workflow",
  eventName: "pull_request",
  action: "synchronize",
  repository: "Robbie-Palmer/hq",
  pullRequestNumber: 837,
  headSha: "a".repeat(40),
  force: false,
};

const event = {
  instanceId: "review-delivery-workflow",
  payload,
  timestamp: new Date("2026-07-28T12:00:00Z"),
} as WorkflowEvent<ReviewWorkflowParams>;

const prepared = {
  headSha: payload.headSha,
  diffFingerprint: "diff-fingerprint",
  configFingerprint: "config-fingerprint",
  diff: "diff --git a/app.ts b/app.ts",
  paths: ["app.ts"],
  omitted: [],
};

const scouts = {
  models: ["model/scout"],
  candidates: { "model/scout": [] },
  failed: [],
  candidateCounts: { "model/scout": 0 },
  invalidCounts: { "model/scout": 0 },
  outOfScopeCounts: { "model/scout": 0 },
  costs: { "model/scout": 0.4 },
  metrics: [],
};

const merged = {
  result: { summary: "Clean.", findings: [] },
  cost: 0.2,
};

const artifacts = {
  hunks: [],
  candidates: {},
  publishedFindings: [],
};

const emptyScouts = {
  models: [],
  candidates: {},
  failed: [],
  candidateCounts: {},
  invalidCounts: {},
  outOfScopeCounts: {},
  costs: {},
  metrics: [],
};

function fixture() {
  const workflow = new ReviewWorkflow(
    {} as ExecutionContext,
    {} as unknown as Env,
  );
  const step = {
    do: vi.fn(async <T>(
      _name: string,
      configOrOperation:
        | { retries: { limit: number } }
        | (() => Promise<T>),
      maybeOperation?: () => Promise<T>,
    ): Promise<T> => {
      const operation =
        typeof configOrOperation === "function"
          ? configOrOperation
          : maybeOperation;
      if (!operation) throw new Error("Missing Workflow operation");
      return operation();
    }),
  } as unknown as WorkflowStep;
  return { workflow, step };
}

beforeEach(() => {
  vi.resetAllMocks();
  engine.prepareReview.mockResolvedValue(prepared);
  engine.claimReview.mockResolvedValue({
    claimed: true,
    previousState: { runs: 0, total_usd: 0 },
  });
  engine.runScouts
    .mockResolvedValueOnce(scouts)
    .mockResolvedValueOnce(emptyScouts);
  engine.combineScoutRuns.mockReturnValue(scouts);
  engine.mergeFindings.mockResolvedValue(merged);
  engine.modelFailureCostUsd.mockReturnValue(0);
  engine.identifyReviewArtifacts.mockResolvedValue(artifacts);
  engine.publishReview.mockResolvedValue({
    commentId: 123,
    runCostUsd: 0.6,
    findings: [],
  });
  engine.publishSkippedReview.mockResolvedValue({
    commentId: 123,
    runCostUsd: 0,
    findings: [],
  });
  engine.recordReview.mockResolvedValue(undefined);
  engine.recordReviewTerminal.mockResolvedValue(undefined);
  engine.completeReview.mockResolvedValue(undefined);
  engine.failReview.mockResolvedValue(undefined);
});

describe("ReviewWorkflow orchestration", () => {
  it("runs and records every retryable review step", async () => {
    const { workflow, step } = fixture();

    await workflow.run(event, step);

    expect(engine.runScouts).toHaveBeenCalledTimes(2);
    expect(engine.runScouts).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      payload,
      prepared,
      {
        providers: ["openrouter"],
        observationId: `${event.instanceId}:openrouter`,
      },
    );
    expect(engine.runScouts).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      payload,
      prepared,
      {
        providers: ["opencode"],
        observationId: `${event.instanceId}:opencode`,
      },
    );
    expect(engine.combineScoutRuns).toHaveBeenCalledWith(scouts, emptyScouts);
    expect(engine.mergeFindings).toHaveBeenCalledOnce();
    expect(vi.mocked(step.do).mock.calls[2]?.[1]).toMatchObject({
      retries: { limit: 1 },
    });
    expect(vi.mocked(step.do).mock.calls[3]?.[1]).toMatchObject({
      retries: { limit: 1 },
    });
    expect(vi.mocked(step.do).mock.calls[4]?.[1]).toMatchObject({
      retries: { limit: 1 },
    });
    expect(engine.publishReview).toHaveBeenCalledOnce();
    expect(engine.identifyReviewArtifacts).toHaveBeenCalledWith(
      prepared,
      scouts,
      merged,
      expect.objectContaining({
        version: "deterministic-publication-v1",
        maxVisibleFindings: 7,
      }),
    );
    expect(engine.recordReview).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceId: event.instanceId,
        prepared,
        scouts,
        merged,
        artifacts,
        timestamp: event.timestamp,
      }),
    );
    expect(engine.completeReview).toHaveBeenCalledOnce();
    expect(
      vi.mocked(step.do).mock.calls.map(([name]) => name),
    ).toEqual([
      "prepare-review",
      "claim-review",
      "run-openrouter-scouts",
      "run-opencode-scouts",
      "merge-current-scout-findings",
      "identify-review-artifacts",
      "publish-rolling-comment",
      "record-versioned-review",
      "complete-review-state",
    ]);
  });

  it("publishes an empty review without invoking models", async () => {
    engine.prepareReview.mockResolvedValue({ ...prepared, diff: "" });
    const { workflow, step } = fixture();

    await workflow.run(event, step);

    expect(engine.runScouts).not.toHaveBeenCalled();
    expect(engine.mergeFindings).not.toHaveBeenCalled();
    expect(engine.publishReview).toHaveBeenCalledWith(
      expect.anything(),
      payload,
      expect.objectContaining({ diff: "" }),
      expect.objectContaining({ models: [], metrics: [] }),
      expect.objectContaining({
        result: {
          summary: "No reviewable text changes found.",
          findings: [],
        },
        cost: 0,
      }),
      artifacts,
      { runs: 0, total_usd: 0 },
    );
  });

  it("stops after eligibility or durable-claim rejection", async () => {
    const skipped = fixture();
    engine.prepareReview.mockResolvedValueOnce({
      skipReason: "pull request is draft",
      paths: [],
      omitted: [],
    });
    await skipped.workflow.run(event, skipped.step);
    expect(engine.claimReview).not.toHaveBeenCalled();
    expect(engine.recordReviewTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ status: "skipped" }),
    );

    engine.prepareReview.mockResolvedValueOnce(prepared);
    engine.claimReview.mockResolvedValueOnce({
      claimed: false,
      reason: "already reviewed",
      previousState: { runs: 1, total_usd: 0.5 },
    });
    const duplicate = fixture();
    await duplicate.workflow.run(event, duplicate.step);
    expect(engine.runScouts).not.toHaveBeenCalled();
    expect(engine.recordReviewTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ status: "denied" }),
    );
  });

  it("claims and completes deterministic skipped coverage without invoking models", async () => {
    const coverage = {
      mode: "skipped",
      reason: "all current semantic hunks were covered",
      totalHunks: 1,
      reviewedHunkIds: [],
      unchangedHunkIds: [`h_${"a".repeat(24)}`],
      skippedHunkIds: [],
      affectedFindingIds: [],
      paths: [],
      skippedPaths: [],
    };
    const skippedPrepared = {
      ...prepared,
      skipReason: coverage.reason,
      coverage,
    };
    engine.prepareReview.mockResolvedValueOnce(skippedPrepared);
    const { workflow, step } = fixture();

    await workflow.run(event, step);

    expect(engine.claimReview).toHaveBeenCalledWith(
      expect.anything(),
      payload,
      event.instanceId,
      skippedPrepared,
    );
    expect(engine.runScouts).not.toHaveBeenCalled();
    expect(engine.publishSkippedReview).toHaveBeenCalledWith(
      expect.anything(),
      payload,
      skippedPrepared,
    );
    expect(engine.recordReviewTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "skipped",
        publication: expect.objectContaining({ runCostUsd: 0 }),
      }),
    );
    expect(engine.completeReview).toHaveBeenCalledWith(
      expect.anything(),
      payload,
      event.instanceId,
      skippedPrepared,
      { result: { finding_resolutions: [] }, cost: 0 },
      { hunks: [], candidates: {}, publishedFindings: [] },
      expect.objectContaining({ runCostUsd: 0 }),
    );
    expect(vi.mocked(step.do).mock.calls.map(([name]) => name)).toEqual([
      "prepare-review",
      "claim-skipped-review",
      "publish-skipped-coverage",
      "record-skipped-review",
      "complete-skipped-review-state",
    ]);
  });

  it("records a denied skipped review without publishing coverage", async () => {
    const skippedPrepared = {
      ...prepared,
      skipReason: "all current semantic hunks were covered",
      coverage: {
        mode: "skipped",
        reason: "all current semantic hunks were covered",
        totalHunks: 1,
        reviewedHunkIds: [],
        unchangedHunkIds: [`h_${"a".repeat(24)}`],
        skippedHunkIds: [],
        affectedFindingIds: [],
        paths: [],
        skippedPaths: [],
      },
    };
    engine.prepareReview.mockResolvedValueOnce(skippedPrepared);
    engine.claimReview.mockResolvedValueOnce({
      claimed: false,
      reason: "this content and reviewer configuration were already reviewed",
      previousState: { runs: 1, total_usd: 0.6 },
    });
    const { workflow, step } = fixture();

    await workflow.run(event, step);

    expect(engine.publishSkippedReview).not.toHaveBeenCalled();
    expect(engine.completeReview).not.toHaveBeenCalled();
    expect(engine.recordReviewTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "denied",
        reason: "this content and reviewer configuration were already reviewed",
      }),
    );
    expect(vi.mocked(step.do).mock.calls.map(([name]) => name)).toEqual([
      "prepare-review",
      "claim-skipped-review",
      "record-denied-skipped-review",
    ]);
  });

  it("records known model spend before propagating a failure", async () => {
    engine.mergeFindings.mockRejectedValue(new Error("merger unavailable"));
    const { workflow, step } = fixture();

    await expect(workflow.run(event, step)).rejects.toThrow(
      "merger unavailable",
    );

    expect(engine.failReview).toHaveBeenCalledWith(
      expect.anything(),
      payload,
      event.instanceId,
      expect.any(Error),
      0.4,
    );
    expect(engine.recordReviewTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        failedPhase: "merge-current-scout-findings",
        incurredCostUsd: 0.4,
      }),
    );
  });

  it("includes paid invalid merger output in failed review spend", async () => {
    const error = new Error("invalid merger output");
    engine.mergeFindings.mockRejectedValue(error);
    engine.modelFailureCostUsd.mockReturnValue(0.2);
    const { workflow, step } = fixture();

    await expect(workflow.run(event, step)).rejects.toThrow(
      "invalid merger output",
    );

    expect(engine.modelFailureCostUsd).toHaveBeenCalledWith(error);
    expect(engine.failReview).toHaveBeenCalledWith(
      expect.anything(),
      payload,
      event.instanceId,
      error,
      expect.any(Number),
    );
    expect(engine.failReview.mock.calls[0]?.[4]).toBeCloseTo(0.6);
    expect(engine.recordReviewTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ incurredCostUsd: expect.any(Number) }),
    );
    expect(engine.recordReviewTerminal.mock.calls[0]?.[0].incurredCostUsd)
      .toBeCloseTo(0.6);
  });

  it("preserves the original failure when failure-state recording also fails", async () => {
    engine.runScouts
      .mockReset()
      .mockRejectedValue(new Error("scouts unavailable"));
    engine.failReview.mockRejectedValue(new Error("coordinator unavailable"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { workflow, step } = fixture();

    await expect(workflow.run(event, step)).rejects.toThrow(
      "scouts unavailable",
    );

    expect(consoleError).toHaveBeenCalledWith(
      "Could not record failed review state",
      { type: "Error" },
    );
  });
});
