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
    expect(fakes.createDb).toHaveBeenCalledWith(connectionString);
    expect(fakes.repositoryConstructor).toHaveBeenCalledWith(db);
    expect(fakes.appFetch).toHaveBeenCalledWith(request, env, context);
    expect(fakes.closeDb).toHaveBeenCalledWith(db);
  });

  it("closes the database when request handling fails", async () => {
    const failure = new Error("request failed");
    fakes.appFetch.mockRejectedValue(failure);

    await expect(
      worker.fetch(
        new Request(
          "https://work-graph.example/api/work-items",
        ) as WorkerRequest,
        env,
        context,
      ),
    ).rejects.toBe(failure);
    expect(fakes.closeDb).toHaveBeenCalledWith(db);
  });
});
