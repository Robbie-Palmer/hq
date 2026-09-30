import { beforeEach, describe, expect, it, vi } from "vitest";

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
    expect(response.status).toBe(500);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('"exceptionClass":"worker_lifecycle_error"'),
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain("SECRET");
    expect(await response.text()).not.toContain("SECRET");
    error.mockRestore();
  });
});
