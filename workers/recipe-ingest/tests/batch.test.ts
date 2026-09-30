import type { WorkflowStep } from "cloudflare:workers";
import { recipeImportJob as jobs, user } from "recipe-db/schema";
import { sha256Hex } from "ts-base/crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";

const mocks = vi.hoisted(() => ({
  withDb: vi.fn(),
  writeArtifact: vi.fn(),
  insertGeneratedDraft: vi.fn(),
}));
vi.mock("recipe-db", () => ({ withDb: mocks.withDb }));
vi.mock("../src/artifacts", () => ({ writeArtifact: mocks.writeArtifact }));

vi.mock("recipe-db/batch-drafts", () => ({
  insertGeneratedDraft: mocks.insertGeneratedDraft,
}));

import { runBatchItem } from "../src/batch";

async function fixture(source: unknown, activeCounts = [0]) {
  const body = JSON.stringify(source);
  const item = {
    id: "job-1",
    userId: "user-1",
    workflowInstanceId: null,
    status: "queued",
    executionAttempt: 1,
    reviewState: "waiting",
    sourceChecksum: await sha256Hex(body),
  };
  const updates: Record<string, unknown>[] = [];
  const db = {
    select: (projection?: unknown) => {
      let table: unknown;
      const query = {
        from: (value: unknown) => {
          table = value;
          return query;
        },
        where: () => query,
        for: () => Promise.resolve([{ id: "user-1" }]),
        // biome-ignore lint/suspicious/noThenProperty: Drizzle queries are awaitable thenables.
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(
            table === user
              ? [{ id: "user-1" }]
              : projection
                ? [{ value: activeCounts.shift() ?? 0 }]
                : [item],
          ).then(resolve),
      };
      return query;
    },
    transaction: (fn: (value: unknown) => unknown) => fn(db),
    update: (table: unknown) => ({
      set: (value: Record<string, unknown>) => ({
        where: () => {
          expect(table).toBe(jobs);
          updates.push(value);
          Object.assign(item, value);
          return Promise.resolve();
        },
      }),
    }),
  };
  mocks.withDb.mockImplementation((_env, fn) => fn(db));
  const get = vi.fn().mockResolvedValue({ text: async () => body });
  const step = {
    do: vi.fn(async (_name, configOrFn, fn) => (fn ?? configOrFn)()),
    sleep: vi.fn().mockResolvedValue(undefined),
  };
  return {
    env: { ARTIFACTS: { get } } as unknown as Env,
    step: step as unknown as WorkflowStep,
    updates,
    item,
    get,
    sleep: step.sleep,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.writeArtifact.mockResolvedValue({});
});
describe("batch execution", () => {
  it("parses a file after durable backpressure and writes a review draft without publishing", async () => {
    const f = await fixture(
      {
        type: "file",
        filename: "salt.cook",
        content: "Mix @salt{1%tsp} into the dish.",
      },
      [2, 0],
    );
    await runBatchItem(f.env, "job-1", 1, "job-1-1", f.step);
    expect(f.sleep).toHaveBeenCalledOnce();
    expect(f.item.status).toBe("succeeded");
    expect(f.item.reviewState).toBe("ready");
    expect(mocks.insertGeneratedDraft).toHaveBeenCalledWith(
      expect.anything(),
      "job-1",
      expect.objectContaining({
        title: "salt",
        source: "Mix @salt{1%tsp} into the dish.",
      }),
    );
    expect(mocks.writeArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "batch-draft-1.json",
        kind: "batch-draft-1",
      }),
    );
  });
  it("records a failure for an invalid file while preserving the source", async () => {
    const f = await fixture({
      type: "file",
      filename: "broken.json",
      content: "{}",
    });
    await runBatchItem(f.env, "job-1", 1, "job-1-1", f.step);
    expect(f.item.status).toBe("failed");
    expect(f.item.reviewState).toBe("needs_attention");
    expect(f.updates.at(-1)?.errorMessage).toMatch(/No complete recipe/);
    expect(mocks.writeArtifact).not.toHaveBeenCalled();
  });
  it("rejects changed or expired immutable sources", async () => {
    const f = await fixture({
      type: "file",
      filename: "salt.cook",
      content: "Mix @salt{1%tsp}.",
    });
    f.item.sourceChecksum = "wrong";
    await runBatchItem(f.env, "job-1", 1, "job-1-1", f.step);
    expect(f.updates.at(-1)?.errorMessage).toMatch(/checksum/);
    const missing = await fixture({
      type: "file",
      filename: "salt.cook",
      content: "Mix @salt{1%tsp}.",
    });
    missing.get.mockResolvedValue(null);
    await runBatchItem(missing.env, "job-1", 1, "job-1-1", missing.step);
    expect(missing.updates.at(-1)?.errorMessage).toMatch(/expired/);
  });
  it("fetches and parses an independent URL item", async () => {
    const f = await fixture({
      type: "url",
      url: "https://recipes.example.test/soup",
    });
    const original = globalThis.fetch;
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          `<script type="application/ld+json">${JSON.stringify({ "@type": "Recipe", name: "Soup", recipeIngredient: ["1 tsp salt"], recipeInstructions: ["Mix the salt."] })}</script>`,
          { headers: { "content-type": "text/html" } },
        ),
      );
    try {
      await runBatchItem(f.env, "job-1", 1, "job-1-1", f.step);
      expect(f.item.status).toBe("succeeded");
      expect(mocks.insertGeneratedDraft).toHaveBeenCalledWith(
        expect.anything(),
        "job-1",
        expect.objectContaining({
          title: "Soup",
          url: "https://recipes.example.test/soup",
        }),
      );
    } finally {
      globalThis.fetch = original;
    }
  });
});
