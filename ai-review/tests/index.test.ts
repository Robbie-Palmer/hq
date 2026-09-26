import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { createHmac, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env, ReviewWorkflowParams } from "../src/env";
import worker, { PullRequestCoordinator, ReviewWorkflow } from "../src/index";
import { SCHEMA_MIGRATION_HISTORY } from "../src/schema";

const MAX_REVIEW_COMPLETION_ITEMS_FOR_TEST = 10_000;

const event: ReviewWorkflowParams = {
  deliveryId: "delivery-123",
  eventName: "pull_request",
  action: "synchronize",
  repository: "Robbie-Palmer/hq",
  pullRequestNumber: 821,
  headSha: "abcdef123456",
  force: false,
};

const identifiedFinding = {
  findingId: `f_${"b".repeat(24)}`,
  hunkIds: [`h_${"c".repeat(24)}`],
  severity: "high",
  file: "app.ts",
  line: 1,
  title: "Finding",
  evidence: "Evidence",
  recommendation: "Fix it",
  confidence: 0.9,
  source_models: ["model/scout"],
  status: "open",
  resolution_note: "",
};

const identifiedHunk = {
  hunkId: `h_${"c".repeat(24)}`,
  fingerprint: "d".repeat(64),
  file: "app.ts",
  oldStart: 1,
  oldLines: 1,
  newStart: 1,
  newLines: 1,
};

const findingInteraction = {
  deliveryId: "feedback-delivery-1",
  eventName: "issue_comment",
  action: "created",
  repository: event.repository,
  pullRequestNumber: event.pullRequestNumber,
  interactionType: "disposition",
  actor: "Robbie-Palmer",
  actorAssociation: "OWNER",
  findingId: identifiedFinding.findingId,
  commentId: 900,
  disposition: "acknowledged",
  reason: "Accepted risk",
  occurredAt: "2026-08-09T12:00:00Z",
} as const;

const pullRequestFinalization = {
  deliveryId: "finalization-delivery-1",
  eventName: "pull_request",
  action: "closed",
  repository: event.repository,
  pullRequestNumber: event.pullRequestNumber,
  headSha: event.headSha,
  finalState: "merged",
  occurredAt: "2026-08-15T12:00:00Z",
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

function coordinatorFixture(
  existingDeliveries: string[] = [],
  envOverrides: Partial<Env> = {},
) {
  const sqlExec = vi.fn(
    (
      query: string,
      ..._params: unknown[]
    ): { rowsWritten: number; toArray: () => unknown[] } => ({
      rowsWritten: 1,
      toArray: () => {
        if (query.includes("FROM _migrations")) {
          return [...SCHEMA_MIGRATION_HISTORY];
        }
        if (query.includes("FROM sqlite_schema")) {
          return [{ present: 1 }];
        }
        if (query.includes("PRAGMA table_info(review_runs)")) {
          return [
            { name: "completion_hash" },
            { name: "finding_resolutions_json" },
          ];
        }
        if (query.includes("PRAGMA table_info(review_findings)")) {
          return [
            { name: "disposition" },
            { name: "disposition_reason" },
          ];
        }
        if (query.includes("PRAGMA table_info(review_finding_outcomes)")) {
          return [
            { name: "confidence" },
            { name: "evaluator_version" },
            { name: "manual_override" },
          ];
        }
        if (
          query.includes("FROM webhook_deliveries") &&
          existingDeliveries.includes(event.deliveryId)
        ) {
          return [{ delivery_id: event.deliveryId }];
        }
        return [];
      },
    }),
  );
  const storage = {
    sql: { exec: sqlExec },
    kv: { put: vi.fn() },
    get: vi.fn(),
    delete: vi.fn(),
    getAlarm: vi.fn(
      (): Promise<number | null> => Promise.resolve(Date.now() + 2_000),
    ),
    setAlarm: vi.fn(),
    transactionSync: vi.fn((operation: () => unknown) => operation()),
  };
  const createBatch = vi.fn();
  const terminate = vi.fn();
  const workflowStatus = vi.fn(() =>
    Promise.resolve({ status: "running" as const }),
  );
  const workflowGet = vi.fn(() =>
    Promise.resolve({ status: workflowStatus, terminate }),
  );
  const put = vi.fn();
  const env = {
    AI_REVIEW_ENABLED: "true",
    AI_REVIEW_DEBOUNCE_SECONDS: "2",
    REVIEW_DATA: { put },
    REVIEW_WORKFLOW: { createBatch, get: workflowGet },
    ...envOverrides,
  } as unknown as Env;
  const coordinator = new PullRequestCoordinator(
    { storage } as unknown as DurableObjectState,
    env,
  );

  return {
    coordinator,
    createBatch,
    env,
    put,
    sqlExec,
    storage,
    terminate,
    workflowGet,
    workflowStatus,
  };
}

function signedWebhookRequest(
  body: string,
  secret: string,
  headers: Record<string, string> = {},
): Request {
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  return new Request("https://ai-review.test/webhooks/github", {
    method: "POST",
    body,
    headers: {
      "x-github-delivery": "delivery-123",
      "x-github-event": "pull_request",
      "x-hub-signature-256": `sha256=${signature}`,
      ...headers,
    },
  });
}

describe("PullRequestCoordinator", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("initializes storage and schedules a new delivery", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T00:00:00.000Z"));
    const { coordinator, sqlExec, storage } = coordinatorFixture();

    const response = await coordinator.fetch(
      new Request("https://coordinator.test/events", {
        method: "POST",
        body: JSON.stringify(event),
      }),
    );

    await expect(response.json()).resolves.toEqual({
      accepted: true,
      enabled: true,
    });
    expect(sqlExec.mock.calls[0]?.[0]).toContain("CREATE TABLE IF NOT EXISTS");
    expect(storage.kv.put).toHaveBeenCalledWith("latest-pending-event", event);
    expect(storage.setAlarm).toHaveBeenCalledWith(
      new Date("2026-07-27T00:00:02.000Z").getTime(),
    );
  });

  it("clamps immediate delays and defaults invalid configuration", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T00:00:00.000Z"));
    const immediate = coordinatorFixture();
    immediate.env.AI_REVIEW_DEBOUNCE_SECONDS = "0";
    await immediate.coordinator.fetch(
      new Request("https://coordinator.test/events", {
        method: "POST",
        body: JSON.stringify(event),
      }),
    );
    expect(immediate.storage.setAlarm).toHaveBeenCalledWith(
      new Date("2026-07-27T00:00:01.000Z").getTime(),
    );

    const invalid = coordinatorFixture();
    invalid.env.AI_REVIEW_DEBOUNCE_SECONDS = "not-a-number";
    await invalid.coordinator.fetch(
      new Request("https://coordinator.test/events", {
        method: "POST",
        body: JSON.stringify(event),
      }),
    );
    expect(invalid.storage.setAlarm).toHaveBeenCalledWith(
      new Date("2026-07-27T00:02:00.000Z").getTime(),
    );

    const excessive = coordinatorFixture();
    excessive.env.AI_REVIEW_DEBOUNCE_SECONDS = "999999999";
    await excessive.coordinator.fetch(
      new Request("https://coordinator.test/events", {
        method: "POST",
        body: JSON.stringify(event),
      }),
    );
    expect(excessive.storage.setAlarm).toHaveBeenCalledWith(
      new Date("2026-07-27T01:00:00.000Z").getTime(),
    );
  });

  it("coalesces rapid deliveries and moves the alarm to the quiet-period edge", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T00:00:00.000Z"));
    const { coordinator, storage } = coordinatorFixture();
    await coordinator.fetch(
      new Request("https://coordinator.test/events", {
        method: "POST",
        body: JSON.stringify(event),
      }),
    );

    vi.advanceTimersByTime(500);
    const latestEvent = {
      ...event,
      deliveryId: "delivery-456",
      headSha: "fedcba654321",
    };
    await coordinator.fetch(
      new Request("https://coordinator.test/events", {
        method: "POST",
        body: JSON.stringify(latestEvent),
      }),
    );

    expect(storage.kv.put).toHaveBeenLastCalledWith(
      "latest-pending-event",
      latestEvent,
    );
    expect(storage.setAlarm).toHaveBeenLastCalledWith(
      new Date("2026-07-27T00:00:02.500Z").getTime(),
    );
  });

  it("returns early for duplicate deliveries and unsupported methods", async () => {
    const { coordinator, storage } = coordinatorFixture([event.deliveryId]);

    const duplicate = await coordinator.fetch(
      new Request("https://coordinator.test/events", {
        method: "POST",
        body: JSON.stringify(event),
      }),
    );
    await expect(duplicate.json()).resolves.toEqual({
      accepted: true,
      duplicate: true,
    });
    expect(storage.kv.put).not.toHaveBeenCalled();
    expect(storage.setAlarm).not.toHaveBeenCalled();

    const rejected = await coordinator.fetch(
      new Request("https://coordinator.test/events"),
    );
    expect(rejected.status).toBe(405);
  });

  it("restores a missing alarm for a duplicate without extending an existing one", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T00:00:00.000Z"));
    const { coordinator, storage } = coordinatorFixture([event.deliveryId]);
    storage.getAlarm.mockResolvedValueOnce(null);

    await coordinator.fetch(
      new Request("https://coordinator.test/events", {
        method: "POST",
        body: JSON.stringify(event),
      }),
    );
    expect(storage.setAlarm).toHaveBeenCalledWith(
      new Date("2026-07-27T00:00:02.000Z").getTime(),
    );

    storage.setAlarm.mockClear();
    storage.getAlarm.mockResolvedValueOnce(
      new Date("2026-07-27T00:00:02.000Z").getTime(),
    );
    await coordinator.fetch(
      new Request("https://coordinator.test/events", {
        method: "POST",
        body: JSON.stringify(event),
      }),
    );
    expect(storage.setAlarm).not.toHaveBeenCalled();
  });

  it("rejects invalid coordinator event bodies", async () => {
    const { coordinator, storage } = coordinatorFixture();

    const wrongType = await coordinator.fetch(
      new Request("https://coordinator.test/events", {
        method: "POST",
        body: JSON.stringify({ ...event, pullRequestNumber: "821" }),
      }),
    );
    const malformed = await coordinator.fetch(
      new Request("https://coordinator.test/events", {
        method: "POST",
        body: "{",
      }),
    );
    const empty = await coordinator.fetch(
      new Request("https://coordinator.test/events", {
        method: "POST",
        body: "null",
      }),
    );

    expect(wrongType.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(empty.status).toBe(400);
    expect(storage.kv.put).not.toHaveBeenCalled();
  });

  it("rejects malformed model availability plans and observations", async () => {
    const { coordinator } = coordinatorFixture();
    const post = (path: string, body: unknown) =>
      coordinator.fetch(
        new Request(`https://coordinator.test${path}`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );
    const validModel = { model: "provider/model", provider: "openrouter" };
    const invalidPlans = [
      null,
      {},
      { models: Array.from({ length: 51 }, () => validModel) },
      { models: [null] },
      { models: [{ ...validModel, model: 1 }] },
      { models: [{ ...validModel, model: "" }] },
      { models: [{ ...validModel, model: "x".repeat(201) }] },
      { models: [{ ...validModel, provider: "other" }] },
    ];
    for (const body of invalidPlans) {
      expect((await post("/models/plan", body)).status).toBe(400);
    }
    expect(
      (
        await coordinator.fetch(
          new Request("https://coordinator.test/models/plan", {
            method: "POST",
            body: "{",
          }),
        )
      ).status,
    ).toBe(400);

    const policy = {
      version: "consecutive-failures-v1",
      consecutiveFailureThreshold: 2,
      cooldownSeconds: 60,
    };
    const validMetric = { ...validModel, ok: true };
    const validObservation = {
      observationId: "observation-1",
      policy,
      metrics: [validMetric],
    };
    const invalidObservations = [
      null,
      { ...validObservation, observationId: 1 },
      { ...validObservation, observationId: "" },
      { ...validObservation, observationId: "x".repeat(256) },
      { ...validObservation, policy: null },
      { ...validObservation, policy: { ...policy, version: 1 } },
      { ...validObservation, policy: { ...policy, version: "" } },
      { ...validObservation, policy: { ...policy, version: "   " } },
      { ...validObservation, policy: { ...policy, version: " version" } },
      { ...validObservation, policy: { ...policy, version: "version " } },
      {
        ...validObservation,
        policy: { ...policy, consecutiveFailureThreshold: "2" },
      },
      {
        ...validObservation,
        policy: { ...policy, consecutiveFailureThreshold: 1.5 },
      },
      {
        ...validObservation,
        policy: { ...policy, consecutiveFailureThreshold: 0 },
      },
      {
        ...validObservation,
        policy: { ...policy, consecutiveFailureThreshold: 21 },
      },
      {
        ...validObservation,
        policy: { ...policy, cooldownSeconds: "60" },
      },
      { ...validObservation, policy: { ...policy, cooldownSeconds: 1.5 } },
      { ...validObservation, policy: { ...policy, cooldownSeconds: 0 } },
      { ...validObservation, policy: { ...policy, cooldownSeconds: 604_801 } },
      { ...validObservation, metrics: null },
      {
        ...validObservation,
        metrics: Array.from({ length: 51 }, () => validMetric),
      },
      { ...validObservation, metrics: [null] },
      { ...validObservation, metrics: [{ ...validMetric, model: 1 }] },
      { ...validObservation, metrics: [{ ...validMetric, model: "" }] },
      {
        ...validObservation,
        metrics: [{ ...validMetric, model: "x".repeat(201) }],
      },
      {
        ...validObservation,
        metrics: [{ ...validMetric, provider: "other" }],
      },
      { ...validObservation, metrics: [{ ...validMetric, ok: "yes" }] },
      { ...validObservation, metrics: [{ ...validMetric, error: 1 }] },
      {
        ...validObservation,
        metrics: [{ ...validMetric, error: "x".repeat(501) }],
      },
    ];
    for (const body of invalidObservations) {
      expect((await post("/models/record", body)).status).toBe(400);
    }
  });

  it("opens, deduplicates, expires, and resets model cooldowns", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T00:00:00.000Z"));
    const { coordinator, sqlExec } = coordinatorFixture();
    const health = new Map<
      string,
      {
        consecutive_failures: number;
        total_failures: number;
        total_successes: number;
        cooldown_until_ms: number | null;
      }
    >();
    const observations = new Set<string>();
    sqlExec.mockImplementation((query: string, ...values: unknown[]) => {
      if (query.includes("FROM review_model_health_observations")) {
        const key = `${values[0]}:${values[1]}:${values[2]}`;
        return {
          rowsWritten: 0,
          toArray: () =>
            observations.has(key) ? [{ observation_id: values[0] }] : [],
        };
      }
      if (query.includes("FROM review_model_health WHERE provider")) {
        const row = health.get(`${values[0]}:${values[1]}`);
        return { rowsWritten: 0, toArray: () => (row ? [row] : []) };
      }
      if (
        query.includes("INSERT INTO review_model_health") &&
        !query.includes("review_model_health_observations")
      ) {
        health.set(`${values[1]}:${values[0]}`, {
          consecutive_failures: Number(values[2]),
          total_failures: Number(values[3]),
          total_successes: Number(values[4]),
          cooldown_until_ms: values[5] === null ? null : Number(values[5]),
        });
      }
      if (query.includes("INSERT INTO review_model_health_observations")) {
        observations.add(`${values[0]}:${values[2]}:${values[1]}`);
      }
      return { rowsWritten: 1, toArray: () => [] };
    });
    const policy = {
      version: "consecutive-failures-v1",
      consecutiveFailureThreshold: 2,
      cooldownSeconds: 60,
    };
    const record = (observationId: string, metrics: unknown[]) =>
      coordinator.fetch(
        new Request("https://coordinator.test/models/record", {
          method: "POST",
          body: JSON.stringify({ observationId, policy, metrics }),
        }),
      );
    const plan = () =>
      coordinator.fetch(
        new Request("https://coordinator.test/models/plan", {
          method: "POST",
          body: JSON.stringify({
            models: [
              { model: "model-a", provider: "openrouter" },
              { model: "model-a", provider: "opencode" },
              { model: "model-b", provider: "opencode" },
              { model: "unknown", provider: "openrouter" },
            ],
          }),
        }),
      );

    await expect(
      (
        await record("observation-1", [
          {
            model: "model-a",
            provider: "openrouter",
            ok: false,
            error: "provider unavailable",
          },
          { model: "model-b", provider: "opencode", ok: true },
        ])
      ).json(),
    ).resolves.toEqual({ recorded: 2 });
    await expect(
      (
        await record("observation-1", [
          { model: "model-a", provider: "openrouter", ok: false },
          { model: "model-b", provider: "opencode", ok: true },
        ])
      ).json(),
    ).resolves.toEqual({ recorded: 0 });
    await expect(
      (
        await record("observation-2", [
          { model: "model-a", provider: "openrouter", ok: false },
        ])
      ).json(),
    ).resolves.toEqual({ recorded: 1 });

    await expect((await plan()).json()).resolves.toMatchObject({
      skipped: [{
        model: "model-a",
        provider: "openrouter",
        consecutiveFailures: 2,
        cooldownUntil: "2026-08-27T00:01:00.000Z",
      }],
    });
    expect(health.get("openrouter:model-a")).toMatchObject({
      total_failures: 2,
      total_successes: 0,
    });
    expect(health.get("opencode:model-b")).toMatchObject({
      consecutive_failures: 0,
      total_successes: 1,
    });

    vi.advanceTimersByTime(60_001);
    await expect((await plan()).json()).resolves.toEqual({ skipped: [] });
    await record("observation-3", [
      { model: "model-a", provider: "openrouter", ok: true },
    ]);
    expect(health.get("openrouter:model-a")).toMatchObject({
      consecutive_failures: 0,
      total_failures: 2,
      total_successes: 1,
      cooldown_until_ms: null,
    });
  });

  it("does not schedule while reviews are disabled", async () => {
    const { coordinator, env, storage } = coordinatorFixture();
    env.AI_REVIEW_ENABLED = "false";

    const response = await coordinator.fetch(
      new Request("https://coordinator.test/events", {
        method: "POST",
        body: JSON.stringify(event),
      }),
    );

    await expect(response.json()).resolves.toMatchObject({ enabled: false });
    expect(storage.setAlarm).not.toHaveBeenCalled();
  });

  it("starts each delivery idempotently and clears the pending event", async () => {
    const { coordinator, createBatch, storage } = coordinatorFixture();
    storage.get.mockResolvedValue(event);

    await coordinator.alarm();

    expect(createBatch).toHaveBeenCalledWith([
      { id: `review-${event.deliveryId}`, params: event },
    ]);
    expect(storage.delete).toHaveBeenCalledWith("latest-pending-event");
  });

  it("leaves disabled or absent pending work alone", async () => {
    const { coordinator, createBatch, env, storage } = coordinatorFixture();
    storage.get.mockResolvedValue(event);
    env.AI_REVIEW_ENABLED = "false";
    await coordinator.alarm();
    expect(createBatch).not.toHaveBeenCalled();

    env.AI_REVIEW_ENABLED = "true";
    storage.get.mockResolvedValue(undefined);
    await coordinator.alarm();
    expect(createBatch).not.toHaveBeenCalled();
  });

  it("claims and completes a review run idempotently through internal routes", async () => {
    const { coordinator, sqlExec } = coordinatorFixture();
    const claim = await coordinator.fetch(
      new Request("https://coordinator.test/reviews/claim", {
        method: "POST",
        body: JSON.stringify({
          runId: "review-delivery-123",
          headSha: event.headSha,
          diffFingerprint: "diff-hash",
          configFingerprint: "config-hash",
          force: false,
          maxRuns: 20,
          maxCostUsd: 5,
        }),
      }),
    );
    await expect(claim.json()).resolves.toEqual({
      claimed: true,
      previousState: { runs: 0, total_usd: 0 },
    });
    expect(
      sqlExec.mock.calls.some(([query]) =>
        String(query).includes("INSERT INTO review_runs"),
      ),
    ).toBe(true);

    const completion = await coordinator.fetch(
      new Request("https://coordinator.test/reviews/complete", {
        method: "POST",
        body: JSON.stringify({
          repository: event.repository,
          pullRequestNumber: event.pullRequestNumber,
          runId: "review-delivery-123",
          headSha: event.headSha,
          costUsd: 0.42,
          commentId: 987,
          hunks: [identifiedHunk],
          findings: [identifiedFinding],
          findingPublications: [
            {
              findingId: identifiedFinding.findingId,
              delivery: "line",
              commentId: 654,
              reconciled: false,
              path: identifiedFinding.file,
              line: identifiedFinding.line,
            },
          ],
        }),
      }),
    );
    await expect(completion.json()).resolves.toEqual({ completed: true });
    expect(
      sqlExec.mock.calls.some(([query]) =>
        String(query).includes("SET status = 'completed'"),
      ),
    ).toBe(true);
    expect(
      sqlExec.mock.calls.some(([query]) =>
        String(query).includes("INSERT INTO review_finding_comments"),
      ),
    ).toBe(true);
  });

  it.each([
    ["a negative run limit", { maxRuns: -1 }],
    ["a fractional run limit", { maxRuns: 1.5 }],
    ["an unsafe run limit", { maxRuns: Number.MAX_SAFE_INTEGER + 1 }],
    ["a negative cost limit", { maxCostUsd: -0.01 }],
    ["an empty run ID", { runId: "" }],
    ["an oversized run ID", { runId: "x".repeat(256) }],
    ["an empty head SHA", { headSha: "" }],
    ["an oversized head SHA", { headSha: "x".repeat(65) }],
    ["an empty diff fingerprint", { diffFingerprint: "" }],
    ["an oversized diff fingerprint", { diffFingerprint: "x".repeat(65) }],
    ["an empty config fingerprint", { configFingerprint: "" }],
    [
      "an oversized config fingerprint",
      { configFingerprint: "x".repeat(65) },
    ],
  ])("rejects review claims with %s", async (_label, override) => {
    const { coordinator } = coordinatorFixture();
    const response = await coordinator.fetch(
      new Request("https://coordinator.test/reviews/claim", {
        method: "POST",
        body: JSON.stringify({
          runId: "review-invalid-limits",
          headSha: event.headSha,
          diffFingerprint: "diff-hash",
          configFingerprint: "config-hash",
          force: false,
          maxRuns: 20,
          maxCostUsd: 5,
          ...override,
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid review claim",
    });
  });

  it("does not mint a confirmed fix from model replay alone", async () => {
    const { coordinator, put, sqlExec } = coordinatorFixture();
    const changedHunk = {
      ...identifiedHunk,
      hunkId: `h_${"d".repeat(24)}`,
      fingerprint: "e".repeat(64),
    };
    sqlExec.mockImplementation((_query: string) => ({
      rowsWritten: 1,
      toArray: () => [],
    }));

    const response = await coordinator.fetch(
      new Request("https://coordinator.test/reviews/complete", {
        method: "POST",
        body: JSON.stringify({
          repository: event.repository,
          pullRequestNumber: event.pullRequestNumber,
          runId: "later-run",
          headSha: event.headSha,
          costUsd: 0.25,
          hunks: [changedHunk],
          findings: [],
          findingResolutions: [{
            findingId: identifiedFinding.findingId,
            verdict: "fixed",
            evidence: "The later diff adds the missing retry alarm.",
          }],
        }),
      }),
    );

    await expect(response.json()).resolves.toEqual({ completed: true });
    expect(put).not.toHaveBeenCalled();
    expect(
      sqlExec.mock.calls.some(([query]) =>
        String(query).includes("outcome, basis, source_id"),
      ),
    ).toBe(false);
  });

  it("records finding dispositions in SQLite and append-only evidence", async () => {
    const { coordinator, put, sqlExec } = coordinatorFixture();
    sqlExec.mockImplementation((query: string) => ({
      rowsWritten: 1,
      toArray: () =>
        query.includes("SELECT finding_id FROM review_findings")
          ? [{ finding_id: identifiedFinding.findingId }]
          : [],
    }));

    const response = await coordinator.fetch(
      new Request("https://coordinator.test/interactions", {
        method: "POST",
        body: JSON.stringify({ ...findingInteraction, reason: undefined }),
      }),
    );

    await expect(response.json()).resolves.toEqual({
      accepted: true,
      duplicate: false,
      findingId: identifiedFinding.findingId,
    });
    expect(put).toHaveBeenCalledWith(
      expect.stringContaining("/evidence/feedback-delivery-1.json"),
      expect.stringContaining('"disposition":"acknowledged"'),
      { httpMetadata: { contentType: "application/json" } },
    );
    expect(
      sqlExec.mock.calls.some(([query]) =>
        String(query).includes("SET disposition = ?"),
      ),
    ).toBe(true);
    const outcomeInsert = sqlExec.mock.calls.find(([query]) =>
      String(query).includes("INSERT OR IGNORE INTO review_finding_outcomes")
    );
    expect(JSON.parse(String(outcomeInsert?.[9]))).toMatchObject({
      manualOverride: { reason: "Trusted manual disposition" },
      evidence: { reason: "Trusted manual disposition" },
    });
  });

  it("requires a fixed controlled replay before trusted confirmation", async () => {
    const { coordinator, put, sqlExec } = coordinatorFixture();
    sqlExec.mockImplementation((query: string) => ({
      rowsWritten: 1,
      toArray: () =>
        query.includes("SELECT finding_id FROM review_findings")
          ? [{ finding_id: identifiedFinding.findingId }]
          : [],
    }));

    const response = await coordinator.fetch(
      new Request("https://coordinator.test/interactions", {
        method: "POST",
        body: JSON.stringify({
          ...findingInteraction,
          deliveryId: "feedback-confirmation-without-replay",
          headSha: "2".repeat(40),
          disposition: "confirmed-fixed",
          reason: "Looks fixed",
        }),
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      accepted: false,
      reason: "no-fixed-replay",
    });
    expect(put).not.toHaveBeenCalled();
  });

  it("rejects trusted confirmation against a newer authoritative head", async () => {
    const { coordinator, put, sqlExec } = coordinatorFixture();
    const replayHead = "1".repeat(40);
    const currentHead = "2".repeat(40);
    sqlExec.mockImplementation((query: string) => ({
      rowsWritten: 1,
      toArray: () => {
        if (query.includes("SELECT finding_id FROM review_findings")) {
          return [{ finding_id: identifiedFinding.findingId }];
        }
        if (query.includes("finding_resolutions_json IS NOT NULL")) {
          return [{
            run_id: "fixed-replay",
            head_sha: replayHead,
            finding_resolutions_json: JSON.stringify([{
              findingId: identifiedFinding.findingId,
              verdict: "fixed",
              evidence: "The old head removed the defect.",
            }]),
          }];
        }
        return [];
      },
    }));

    const response = await coordinator.fetch(
      new Request("https://coordinator.test/interactions", {
        method: "POST",
        body: JSON.stringify({
          ...findingInteraction,
          deliveryId: "feedback-stale-confirmation",
          headSha: currentHead,
          disposition: "confirmed-fixed",
          reason: "Looks fixed",
        }),
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      accepted: false,
      reason: "stale-fixed-replay",
    });
    expect(put).not.toHaveBeenCalled();
  });

  it("carries a fixed replay across an unchanged finding after a current full review", async () => {
    const { coordinator, put, sqlExec } = coordinatorFixture();
    const replayHead = "1".repeat(40);
    const currentHead = "2".repeat(40);
    sqlExec.mockImplementation((query: string) => ({
      rowsWritten: 1,
      toArray: () => {
        if (query.includes("SELECT finding_id FROM review_findings")) {
          return [{ finding_id: identifiedFinding.findingId }];
        }
        if (query.includes("finding_resolutions_json IS NOT NULL")) {
          return [{
            run_id: "fixed-replay",
            head_sha: replayHead,
            finding_resolutions_json: JSON.stringify([{
              findingId: identifiedFinding.findingId,
              verdict: "fixed",
              evidence: "The earlier replay demonstrated the fix.",
            }]),
          }];
        }
        if (query.includes("force_run = 1")) {
          return [{
            run_id: "current-full-review",
            head_sha: currentHead,
            finding_resolutions_json: null,
          }];
        }
        return [];
      },
    }));

    const response = await coordinator.fetch(
      new Request("https://coordinator.test/interactions", {
        method: "POST",
        body: JSON.stringify({
          ...findingInteraction,
          deliveryId: "feedback-carried-confirmation",
          headSha: currentHead,
          disposition: "confirmed-fixed",
          reason: "Looks fixed",
        }),
      }),
    );

    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      duplicate: false,
      findingId: identifiedFinding.findingId,
    });
    expect(put).toHaveBeenCalledWith(
      expect.stringContaining("/evidence/feedback-carried-confirmation.json"),
      expect.stringContaining('"validatedByFullReviewRunId":"current-full-review"'),
      { httpMetadata: { contentType: "application/json" } },
    );
    const outcomeInsert = sqlExec.mock.calls.find(([query]) =>
      String(query).includes("INSERT OR IGNORE INTO review_finding_outcomes")
    );
    expect(JSON.parse(String(outcomeInsert?.[9]))).toMatchObject({
      evidence: {
        controlledReplay: {
          validatedByFullReviewRunId: "current-full-review",
        },
      },
    });
  });

  it("rejects a fixed replay contradicted by the current full review", async () => {
    const { coordinator, put, sqlExec } = coordinatorFixture();
    const replayHead = "1".repeat(40);
    const currentHead = "2".repeat(40);
    sqlExec.mockImplementation((query: string) => ({
      rowsWritten: 1,
      toArray: () => {
        if (query.includes("SELECT finding_id FROM review_findings")) {
          return [{ finding_id: identifiedFinding.findingId }];
        }
        if (query.includes("finding_resolutions_json IS NOT NULL")) {
          return [{
            run_id: "fixed-replay",
            head_sha: replayHead,
            finding_resolutions_json: JSON.stringify([{
              findingId: identifiedFinding.findingId,
              verdict: "fixed",
              evidence: "The earlier replay demonstrated the fix.",
            }]),
          }];
        }
        if (query.includes("force_run = 1")) {
          return [{
            run_id: "current-full-review",
            head_sha: currentHead,
            finding_resolutions_json: JSON.stringify([{
              findingId: identifiedFinding.findingId,
              verdict: "still-present",
              evidence: "The current full review still sees the defect.",
            }]),
          }];
        }
        return [];
      },
    }));

    const response = await coordinator.fetch(
      new Request("https://coordinator.test/interactions", {
        method: "POST",
        body: JSON.stringify({
          ...findingInteraction,
          deliveryId: "feedback-contradicted-confirmation",
          headSha: currentHead,
          disposition: "confirmed-fixed",
          reason: "Looks fixed",
        }),
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      accepted: false,
      reason: "no-fixed-replay",
    });
    expect(put).not.toHaveBeenCalled();
  });

  it("finalizes and flushes outstanding finding outcomes", async () => {
    const { coordinator, put, sqlExec } = coordinatorFixture();
    const removedFindingId = `f_${"d".repeat(24)}`;
    const removedHunkId = `h_${"e".repeat(24)}`;
    const findings = [
      {
        finding_id: identifiedFinding.findingId,
        status: "open",
        disposition: null,
        disposition_reason: null,
        first_seen_head_sha: "1".repeat(40),
        last_seen_head_sha: event.headSha,
        first_seen_run_id: "initial-run",
        last_seen_run_id: "latest-run",
      },
      {
        finding_id: removedFindingId,
        status: "open",
        disposition: null,
        disposition_reason: null,
        first_seen_head_sha: "1".repeat(40),
        last_seen_head_sha: "1".repeat(40),
        first_seen_run_id: "initial-run",
        last_seen_run_id: "initial-run",
      },
    ];
    const pendingOutcomes = findings.map((finding) => ({
      finding_id: finding.finding_id,
      outcome_version: 1,
      payload_json: JSON.stringify({
        schemaVersion: 2,
        recordType: "finding-outcome",
        outcomeVersion: 1,
        findingId: finding.finding_id,
      }),
    }));
    sqlExec.mockImplementation((query: string, ...params: unknown[]) => ({
      rowsWritten: 1,
      toArray: () => {
        if (query.includes("FROM review_runs")) {
          return [{ run_id: "latest-run", head_sha: event.headSha }];
        }
        if (query.includes("FROM review_run_hunks")) {
          return [{ hunk_id: identifiedHunk.hunkId }];
        }
        if (query.includes("FROM review_findings ORDER BY")) return findings;
        if (query.includes("FROM review_finding_hunks")) {
          return [{
            hunk_id:
              params[0] === identifiedFinding.findingId
                ? identifiedHunk.hunkId
                : removedHunkId,
          }];
        }
        if (query.includes("WHERE r2_recorded = 0")) return pendingOutcomes;
        return [];
      },
    }));

    const response = await coordinator.fetch(
      new Request("https://coordinator.test/finalizations", {
        method: "POST",
        body: JSON.stringify(pullRequestFinalization),
      }),
    );

    await expect(response.json()).resolves.toEqual({
      accepted: true,
      duplicate: false,
      outcomes: 2,
      pending: 0,
      manualRequired: 0,
    });
    expect(put).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenCalledWith(
      expect.stringContaining(
        `/findings/${identifiedFinding.findingId}/outcomes/v1.json`,
      ),
      pendingOutcomes[0]?.payload_json,
      { httpMetadata: { contentType: "application/json" } },
    );
    expect(put).toHaveBeenCalledWith(
      expect.stringContaining(
        `/findings/${removedFindingId}/outcomes/v1.json`,
      ),
      pendingOutcomes[1]?.payload_json,
      { httpMetadata: { contentType: "application/json" } },
    );
  });

  it("rejects malformed finalizations and deduplicates recorded ones", async () => {
    const invalid = coordinatorFixture();
    for (const body of [
      {},
      { ...pullRequestFinalization, headSha: "x".repeat(65) },
      { ...pullRequestFinalization, occurredAt: "x".repeat(65) },
    ]) {
      const invalidResponse = await invalid.coordinator.fetch(
        new Request("https://coordinator.test/finalizations", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );
      expect(invalidResponse.status).toBe(400);
    }

    const duplicate = coordinatorFixture([event.deliveryId]);
    const duplicateResponse = await duplicate.coordinator.fetch(
      new Request("https://coordinator.test/finalizations", {
        method: "POST",
        body: JSON.stringify({
          ...pullRequestFinalization,
          deliveryId: event.deliveryId,
        }),
      }),
    );
    await expect(duplicateResponse.json()).resolves.toEqual({
      accepted: true,
      duplicate: true,
      outcomes: 0,
    });
    expect(duplicate.put).not.toHaveBeenCalled();
  });

  it("schedules silent findings after the configured outcome window", async () => {
    const { coordinator, sqlExec, storage } = coordinatorFixture([], {
      AI_REVIEW_OUTCOME_WINDOW_SECONDS: "60",
    });
    storage.getAlarm.mockResolvedValue(null);
    sqlExec.mockImplementation((query: string) => ({
      rowsWritten: 1,
      toArray: () =>
        query.includes("FROM review_findings ORDER BY")
          ? [{
              finding_id: identifiedFinding.findingId,
              disposition: null,
              disposition_reason: null,
              first_seen_head_sha: event.headSha,
              last_seen_head_sha: event.headSha,
              first_seen_run_id: "initial-run",
              last_seen_run_id: "initial-run",
            }]
          : [],
    }));
    const finalization = {
      ...pullRequestFinalization,
      deliveryId: "pending-finalization",
      occurredAt: new Date().toISOString(),
    };

    const response = await coordinator.fetch(
      new Request("https://coordinator.test/finalizations", {
        method: "POST",
        body: JSON.stringify(finalization),
      }),
    );

    await expect(response.json()).resolves.toEqual({
      accepted: true,
      duplicate: false,
      outcomes: 0,
      pending: 1,
      manualRequired: 0,
    });
    expect(storage.kv.put).toHaveBeenCalledWith(
      "pending-outcome-evaluation",
      expect.objectContaining({
        kind: "finding-outcome-evaluation",
        event: finalization,
      }),
    );
    expect(storage.setAlarm).toHaveBeenCalledOnce();
  });

  it("uses the default outcome window for invalid configuration", async () => {
    const { coordinator } = coordinatorFixture([], {
      AI_REVIEW_OUTCOME_WINDOW_SECONDS: "invalid",
    });
    const response = await coordinator.fetch(
      new Request("https://coordinator.test/finalizations", {
        method: "POST",
        body: JSON.stringify({
          ...pullRequestFinalization,
          deliveryId: "default-window-finalization",
          occurredAt: new Date().toISOString(),
        }),
      }),
    );

    await expect(response.json()).resolves.toEqual({
      accepted: true,
      duplicate: false,
      outcomes: 0,
      pending: 0,
      manualRequired: 0,
    });
  });

  it("does not postpone an existing evaluation for a duplicate delivery", async () => {
    const { coordinator, sqlExec, storage } = coordinatorFixture(
      [event.deliveryId],
      { AI_REVIEW_OUTCOME_WINDOW_SECONDS: "60" },
    );
    const existingPending = {
      kind: "finding-outcome-evaluation",
      dueAt: Date.now() + 10_000,
      event: {
        ...pullRequestFinalization,
        deliveryId: event.deliveryId,
        occurredAt: new Date().toISOString(),
      },
    } as const;
    storage.get.mockResolvedValue(existingPending);
    sqlExec.mockImplementation((query: string) => ({
      rowsWritten: 1,
      toArray: () => {
        if (query.includes("FROM webhook_deliveries")) {
          return [{ delivery_id: event.deliveryId }];
        }
        if (query.includes("SELECT COUNT(*) AS pending")) {
          return [{ pending: 1 }];
        }
        return [];
      },
    }));

    const response = await coordinator.fetch(
      new Request("https://coordinator.test/finalizations", {
        method: "POST",
        body: JSON.stringify({
          ...pullRequestFinalization,
          deliveryId: event.deliveryId,
          occurredAt: new Date(Date.now() + 30_000).toISOString(),
        }),
      }),
    );

    await expect(response.json()).resolves.toEqual({
      accepted: true,
      duplicate: true,
      outcomes: 0,
    });
    expect(storage.kv.put).not.toHaveBeenCalledWith(
      "pending-outcome-evaluation",
      expect.anything(),
    );
  });

  it("keeps committed finalization successful when outcome publication fails", async () => {
    const { coordinator, put, sqlExec, storage } = coordinatorFixture();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    storage.getAlarm.mockResolvedValue(null);
    put.mockRejectedValueOnce(new Error("R2 unavailable"));
    sqlExec.mockImplementation((query: string) => ({
      rowsWritten: 1,
      toArray: () =>
        query.includes("WHERE r2_recorded = 0")
          ? [{
              finding_id: identifiedFinding.findingId,
              outcome_version: 1,
              payload_json: "{}",
            }]
          : [],
    }));

    const response = await coordinator.fetch(
      new Request("https://coordinator.test/finalizations", {
        method: "POST",
        body: JSON.stringify(pullRequestFinalization),
      }),
    );

    await expect(response.json()).resolves.toEqual({
      accepted: true,
      duplicate: false,
      outcomes: 0,
      pending: 0,
      manualRequired: 0,
    });
    expect(consoleError).toHaveBeenCalledWith(
      "Could not publish a finding outcome",
      { type: "Error" },
    );
    expect(
      sqlExec.mock.calls.some(([query]) =>
        String(query).includes("SET r2_recorded = 1"),
      ),
    ).toBe(false);
    expect(storage.kv.put).toHaveBeenCalledWith(
      "pending-finding-outcome-flush",
      {
        kind: "finding-outcomes",
        repository: event.repository,
        pullRequestNumber: event.pullRequestNumber,
      },
    );
    expect(storage.setAlarm).toHaveBeenCalledWith(1_060_000);
    now.mockRestore();
    consoleError.mockRestore();
  });

  it("retries pending outcome publication from an alarm", async () => {
    const { coordinator, put, sqlExec, storage } = coordinatorFixture();
    const pendingOutcome = {
      finding_id: identifiedFinding.findingId,
      outcome_version: 1,
      payload_json: "{}",
    };
    storage.get.mockImplementation((key: string) =>
      Promise.resolve(
        key === "pending-finding-outcome-flush"
          ? {
              kind: "finding-outcomes",
              repository: event.repository,
              pullRequestNumber: event.pullRequestNumber,
            }
          : undefined,
      ),
    );
    sqlExec.mockImplementation((query: string) => ({
      rowsWritten: 1,
      toArray: () =>
        query.includes("WHERE r2_recorded = 0") ? [pendingOutcome] : [],
    }));

    await coordinator.alarm();

    expect(put).toHaveBeenCalledWith(
      expect.stringContaining(
        `/findings/${identifiedFinding.findingId}/outcomes/v1.json`,
      ),
      pendingOutcome.payload_json,
      { httpMetadata: { contentType: "application/json" } },
    );
    expect(storage.delete).toHaveBeenCalledWith(
      "pending-finding-outcome-flush",
    );
  });

  it("deduplicates finding evidence and rejects unknown findings", async () => {
    const duplicate = coordinatorFixture();
    duplicate.sqlExec.mockImplementation((query: string) => ({
      rowsWritten: 1,
      toArray: () =>
        query.includes("FROM review_finding_events")
          ? [{
              finding_id: identifiedFinding.findingId,
              payload_json: JSON.stringify({ recorded: true }),
              r2_recorded: 1,
            }]
          : [],
    }));
    const duplicateResponse = await duplicate.coordinator.fetch(
      new Request("https://coordinator.test/interactions", {
        method: "POST",
        body: JSON.stringify(findingInteraction),
      }),
    );
    await expect(duplicateResponse.json()).resolves.toMatchObject({
      accepted: true,
      duplicate: true,
    });
    expect(duplicate.put).not.toHaveBeenCalled();

    const unknown = coordinatorFixture();
    const unknownResponse = await unknown.coordinator.fetch(
      new Request("https://coordinator.test/interactions", {
        method: "POST",
        body: JSON.stringify({
          ...findingInteraction,
          findingId: undefined,
          rootCommentId: 654,
          interactionType: "reply",
          disposition: undefined,
          reason: undefined,
        }),
      }),
    );
    expect(unknownResponse.status).toBe(202);
    await expect(unknownResponse.json()).resolves.toEqual({
      accepted: false,
      reason: "unknown-finding",
    });
  });

  it("rejects malformed finding interactions", async () => {
    const { coordinator } = coordinatorFixture();
    for (const body of [
      null,
      [],
      { ...findingInteraction, actor: "" },
      { ...findingInteraction, deliveryId: "x".repeat(256) },
      { ...findingInteraction, reason: "  " },
      { ...findingInteraction, reason: "x".repeat(1_001) },
      { ...findingInteraction, body: "x".repeat(4_001) },
      {
        ...findingInteraction,
        interactionType: "thread",
        disposition: undefined,
        findingId: undefined,
        reason: undefined,
        rootCommentId: 654,
        threadId: "x".repeat(256),
      },
    ]) {
      const response = await coordinator.fetch(
        new Request("https://coordinator.test/interactions", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );
      expect(response.status).toBe(400);
    }
  });

  it("reports a completion that does not match a claimed run", async () => {
    const { coordinator, sqlExec } = coordinatorFixture();
    sqlExec.mockImplementation((query: string) => ({
      rowsWritten: query.includes("UPDATE review_runs") ? 0 : 1,
      toArray: () => [],
    }));

    const response = await coordinator.fetch(
      new Request("https://coordinator.test/reviews/complete", {
        method: "POST",
        body: JSON.stringify({
          repository: event.repository,
          pullRequestNumber: event.pullRequestNumber,
          runId: "missing-review",
          headSha: event.headSha,
          costUsd: 0.42,
          hunks: [],
          findings: [],
        }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "No matching review run to complete",
    });
  });

  it("rejects a mismatched retry of an already completed run", async () => {
    const { coordinator, sqlExec } = coordinatorFixture();
    sqlExec.mockImplementation((query: string) => ({
      rowsWritten: query.includes("UPDATE review_runs") ? 0 : 1,
      toArray: () =>
        query.includes("SELECT head_sha, status, completion_hash")
          ? [{
              head_sha: event.headSha,
              status: "completed",
              completion_hash: "0".repeat(64),
            }]
          : [],
    }));

    const response = await coordinator.fetch(
      new Request("https://coordinator.test/reviews/complete", {
        method: "POST",
        body: JSON.stringify({
          repository: event.repository,
          pullRequestNumber: event.pullRequestNumber,
          runId: "review-delivery-123",
          headSha: event.headSha,
          costUsd: 0.43,
          hunks: [identifiedHunk],
          findings: [identifiedFinding],
        }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Review completion payload does not match",
    });
  });

  it("rejects malformed internal review-state updates", async () => {
    const { coordinator } = coordinatorFixture();
    for (const path of [
      "/reviews/claim",
      "/reviews/complete",
      "/reviews/fail",
    ]) {
      const response = await coordinator.fetch(
        new Request(`https://coordinator.test${path}`, {
          method: "POST",
          body: "{}",
        }),
      );
      expect(response.status).toBe(400);
    }
  });

  it.each([
    ["an empty run ID", { runId: "" }],
    ["an oversized run ID", { runId: "x".repeat(256) }],
    ["an empty error", { error: "" }],
    ["an oversized error", { error: "x".repeat(4_001) }],
    ["a negative cost", { costUsd: -0.01 }],
    ["a nonnumeric cost", { costUsd: "0.1" }],
  ])("rejects review failures with %s", async (_label, override) => {
    const { coordinator } = coordinatorFixture();
    const response = await coordinator.fetch(
      new Request("https://coordinator.test/reviews/fail", {
        method: "POST",
        body: JSON.stringify({
          runId: "review-delivery-123",
          error: "Model request failed",
          costUsd: 0.1,
          ...override,
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid review failure",
    });
  });

  it("caps review completion collections", async () => {
    const { coordinator } = coordinatorFixture();
    const oversized = Array.from(
      { length: MAX_REVIEW_COMPLETION_ITEMS_FOR_TEST + 1 },
      () => null,
    );
    for (const field of [
      "hunks",
      "currentHunks",
      "findings",
      "findingResolutions",
      "findingPublications",
    ]) {
      const response = await coordinator.fetch(
        new Request("https://coordinator.test/reviews/complete", {
          method: "POST",
          body: JSON.stringify({
            repository: event.repository,
            pullRequestNumber: event.pullRequestNumber,
            runId: "review-delivery-123",
            headSha: event.headSha,
            costUsd: 0.42,
            hunks: [],
            findings: [],
            [field]: oversized,
          }),
        }),
      );
      expect(response.status).toBe(400);
    }
  });

  it.each([
    ["an empty run ID", { runId: "" }],
    ["an oversized run ID", { runId: "x".repeat(256) }],
    ["an empty head SHA", { headSha: "" }],
    ["an oversized head SHA", { headSha: "x".repeat(65) }],
    ["a zero comment ID", { commentId: 0 }],
    ["a fractional comment ID", { commentId: 1.5 }],
    ["an unsafe comment ID", { commentId: Number.MAX_SAFE_INTEGER + 1 }],
  ])("rejects review completions with %s", async (_label, override) => {
    const { coordinator } = coordinatorFixture();
    const response = await coordinator.fetch(
      new Request("https://coordinator.test/reviews/complete", {
        method: "POST",
        body: JSON.stringify({
          repository: event.repository,
          pullRequestNumber: event.pullRequestNumber,
          runId: "review-delivery-123",
          headSha: event.headSha,
          costUsd: 0.42,
          hunks: [],
          findings: [],
          ...override,
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid review completion",
    });
  });

  it("rejects an incomplete identified finding at the completion boundary", async () => {
    const { coordinator } = coordinatorFixture();
    const { evidence: _evidence, ...incompleteFinding } = identifiedFinding;
    const response = await coordinator.fetch(
      new Request("https://coordinator.test/reviews/complete", {
        method: "POST",
        body: JSON.stringify({
          repository: event.repository,
          pullRequestNumber: event.pullRequestNumber,
          runId: "review-delivery-123",
          headSha: event.headSha,
          costUsd: 0.42,
          hunks: [identifiedHunk],
          findings: [incompleteFinding],
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid review completion",
    });
  });

  it("rejects a zero-based identified finding at the completion boundary", async () => {
    const { coordinator } = coordinatorFixture();
    const response = await coordinator.fetch(
      new Request("https://coordinator.test/reviews/complete", {
        method: "POST",
        body: JSON.stringify({
          repository: event.repository,
          pullRequestNumber: event.pullRequestNumber,
          runId: "review-delivery-123",
          headSha: event.headSha,
          costUsd: 0.42,
          hunks: [identifiedHunk],
          findings: [{ ...identifiedFinding, line: 0 }],
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid review completion",
    });
  });

  it("rejects a finding linked to a hunk absent from its completion", async () => {
    const { coordinator } = coordinatorFixture();
    const response = await coordinator.fetch(
      new Request("https://coordinator.test/reviews/complete", {
        method: "POST",
        body: JSON.stringify({
          repository: event.repository,
          pullRequestNumber: event.pullRequestNumber,
          runId: "review-delivery-123",
          headSha: event.headSha,
          costUsd: 0.42,
          hunks: [],
          findings: [identifiedFinding],
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid review completion",
    });
  });

  it("rejects conflicting metadata for the same completed hunk", async () => {
    const { coordinator } = coordinatorFixture();
    const response = await coordinator.fetch(
      new Request("https://coordinator.test/reviews/complete", {
        method: "POST",
        body: JSON.stringify({
          repository: event.repository,
          pullRequestNumber: event.pullRequestNumber,
          runId: "review-delivery-123",
          headSha: event.headSha,
          costUsd: 0,
          hunks: [identifiedHunk],
          currentHunks: [
            { ...identifiedHunk, newLines: identifiedHunk.newLines + 1 },
          ],
          findings: [],
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid review completion",
    });
  });

  it("rejects duplicate finding identifiers in completion collections", async () => {
    const validPublication = {
      findingId: identifiedFinding.findingId,
      delivery: "line",
      commentId: 654,
      reconciled: false,
      path: identifiedFinding.file,
      line: identifiedFinding.line,
    };
    const validResolution = {
      findingId: identifiedFinding.findingId,
      verdict: "fixed",
      evidence: "The later diff fixes the finding.",
    };
    const duplicateCollections = [
      { findings: [identifiedFinding, identifiedFinding] },
      {
        findings: [identifiedFinding],
        findingPublications: [validPublication, validPublication],
      },
      {
        findings: [identifiedFinding],
        findingResolutions: [validResolution, validResolution],
      },
    ];

    for (const duplicateCollection of duplicateCollections) {
      const { coordinator } = coordinatorFixture();
      const response = await coordinator.fetch(
        new Request("https://coordinator.test/reviews/complete", {
          method: "POST",
          body: JSON.stringify({
            repository: event.repository,
            pullRequestNumber: event.pullRequestNumber,
            runId: "review-delivery-123",
            headSha: event.headSha,
            costUsd: 0.42,
            hunks: [identifiedHunk],
            ...duplicateCollection,
          }),
        }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "Invalid review completion",
      });
    }
  });

  it("hashes equivalent completion objects independently of key order", async () => {
    const reorderedFinding = Object.fromEntries(
      Object.entries(identifiedFinding).reverse(),
    );
    const completionHashes: unknown[] = [];

    for (const finding of [identifiedFinding, reorderedFinding]) {
      const { coordinator, sqlExec } = coordinatorFixture();
      const response = await coordinator.fetch(
        new Request("https://coordinator.test/reviews/complete", {
          method: "POST",
          body: JSON.stringify({
            repository: event.repository,
            pullRequestNumber: event.pullRequestNumber,
            runId: "review-delivery-123",
            headSha: event.headSha,
            costUsd: 0.42,
            hunks: [identifiedHunk],
            findings: [finding],
          }),
        }),
      );

      expect(response.status).toBe(200);
      const completionUpdate = sqlExec.mock.calls.find(([query]) =>
        String(query).includes("SET status = 'completed'"),
      );
      completionHashes.push(completionUpdate?.[6]);
    }

    expect(completionHashes[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(completionHashes[1]).toBe(completionHashes[0]);
  });

  it("rejects inconsistent finding publication mappings", async () => {
    const { coordinator } = coordinatorFixture();
    const validPublication = {
      findingId: identifiedFinding.findingId,
      delivery: "line",
      commentId: 654,
      reconciled: false,
      path: identifiedFinding.file,
      line: identifiedFinding.line,
    };
    for (const publication of [
      { ...validPublication, path: "different.ts" },
      { ...validPublication, line: 0 },
      { ...validPublication, delivery: "fallback", commentId: 654 },
    ]) {
      const response = await coordinator.fetch(
        new Request("https://coordinator.test/reviews/complete", {
          method: "POST",
          body: JSON.stringify({
            repository: event.repository,
            pullRequestNumber: event.pullRequestNumber,
            runId: "review-delivery-123",
            headSha: event.headSha,
            costUsd: 0.42,
            hunks: [identifiedHunk],
            findings: [identifiedFinding],
            findingPublications: [publication],
          }),
        }),
      );
      expect(response.status).toBe(400);
    }
  });

  it("accepts a reconciled native comment whose current line is null", async () => {
    const { coordinator } = coordinatorFixture();
    const findingWithoutCurrentLine = { ...identifiedFinding, line: null };
    const response = await coordinator.fetch(
      new Request("https://coordinator.test/reviews/complete", {
        method: "POST",
        body: JSON.stringify({
          repository: event.repository,
          pullRequestNumber: event.pullRequestNumber,
          runId: "review-delivery-123",
          headSha: event.headSha,
          costUsd: 0.42,
          hunks: [identifiedHunk],
          findings: [findingWithoutCurrentLine],
          findingPublications: [
            {
              findingId: findingWithoutCurrentLine.findingId,
              delivery: "line",
              commentId: 654,
              reconciled: true,
              path: findingWithoutCurrentLine.file,
              line: null,
            },
          ],
        }),
      }),
    );

    await expect(response.json()).resolves.toEqual({ completed: true });
  });

  it.each([
    [{ attempts: 20, runs: 18, total_cost: 1 }, "review-run budget"],
    [{ attempts: 2, runs: 2, total_cost: 5 }, "cost budget"],
  ])("refuses a claim after the per-PR %s is reached", async (aggregate, reason) => {
    const { coordinator, sqlExec } = coordinatorFixture();
    sqlExec.mockImplementation((query: string) => ({
      rowsWritten: 1,
      toArray: () =>
        query.includes("COUNT(*) AS attempts") ? [aggregate] : [],
    }));

    const response = await coordinator.fetch(
      new Request("https://coordinator.test/reviews/claim", {
        method: "POST",
        body: JSON.stringify({
          runId: "review-budgeted",
          headSha: event.headSha,
          diffFingerprint: "diff-hash",
          configFingerprint: "config-hash",
          force: false,
          maxRuns: 20,
          maxCostUsd: 5,
        }),
      }),
    );

    await expect(response.json()).resolves.toMatchObject({
      claimed: false,
      reason: expect.stringContaining(reason),
    });
    expect(
      sqlExec.mock.calls.some(([query]) =>
        String(query).includes("INSERT INTO review_runs"),
      ),
    ).toBe(false);
  });

  it("allows only one in-flight paid review per pull request", async () => {
    const { coordinator, sqlExec } = coordinatorFixture();
    sqlExec.mockImplementation((query: string) => ({
      rowsWritten: 1,
      toArray: () => {
        if (query.includes("COUNT(*) AS attempts")) {
          return [{ attempts: 1, runs: 0, total_cost: 0 }];
        }
        if (query.includes("WHERE status IN")) {
          return [{ run_id: "review-earlier-head" }];
        }
        return [];
      },
    }));

    const response = await coordinator.fetch(
      new Request("https://coordinator.test/reviews/claim", {
        method: "POST",
        body: JSON.stringify({
          runId: "review-later-head",
          headSha: "def456",
          diffFingerprint: "new-diff-hash",
          configFingerprint: "new-config-hash",
          force: false,
          maxRuns: 20,
          maxCostUsd: 5,
        }),
      }),
    );

    await expect(response.json()).resolves.toMatchObject({
      claimed: false,
      reason: "another review is already running",
    });
    expect(
      sqlExec.mock.calls.some(([query]) =>
        String(query).includes("INSERT INTO review_runs"),
      ),
    ).toBe(false);
  });

  it("terminates an expired Workflow before claiming a replacement", async () => {
    const { coordinator, sqlExec, terminate, workflowGet } =
      coordinatorFixture();
    sqlExec.mockImplementation((query: string) => {
      return {
        rowsWritten: 1,
        toArray: () => {
          if (
            query.includes("WHERE status = 'running'") &&
            query.includes("started_at <")
          ) {
            return [{ run_id: "review-abandoned" }];
          }
          if (query.includes("COUNT(*) AS attempts")) {
            return [{ attempts: 1, runs: 0, total_cost: 0 }];
          }
          return [];
        },
      };
    });

    const response = await coordinator.fetch(
      new Request("https://coordinator.test/reviews/claim", {
        method: "POST",
        body: JSON.stringify({
          runId: "review-replacement",
          headSha: "def456",
          diffFingerprint: "new-diff-hash",
          configFingerprint: "new-config-hash",
          force: true,
          maxRuns: 20,
          maxCostUsd: 5,
        }),
      }),
    );

    await expect(response.json()).resolves.toMatchObject({ claimed: true });
    expect(workflowGet).toHaveBeenCalledWith("review-abandoned");
    expect(terminate).toHaveBeenCalledOnce();
    expect(
      sqlExec.mock.calls.some(
        ([query]) =>
          String(query).includes("status = 'failed'") &&
          String(query).includes("Workflow terminated before replacement"),
      ),
    ).toBe(true);
    expect(
      sqlExec.mock.calls.some(([query]) =>
        String(query).includes("INSERT INTO review_runs"),
      ),
    ).toBe(true);
  });

  it("keeps an expired claim active when Workflow termination fails", async () => {
    const fixture = coordinatorFixture();
    fixture.terminate.mockRejectedValue(new Error("Cloudflare unavailable"));
    fixture.sqlExec.mockImplementation((query: string) => ({
      rowsWritten: 1,
      toArray: () =>
        query.includes("WHERE status = 'running'") &&
        query.includes("started_at <")
          ? [{ run_id: "review-still-running" }]
          : [],
    }));

    const response = await fixture.coordinator.fetch(
      new Request("https://coordinator.test/reviews/claim", {
        method: "POST",
        body: JSON.stringify({
          runId: "review-replacement",
          headSha: "def456",
          diffFingerprint: "new-diff-hash",
          configFingerprint: "new-config-hash",
          force: true,
          maxRuns: 20,
          maxCostUsd: 5,
        }),
      }),
    );

    expect(response.status).toBe(503);
    expect(
      fixture.sqlExec.mock.calls.some(
        ([query]) =>
          String(query).includes("status = 'running'") &&
          String(query).includes("could not terminate expired Workflow"),
      ),
    ).toBe(true);
    expect(
      fixture.sqlExec.mock.calls.some(([query]) =>
        String(query).includes("INSERT INTO review_runs"),
      ),
    ).toBe(false);
  });
});

describe("ReviewWorkflow", () => {
  it("stops before model calls when the pull request is closed", async () => {
    const put = vi.fn();
    const privateKey = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    }).privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ token: "installation-token" }))
      .mockResolvedValueOnce(
        Response.json({
          state: "closed",
          draft: false,
          author_association: "OWNER",
          user: { login: "robbie" },
          head: {
            sha: event.headSha,
            repo: { full_name: event.repository },
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      REVIEW_DATA: { put },
      AI_REVIEW_PROMPT_VERSION: "stateless-parity-v1",
      AI_REVIEW_MODELS: "",
      AI_REVIEW_OPENCODE_MODELS: "",
      AI_REVIEW_MERGER_MODEL: "",
      AI_REVIEW_IGNORED_AUTHORS: "",
      AI_REVIEW_ZDR: "false",
      AI_REVIEW_APP_ID: "123",
      AI_REVIEW_APP_INSTALLATION_ID: "456",
      AI_REVIEW_APP_PRIVATE_KEY: privateKey,
      OPENROUTER_API_KEY: "openrouter-key",
    } as unknown as Env;
    const workflow = new ReviewWorkflow({} as ExecutionContext, env);
    const step = {
      do: vi.fn(async (_name: string, operation: () => Promise<void>) =>
        operation(),
      ),
    } as unknown as WorkflowStep;

    await workflow.run(
      {
        instanceId: "review-delivery-123",
        payload: event,
        timestamp: new Date("2026-07-26T00:00:00.000Z"),
      } as WorkflowEvent<ReviewWorkflowParams>,
      step,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenCalledOnce();
    expect(JSON.parse(String(put.mock.calls[0]?.[1]))).toMatchObject({
      schemaVersion: 2,
      status: "skipped",
      terminal: { reason: "pull request is closed" },
    });
    expect(step.do).toHaveBeenCalledTimes(2);
  });
});

describe("HTTP Worker", () => {
  const secret = "webhook-secret";
  const validBody = JSON.stringify({
    action: "opened",
    number: 821,
    repository: { full_name: "Robbie-Palmer/hq" },
    pull_request: { head: { sha: "abcdef123456" } },
  });

  function workerEnv() {
    const fetch = vi.fn(() => Response.json({ accepted: true }));
    return {
      env: {
        AI_REVIEW_ENABLED: "false",
        AI_REVIEW_REPOSITORY: "Robbie-Palmer/hq",
        AI_REVIEW_WEBHOOK_SECRET: secret,
        PR_STATE: {
          idFromName: vi.fn(() => "coordinator-id"),
          get: vi.fn(() => ({ fetch })),
        },
        REVIEW_DATA: {},
        REVIEW_WORKFLOW: {},
      } as unknown as Env,
      fetch,
    };
  }

  it("serves health and rejects unknown routes", async () => {
    const { env } = workerEnv();
    const health = await worker.fetch(
      new Request("https://ai-review.test/health"),
      env,
    );
    await expect(health.json()).resolves.toMatchObject({
      ok: true,
      service: "ai-review",
      enabled: false,
      bindings: {
        durableObject: true,
        r2: true,
        workflow: true,
      },
    });
    expect(health.headers.get("cache-control")).toBe("no-store");

    const missing = await worker.fetch(
      new Request("https://ai-review.test/missing"),
      env,
    );
    expect(missing.status).toBe(404);
  });

  it("reports degraded health when a critical binding is absent", async () => {
    const { env } = workerEnv();
    Object.assign(env, { PR_STATE: undefined });

    const health = await worker.fetch(
      new Request("https://ai-review.test/health"),
      env,
    );

    expect(health.status).toBe(503);
    await expect(health.json()).resolves.toMatchObject({
      ok: false,
      bindings: { durableObject: false },
    });
  });

  it("rejects invalid signatures and disallowed repositories", async () => {
    const { env } = workerEnv();
    const invalid = await worker.fetch(
      new Request("https://ai-review.test/webhooks/github", {
        method: "POST",
        body: validBody,
      }),
      env,
    );
    expect(invalid.status).toBe(401);

    const disallowedBody = validBody.replace(
      "Robbie-Palmer/hq",
      "Robbie-Palmer/other",
    );
    const disallowed = await worker.fetch(
      signedWebhookRequest(disallowedBody, secret),
      env,
    );
    expect(disallowed.status).toBe(403);

    env.AI_REVIEW_REPOSITORY = "";
    const unconfigured = await worker.fetch(
      signedWebhookRequest(validBody, secret),
      env,
    );
    expect(unconfigured.status).toBe(403);
  });

  it("rejects malformed signed JSON without throwing", async () => {
    const { env } = workerEnv();

    const response = await worker.fetch(signedWebhookRequest("{", secret), env);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Malformed JSON payload",
    });

    const invalidPayload = JSON.stringify({
      action: "opened",
      repository: { full_name: "Robbie-Palmer/hq" },
    });
    const invalid = await worker.fetch(
      signedWebhookRequest(invalidPayload, secret),
      env,
    );
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({
      error: "Malformed webhook payload",
    });
  });

  it("rejects oversized webhook payloads before verification", async () => {
    const { env } = workerEnv();

    const declaredOversizeResponse = await worker.fetch(
      new Request("https://ai-review.test/webhooks/github", {
        method: "POST",
        body: "{}",
        headers: { "content-length": String(2 * 1024 * 1024 + 1) },
      }),
      env,
    );

    expect(declaredOversizeResponse.status).toBe(413);

    const actualOversizeResponse = await worker.fetch(
      new Request("https://ai-review.test/webhooks/github", {
        method: "POST",
        body: "x".repeat(2 * 1024 * 1024 + 1),
      }),
      env,
    );

    expect(actualOversizeResponse.status).toBe(413);
  });

  it("rejects signed webhooks missing routing headers", async () => {
    const { env } = workerEnv();

    const missingEvent = await worker.fetch(
      signedWebhookRequest(validBody, secret, { "x-github-event": "" }),
      env,
    );
    const missingDelivery = await worker.fetch(
      signedWebhookRequest(validBody, secret, { "x-github-delivery": "" }),
      env,
    );

    expect(missingEvent.status).toBe(400);
    expect(missingDelivery.status).toBe(400);
  });

  it("ignores unsupported events and forwards accepted events", async () => {
    const { env, fetch } = workerEnv();
    const ignored = await worker.fetch(
      signedWebhookRequest(validBody, secret, {
        "x-github-event": "push",
      }),
      env,
    );
    expect(ignored.status).toBe(202);

    const accepted = await worker.fetch(
      signedWebhookRequest(validBody, secret),
      env,
    );
    await expect(accepted.json()).resolves.toEqual({ accepted: true });
    expect(fetch).toHaveBeenCalledWith(
      "https://coordinator.internal/events",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("routes authorized finding feedback without scheduling review work", async () => {
    const { env, fetch } = workerEnv();
    const feedbackBody = JSON.stringify({
      action: "created",
      repository: { full_name: "Robbie-Palmer/hq" },
      issue: { number: 821, pull_request: {} },
      sender: { login: "Robbie-Palmer" },
      comment: {
        id: 900,
        body: `/ai-review acknowledge f_${"a".repeat(24)} deferred`,
        author_association: "OWNER",
        user: { login: "Robbie-Palmer" },
      },
    });

    const response = await worker.fetch(
      signedWebhookRequest(feedbackBody, secret, {
        "x-github-event": "issue_comment",
      }),
      env,
    );

    await expect(response.json()).resolves.toEqual({ accepted: true });
    expect(fetch).toHaveBeenCalledWith(
      "https://coordinator.internal/interactions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("records thread-reply dispositions and acknowledges accepted commands", async () => {
    const { env, fetch: coordinatorFetch } = workerEnv();
    const privateKey = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    }).privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    Object.assign(env, {
      AI_REVIEW_APP_ID: "123",
      AI_REVIEW_APP_INSTALLATION_ID: "456",
      AI_REVIEW_APP_PRIVATE_KEY: privateKey,
    });
    const githubFetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ token: "installation-token" }))
      .mockResolvedValueOnce(Response.json({ content: "+1" }, { status: 201 }));
    vi.stubGlobal("fetch", githubFetch);
    const feedbackBody = JSON.stringify({
      action: "created",
      repository: { full_name: "Robbie-Palmer/hq" },
      pull_request: { number: 821 },
      sender: { login: "Robbie-Palmer" },
      comment: {
        id: 902,
        in_reply_to_id: 901,
        body: "/ai-review reject duplicate of the existing finding",
        author_association: "OWNER",
        user: { login: "Robbie-Palmer" },
      },
    });

    const response = await worker.fetch(
      signedWebhookRequest(feedbackBody, secret, {
        "x-github-event": "pull_request_review_comment",
      }),
      env,
    );

    await expect(response.json()).resolves.toEqual({ accepted: true });
    expect(coordinatorFetch).toHaveBeenCalledWith(
      "https://coordinator.internal/interactions",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"disposition":"rejected"'),
      }),
    );
    expect(githubFetch).toHaveBeenCalledTimes(2);
    expect(githubFetch).toHaveBeenLastCalledWith(
      new URL(
        "https://api.github.com/repos/Robbie-Palmer/hq/pulls/comments/902/reactions",
      ),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ content: "+1" }),
      }),
    );
  });

  it("requests webhook redelivery when disposition acknowledgement fails", async () => {
    const { env } = workerEnv();
    const privateKey = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    }).privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    Object.assign(env, {
      AI_REVIEW_APP_ID: "123",
      AI_REVIEW_APP_INSTALLATION_ID: "456",
      AI_REVIEW_APP_PRIVATE_KEY: privateKey,
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ token: "installation-token" }))
        .mockResolvedValueOnce(new Response("forbidden", { status: 403 })),
    );
    const feedbackBody = JSON.stringify({
      action: "created",
      repository: { full_name: "Robbie-Palmer/hq" },
      pull_request: { number: 821 },
      sender: { login: "Robbie-Palmer" },
      comment: {
        id: 904,
        in_reply_to_id: 903,
        body: "/ai-review acknowledge legitimate but deferred",
        author_association: "OWNER",
        user: { login: "Robbie-Palmer" },
      },
    });

    const response = await worker.fetch(
      signedWebhookRequest(feedbackBody, secret, {
        "x-github-event": "pull_request_review_comment",
      }),
      env,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Could not acknowledge disposition reply",
    });
  });

  it("binds trusted fix confirmation to GitHub's current pull request head", async () => {
    const { env, fetch: coordinatorFetch } = workerEnv();
    const privateKey = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    }).privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    Object.assign(env, {
      AI_REVIEW_APP_ID: "123",
      AI_REVIEW_APP_INSTALLATION_ID: "456",
      AI_REVIEW_APP_PRIVATE_KEY: privateKey,
    });
    const githubFetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ token: "installation-token" }))
      .mockResolvedValueOnce(Response.json({ head: { sha: "2".repeat(40) } }));
    vi.stubGlobal("fetch", githubFetch);
    const feedbackBody = JSON.stringify({
      action: "created",
      repository: { full_name: "Robbie-Palmer/hq" },
      issue: { number: 821, pull_request: {} },
      sender: { login: "Robbie-Palmer" },
      comment: {
        id: 901,
        body: `/ai-review confirm-fixed f_${"a".repeat(24)} verified`,
        author_association: "OWNER",
        user: { login: "Robbie-Palmer" },
      },
    });

    const response = await worker.fetch(
      signedWebhookRequest(feedbackBody, secret, {
        "x-github-event": "issue_comment",
      }),
      env,
    );

    await expect(response.json()).resolves.toEqual({ accepted: true });
    expect(githubFetch).toHaveBeenCalledTimes(2);
    expect(coordinatorFetch).toHaveBeenCalledWith(
      "https://coordinator.internal/interactions",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining(`"headSha":"${"2".repeat(40)}"`),
      }),
    );
  });

  it("fails closed when GitHub's current pull request head is unavailable", async () => {
    const { env, fetch: coordinatorFetch } = workerEnv();
    const privateKey = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    }).privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    Object.assign(env, {
      AI_REVIEW_APP_ID: "123",
      AI_REVIEW_APP_INSTALLATION_ID: "456",
      AI_REVIEW_APP_PRIVATE_KEY: privateKey,
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ token: "installation-token" }))
        .mockResolvedValueOnce(new Response("unavailable", { status: 503 })),
    );
    const feedbackBody = JSON.stringify({
      action: "created",
      repository: { full_name: "Robbie-Palmer/hq" },
      issue: { number: 821, pull_request: {} },
      sender: { login: "Robbie-Palmer" },
      comment: {
        id: 902,
        body: `/ai-review confirm-fixed f_${"a".repeat(24)} verified`,
        author_association: "OWNER",
        user: { login: "Robbie-Palmer" },
      },
    });

    const response = await worker.fetch(
      signedWebhookRequest(feedbackBody, secret, {
        "x-github-event": "issue_comment",
      }),
      env,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Could not verify current pull request head",
    });
    expect(coordinatorFetch).not.toHaveBeenCalled();
  });

  it("routes pull request closure to outcome finalization", async () => {
    const { env, fetch } = workerEnv();
    const closedBody = JSON.stringify({
      action: "closed",
      number: 821,
      repository: { full_name: "Robbie-Palmer/hq" },
      pull_request: {
        merged: true,
        closed_at: "2026-08-15T12:00:00Z",
        head: { sha: "abcdef123456" },
      },
    });

    const response = await worker.fetch(
      signedWebhookRequest(closedBody, secret),
      env,
    );

    await expect(response.json()).resolves.toEqual({ accepted: true });
    expect(fetch).toHaveBeenCalledWith(
      "https://coordinator.internal/finalizations",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("sanitizes coordinator failures", async () => {
    const { env, fetch } = workerEnv();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    fetch.mockResolvedValueOnce(
      new Response("SQLite internals", { status: 500 }),
    );
    const rejected = await worker.fetch(
      signedWebhookRequest(validBody, secret),
      env,
    );
    expect(rejected.status).toBe(503);
    await expect(rejected.json()).resolves.toEqual({
      error: "Coordinator unavailable",
    });

    fetch.mockResolvedValueOnce(new Response("invalid", { status: 400 }));
    const invalid = await worker.fetch(
      signedWebhookRequest(validBody, secret),
      env,
    );
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({
      error: "Invalid coordinator request",
    });

    fetch.mockRejectedValueOnce(new Error("internal binding details"));
    const failed = await worker.fetch(
      signedWebhookRequest(validBody, secret),
      env,
    );
    expect(failed.status).toBe(503);
    expect(consoleError).toHaveBeenCalledTimes(3);
  });
});
