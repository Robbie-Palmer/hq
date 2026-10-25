import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  appFetch: vi.fn(),
  closeDb: vi.fn(),
  createDb: vi.fn(),
  createWorkGraphApp: vi.fn(),
  repositoryConstructor: vi.fn(),
}));

vi.mock("work-graph-db", () => ({
  closeDb: fakes.closeDb,
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

import worker from "../src/index";

type WorkerRequest = Parameters<typeof worker.fetch>[0];

const connectionString =
  "postgresql://work_graph_owner:unused@db.invalid:5432/work_graph";
const db = { kind: "test-db" };
const env = {
  HYPERDRIVE: { connectionString } as Hyperdrive,
  WORKER_VERSION: { id: "version-123" },
};
const context = {} as ExecutionContext;

const memoryCache = () => {
  const entries = new Map<string, Response>();
  return {
    match: vi.fn(async (request: RequestInfo) => {
      const key = request instanceof Request ? request.url : request.toString();
      return entries.get(key)?.clone();
    }),
    put: vi.fn(async (request: RequestInfo, response: Response) => {
      const key = request instanceof Request ? request.url : request.toString();
      entries.set(key, response.clone());
    }),
  } as unknown as Cache;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Given the deployed Worker entrypoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    });
    expect(fakes.createWorkGraphApp).toHaveBeenCalledWith(expect.anything(), {
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

  it("serves a repeated projection without opening another database connection", async () => {
    const cache = memoryCache();
    vi.stubGlobal("caches", { default: cache });
    const pending: Promise<unknown>[] = [];
    const cacheContext = {
      waitUntil: vi.fn((promise: Promise<unknown>) => pending.push(promise)),
    } as unknown as ExecutionContext;
    const request = new Request(
      "https://work-graph.example/api/work-items?stage=ready",
    ) as WorkerRequest;
    fakes.appFetch.mockResolvedValue(
      Response.json({ items: [], nextCursor: null }),
    );

    const first = await worker.fetch(request, env, cacheContext);
    await Promise.all(pending);
    const second = await worker.fetch(request, env, cacheContext);

    expect(first.headers.get("x-work-graph-cache")).toBe("miss");
    expect(second.headers.get("x-work-graph-cache")).toBe("hit");
    expect(await second.json()).toEqual({ items: [], nextCursor: null });
    expect(fakes.createDb).toHaveBeenCalledTimes(1);
    expect(fakes.appFetch).toHaveBeenCalledTimes(1);
    expect(fakes.closeDb).toHaveBeenCalledTimes(1);
  });

  it("rotates cached projections after a successful mutation", async () => {
    const cache = memoryCache();
    vi.stubGlobal("caches", { default: cache });
    const pending: Promise<unknown>[] = [];
    const cacheContext = {
      waitUntil: vi.fn((promise: Promise<unknown>) => pending.push(promise)),
    } as unknown as ExecutionContext;
    fakes.appFetch.mockImplementation(async (request: Request) =>
      request.method === "POST"
        ? Response.json({ id: "ticket" }, { status: 201 })
        : Response.json({ items: [], nextCursor: null }),
    );
    const projection = new Request(
      "https://work-graph.example/api/work-items?stage=ready",
    ) as WorkerRequest;

    await worker.fetch(projection, env, cacheContext);
    await Promise.all(pending.splice(0));
    expect(
      (await worker.fetch(projection, env, cacheContext)).headers.get(
        "x-work-graph-cache",
      ),
    ).toBe("hit");

    await worker.fetch(
      new Request("https://work-graph.example/api/work-items", {
        method: "POST",
      }) as WorkerRequest,
      env,
      cacheContext,
    );
    const afterMutation = await worker.fetch(projection, env, cacheContext);

    expect(afterMutation.headers.get("x-work-graph-cache")).toBe("miss");
    expect(fakes.appFetch).toHaveBeenCalledTimes(3);
    expect(fakes.createDb).toHaveBeenCalledTimes(3);
  });

  it("does not store an unsuccessful projection response", async () => {
    vi.stubGlobal("caches", { default: memoryCache() });
    const cacheContext = {
      waitUntil: vi.fn(),
    } as unknown as ExecutionContext;
    fakes.appFetch.mockResolvedValue(
      Response.json({ error: { code: "not_found" } }, { status: 404 }),
    );

    const response = await worker.fetch(
      new Request(
        "https://work-graph.example/api/work-items/missing/details",
      ) as WorkerRequest,
      env,
      cacheContext,
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("x-work-graph-cache")).toBeNull();
    expect(cacheContext.waitUntil).not.toHaveBeenCalled();
  });

  it("logs a cache failure without failing the database read", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("caches", {
      default: {
        match: vi.fn(async () => Promise.reject(new Error("private cache error"))),
        put: vi.fn(),
      },
    });
    fakes.appFetch.mockResolvedValue(
      Response.json({ items: [], nextCursor: null }),
    );

    const response = await worker.fetch(
      new Request("https://work-graph.example/api/work-items") as WorkerRequest,
      { HYPERDRIVE: env.HYPERDRIVE },
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );

    expect(response.status).toBe(200);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        exceptionClass: "projection_cache_lookup_error",
        workerVersion: "local",
      }),
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain("private cache error");
    error.mockRestore();
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
