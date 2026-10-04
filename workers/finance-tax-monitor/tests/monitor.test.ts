import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowStep } from "cloudflare:workers";

vi.mock("cloudflare:workers", () => ({ WorkflowEntrypoint: class {} }));
vi.mock("cloudflare:workflows", () => ({
  NonRetryableError: class NonRetryableError extends Error {},
}));

import {
  buildGovUkSourceRegistry,
  snapshotGovUkContent,
  type GovUkSourceSpec,
} from "finance-tax-rules/gov-uk-monitor";
import {
  archiveGovUkResponse,
  readNormalizedSnapshot,
} from "../src/artifacts";
import type { Env } from "../src/env";
import {
  fetchAndArchiveSource,
  isSourceDue,
  persistArchivedSource,
  runTaxMonitor,
  type MonitorServices,
} from "../src/index";
import {
  closeDbClient,
  createDb,
  databaseConnection,
  withDb,
} from "../src/db";

const source: GovUkSourceSpec = {
  id: "income-tax",
  title: "Income Tax rates",
  pageUrl: "https://www.gov.uk/income-tax-rates",
  contentApiUrl: "https://www.gov.uk/api/content/income-tax-rates",
  ruleIds: ["income-tax-2026-27"],
  effectivePeriods: [{ from: "2026-04-06", to: "2027-04-05" }],
  defaultCheckIntervalHours: 168,
};

function contentItem(body = "<p>Basic rate: 20%</p>") {
  return {
    base_path: "/income-tax-rates",
    content_id: "content-id",
    description: "Official rates",
    details: { body },
    document_type: "guidance",
    first_published_at: "2025-11-01T09:00:00Z",
    links: {},
    public_updated_at: "2026-04-06T00:00:00Z",
    schema_name: "detailed_guide",
    title: "Income Tax rates",
    updated_at: "2026-04-06T00:01:00Z",
    withdrawn_notice: {},
  };
}

function fakeBucket(): R2Bucket {
  const objects = new Map<string, Uint8Array>();
  return {
    head: vi.fn(async (key: string) =>
      objects.has(key) ? ({ key } as R2Object) : null,
    ),
    put: vi.fn(async (key: string, value: unknown) => {
      if (!(value instanceof Uint8Array)) throw new Error("Expected bytes");
      objects.set(key, value);
      return { key } as R2Object;
    }),
    get: vi.fn(async (key: string) => {
      const value = objects.get(key);
      if (!value) return null;
      return {
        key,
        arrayBuffer: async () =>
          value.buffer.slice(
            value.byteOffset,
            value.byteOffset + value.byteLength,
          ),
      } as R2ObjectBody;
    }),
  } as unknown as R2Bucket;
}

function env(bucket = fakeBucket()): Env {
  return { SOURCE_ARTIFACTS: bucket };
}

describe("R2 source artifacts", () => {
  it("compresses immutable raw and normalized objects and deduplicates them", async () => {
    const bucket = fakeBucket();
    const raw = JSON.stringify(contentItem());
    const snapshot = await snapshotGovUkContent(JSON.parse(raw));
    const response = new Response(raw, {
      headers: { etag: '"revision-1"' },
    });

    const first = await archiveGovUkResponse(
      bucket,
      source,
      raw,
      snapshot,
      response,
      "2026-10-03T10:00:00Z",
    );
    const second = await archiveGovUkResponse(
      bucket,
      source,
      raw,
      snapshot,
      response,
      "2026-10-03T10:00:00Z",
    );

    expect(second).toEqual(first);
    expect(bucket.put).toHaveBeenCalledTimes(2);
    expect(first.rawObjectKey).toMatch(/\/raw\/[a-f0-9]{64}\.json\.gz$/);
    expect(first.normalizedObjectKey).toMatch(
      /\/normalized\/[a-f0-9]{64}\.json\.gz$/,
    );
    await expect(
      readNormalizedSnapshot(bucket, first.normalizedObjectKey),
    ).resolves.toEqual(snapshot);
  });
});

describe("scheduled source checks", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.useRealTimers());

  it("uses the configured interval", () => {
    expect(isSourceDue(null, "2026-10-03T10:00:00Z", 168)).toBe(true);
    expect(
      isSourceDue(
        "2026-10-01T10:00:00Z",
        "2026-10-03T10:00:00Z",
        168,
      ),
    ).toBe(false);
    expect(
      isSourceDue(
        "2026-09-26T10:00:00Z",
        "2026-10-03T10:00:00Z",
        168,
      ),
    ).toBe(true);
    expect(() => isSourceDue("not-a-date", "also-bad", -1)).toThrow(
      "Invalid GOV.UK source monitoring interval or timestamp",
    );
  });

  it("fetches only the public source and sends no salary payload", async () => {
    const raw = JSON.stringify(contentItem());
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.body).toBeUndefined();
      expect(init?.method).toBe("GET");
      return new Response(raw, { status: 200 });
    });

    const artifacts = await fetchAndArchiveSource(
      env(),
      source,
      "2026-10-03T10:00:00Z",
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      source.contentApiUrl,
      expect.objectContaining({ method: "GET" }),
    );
    expect(artifacts.rawByteLength).toBeGreaterThan(0);
    expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain("salary");
  });

  it("rejects a failed GOV.UK response before writing R2", async () => {
    const workerEnv = env();
    await expect(
      fetchAndArchiveSource(
        workerEnv,
        source,
        "2026-10-03T10:00:00Z",
        async () => new Response("unavailable", { status: 503 }),
      ),
    ).rejects.toThrow("returned 503");
    expect(workerEnv.SOURCE_ARTIFACTS.put).not.toHaveBeenCalled();
  });

  it("persists compact revision and review records without HTML", async () => {
    const workerEnv = env();
    const raw = JSON.stringify(contentItem("<table><tr><td>21%</td></tr></table>"));
    const response = new Response(raw);
    const snapshot = await snapshotGovUkContent(JSON.parse(raw));
    const artifacts = await archiveGovUkResponse(
      workerEnv.SOURCE_ARTIFACTS,
      source,
      raw,
      snapshot,
      response,
      "2026-10-03T10:00:00Z",
    );
    const persistCheck = vi.fn<MonitorServices["persistCheck"]>(async () => ({
      revisionId: "revision-1",
      reviewId: "review-1",
      repeated: false,
    }));
    const services: MonitorServices = {
      fetchImpl: fetch,
      readSourceState: vi.fn(),
      readLatestRevision: vi.fn(async () => null),
      persistCheck,
    };

    await expect(
      persistArchivedSource(workerEnv, source, artifacts, services),
    ).resolves.toMatchObject({ reviewId: "review-1" });
    const persistedInput = persistCheck.mock.calls[0]?.[1];
    expect(persistedInput?.proposal).toMatchObject({
      kind: "initial-baseline",
      dates: { activationDate: null, reviewedEffectiveDate: null },
    });
    expect(JSON.stringify(persistedInput)).not.toContain("<table>");
    expect(persistedInput?.artifacts.rawObjectKey).toContain("/raw/");
  });

  it("loads the prior R2 snapshot for a source-change diff", async () => {
    const workerEnv = env();
    const originalRaw = JSON.stringify(contentItem("<p>20%</p>"));
    const changedRaw = JSON.stringify(contentItem("<p>21%</p>"));
    const original = await snapshotGovUkContent(JSON.parse(originalRaw));
    const changed = await snapshotGovUkContent(JSON.parse(changedRaw));
    const originalArtifacts = await archiveGovUkResponse(
      workerEnv.SOURCE_ARTIFACTS,
      source,
      originalRaw,
      original,
      new Response(originalRaw),
      "2026-10-01T10:00:00Z",
    );
    const changedArtifacts = await archiveGovUkResponse(
      workerEnv.SOURCE_ARTIFACTS,
      source,
      changedRaw,
      changed,
      new Response(changedRaw),
      "2026-10-03T10:00:00Z",
    );
    const persistCheck = vi.fn<MonitorServices["persistCheck"]>(async () => ({
      revisionId: "revision-2",
      reviewId: "review-2",
      repeated: false,
    }));
    const services: MonitorServices = {
      fetchImpl: fetch,
      readSourceState: vi.fn(),
      readLatestRevision: vi.fn(async () => ({
        id: "revision-1",
        normalizedFingerprint: original.fingerprint,
        normalizedObjectKey: originalArtifacts.normalizedObjectKey,
      })),
      persistCheck,
    };

    await persistArchivedSource(workerEnv, source, changedArtifacts, services);

    expect(persistCheck.mock.calls[0]?.[1]).toMatchObject({
      expectedBaseRevisionId: "revision-1",
      proposal: {
        kind: "source-change",
        baseFingerprint: original.fingerprint,
        candidateFingerprint: changed.fingerprint,
      },
    });
  });

  it("completes a due source and skips sources still inside their interval", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-10-04T12:34:56.000Z");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const registry = buildGovUkSourceRegistry();
    const firstSourceId = registry[0]?.id;
    const services: MonitorServices = {
      fetchImpl: vi.fn(async () =>
        new Response(JSON.stringify(contentItem()), { status: 200 }),
      ),
      readSourceState: vi.fn(async (_env, checkedSource) => ({
        lastSuccessfulCheckAt:
          checkedSource.id === firstSourceId ? null : "2026-10-03T10:00:00Z",
      })),
      readLatestRevision: vi.fn(async () => null),
      persistCheck: vi.fn(async (_env, input) => ({
        revisionId: "revision-1",
        reviewId: input.proposal?.id ?? null,
        repeated: false,
      })),
    };
    const step = {
      do: vi.fn(
        async (
          _name: string,
          _config: unknown,
          operation: () => Promise<unknown>,
        ) => operation(),
      ),
    } as unknown as WorkflowStep;

    const result = await runTaxMonitor(
      env(),
      step,
      "2026-10-03T10:00:00Z",
      services,
    );

    expect(result.checkedSourceIds).toEqual([firstSourceId]);
    expect(result.skippedSourceIds).toHaveLength(registry.length - 1);
    expect(result.reviewIds).toHaveLength(1);
    expect(result.failures).toEqual([]);
    expect(services.persistCheck).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        artifacts: expect.objectContaining({
          retrievedAt: "2026-10-04T12:34:56.000Z",
        }),
      }),
    );
  });

  it("leaves exhausted retry bookkeeping in the Workflow", async () => {
    const firstSourceId = buildGovUkSourceRegistry()[0]?.id;
    const fetchImpl = vi.fn(async () => new Response("unavailable", { status: 503 }));
    const services: MonitorServices = {
      fetchImpl,
      readSourceState: vi.fn(async (_env, checkedSource) => ({
        lastSuccessfulCheckAt:
          checkedSource.id === firstSourceId ? null : "2026-10-03T10:00:00Z",
      })),
      readLatestRevision: vi.fn(),
      persistCheck: vi.fn(),
    };
    const step = {
      do: vi.fn(
        async (
          _name: string,
          config: { retries?: { limit?: number } },
          operation: () => Promise<unknown>,
        ) => {
          let lastError: unknown;
          for (
            let attempt = 0;
            attempt <= (config.retries?.limit ?? 0);
            attempt += 1
          ) {
            try {
              return await operation();
            } catch (error) {
              lastError = error;
            }
          }
          throw lastError;
        },
      ),
    } as unknown as WorkflowStep;

    await expect(
      runTaxMonitor(
        env(),
        step,
        "2026-10-03T10:00:00Z",
        services,
      ),
    ).rejects.toThrow("failed after step retries");
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(services.persistCheck).not.toHaveBeenCalled();
  });
});

describe("database connection boundary", () => {
  it("prefers Hyperdrive and falls back to a direct development URL", () => {
    expect(
      databaseConnection({
        ...env(),
        HYPERDRIVE: { connectionString: "postgresql://hyperdrive" } as Hyperdrive,
        DATABASE_URL: "postgresql://fallback",
      }),
    ).toBe("postgresql://hyperdrive");
    expect(
      databaseConnection({ ...env(), DATABASE_URL: "postgresql://fallback" }),
    ).toBe("postgresql://fallback");
    expect(databaseConnection(env())).toBeUndefined();
  });

  it("creates and closes a lazy postgres.js client", async () => {
    const created = createDb("postgresql://user:password@127.0.0.1:1/test");
    expect(created.db).toBeDefined();
    await expect(closeDbClient(created.client)).resolves.toBeUndefined();
    await expect(closeDbClient(undefined)).resolves.toBeUndefined();
  });

  it("fails before an operation when no database binding exists", async () => {
    await expect(withDb(env(), async () => "unused")).rejects.toThrow(
      "No finance database connection configured",
    );
  });
});
