import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  appFetch: vi.fn(),
  closeDb: vi.fn(),
  createDatabaseQueryMetrics: vi.fn(),
  createDb: vi.fn(),
  createWorkGraphApp: vi.fn(),
  exportAnalyticsBatch: vi.fn(),
  repositoryConstructor: vi.fn(),
}));

vi.mock("work-graph-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("work-graph-db")>()),
  closeDb: fakes.closeDb,
  createDatabaseQueryMetrics: fakes.createDatabaseQueryMetrics,
  createDb: fakes.createDb,
  WorkGraphRepository: class {
    constructor(db: unknown) {
      fakes.repositoryConstructor(db);
    }
  },
}));

vi.mock("../src/app", () => ({
  createWorkGraphApp: fakes.createWorkGraphApp,
}));

vi.mock("../src/analytics-export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/analytics-export")>()),
  exportAnalyticsBatch: fakes.exportAnalyticsBatch,
}));

import { AnalyticsExportError } from "../src/analytics-export";
import worker from "../src/index";

type WorkerRequest = Parameters<typeof worker.fetch>[0];
type ScheduleController = Parameters<typeof worker.scheduled>[0];

const connectionString =
  "postgresql://work_graph_owner:unused@db.invalid:5432/work_graph";
const db = { kind: "test-db" };
const databaseMetrics = {
  queryCount: 2,
  resultRowCount: 3,
  resultBytesEstimated: 128,
};
const env = {
  HYPERDRIVE: { connectionString } as Hyperdrive,
  WORKER_VERSION: { id: "version-123" },
};
const context = {} as ExecutionContext;

describe("Given the deployed Worker entrypoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.createDatabaseQueryMetrics.mockReturnValue(databaseMetrics);
    fakes.createDb.mockReturnValue(db);
    fakes.createWorkGraphApp.mockReturnValue({ fetch: fakes.appFetch });
  });

  it("serves requests through the Hyperdrive repository and closes the database", async () => {
    const expected = new Response(null, { status: 204 });
    const request = new Request(
      "https://work-graph.example/api/work-items",
    ) as WorkerRequest;
    fakes.appFetch.mockResolvedValue(expected);

    const actual = await worker.fetch(request, env, context);

    expect(actual).toBe(expected);
    expect(fakes.createDb).toHaveBeenCalledWith(connectionString, {
      maxConnections: 1,
      metrics: databaseMetrics,
    });
    expect(fakes.createWorkGraphApp).toHaveBeenCalledWith(expect.anything(), {
      databaseMetrics,
      workerVersion: "version-123",
    });
    expect(fakes.repositoryConstructor).toHaveBeenCalledWith(db);
    expect(fakes.appFetch).toHaveBeenCalledWith(request, env, context);
    expect(fakes.closeDb).toHaveBeenCalledWith(db);
  });

  it("closes the database when request handling fails", async () => {
    const failure = new Error("request failed");
    fakes.appFetch.mockRejectedValue(failure);

    const response = await worker.fetch(
      new Request("https://work-graph.example/api/work-items") as WorkerRequest,
      env,
      context,
    );
    expect(response.status).toBe(500);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(fakes.closeDb).toHaveBeenCalledWith(db);
  });
});

describe("Given a Worker lifecycle failure", () => {
  it.each(["startup", "cleanup"])("sanitizes %s exceptions", async (phase) => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const secret = "postgresql://owner:SECRET@db.invalid/database";
    fakes.createDb.mockReset().mockReturnValue(db);
    fakes.closeDb.mockReset().mockResolvedValue(undefined);
    fakes.appFetch.mockResolvedValue(new Response(null, { status: 204 }));
    fakes.createWorkGraphApp.mockReturnValue({ fetch: fakes.appFetch });
    if (phase === "startup")
      fakes.createDb.mockImplementation(() => {
        throw new Error(secret);
      });
    else fakes.closeDb.mockRejectedValue(new Error(secret));
    const response = await worker.fetch(
      new Request(
        "https://work-graph.example/secret?token=SECRET",
      ) as WorkerRequest,
      env,
      context,
    );
    expect(response.status).toBe(phase === "startup" ? 500 : 204);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        exceptionClass:
          phase === "startup"
            ? "worker_lifecycle_error"
            : "worker_cleanup_error",
      }),
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain("SECRET");
    expect(await response.text()).not.toContain("SECRET");
    error.mockRestore();
  });
});

describe("Given database cleanup fails after the app completes", () => {
  it.each([201, 503])("preserves the app's %s response", async (status) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    fakes.createDb.mockReset().mockReturnValue(db);
    fakes.closeDb.mockReset().mockRejectedValue(new Error("private details"));
    const expected = Response.json(
      { outcome: "app response" },
      {
        status,
        headers: { "X-Request-Id": "app-request-id" },
      },
    );
    fakes.appFetch.mockResolvedValue(expected);
    fakes.createWorkGraphApp.mockReturnValue({ fetch: fakes.appFetch });
    const response = await worker.fetch(
      new Request("https://work-graph.example/api/work-items") as WorkerRequest,
      env,
      context,
    );
    expect(response).toBe(expected);
    expect(response.headers.get("x-request-id")).toBe("app-request-id");
    expect(await response.json()).toEqual({ outcome: "app response" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private details");
    log.mockRestore();
  });
});

describe("Given a scheduled analytics export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.createDatabaseQueryMetrics
      .mockReset()
      .mockReturnValue(databaseMetrics);
    fakes.createDb.mockReset().mockReturnValue(db);
    fakes.closeDb.mockReset().mockResolvedValue(undefined);
    fakes.exportAnalyticsBatch.mockReset();
  });

  it.each([
    ["database", "dependency_failure"],
    ["binding", "configuration_invalid"],
  ])("sanitizes a %s failure", async (phase, reason) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const secret = "postgresql://owner:SECRET@db.invalid/database";
    if (phase === "database") {
      fakes.createDb.mockImplementation(() => {
        throw new Error(secret);
      });
    } else {
      fakes.createDb.mockReturnValue(db);
    }

    await expect(
      worker.scheduled({} as ScheduleController, env),
    ).rejects.toThrow("analytics export failed");
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        exceptionClass: "analytics_export_error",
        reason,
      }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("SECRET");
    expect(fakes.closeDb).toHaveBeenCalledTimes(phase === "binding" ? 1 : 0);
    log.mockRestore();
  });

  it("logs successful batch metrics without sensitive data", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const analytics = {} as R2Bucket;
    fakes.exportAnalyticsBatch.mockResolvedValue({
      eventRows: 2,
      manifestKey: "work-state/v1/manifests/1-2.json",
      objectBytes: 512,
      scopeRows: 1,
      status: "exported",
      throughSequence: 2,
    });

    await expect(
      worker.scheduled({} as ScheduleController, {
        ...env,
        ANALYTICS: analytics,
      }),
    ).resolves.toBeUndefined();
    expect(fakes.exportAnalyticsBatch).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      1_000,
    );
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        eventRows: 2,
        scopeRows: 1,
        throughSequence: 2,
      }),
    );
    expect(fakes.closeDb).toHaveBeenCalledWith(db);
    log.mockRestore();
  });

  it("logs fixed reasons for invalid configuration and permanent export errors", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const analytics = {} as R2Bucket;

    await expect(
      worker.scheduled(
        {} as ScheduleController,
        { ...env, ANALYTICS: analytics, ANALYTICS_BATCH_SIZE: "unbounded" },
      ),
    ).rejects.toThrow("analytics export failed");
    expect(log).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: "configuration_invalid" }),
    );

    fakes.exportAnalyticsBatch.mockRejectedValue(
      new AnalyticsExportError(
        "manifest_schema_invalid",
        "private manifest details",
      ),
    );
    await expect(
      worker.scheduled({} as ScheduleController, {
        ...env,
        ANALYTICS: analytics,
      }),
    ).rejects.toThrow("analytics export failed");
    expect(log).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: "manifest_schema_invalid" }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      "private manifest details",
    );
    log.mockRestore();
  });
});
