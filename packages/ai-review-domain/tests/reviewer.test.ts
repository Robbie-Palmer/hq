import assert from "node:assert/strict";

import { afterEach, test, vi } from "vitest";

import {
  completionContent,
  DEFAULT_MERGER,
  duplicateScoutModels,
  ignored,
  isCreditExhaustion,
  JsonClient,
  MERGER_MAX_TOKENS,
  markdownText,
  parseModelPayload,
  renderComment,
  Reviewer,
  selectFreeScoutModels,
  validateFindings,
  workflowStatusForCoverage,
} from "../src/reviewer.ts";

const finding = {
  severity: "high",
  file: "app.ts",
  line: 3,
  title: "Bug",
  evidence: "Evidence",
  recommendation: "Fix it",
  confidence: 0.8,
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("ignore patterns match paths and basenames", () => {
  assert.equal(ignored("pnpm-lock.yaml"), true);
  assert.equal(ignored("ml-pipelines/wsi-analysis/uv.lock"), true);
  assert.equal(ignored("workers/api/.terraform.lock.hcl"), true);
  assert.equal(ignored("flake.lock"), true);
  assert.equal(ignored("ui/public/image.png"), true);
  assert.equal(ignored("ui/public/font.WOFF2"), true);
  assert.equal(ignored("models/checkpoint.safetensors"), true);
  assert.equal(ignored("artifacts/results.parquet"), true);
  assert.equal(ignored("ui/node_modules/a.js"), true);
  assert.equal(ignored("dist/server.js"), true);
  assert.equal(ignored("ui/.next/server/app.js"), true);
  assert.equal(ignored("generated/client.generated.ts"), true);
  assert.equal(ignored(".env.production"), true);
  assert.equal(ignored("ui/components/card.tsx"), false);
  assert.equal(ignored("workers/recipe-api/src/db/schema.ts"), false);
  assert.equal(ignored(".vale/styles/proselint/Passive.yml"), true);
  assert.equal(ignored(".vale/styles/write-good/E-Prime.yml"), true);
  assert.equal(ignored(".vale/styles/Unslop/AIVocabulary.yml"), false);
});

test("finding validation rejects incomplete and out-of-diff findings", () => {
  const valid = validateFindings({ findings: [{ ...finding, confidence: 4 }, { severity: "low" }] }, { merged: false });
  assert.equal(valid.length, 1);
  assert.equal(valid[0]?.confidence, 1);
  assert.deepEqual(
    validateFindings({ findings: [finding] }, { merged: false, allowedFiles: new Set(["other.ts"]) }),
    [],
  );
});

test("finding validation enforces confidence bounds at runtime", () => {
  assert.equal(validateFindings({ findings: [{ ...finding, confidence: -2 }] }, { merged: false })[0]?.confidence, 0);
  assert.equal(validateFindings({ findings: [{ ...finding, confidence: 4 }] }, { merged: false })[0]?.confidence, 1);
});

test("finding validation accepts only positive or null diff lines", () => {
  assert.deepEqual(
    validateFindings(
      { findings: [{ ...finding, line: 0 }, { ...finding, line: null }] },
      { merged: false },
    ),
    [{ ...finding, line: null }],
  );
});

test("completion accepts a null finish reason but rejects truncation", () => {
  assert.equal(completionContent({ finish_reason: null, message: { content: "{}" } }, "model"), "{}");
  assert.throws(
    () => completionContent({ finish_reason: "length", message: { content: "{}" } }, "model"),
    /stopped with length/,
  );
  assert.throws(
    () => completionContent({ finish_reason: {}, message: { content: "{}" } }, "model"),
    /stopped with unknown reason/,
  );
});

test("credit exhaustion only matches payment and key-limit failures", () => {
  assert.equal(
    isCreditExhaustion(
      new Error(
        'POST /chat/completions failed (403): {"error":{"message":"Key limit exceeded (monthly limit)"}}',
      ),
    ),
    true,
  );
  assert.equal(
    isCreditExhaustion(
      new Error('POST /chat/completions failed (402): {"error":{"message":"Insufficient credits"}}'),
    ),
    true,
  );
  assert.equal(
    isCreditExhaustion(
      new Error('POST /chat/completions failed (403): {"error":{"message":"Guardrail blocked request"}}'),
    ),
    false,
  );
  assert.equal(isCreditExhaustion(new Error("All scout models failed")), false);
});

test("OpenCode model discovery keeps live supplementary scouts and excludes failed ones", () => {
  assert.deepEqual(
    selectFreeScoutModels({
      data: [
        { id: "paid-model" },
        { id: "deepseek-v4-flash-free" },
        { id: "big-pickle" },
        { id: "deepseek-v4-flash-free" },
        { id: "mimo-v2.5-free" },
        { id: "nemotron-3-ultra-free" },
        { id: "laguna-s-2.1-free" },
        { id: "ling-3.0-flash-free" },
        { id: "north-mini-code-free" },
        { id: { nested: "big-pickle" } },
      ],
    }),
    ["big-pickle", "nemotron-3-ultra-free"],
  );
  assert.deepEqual(selectFreeScoutModels({ data: [] }), []);
  assert.throws(() => selectFreeScoutModels({ models: [] }), /no data array/);
});

test("paid OpenRouter completions are never retried by the HTTP client", async () => {
  let attempts = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    attempts += 1;
    return new Response("temporary upstream failure", { status: 503 });
  });
  const reviewer = new Reviewer({
    githubToken: "github-token",
    openRouterKey: "openrouter-key",
    repository: "Robbie-Palmer/hq",
    prNumber: 837,
    openRouterScouts: ["model-a"],
    openCodeScouts: [],
    merger: "model-b",
    ignoredAuthors: [],
    requireZdr: false,
  });

  await assert.rejects(
    reviewer.callOpenRouterScout("model-a", "system", "user"),
    /failed \(503\)/,
  );
  assert.equal(attempts, 1);
});

test("GitHub comment creation is never retried", async () => {
  let attempts = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    attempts += 1;
    return new Response("temporary upstream failure", { status: 503 });
  });
  const reviewer = new Reviewer({
    githubToken: "github-token",
    openRouterKey: "openrouter-key",
    repository: "Robbie-Palmer/hq",
    prNumber: 837,
    openRouterScouts: [],
    openCodeScouts: [],
    merger: "model-b",
    ignoredAuthors: [],
    requireZdr: false,
  });

  await assert.rejects(reviewer.writeComment(undefined, "Review body"), /failed \(503\)/);
  assert.equal(attempts, 1);
});

test("HTTP retries use bounded Web Crypto jitter", async () => {
  vi.useFakeTimers();
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation((array) => {
    (array as Uint32Array)[0] = 0;
    return array;
  });
  const fetchMock = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response("temporary upstream failure", { status: 503 }))
    .mockResolvedValueOnce(Response.json({ ok: true }));

  const request = new JsonClient("https://example.com", {}, { retries: 2 }).request<{ ok: boolean }>(
    "GET",
    "/resource",
  );
  await vi.advanceTimersByTimeAsync(1_000);

  assert.deepEqual(await request, { ok: true });
  assert.equal(fetchMock.mock.calls.length, 2);
});

test("HTTP transport failures retry with Web Crypto jitter", async () => {
  vi.useFakeTimers();
  vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation((array) => {
    (array as Uint32Array)[0] = 0;
    return array;
  });
  vi.spyOn(globalThis, "fetch")
    .mockRejectedValueOnce(new TypeError("network unavailable"))
    .mockResolvedValueOnce(Response.json({ ok: true }));

  const request = new JsonClient("https://example.com", {}, { retries: 2 }).request<{ ok: boolean }>(
    "GET",
    "/resource",
  );
  await vi.advanceTimersByTimeAsync(1_000);

  assert.deepEqual(await request, { ok: true });
});

test("default OpenRouter scouts enforce their model-specific price ceiling", async () => {
  const expectedByModel = new Map<string, { prompt: number; completion: number }>([
    ["moonshotai/kimi-k2.6", { prompt: 0.7, completion: 2.8 }],
    ["deepseek/deepseek-v4-pro", { prompt: 0.65, completion: 1.3 }],
    ["z-ai/glm-5.3-flash", { prompt: 0.075, completion: 0.25 }],
    ["inclusionai/ling-2.6-1t", { prompt: 0.08, completion: 0.65 }],
  ]);
  let attempts = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        model?: string;
        provider?: { max_price?: { prompt?: number; completion?: number } };
      };
      assert.ok(body.model && expectedByModel.has(body.model));
      assert.deepEqual(body.provider?.max_price, expectedByModel.get(body.model));
      attempts += 1;
      return Response.json({
        choices: [{ finish_reason: "stop", message: { content: '{"findings":[]}' } }],
        usage: { cost: 0 },
      });
    },
  );
  const reviewer = new Reviewer({
    githubToken: "github-token",
    openRouterKey: "openrouter-key",
    repository: "Robbie-Palmer/hq",
    prNumber: 837,
    openRouterScouts: [...expectedByModel.keys()],
    openCodeScouts: [],
    merger: "model-b",
    ignoredAuthors: [],
    requireZdr: false,
  });

  for (const model of expectedByModel.keys()) {
    await reviewer.callOpenRouterScout(model, "system", "user");
  }
  assert.equal(attempts, expectedByModel.size);
});

test("default OpenRouter merger enforces its price ceiling and records top-level cost", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        model?: string;
        max_tokens?: number;
        provider?: { max_price?: { prompt?: number; completion?: number } };
      };
      assert.equal(body.model, DEFAULT_MERGER);
      assert.equal(body.max_tokens, MERGER_MAX_TOKENS);
      assert.deepEqual(body.provider?.max_price, { prompt: 0.75, completion: 3.75 });
      return Response.json({
        choices: [{ finish_reason: "stop", message: { content: '{"summary":"","findings":[]}' } }],
        cost: 0.42,
        usage: {},
      });
    },
  );
  const reviewer = new Reviewer({
    githubToken: "github-token",
    openRouterKey: "openrouter-key",
    repository: "Robbie-Palmer/hq",
    prNumber: 837,
    openRouterScouts: [],
    openCodeScouts: [],
    merger: DEFAULT_MERGER,
    ignoredAuthors: [],
    requireZdr: false,
  });

  const result = await reviewer.callMerger(
    DEFAULT_MERGER,
    "system",
    "user",
    "merged_findings",
    { type: "object" },
    MERGER_MAX_TOKENS,
  );
  assert.equal(result.cost, 0.42);
});

test("duplicate scout model IDs are detected across providers", () => {
  assert.deepEqual(
    duplicateScoutModels(["provider/model-a", "big-pickle"], ["big-pickle", "free-model"]),
    ["big-pickle"],
  );
  assert.deepEqual(duplicateScoutModels(["provider/model-a"], ["free-model"]), []);
});

test("workflow skips its stable check when no scout provides coverage", () => {
  assert.equal(workflowStatusForCoverage(0), "no_coverage");
  assert.equal(workflowStatusForCoverage(1), "success");
});

test("model payload accepts a single JSON fence but rejects prose", () => {
  assert.deepEqual(parseModelPayload('```json\n{"findings":[]}\n```'), { findings: [] });
  assert.deepEqual(parseModelPayload('```json\n{"findings":[]}```'), { findings: [] });
  assert.deepEqual(parseModelPayload('```\n{"findings":[]}\n```'), { findings: [] });
  assert.deepEqual(parseModelPayload('{"findings":[]}'), { findings: [] });
  assert.throws(() => parseModelPayload("```json\n```"));
  assert.throws(() => parseModelPayload('```json\t\t{"findings":[]}```'));
  assert.throws(() => parseModelPayload('Result: {"findings":[]}'), /Unexpected token|Unexpected character/);
});

test("model text cannot inject HTML, mentions, or markdown links", () => {
  const output = markdownText("<SCRIPT>@owner [click](https://example.com)</SCRIPT>");
  assert.doesNotMatch(output, /<script>|@owner|\[click\]\(/i);
  assert.equal(markdownText({ unsafe: "object" }), "");
});

test("review context ignores malformed API scalar values", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
    data: {
      repository: {
        pullRequest: {
          reviews: {
            nodes: [
              { author: { login: "alice" } },
              { author: { login: { unexpected: true } } },
            ],
          },
          reviewThreads: {
            nodes: [{
              isResolved: false,
              isOutdated: true,
              comments: {
                nodes: [
                  { path: "app.ts", line: 4, body: "Review body", author: { login: "bob" } },
                  { path: {}, line: {}, body: {}, author: { login: {} } },
                ],
              },
            }],
          },
        },
      },
    },
  }));
  const reviewer = new Reviewer({
    githubToken: "github-token",
    openRouterKey: "openrouter-key",
    repository: "Robbie-Palmer/hq",
    prNumber: 837,
    openRouterScouts: [],
    openCodeScouts: [],
    merger: "model-b",
    ignoredAuthors: [],
    requireZdr: false,
  });

  const context = await reviewer.pullRequestReviewContext();

  assert.deepEqual(context.reviewers, ["alice"]);
  assert.match(context.threads, /THREAD OUTDATED\nbob at app\.ts:4: Review body/);
  assert.doesNotMatch(context.threads, /\[object Object\]/);
});

test("rendered comment preserves provenance and cumulative cost", () => {
  const body = renderComment({
    result: {
      summary: "Summary",
      findings: [
        {
          ...finding,
          title: "<details>Injected</details>",
          source_models: ["model-a"],
          status: "open",
          resolution_note: "",
        },
      ],
    },
    headSha: "a".repeat(40),
    models: ["model-a"],
    merger: "model-b",
    failed: [],
    candidateCounts: { "model-a": 1 },
    invalidCounts: {},
    outOfScopeCounts: {},
    modelCosts: { "model-a": 0.1 },
    mergerCost: 0.15,
    omitted: [],
    runCost: 0.25,
    previousState: { runs: 1, total_usd: 0.5 },
  });
  assert.match(body, /Reported by: `model-a`/);
  assert.match(body, /&lt;details&gt;/);
  assert.match(body, /<!-- ai-review-cost:{"runs":2,"total_usd":0.75,"models":/);
  assert.match(body, /\| model-a \| 1 \| 1 \| 1 \| 0 \| 0 \| 0 \| \$0.1000 \|/);
});

test("summary-only comments describe thread delivery without duplicating findings", () => {
  const body = renderComment({
    result: {
      summary: "Summary",
      findings: [{
        ...finding,
        source_models: ["model-a"],
        status: "open",
        resolution_note: "",
      }],
    },
    headSha: "a".repeat(40),
    models: ["model-a"],
    merger: "model-b",
    failed: [],
    candidateCounts: { "model-a": 1 },
    invalidCounts: {},
    outOfScopeCounts: {},
    modelCosts: {},
    mergerCost: 0,
    omitted: [],
    runCost: 0,
    previousState: { runs: 0, total_usd: 0 },
    summaryOnly: true,
    findingDelivery: { line: 1, fallback: 0 },
  });

  assert.match(body, /1 open finding\(s\) published as review threads/);
  assert.doesNotMatch(body, /### HIGH/);
});

test("historical scorecard schema drift cannot produce NaN", () => {
  const body = renderComment({
    result: { summary: "Summary", findings: [] },
    headSha: "a".repeat(40),
    models: ["model-a"],
    merger: "model-b",
    failed: [],
    candidateCounts: { "model-a": 0 },
    invalidCounts: {},
    outOfScopeCounts: {},
    modelCosts: {},
    mergerCost: 0,
    omitted: [],
    runCost: 0,
    previousState: {
      runs: 1,
      total_usd: 0.5,
      models: { "model-a": {} as never },
    },
  });
  assert.doesNotMatch(body, /NaN/);
});

test("rendered comment makes total scout failure explicit", () => {
  const body = renderComment({
    result: { summary: "No coverage", findings: [] },
    headSha: "a".repeat(40),
    models: ["free-a", "free-b"],
    merger: "paid-merger",
    failed: ["free-a", "free-b"],
    candidateCounts: {},
    invalidCounts: {},
    outOfScopeCounts: {},
    modelCosts: {},
    mergerCost: 0,
    omitted: [],
    runCost: 0,
    previousState: { runs: 0, total_usd: 0 },
  });
  assert.match(body, /No findings were evaluated because every scout failed/);
  assert.doesNotMatch(body, /No open findings reported/);
});

test("rendered comment reports resolved, omitted, and rejected findings", () => {
  const omitted = Array.from({ length: 21 }, (_, index) => `generated/file-${index}.ts`);
  const body = renderComment({
    result: {
      summary: "",
      findings: [
        {
          ...finding,
          severity: "medium",
          file: "b.ts",
          line: null,
          source_models: ["model-a"],
          status: "open",
          resolution_note: "",
        },
        {
          ...finding,
          severity: "medium",
          file: "a.ts",
          line: 4,
          source_models: ["model-a"],
          status: "open",
          resolution_note: "",
        },
        {
          ...finding,
          severity: "low",
          file: "a.ts",
          line: null,
          source_models: ["model-a"],
          status: "resolved",
          resolution_note: "Fixed in the latest commit",
        },
      ],
    },
    headSha: "b".repeat(40),
    models: ["model-a", "model-b"],
    merger: "model-c",
    failed: ["model-b"],
    candidateCounts: { "model-a": 3 },
    invalidCounts: { "model-a": 2, "model-b": 0 },
    outOfScopeCounts: { "model-b": 1 },
    modelCosts: {},
    mergerCost: 0,
    omitted,
    runCost: 0,
    previousState: { runs: 0, total_usd: 0 },
  });

  assert.match(body, /Review complete\./);
  assert.match(body, /## Resolved threads/);
  assert.match(body, /and 1 more/);
  assert.match(body, /Scout failures: model-b/);
  assert.match(body, /Structurally invalid findings dropped: model-a: 2/);
  assert.match(body, /Out-of-diff findings dropped: model-b: 1/);
});

test("rendered state cannot close its HTML comment", () => {
  const body = renderComment({
    result: { summary: "Summary", findings: [] },
    headSha: "c".repeat(40),
    models: ["model-->injected-free"],
    merger: "merger",
    failed: [],
    candidateCounts: {},
    invalidCounts: {},
    outOfScopeCounts: {},
    modelCosts: {},
    mergerCost: 0,
    omitted: [],
    runCost: 0,
    previousState: { runs: 0, total_usd: 0 },
  });
  const stateMarker = body.split("\n")[1] ?? "";

  assert.match(stateMarker, /model\\u002d\\u002d>injected-free/);
  assert.equal(stateMarker.split("-->").length - 1, 1);
});
