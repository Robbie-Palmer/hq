import type { WorkflowStep } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";

const mocks = vi.hoisted(() => ({
  admitBatchJob: vi.fn(),
  db: { kind: "test-db" },
}));

vi.mock("cloudflare:workers", () => ({
  WorkflowEntrypoint: class {},
}));

vi.mock("cloudflare:workflows", () => ({
  NonRetryableError: class extends Error {},
}));

vi.mock("recipe-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("recipe-db")>()),
  withDb: vi.fn(
    (_env: Env, operation: (db: typeof mocks.db) => unknown) =>
      operation(mocks.db),
  ),
}));

vi.mock("../src/batch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/batch")>()),
  admitBatchJob: mocks.admitBatchJob,
}));

import handler, { awaitBatchAdmission } from "../src/index";

const ctx = {
  waitUntil: vi.fn(),
} as unknown as ExecutionContext;
const env = {} as Env;

beforeEach(() => {
  vi.clearAllMocks();
});

function admissionStep() {
  return {
    do: vi.fn(
      async (_name: string, operation: () => Promise<unknown>) => operation(),
    ),
    sleep: vi.fn().mockResolvedValue(undefined),
  } as unknown as WorkflowStep;
}

describe("recipe ingest Worker", () => {
  it("returns its health response through the tracing wrapper", async () => {
    const response = await handler.fetch(
      new Request("https://recipe-ingest.example.test/health"),
      env,
      ctx,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      service: "recipe-ingest",
    });
  });

  it("returns not found for unknown paths", async () => {
    const response = await handler.fetch(
      new Request("https://recipe-ingest.example.test/unknown"),
      env,
      ctx,
    );

    expect(response.status).toBe(404);
  });
});

describe("photo batch admission", () => {
  it("waits for capacity and retries with a stable execution fence", async () => {
    mocks.admitBatchJob
      .mockResolvedValueOnce("queued")
      .mockResolvedValueOnce("admitted");
    const step = admissionStep();

    await expect(
      awaitBatchAdmission(env, "job-1", 3, "instance-1", step),
    ).resolves.toBe(true);

    expect(step.do).toHaveBeenNthCalledWith(1, "admit-0", expect.any(Function));
    expect(step.do).toHaveBeenNthCalledWith(2, "admit-1", expect.any(Function));
    expect(step.sleep).toHaveBeenCalledOnce();
    expect(step.sleep).toHaveBeenCalledWith("wait-0", "5 seconds");
    expect(mocks.admitBatchJob).toHaveBeenCalledTimes(2);
    expect(mocks.admitBatchJob).toHaveBeenLastCalledWith(
      mocks.db,
      "job-1",
      3,
      "instance-1",
    );
  });

  it("stops an obsolete attempt without sleeping or retrying", async () => {
    mocks.admitBatchJob.mockResolvedValueOnce("obsolete");
    const step = admissionStep();

    await expect(
      awaitBatchAdmission(env, "job-2", 4, "instance-2", step),
    ).resolves.toBe(false);

    expect(step.do).toHaveBeenCalledOnce();
    expect(step.sleep).not.toHaveBeenCalled();
    expect(mocks.admitBatchJob).toHaveBeenCalledWith(
      mocks.db,
      "job-2",
      4,
      "instance-2",
    );
  });
});
