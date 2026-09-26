import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OPENROUTER_SCOUTS,
  Reviewer,
} from "ai-review-domain/reviewer";
import type { Env, ReviewWorkflowParams } from "../src/env";
import {
  STATEFUL_REVIEW_MARKER,
  claimReview,
  combineScoutRuns,
  completeReview,
  decideReviewCoverage,
  failReview,
  identifyReviewArtifacts,
  identifyDiffHunks,
  mergeFindings,
  MergerOutputError,
  modelFailureCostUsd,
  prepareReview,
  publishReview,
  publishSkippedReview,
  recordReview,
  runScouts,
} from "../src/review-engine";

const HEAD_SHA = "a".repeat(40);

const params: ReviewWorkflowParams = {
  deliveryId: "delivery-1",
  eventName: "pull_request",
  action: "synchronize",
  repository: "Robbie-Palmer/hq",
  pullRequestNumber: 42,
  headSha: HEAD_SHA,
  force: false,
};

const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();

function environment(put = vi.fn()): Env {
  return {
    AI_REVIEW_MODELS:
      "moonshotai/kimi-k2.6,deepseek/deepseek-v4-pro,z-ai/glm-5.3-flash,inclusionai/ling-2.6-1t",
    AI_REVIEW_OPENCODE_MODELS: "",
    AI_REVIEW_MERGER_MODEL: "google/gemini-3.7-flash",
    AI_REVIEW_IGNORED_AUTHORS: "renovate[bot],dependabot[bot]",
    AI_REVIEW_ZDR: "false",
    AI_REVIEW_APP_BOT_LOGIN: "robbie-palmer-ai-review[bot]",
    AI_REVIEW_MAX_PR_COST_USD: "5",
    AI_REVIEW_MAX_RUNS_PER_PR: "20",
    AI_REVIEW_PROMPT_VERSION: "stateless-parity-v1",
    AI_REVIEW_APP_ID: "123",
    AI_REVIEW_APP_INSTALLATION_ID: "456",
    AI_REVIEW_APP_PRIVATE_KEY: privateKey,
    OPENROUTER_API_KEY: "openrouter-key",
    REVIEW_DATA: { put },
  } as unknown as Env;
}

function json(payload: unknown): Response {
  return Response.json(payload);
}

function reviewer(): Reviewer {
  return new Reviewer({
    githubToken: "github-token",
    openRouterKey: "openrouter-key",
    repository: params.repository,
    prNumber: params.pullRequestNumber,
    openRouterScouts: [],
    openCodeScouts: [],
    merger: "merger",
    ignoredAuthors: [],
    requireZdr: false,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("stateful review engine", () => {
  it("reserves the bounded diff budget for reviewable files", async () => {
    const ignoredPatch = `@@ -1 +1 @@\n-${"a".repeat(27_000)}\n+${"b".repeat(27_000)}`;
    const sourcePatch = `@@ -1 +1 @@\n-${"a".repeat(5_000)}\n+${"b".repeat(5_000)}`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        json([
          ...Array.from({ length: 5 }, (_, index) => ({
            filename: `src/client-${index}.generated.ts`,
            status: "modified",
            patch: ignoredPatch,
          })),
          { filename: "src/app.ts", status: "modified", patch: sourcePatch },
        ]),
      ),
    );

    const changed = await reviewer().changedFiles({ includeIgnored: true });

    expect(changed.paths[0]).toBe("src/app.ts");
    expect(changed.diff).toContain("diff --git a/src/app.ts b/src/app.ts");
    expect(changed.omitted).not.toContain("src/app.ts");
  });

  it("batches exact-head file context instead of fetching every path", async () => {
    const paths = Array.from({ length: 37 }, (_, index) => `src/file-${index}.ts`);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        query: string;
        variables: Record<string, string>;
      };
      expect(body.query).toContain("query FileContext");
      const expressionCount = Object.keys(body.variables).filter((key) =>
        key.startsWith("expression"),
      ).length;
      return json({
        data: {
          repository: Object.fromEntries(
            Array.from({ length: expressionCount }, (_, index) => [
              `file${index}`,
              {
                byteSize: 24,
                isBinary: false,
                isTruncated: false,
                text: `export const file${index} = true;`,
              },
            ]),
          ),
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const context = await reviewer().fileContext(paths, HEAD_SHA);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(context).toContain("FILE src/file-0.ts");
    expect(context).toContain("FILE src/file-36.ts");
    for (const [, init] of fetchMock.mock.calls) {
      const body = JSON.parse(String(init?.body)) as {
        variables: Record<string, string>;
      };
      for (const [key, expression] of Object.entries(body.variables)) {
        if (key.startsWith("expression")) {
          expect(expression).toMatch(new RegExp(`^${HEAD_SHA}:src/file-`));
        }
      }
    }
  });

  it("caps per-file REST fallbacks when a GraphQL batch fails", async () => {
    const paths = Array.from({ length: 10 }, (_, index) => `src/file-${index}.ts`);
    const errorMock = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/graphql") {
        return json({ errors: [{ message: "temporary GraphQL failure" }] });
      }
      if (url.pathname.includes("/contents/")) {
        return json({
          encoding: "base64",
          size: 20,
          content: Buffer.from("export default true;").toString("base64"),
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const context = await reviewer().fileContext(paths, HEAD_SHA);

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(context).toContain("FILE src/file-0.ts");
    expect(context).toContain("FILE src/file-3.ts");
    expect(context).not.toContain("FILE src/file-4.ts");
    expect(errorMock).toHaveBeenCalledWith(
      "::warning::Skipped 6 file-context path(s) after the REST fallback limit was exhausted",
    );
  });

  it("does not automatically spend on fork pull requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json({ token: "installation-token" }))
        .mockResolvedValueOnce(
          json({
            state: "open",
            draft: false,
            author_association: "CONTRIBUTOR",
            user: { login: "outside-contributor" },
            head: {
              sha: params.headSha,
              repo: { full_name: "outside-contributor/personal-site" },
            },
          }),
        ),
    );

    await expect(prepareReview(environment(), params)).resolves.toMatchObject({
      skipReason: "automatic review is not eligible for this author or fork",
    });
  });

  it("skips drafts and ignored authors but permits a forced draft review", async () => {
    const draft = {
      state: "open",
      draft: true,
      author_association: "OWNER",
      user: { login: "robbie" },
      head: {
        sha: HEAD_SHA,
        repo: { full_name: params.repository },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json({ token: "installation-token" }))
        .mockResolvedValueOnce(json(draft)),
    );
    await expect(prepareReview(environment(), params)).resolves.toMatchObject({
      skipReason: "pull request is draft",
    });

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json({ token: "installation-token" }))
        .mockResolvedValueOnce(
          json({
            ...draft,
            draft: false,
            user: { login: "renovate[bot]" },
          }),
        ),
    );
    await expect(prepareReview(environment(), params)).resolves.toMatchObject({
      skipReason: "ignored author renovate[bot]",
    });

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json({ token: "installation-token" }))
        .mockResolvedValueOnce(json(draft))
        .mockResolvedValueOnce(json([])),
    );
    await expect(
      prepareReview(environment(), { ...params, force: true }),
    ).resolves.toMatchObject({
      headSha: params.headSha,
      diff: "",
      context: "",
      guidelines: "",
      threads: "",
    });
  });

  it("skips generated, lockfile, and whitespace-only hunks automatically", async () => {
    const pullRequest = {
      state: "open",
      draft: false,
      author_association: "OWNER",
      user: { login: "robbie" },
      head: {
        sha: HEAD_SHA,
        repo: { full_name: params.repository },
      },
    };
    const files = [
      {
        filename: "pnpm-lock.yaml",
        status: "modified",
        patch: "@@ -1 +1 @@\n-lock: one\n+lock: two",
      },
      {
        filename: "src/client.generated.ts",
        status: "modified",
        patch: "@@ -1 +1 @@\n-export const value=1\n+export const value=2",
      },
      {
        filename: "src/app.ts",
        status: "modified",
        patch: "@@ -1 +1 @@\n-  export const value = 1\n+    export const value = 1",
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json({ token: "installation-token" }))
        .mockResolvedValueOnce(json(pullRequest))
        .mockResolvedValueOnce(json(files)),
    );

    await expect(prepareReview(environment(), params)).resolves.toMatchObject({
      skipReason: "no semantic hunks to review",
      diff: "",
      coverage: {
        mode: "skipped",
        reviewedHunkIds: [],
        skippedPaths: [
          "pnpm-lock.yaml",
          "src/app.ts",
          "src/client.generated.ts",
        ],
      },
    });
  });

  it("keeps ignored hunks out of risk escalation but includes them when forced", async () => {
    const pullRequest = {
      state: "open",
      draft: false,
      author_association: "OWNER",
      user: { login: "robbie" },
      head: {
        sha: HEAD_SHA,
        ref: "feature",
        repo: { full_name: params.repository },
      },
      labels: [],
    };
    const diff =
      "diff --git a/.github/workflows/deploy.yml b/.github/workflows/deploy.yml\n" +
      "status modified\n@@ -1 +1 @@\n-old\n+new\n" +
      "diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml\n" +
      "status modified\n@@ -1 +1 @@\n-old lock\n+new lock\n";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ token: "installation-token" })),
    );
    vi.spyOn(Reviewer.prototype, "getPr").mockResolvedValue(pullRequest);
    vi.spyOn(Reviewer.prototype, "changedFiles").mockResolvedValue({
      diff,
      paths: [".github/workflows/deploy.yml", "pnpm-lock.yaml"],
      omitted: [],
    });
    vi.spyOn(Reviewer.prototype, "fileContext").mockResolvedValue("");
    vi.spyOn(Reviewer.prototype, "headGuidelines").mockResolvedValue("");
    vi.spyOn(Reviewer.prototype, "pullRequestReviewContext").mockResolvedValue({ threads: "", reviewers: [] });

    const automatic = await prepareReview(environment(), params);
    expect(automatic.coverage).toMatchObject({
      mode: "full",
      skippedPaths: ["pnpm-lock.yaml"],
    });
    expect(automatic.paths).toEqual([".github/workflows/deploy.yml"]);
    expect(automatic.diff).not.toContain("pnpm-lock.yaml");
    expect(automatic.allHunks).toHaveLength(2);

    const forced = await prepareReview(environment(), {
      ...params,
      force: true,
    });
    expect(forced.paths).toEqual([
      ".github/workflows/deploy.yml",
      "pnpm-lock.yaml",
    ]);
    expect(forced.diff).toContain("pnpm-lock.yaml");
  });

  it("treats hunk content beginning with diff-header characters as semantic", async () => {
    const diff =
      "diff --git a/config.txt b/config.txt\n" +
      "status modified\n@@ -1 +1 @@\n----\n++++\n";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ token: "installation-token" })),
    );
    vi.spyOn(Reviewer.prototype, "getPr").mockResolvedValue({
      state: "open",
      draft: false,
      author_association: "OWNER",
      user: { login: "robbie" },
      head: {
        sha: HEAD_SHA,
        ref: "feature",
        repo: { full_name: params.repository },
      },
      labels: [],
    });
    vi.spyOn(Reviewer.prototype, "changedFiles").mockResolvedValue({
      diff,
      paths: ["config.txt"],
      omitted: [],
    });
    vi.spyOn(Reviewer.prototype, "fileContext").mockResolvedValue("");
    vi.spyOn(Reviewer.prototype, "headGuidelines").mockResolvedValue("");
    vi.spyOn(Reviewer.prototype, "pullRequestReviewContext").mockResolvedValue({ threads: "", reviewers: [] });

    const prepared = await prepareReview(environment(), params);

    expect(prepared.skipReason).toBeUndefined();
    expect(prepared.coverage).toMatchObject({ mode: "full", totalHunks: 1 });
    expect(prepared.diff).toContain("----\n++++");
  });

  it("does not resend an unchanged hunk after synchronize", async () => {
    const patch =
      "@@ -1 +1 @@\n-old first\n+reviewed first\n" +
      "@@ -10 +10 @@\n-old second\n+new second";
    const fullDiff =
      `diff --git a/app.ts b/app.ts\nstatus modified\n${patch}\n`;
    const [reviewedHunk, newHunk] = await identifyDiffHunks(fullDiff);
    expect(reviewedHunk).toBeDefined();
    expect(newHunk).toBeDefined();

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json({ token: "installation-token" }))
        .mockResolvedValueOnce(
          json({
            state: "open",
            draft: false,
            author_association: "OWNER",
            user: { login: "robbie" },
            head: {
              sha: params.headSha,
              repo: { full_name: params.repository },
            },
          }),
        )
        .mockResolvedValueOnce(
          json([{ filename: "app.ts", status: "modified", patch }]),
        )
        .mockResolvedValueOnce(
          json({
            data: {
              repository: {
                file0: {
                  byteSize: 30,
                  isBinary: false,
                  isTruncated: false,
                  text: "reviewed first\nnew second",
                },
              },
            },
          }),
        )
        .mockResolvedValueOnce(
          json({
            encoding: "base64",
            size: 19,
            content: Buffer.from("Review correctness.").toString("base64"),
          }),
        )
        .mockResolvedValueOnce(
          json({
            data: {
              repository: {
                pullRequest: {
                  reviews: {
                    nodes: [
                      { author: { login: "reviewer-b" } },
                      { author: { login: "reviewer-a" } },
                      { author: { login: "reviewer-b" } },
                    ],
                  },
                  reviewThreads: { nodes: [] },
                },
              },
            },
          }),
        ),
    );
    const env = environment();
    Object.assign(env, {
      PR_STATE: {
        idFromName: vi.fn(() => "coordinator-id"),
        get: vi.fn(() => ({
          fetch: vi.fn(() =>
            Promise.resolve(
              json({
                headSha: "b".repeat(40),
                hunkIds: [reviewedHunk!.hunkId],
                openFindings: [],
              }),
            ),
          ),
        })),
      },
    });

    const prepared = await prepareReview(env, params);

    expect(prepared.coverage).toMatchObject({
      mode: "incremental",
      reviewedHunkIds: [newHunk!.hunkId],
      unchangedHunkIds: [reviewedHunk!.hunkId],
    });
    expect(prepared.diff).toContain("+new second");
    expect(prepared.diff).not.toContain("+reviewed first");
    expect(prepared.hunks).toEqual([newHunk]);
    expect(prepared.allHunks).toEqual([reviewedHunk, newHunk]);
    expect(prepared.pullRequest?.reviewers).toEqual(["reviewer-a", "reviewer-b"]);
  });

  it("rejects invalid model configuration before making model calls", async () => {
    const prepared = {
      headSha: params.headSha,
      diff: "diff",
      paths: ["app.ts"],
      omitted: [],
    };

    const tooManyPaid = environment();
    tooManyPaid.AI_REVIEW_MODELS = Array.from(
      { length: 7 },
      (_, index) => `provider/model-${index}`,
    ).join(",");
    await expect(runScouts(tooManyPaid, params, prepared)).rejects.toThrow(
      "AI_REVIEW_MODELS must contain at most 6",
    );

    const tooManyFree = environment();
    tooManyFree.AI_REVIEW_OPENCODE_MODELS = Array.from(
      { length: 7 },
      (_, index) => `model-${index}-free`,
    ).join(",");
    await expect(runScouts(tooManyFree, params, prepared)).rejects.toThrow(
      "AI_REVIEW_OPENCODE_MODELS must contain at most 6",
    );

    const ineligible = environment();
    ineligible.AI_REVIEW_OPENCODE_MODELS = "paid-model";
    await expect(runScouts(ineligible, params, prepared)).rejects.toThrow(
      "contains ineligible IDs",
    );
    await expect(
      runScouts(environment(), params, {
        paths: [],
        omitted: [],
      }),
    ).rejects.toThrow("without a prepared diff");
  });

  it("uses reviewer defaults when optional model settings are absent", async () => {
    const env = environment();
    env.AI_REVIEW_MODELS = undefined;
    env.AI_REVIEW_OPENCODE_MODELS = undefined;
    env.AI_REVIEW_MERGER_MODEL = undefined;
    env.AI_REVIEW_IGNORED_AUTHORS = undefined;
    env.AI_REVIEW_ZDR = undefined;
    vi.spyOn(Reviewer.prototype, "openCodeScoutModels").mockResolvedValue({
      models: [],
      unavailable: [],
    });
    vi.spyOn(Reviewer.prototype, "callOpenRouterScout").mockRejectedValue(
      new Error("provider unavailable"),
    );

    const result = await runScouts(env, params, {
      headSha: params.headSha,
      diff: "diff",
      paths: ["app.ts"],
      omitted: [],
    });

    expect(result.models).toEqual(DEFAULT_OPENROUTER_SCOUTS);
  });

  it("isolates paid and free scout executions before combining them", async () => {
    const openCodeModels = vi.spyOn(
      Reviewer.prototype,
      "openCodeScoutModels",
    );
    const openRouterScout = vi
      .spyOn(Reviewer.prototype, "callOpenRouterScout")
      .mockResolvedValue({ payload: { findings: [] }, cost: 0.01 });
    const openCodeScout = vi
      .spyOn(Reviewer.prototype, "callOpenCodeScout")
      .mockResolvedValue({ payload: { findings: [] }, cost: 0 });
    const prepared = {
      headSha: HEAD_SHA,
      diff: "diff",
      paths: ["app.ts"],
      omitted: [],
    };

    const paid = await runScouts(environment(), params, prepared, {
      providers: ["openrouter"],
    });
    expect(openCodeModels).not.toHaveBeenCalled();
    expect(openCodeScout).not.toHaveBeenCalled();
    expect(paid.models).toEqual([
      "moonshotai/kimi-k2.6",
      "deepseek/deepseek-v4-pro",
      "z-ai/glm-5.3-flash",
      "inclusionai/ling-2.6-1t",
    ]);

    openCodeModels.mockResolvedValue({
      models: ["big-pickle"],
      unavailable: [],
    });
    const free = await runScouts(environment(), params, prepared, {
      providers: ["opencode"],
    });
    expect(openRouterScout).toHaveBeenCalledTimes(4);
    expect(free.models).toEqual(["big-pickle"]);

    const combined = combineScoutRuns(paid, free);
    expect(combined.models).toEqual([
      "moonshotai/kimi-k2.6",
      "deepseek/deepseek-v4-pro",
      "z-ai/glm-5.3-flash",
      "inclusionai/ling-2.6-1t",
      "big-pickle",
    ]);
    expect(combined.metrics).toHaveLength(5);
  });

  it("skips models in cooldown and records only attempted scouts", async () => {
    const callScout = vi
      .spyOn(Reviewer.prototype, "callOpenRouterScout")
      .mockResolvedValue({ payload: { findings: [] }, cost: 0.01 });
    const recordedBodies: unknown[] = [];
    const coordinatorFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (path === "/models/plan") {
          return json({
            skipped: [
              null,
              [],
              1,
              {},
              { model: "model-a", provider: "other" },
              {
                model: "model-a",
                provider: "openrouter",
                consecutiveFailures: "2",
                cooldownUntil: "2026-08-27T00:01:00.000Z",
              },
              {
                model: "model-a",
                provider: "openrouter",
                consecutiveFailures: 1.5,
                cooldownUntil: "2026-08-27T00:01:00.000Z",
              },
              {
                model: "model-a",
                provider: "openrouter",
                consecutiveFailures: 0,
                cooldownUntil: "2026-08-27T00:01:00.000Z",
              },
              {
                model: "model-a",
                provider: "openrouter",
                consecutiveFailures: 2,
                cooldownUntil: 1,
              },
              {
                model: "model-a",
                provider: "openrouter",
                consecutiveFailures: 2,
                cooldownUntil: "not-a-date",
              },
              {
                model: "model-b",
                provider: "opencode",
                consecutiveFailures: 2,
                cooldownUntil: "2026-08-27T00:01:00.000Z",
              },
              {
                model: "model-a",
                provider: "openrouter",
                consecutiveFailures: 2,
                cooldownUntil: "2026-08-27T00:01:00.000Z",
              },
            ],
          });
        }
        recordedBodies.push(JSON.parse(String(init?.body)));
        return json({ recorded: 1 });
      },
    );
    const env = environment();
    env.AI_REVIEW_MODELS = "model-a,model-b";
    Object.assign(env, {
      PR_STATE: {
        idFromName: vi.fn(() => "model-reliability-id"),
        get: vi.fn(() => ({ fetch: coordinatorFetch })),
      },
    });

    const result = await runScouts(
      env,
      params,
      {
        headSha: params.headSha,
        diff: "diff",
        paths: ["app.ts"],
        omitted: [],
      },
      { providers: ["openrouter"], observationId: "scout-observation" },
    );

    expect(callScout).toHaveBeenCalledOnce();
    expect(callScout).toHaveBeenCalledWith(
      "model-b",
      expect.any(String),
      expect.any(String),
    );
    expect(result.circuitSkipped).toEqual([
      expect.objectContaining({ model: "model-a", consecutiveFailures: 2 }),
    ]);
    expect(result.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ model: "model-a", skipped: true }),
        expect.objectContaining({ model: "model-b", ok: true }),
      ]),
    );
    expect(recordedBodies).toEqual([
      expect.objectContaining({
        observationId: "scout-observation",
        metrics: [expect.objectContaining({ model: "model-b", ok: true })],
      }),
    ]);
    expect(
      combineScoutRuns(result, {
        models: [],
        candidates: {},
        failed: [],
        candidateCounts: {},
        invalidCounts: {},
        outOfScopeCounts: {},
        costs: {},
        metrics: [],
      }).circuitSkipped,
    ).toHaveLength(1);
  });

  it("keeps reviewing when circuit-breaker coordination fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    vi.spyOn(Reviewer.prototype, "callOpenRouterScout").mockResolvedValue({
      payload: { findings: [] },
      cost: 0.01,
    });
    const coordinatorFetch = vi.fn(async (input: RequestInfo | URL) => {
      if (new URL(String(input)).pathname === "/models/plan") throw "offline";
      return new Response("unavailable", { status: 503 });
    });
    const env = environment();
    env.AI_REVIEW_MODELS = "model-a";
    Object.assign(env, {
      PR_STATE: {
        idFromName: vi.fn(() => "model-reliability-id"),
        get: vi.fn(() => ({ fetch: coordinatorFetch })),
      },
    });

    const result = await runScouts(
      env,
      params,
      {
        headSha: params.headSha,
        diff: "diff",
        paths: ["app.ts"],
        omitted: [],
      },
      { providers: ["openrouter"] },
    );

    expect(result.metrics).toEqual([
      expect.objectContaining({ model: "model-a", ok: true }),
    ]);
    expect(consoleError).toHaveBeenCalledTimes(2);
  });

  it("records unavailable, rejected, and invalid scout outcomes", async () => {
    vi.spyOn(Reviewer.prototype, "openCodeScoutModels").mockResolvedValue({
      models: [],
      unavailable: ["unavailable-free"],
    });
    vi.spyOn(Reviewer.prototype, "callOpenRouterScout")
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockResolvedValueOnce({
        payload: { unexpected: [] },
        cost: 0.1,
      });

    const result = await runScouts(environment(), params, {
      headSha: params.headSha,
      diff: "diff",
      paths: ["app.ts"],
      omitted: [],
    });

    expect(result.failed).toEqual([
      "unavailable-free",
      "moonshotai/kimi-k2.6",
      "deepseek/deepseek-v4-pro",
      "z-ai/glm-5.3-flash",
      "inclusionai/ling-2.6-1t",
    ]);
    expect(result.invalidCounts["deepseek/deepseek-v4-pro"]).toBe(1);
    expect(result.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          model: "unavailable-free",
          ok: false,
        }),
        expect.objectContaining({
          model: "moonshotai/kimi-k2.6",
          error: "provider unavailable",
        }),
        expect.objectContaining({
          model: "deepseek/deepseek-v4-pro",
          ok: false,
        }),
        expect.objectContaining({
          model: "z-ai/glm-5.3-flash",
          ok: false,
        }),
        expect.objectContaining({
          model: "inclusionai/ling-2.6-1t",
          ok: false,
        }),
      ]),
    );
  });

  it("rejects duplicate providers and skips merging without candidates", async () => {
    vi.spyOn(Reviewer.prototype, "openCodeScoutModels").mockResolvedValue({
      models: ["moonshotai/kimi-k2.6"],
      unavailable: [],
    });
    await expect(
      runScouts(environment(), params, {
        headSha: params.headSha,
        diff: "diff",
        paths: ["app.ts"],
        omitted: [],
      }),
    ).rejects.toThrow("must be unique across providers");

    await expect(
      mergeFindings(
        environment(),
        params,
        { paths: [], omitted: [] },
        {
          models: [],
          candidates: {},
          failed: [],
          candidateCounts: {},
          invalidCounts: {},
          outOfScopeCounts: {},
          costs: {},
          metrics: [],
        },
      ),
    ).resolves.toEqual({
      result: {
        summary:
          "All scouts failed or were unavailable, so this run has no review coverage.",
        findings: [],
      },
      cost: 0,
    });

    const replayFindingId = `f_${"d".repeat(24)}`;
    await expect(
      mergeFindings(
        environment(),
        params,
        {
          paths: [],
          omitted: [],
          replayFindings: [{
            findingId: replayFindingId,
            file: "app.ts",
            title: "Replay unavailable",
            hunkIds: [],
          }],
        },
        {
          models: [],
          candidates: {},
          failed: [],
          candidateCounts: {},
          invalidCounts: {},
          outOfScopeCounts: {},
          costs: {},
          metrics: [],
        },
      ),
    ).resolves.toMatchObject({
      result: {
        finding_resolutions: [{
          finding_id: replayFindingId,
          verdict: "uncertain",
        }],
      },
    });
  });

  it("returns an explicit incomplete result while the merger is cooling down", async () => {
    const findingId = `f_${"d".repeat(24)}`;
    const callMerger = vi.spyOn(Reviewer.prototype, "callMerger");
    const env = environment();
    Object.assign(env, {
      PR_STATE: {
        idFromName: vi.fn(() => "model-reliability-id"),
        get: vi.fn(() => ({
          fetch: vi.fn(() =>
            Promise.resolve(
              json({
                skipped: [{
                  model: "google/gemini-3.7-flash",
                  provider: "openrouter",
                  consecutiveFailures: 3,
                  cooldownUntil: "2026-08-27T00:01:00.000Z",
                }],
              }),
            )
          ),
        })),
      },
    });

    const merged = await mergeFindings(
      env,
      params,
      {
        paths: ["app.ts"],
        omitted: [],
        replayFindings: [{
          findingId,
          file: "app.ts",
          title: "Retry is missing",
          hunkIds: [],
        }],
      },
      {
        models: ["model/scout"],
        candidates: { "model/scout": [] },
        failed: [],
        candidateCounts: { "model/scout": 0 },
        invalidCounts: { "model/scout": 0 },
        outOfScopeCounts: { "model/scout": 0 },
        costs: { "model/scout": 0 },
        metrics: [],
      },
    );

    expect(callMerger).not.toHaveBeenCalled();
    expect(merged).toMatchObject({
      result: {
        findings: [],
        finding_resolutions: [{ finding_id: findingId, verdict: "uncertain" }],
      },
      cost: 0,
      metric: { skipped: true, consecutiveFailures: 3 },
    });
  });

  it("records a failed merger attempt before propagating the error", async () => {
    vi.spyOn(Reviewer.prototype, "callMerger").mockRejectedValue(
      new Error("merger unavailable"),
    );
    const recordedBodies: unknown[] = [];
    const env = environment();
    Object.assign(env, {
      PR_STATE: {
        idFromName: vi.fn(() => "model-reliability-id"),
        get: vi.fn(() => ({
          fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            if (new URL(String(input)).pathname === "/models/plan") {
              return json({ skipped: [] });
            }
            recordedBodies.push(JSON.parse(String(init?.body)));
            return json({ recorded: 1 });
          }),
        })),
      },
    });

    await expect(
      mergeFindings(
        env,
        params,
        { paths: ["app.ts"], omitted: [] },
        {
          models: ["model/scout"],
          candidates: { "model/scout": [] },
          failed: [],
          candidateCounts: { "model/scout": 0 },
          invalidCounts: { "model/scout": 0 },
          outOfScopeCounts: { "model/scout": 0 },
          costs: { "model/scout": 0 },
          metrics: [],
        },
        { observationId: "merger-observation" },
      ),
    ).rejects.toThrow("merger unavailable");
    expect(recordedBodies).toEqual([
      expect.objectContaining({
        observationId: "merger-observation",
        metrics: [expect.objectContaining({ ok: false })],
      }),
    ]);
  });

  it("records an invalid merger response as a reliability failure", async () => {
    const findingId = `f_${"d".repeat(24)}`;
    vi.spyOn(Reviewer.prototype, "callMerger").mockResolvedValue({
      payload: {
        summary: "Replay omitted.",
        findings: [],
        finding_resolutions: [],
      },
      cost: 0.01,
      usage: {},
    } as never);
    const recordedBodies: unknown[] = [];
    const env = environment();
    Object.assign(env, {
      PR_STATE: {
        idFromName: vi.fn(() => "model-reliability-id"),
        get: vi.fn(() => ({
          fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            if (new URL(String(input)).pathname === "/models/plan") {
              return json({ skipped: [] });
            }
            recordedBodies.push(JSON.parse(String(init?.body)));
            return json({ recorded: 1 });
          }),
        })),
      },
    });

    const failure = mergeFindings(
        env,
        params,
        {
          paths: ["app.ts"],
          omitted: [],
          replayFindings: [{
            findingId,
            file: "app.ts",
            title: "Retry is missing",
            hunkIds: [],
          }],
        },
        {
          models: ["model/scout"],
          candidates: { "model/scout": [] },
          failed: [],
          candidateCounts: { "model/scout": 0 },
          invalidCounts: { "model/scout": 0 },
          outOfScopeCounts: { "model/scout": 0 },
          costs: { "model/scout": 0 },
          metrics: [],
        },
        { observationId: "invalid-merger-observation" },
      );
    await expect(failure).rejects.toThrow(
      "Merger omitted or invalidated a required controlled replay resolution",
    );
    await expect(failure).rejects.toBeInstanceOf(MergerOutputError);
    await failure.catch((error: unknown) => {
      expect(modelFailureCostUsd(error)).toBe(0.01);
    });
    expect(recordedBodies).toEqual([
      expect.objectContaining({
        observationId: "invalid-merger-observation",
        metrics: [
          expect.objectContaining({
            ok: false,
            error:
              "Merger omitted or invalidated a required controlled replay resolution",
          }),
        ],
      }),
    ]);
  });

  it("accepts provenance only from scouts that returned candidates", async () => {
    vi.spyOn(Reviewer.prototype, "callMerger").mockResolvedValue({
      payload: {
        summary: "One supported and one unsupported finding.",
        findings: [
          {
            severity: "high",
            file: "app.ts",
            line: 1,
            title: "Supported finding",
            evidence: "The changed return violates the contract.",
            recommendation: "Restore the expected return value.",
            confidence: 0.9,
            source_models: ["productive", "circuit-skipped"],
            status: "open",
            resolution_note: "",
          },
          {
            severity: "medium",
            file: "app.ts",
            line: 1,
            title: "Unsupported finding",
            evidence: "No successful scout supplied this candidate.",
            recommendation: "Do not publish it.",
            confidence: 0.8,
            source_models: ["circuit-skipped"],
            status: "open",
            resolution_note: "",
          },
        ],
      },
      cost: 0.01,
      usage: {},
    } as never);

    const merged = await mergeFindings(
      environment(),
      params,
      { paths: ["app.ts"], omitted: [] },
      {
        models: ["productive", "circuit-skipped"],
        candidates: {
          productive: [{
            severity: "high",
            file: "app.ts",
            line: 1,
            title: "Supported finding",
            evidence: "The changed return violates the contract.",
            recommendation: "Restore the expected return value.",
            confidence: 0.9,
          }],
          "circuit-skipped": [],
        },
        failed: [],
        candidateCounts: { productive: 1, "circuit-skipped": 0 },
        invalidCounts: { productive: 0, "circuit-skipped": 0 },
        outOfScopeCounts: { productive: 0, "circuit-skipped": 0 },
        costs: { productive: 0.01 },
        metrics: [],
      },
    );

    expect(merged.result.findings).toEqual([
      expect.objectContaining({
        title: "Supported finding",
        source_models: ["productive"],
      }),
    ]);
  });

  it("keeps only evidence-backed controlled replay verdicts", async () => {
    const findingId = `f_${"d".repeat(24)}`;
    const callMerger = vi
      .spyOn(Reviewer.prototype, "callMerger")
      .mockResolvedValue({
        payload: {
          summary: "Replay complete.",
          findings: [],
          finding_resolutions: [
            {
              finding_id: findingId,
              verdict: "fixed",
              evidence: "The current branch now schedules an alarm retry.",
            },
            {
              finding_id: `f_${"e".repeat(24)}`,
              verdict: "fixed",
              evidence: "Unknown finding.",
            },
          ],
        },
        cost: 0.01,
        usage: {},
      } as never);
    const merged = await mergeFindings(
      environment(),
      params,
      {
        paths: ["app.ts"],
        omitted: [],
        diff: "+scheduleRetry()",
        context: "FILE app.ts\nscheduleRetry();",
        replayFindings: [{
          findingId,
          file: "app.ts",
          title: "Outcome is never retried",
          hunkIds: [`h_${"a".repeat(24)}`],
          evidence: "A failed R2 put remains pending forever.",
        }],
      },
      {
        models: ["model/scout"],
        candidates: { "model/scout": [] },
        failed: [],
        candidateCounts: { "model/scout": 0 },
        invalidCounts: { "model/scout": 0 },
        outOfScopeCounts: { "model/scout": 0 },
        costs: { "model/scout": 0 },
        metrics: [],
      },
    );

    expect(callMerger.mock.calls[0]?.[2]).toContain(
      "A failed R2 put remains pending forever.",
    );
    expect(merged.result.finding_resolutions).toEqual([{
      finding_id: findingId,
      verdict: "fixed",
      evidence: "The current branch now schedules an alarm retry.",
    }]);
  });

  it("rejects a merger response that omits a controlled replay verdict", async () => {
    const findingId = `f_${"d".repeat(24)}`;
    vi.spyOn(Reviewer.prototype, "callMerger").mockResolvedValue({
      payload: {
        summary: "Replay omitted.",
        findings: [],
        finding_resolutions: [],
      },
      cost: 0.01,
      usage: {},
    } as never);

    await expect(
      mergeFindings(
        environment(),
        params,
        {
          paths: ["app.ts"],
          omitted: [],
          diff: "+scheduleRetry()",
          context: "FILE app.ts\nscheduleRetry();",
          replayFindings: [{
            findingId,
            file: "app.ts",
            title: "Outcome is never retried",
            hunkIds: [`h_${"a".repeat(24)}`],
          }],
        },
        {
          models: ["model/scout"],
          candidates: { "model/scout": [] },
          failed: [],
          candidateCounts: { "model/scout": 0 },
          invalidCounts: { "model/scout": 0 },
          outOfScopeCounts: { "model/scout": 0 },
          costs: { "model/scout": 0 },
          metrics: [],
        },
      ),
    ).rejects.toThrow(
      "Merger omitted or invalidated a required controlled replay resolution",
    );
  });

  it("uses durable claims and records completion and failure state", async () => {
    const coordinatorFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path === "/reviews/claim") {
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({ maxRuns: 20, maxCostUsd: 5 });
        return json({
          claimed: true,
          previousState: { runs: 0, total_usd: 0 },
        });
      }
      return json(path === "/reviews/complete" ? { completed: true } : { failed: true });
    });
    const env = environment();
    env.AI_REVIEW_MAX_RUNS_PER_PR = "-1";
    env.AI_REVIEW_MAX_PR_COST_USD = "not-a-number";
    Object.assign(env, {
      PR_STATE: {
        idFromName: vi.fn(() => "coordinator-id"),
        get: vi.fn(() => ({ fetch: coordinatorFetch })),
      },
    });
    const prepared = {
      headSha: params.headSha,
      diffFingerprint: "diff-fingerprint",
      configFingerprint: "config-fingerprint",
      paths: [],
      omitted: [],
    };

    await expect(
      claimReview(env, params, "review-1", prepared),
    ).resolves.toMatchObject({ claimed: true });
    await completeReview(
      env,
      params,
      "review-1",
      prepared,
      { result: { finding_resolutions: [] }, cost: 0 },
      { hunks: [], candidates: {}, publishedFindings: [] },
      { commentId: 42, runCostUsd: 0.25, findings: [] },
    );
    await failReview(env, params, "review-1", "failed");
    expect(coordinatorFetch).toHaveBeenCalledTimes(3);

    coordinatorFetch.mockResolvedValueOnce(
      new Response("unavailable", { status: 503 }),
    );
    await expect(
      claimReview(env, params, "review-2", prepared),
    ).rejects.toThrow("Coordinator /reviews/claim failed (503)");
    await expect(
      claimReview(env, params, "review-3", { paths: [], omitted: [] }),
    ).rejects.toThrow("Cannot claim an unprepared review");
  });

  it("refuses unprepared or stale publication and records only prepared runs", async () => {
    const env = environment();
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
    const emptyMerged = {
      result: { summary: "Clean.", findings: [] },
      cost: 0,
    };
    await expect(
      publishReview(
        env,
        params,
        { paths: [], omitted: [] },
        emptyScouts,
        emptyMerged,
        { hunks: [], candidates: {}, publishedFindings: [] },
        { runs: 0, total_usd: 0 },
      ),
    ).rejects.toThrow("Cannot publish an unprepared review");

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json({ token: "installation-token" }))
        .mockResolvedValueOnce(
          json({
            head: { sha: "b".repeat(40) },
          }),
        ),
    );
    await expect(
      publishReview(
        env,
        params,
        {
          headSha: params.headSha,
          paths: [],
          omitted: [],
        },
        emptyScouts,
        emptyMerged,
        { hunks: [], candidates: {}, publishedFindings: [] },
        { runs: 0, total_usd: 0 },
      ),
    ).rejects.toThrow("refusing stale comment");

    await expect(
      recordReview({
        env,
        params,
        instanceId: "review-1",
        prepared: { paths: [], omitted: [] },
        scouts: emptyScouts,
        merged: emptyMerged,
        artifacts: { hunks: [], candidates: {}, publishedFindings: [] },
        publication: { runCostUsd: 0, findings: [] },
        timestamp: new Date(),
      }),
    ).rejects.toThrow("Cannot record an unprepared review");
  });

  it("publishes skipped coverage without erasing prior fallback findings", async () => {
    const existingBody = [
      STATEFUL_REVIEW_MARKER,
      '<!-- ai-review-cost:{"runs":1,"total_usd":0.1} -->',
      "## Stateful AI code review",
      "",
      "**Coverage: Full coverage.** 1/1 semantic hunk(s) reviewed. Initial.",
      "",
      "## Findings without a diff line",
      "",
      "- Existing fallback finding",
    ].join("\n");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ token: "installation-token" }))
      .mockResolvedValueOnce(json({ head: { sha: params.headSha } }))
      .mockResolvedValueOnce(
        json([
          {
            id: 99,
            user: { login: "robbie-palmer-ai-review[bot]" },
            body: existingBody,
          },
        ]),
      )
      .mockResolvedValueOnce(json({}));
    vi.stubGlobal("fetch", fetchMock);

    const publication = await publishSkippedReview(environment(), params, {
      headSha: params.headSha,
      paths: [],
      omitted: [],
      coverage: {
        mode: "skipped",
        reason: "all current semantic hunks were covered",
        baselineHeadSha: "b".repeat(40),
        totalHunks: 1,
        reviewedHunkIds: [],
        unchangedHunkIds: [`h_${"a".repeat(24)}`],
        skippedHunkIds: [],
        affectedFindingIds: [],
        paths: [],
        skippedPaths: [],
      },
    });

    expect(publication).toMatchObject({ commentId: 99, runCostUsd: 0 });
    const update = JSON.parse(
      String(fetchMock.mock.calls[3]?.[1]?.body),
    ) as { body: string };
    expect(update.body).toContain("Coverage: Skipped coverage");
    expect(update.body).toContain("1 unchanged hunk(s) were not reviewed again");
    expect(update.body).toContain("<!-- ai-review-coverage-head -->");
    expect(update.body).toContain("did not require model review");
    expect(update.body).toContain("Existing fallback finding");
    expect(update.body).toContain('ai-review-cost:{"runs":1,"total_usd":0.1}');
  });

  it("rejects unprepared and stale skipped-coverage publication", async () => {
    await expect(
      publishSkippedReview(environment(), params, {
        paths: [],
        omitted: [],
      }),
    ).rejects.toThrow("unprepared review");

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json({ token: "installation-token" }))
        .mockResolvedValueOnce(json({ head: { sha: "b".repeat(40) } })),
    );
    await expect(
      publishSkippedReview(environment(), params, {
        headSha: params.headSha,
        paths: [],
        omitted: [],
        coverage: {
          mode: "skipped",
          reason: "unchanged",
          totalHunks: 0,
          reviewedHunkIds: [],
          unchangedHunkIds: [],
          skippedHunkIds: [],
          affectedFindingIds: [],
          paths: [],
          skippedPaths: [],
        },
      }),
    ).rejects.toThrow("head changed");
  });

  it("reports active guardrails on an explicit manual review", async () => {
    let rollingComment = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname === "/app/installations/456/access_tokens") {
          return json({ token: "installation-token" });
        }
        if (url.pathname.endsWith("/pulls/42")) {
          return json({ head: { sha: params.headSha } });
        }
        if (
          url.pathname.endsWith("/issues/42/comments") &&
          init?.method === "GET"
        ) {
          return json([]);
        }
        if (
          url.pathname.endsWith("/pulls/42/comments") &&
          init?.method === "GET"
        ) {
          return json([]);
        }
        if (
          url.pathname.endsWith("/issues/42/comments") &&
          init?.method === "POST"
        ) {
          rollingComment = String(
            (JSON.parse(String(init.body)) as { body: string }).body,
          );
          return json({ id: 987 });
        }
        throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
      }),
    );
    const env = environment();
    env.AI_REVIEW_PUBLICATION_POLICY_VERSION = "publication-test-v2";
    env.AI_REVIEW_RELIABILITY_POLICY_VERSION = "reliability-test-v2";
    env.AI_REVIEW_MAX_VISIBLE_FINDINGS = "4";
    env.AI_REVIEW_MODEL_FAILURE_THRESHOLD = "2";
    env.AI_REVIEW_MODEL_COOLDOWN_SECONDS = "90";

    await publishReview(
      env,
      { ...params, force: true },
      { headSha: params.headSha, paths: [], omitted: [] },
      {
        models: [],
        candidates: {},
        failed: [],
        candidateCounts: {},
        invalidCounts: {},
        outOfScopeCounts: {},
        costs: {},
        metrics: [],
        circuitSkipped: [{
          model: "model/scout",
          provider: "openrouter",
          consecutiveFailures: 2,
          cooldownUntil: "2026-08-27T00:01:00.000Z",
        }],
      },
      {
        result: { summary: "No defects.", findings: [] },
        cost: 0,
        metric: {
          model: "model/merger",
          provider: "openrouter",
          role: "merger",
          ok: false,
          skipped: true,
          latencyMs: 0,
          costUsd: 0,
        },
      },
      {
        hunks: [],
        candidates: {},
        publishedFindings: [],
        hiddenFindings: [{
          finding: {
            findingId: `f_${"e".repeat(24)}`,
            hunkIds: [],
            severity: "low",
            file: "app.ts",
            line: 1,
            title: "Hidden finding",
            evidence: "The value may be missing.",
            recommendation: "Guard the lookup.",
            confidence: 0.6,
            source_models: ["model/scout"],
            status: "open",
            resolution_note: "",
          },
          reason: "publication-limit",
        }],
      },
      { runs: 0, total_usd: 0 },
    );

    expect(rollingComment).toContain("Advisory review");
    expect(rollingComment).toContain("Active guardrails");
    expect(rollingComment).toContain("publication-test-v2");
    expect(rollingComment).toContain("at most 4 visible open findings");
    expect(rollingComment).toContain("reliability-test-v2");
    expect(rollingComment).toContain("2 consecutive failures for 90 seconds");
    expect(rollingComment).toContain("withheld 1 finding");
    expect(rollingComment).toContain("cooldown skipped model/scout");
    expect(rollingComment).toContain("merger model/merger was skipped");
  });

  it("runs and visibly publishes the same OpenRouter plus OpenCode ensemble", async () => {
    const publishedBodies: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/app/installations/456/access_tokens") {
        return json({ token: "installation-token" });
      }
      if (url.pathname === "/repos/Robbie-Palmer/hq/pulls/42") {
        return json({
          state: "open",
          draft: false,
          author_association: "OWNER",
          user: { login: "robbie" },
          head: {
            sha: params.headSha,
            repo: { full_name: params.repository },
          },
        });
      }
      if (url.pathname.endsWith("/pulls/42/files")) {
        return json([
          {
            filename: "app.ts",
            status: "modified",
            patch: "@@ -1 +1 @@\n-return false\n+return true",
          },
        ]);
      }
      if (url.pathname.endsWith("/contents/app.ts")) {
        return json({
          encoding: "base64",
          size: 18,
          content: Buffer.from("export default true").toString("base64"),
        });
      }
      if (url.pathname.endsWith("/contents/AGENTS.md")) {
        return json({
          encoding: "base64",
          size: 20,
          content: Buffer.from("Review correctness.").toString("base64"),
        });
      }
      if (
        url.pathname.endsWith("/contents/CLAUDE.md") ||
        url.pathname.endsWith("/contents/.github%2Fcopilot-instructions.md")
      ) {
        return new Response("missing", { status: 404 });
      }
      if (url.pathname === "/graphql") {
        const body = JSON.parse(String(init?.body)) as {
          query: string;
          variables: Record<string, string>;
        };
        if (body.query.includes("query FileContext")) {
          return json({
            data: {
              repository: {
                file0: {
                  byteSize: 18,
                  isBinary: false,
                  isTruncated: false,
                  text: "export default true",
                },
              },
            },
          });
        }
        return json({
          data: {
            repository: {
              pullRequest: { reviewThreads: { nodes: [] } },
            },
          },
        });
      }
      if (url.hostname === "opencode.ai" && url.pathname.endsWith("/models")) {
        return json({
          data: [
            { id: "big-pickle" },
            { id: "nemotron-3-ultra-free" },
            { id: "deepseek-v4-flash-free" },
          ],
        });
      }
      if (url.pathname.endsWith("/chat/completions")) {
        const body = JSON.parse(String(init?.body)) as {
          model: string;
          provider?: { allow_fallbacks?: boolean };
        };
        if (url.hostname === "openrouter.ai") {
          expect(body.provider?.allow_fallbacks).toBe(true);
        }
        const isMerger = body.model === "google/gemini-3.7-flash";
        const content = isMerger
          ? {
              summary: "One concrete issue.",
              findings: [
                {
                  severity: "high",
                  file: "app.ts",
                  line: 1,
                  title: "Incorrect return value",
                  evidence: "The changed return value violates the contract.",
                  recommendation: "Restore the expected value.",
                  confidence: 0.9,
                  source_models: ["moonshotai/kimi-k2.6"],
                  status: "open",
                  resolution_note: "",
                },
              ],
            }
          : {
              findings:
                body.model === "moonshotai/kimi-k2.6"
                  ? [
                      {
                        severity: "high",
                        file: "app.ts",
                        line: 1,
                        title: "Incorrect return value",
                        evidence:
                          "The changed return value violates the contract.",
                        recommendation: "Restore the expected value.",
                        confidence: 0.9,
                      },
                    ]
                  : [],
            };
        return json({
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify(content) },
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            prompt_tokens_details: { cached_tokens: 10 },
            cost: isMerger ? 0.02 : 0.01,
          },
        });
      }
      if (url.pathname.endsWith("/issues/42/comments") && init?.method === "GET") {
        return json([]);
      }
      if (url.pathname.endsWith("/pulls/42/comments") && init?.method === "GET") {
        return json([]);
      }
      if (url.pathname.endsWith("/pulls/42/comments") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { body: string };
        publishedBodies.push(body.body);
        return json({ id: 654 });
      }
      if (url.pathname.endsWith("/issues/42/comments") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { body: string };
        publishedBodies.push(body.body);
        return json({ id: 987 });
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const put = vi.fn();
    const env = environment(put);
    const prepared = await prepareReview(env, params);
    const scouts = await runScouts(env, params, prepared);
    const merged = await mergeFindings(env, params, prepared, scouts);
    const artifacts = await identifyReviewArtifacts(prepared, scouts, merged);
    const publication = await publishReview(
      env,
      params,
      prepared,
      scouts,
      merged,
      artifacts,
      { runs: 0, total_usd: 0 },
    );
    await recordReview({
      env,
      params,
      instanceId: "review-delivery-1",
      prepared,
      scouts,
      merged,
      artifacts,
      publication,
      timestamp: new Date("2026-07-28T12:00:00Z"),
    });

    expect(scouts.models).toEqual([
      "moonshotai/kimi-k2.6",
      "deepseek/deepseek-v4-pro",
      "z-ai/glm-5.3-flash",
      "inclusionai/ling-2.6-1t",
      "big-pickle",
      "nemotron-3-ultra-free",
    ]);
    expect(merged.result.findings).toHaveLength(1);
    expect(publication).toEqual({
      commentId: 987,
      runCostUsd: 0.08,
      findings: [
        expect.objectContaining({
          commentId: 654,
          delivery: "line",
          reconciled: false,
        }),
      ],
    });
    expect(publishedBodies[0]).toContain("ai-review-finding:");
    expect(publishedBodies[0]).toContain("Reported by: `moonshotai/kimi-k2.6`");
    expect(publishedBodies[1]).toContain(STATEFUL_REVIEW_MARKER);
    expect(publishedBodies[1]).toContain("## Stateful AI code review");
    expect(publishedBodies[1]).toContain("Coverage: Full coverage");
    expect(publishedBodies[1]).toContain("Advisory review");
    expect(put).toHaveBeenCalledOnce();
    const record = JSON.parse(String(put.mock.calls[0]?.[1])) as {
      schemaVersion: number;
      status: string;
      findings: { published: Array<{ findingId: string }> };
      guardrailPolicy: {
        publication: { version: string; maxVisibleFindings: number };
        reliability: { version: string; consecutiveFailureThreshold: number };
      };
      hunks: Array<{ hunkId: string }>;
      models: Array<{
        provider: string;
        usage?: { cachedInputTokens: number };
      }>;
    };
    expect(record.status).toBe("published");
    expect(record.schemaVersion).toBe(2);
    expect(record.guardrailPolicy).toMatchObject({
      publication: {
        version: "deterministic-publication-v1",
        maxVisibleFindings: 7,
      },
      reliability: {
        version: "consecutive-failures-v1",
        consecutiveFailureThreshold: 3,
      },
    });
    expect(record.findings.published[0]?.findingId).toMatch(/^f_[a-f0-9]{24}$/);
    expect(record.hunks[0]?.hunkId).toMatch(/^h_[a-f0-9]{24}$/);
    expect(record.models.map(({ provider }) => provider)).toContain("opencode");
    expect(record.models.at(-1)?.usage?.cachedInputTokens).toBe(10);
  });

  it("keeps hunk identities stable when only unified-diff coordinates move", async () => {
    const first = await identifyDiffHunks(
      "diff --git a/app.ts b/app.ts\nstatus modified\n@@ -1,2 +1,2 @@\n-old\n+new\n context\n",
    );
    const moved = await identifyDiffHunks(
      "diff --git a/app.ts b/app.ts\nstatus modified\n@@ -40,2 +55,2 @@\n-old\n+new\n context\n",
    );

    expect(first).toHaveLength(1);
    expect(moved).toHaveLength(1);
    expect(moved[0]?.hunkId).toBe(first[0]?.hunkId);
    expect(moved[0]?.fingerprint).toBe(first[0]?.fingerprint);
  });

  it("selects risk, affected-finding, and unchanged coverage", () => {
    const first = {
      hunkId: `h_${"a".repeat(24)}`,
      fingerprint: "a".repeat(64),
      file: "app.ts",
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 1,
    };
    const second = {
      ...first,
      hunkId: `h_${"b".repeat(24)}`,
      fingerprint: "b".repeat(64),
      newStart: 10,
    };
    const baseline = {
      headSha: "c".repeat(40),
      hunkIds: [first.hunkId],
      openFindings: [
        {
          findingId: `f_${"d".repeat(24)}`,
          file: "app.ts",
          title: "Existing issue",
          hunkIds: [first.hunkId],
        },
      ],
    };

    expect(
      decideReviewCoverage({
        force: false,
        riskSignals: [],
        hunks: [first, second],
        baseline,
      }),
    ).toMatchObject({
      mode: "incremental",
      reviewedHunkIds: [first.hunkId, second.hunkId],
      affectedFindingIds: [`f_${"d".repeat(24)}`],
      paths: ["app.ts"],
    });
    expect(
      decideReviewCoverage({
        force: false,
        riskSignals: ["database-schema"],
        hunks: [first],
        baseline,
      }),
    ).toMatchObject({ mode: "full", reviewedHunkIds: [first.hunkId] });
    expect(
      decideReviewCoverage({
        force: false,
        riskSignals: [],
        hunks: [first],
        baseline: { ...baseline, openFindings: [] },
      }),
    ).toMatchObject({ mode: "skipped", reviewedHunkIds: [] });
  });

  it("links a merged finding to its published line while retaining its source identity", async () => {
    const hunks = await identifyDiffHunks(
      "diff --git a/app.ts b/app.ts\n@@ -1 +1 @@\n-old\n+first\n@@ -20 +20 @@\n-old\n+second",
    );
    const candidate = {
      severity: "high" as const,
      file: "app.ts",
      line: 1,
      title: "Incorrect return value",
      evidence: "Candidate evidence",
      recommendation: "Fix it",
      confidence: 0.9,
    };
    const artifacts = await identifyReviewArtifacts(
      { paths: ["app.ts"], omitted: [], hunks },
      {
        models: ["model/scout"],
        candidates: { "model/scout": [candidate] },
        failed: [],
        candidateCounts: { "model/scout": 1 },
        invalidCounts: { "model/scout": 0 },
        outOfScopeCounts: { "model/scout": 0 },
        costs: { "model/scout": 0 },
        metrics: [],
      },
      {
        result: {
          summary: "One issue.",
          findings: [{
            ...candidate,
            line: 20,
            source_models: ["model/scout"],
            status: "open" as const,
            resolution_note: "",
          }],
        },
        cost: 0,
      },
    );

    expect(artifacts.publishedFindings[0]?.findingId).toBe(
      artifacts.candidates["model/scout"]?.[0]?.findingId,
    );
    expect(artifacts.publishedFindings[0]?.hunkIds).toEqual([hunks[1]?.hunkId]);
  });

  it("retains every raw candidate and hidden publication decision in R2", async () => {
    const candidates = [
      {
        severity: "critical" as const,
        file: "a.ts",
        line: 1,
        title: "Critical defect",
        evidence: "The new branch always throws.",
        recommendation: "Return the handled value.",
        confidence: 0.95,
      },
      {
        severity: "high" as const,
        file: "b.ts",
        line: 1,
        title: "Speculative defect",
        evidence: "The value may be absent.",
        recommendation: "Consider checking the value.",
        confidence: 0.9,
      },
      {
        severity: "medium" as const,
        file: "c.ts",
        line: 1,
        title: "Bounded defect",
        evidence: "The loop omits its final element.",
        recommendation: "Include the final index.",
        confidence: 0.85,
      },
    ];
    const scouts = {
      models: ["model/scout"],
      candidates: { "model/scout": candidates },
      failed: [],
      candidateCounts: { "model/scout": 3 },
      invalidCounts: { "model/scout": 0 },
      outOfScopeCounts: { "model/scout": 0 },
      costs: { "model/scout": 0 },
      metrics: [],
    };
    const merged = {
      result: {
        summary: "Three candidates.",
        findings: candidates.map((candidate) => ({
          ...candidate,
          source_models: ["model/scout"],
          status: "open" as const,
          resolution_note: "",
        })),
      },
      cost: 0,
    };
    const prepared = {
      headSha: params.headSha,
      paths: candidates.map(({ file }) => file),
      omitted: [],
      hunks: [],
    };
    const artifacts = await identifyReviewArtifacts(
      prepared,
      scouts,
      merged,
      {
        version: "publication-test-v1",
        maxVisibleFindings: 1,
        rejectedLanguage: [],
      },
    );
    expect(artifacts.candidates["model/scout"]).toHaveLength(3);
    expect(artifacts.publishedFindings).toHaveLength(1);
    expect(artifacts.hiddenFindings).toHaveLength(2);

    const put = vi.fn();
    await recordReview({
      env: environment(put),
      params,
      instanceId: "guardrail-record",
      prepared,
      scouts,
      merged,
      artifacts,
      publication: { runCostUsd: 0, findings: [] },
      timestamp: new Date("2026-08-26T12:00:00Z"),
    });
    const record = JSON.parse(String(put.mock.calls[0]?.[1])) as {
      candidates: Record<string, unknown[]>;
      findings: { published: unknown[]; hidden: unknown[] };
    };
    expect(record.candidates["model/scout"]).toHaveLength(3);
    expect(record.findings.published).toHaveLength(1);
    expect(record.findings.hidden).toHaveLength(2);
  });
});
