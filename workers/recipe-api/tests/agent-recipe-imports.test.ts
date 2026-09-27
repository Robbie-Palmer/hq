import type { AgentSession } from "@better-auth/agent-auth";
import type { Db } from "recipe-db";
import * as schema from "recipe-db/schema";
import { describe, expect, it, vi } from "vitest";
import {
  createAgentRecipeImport,
  readAgentRecipeImportStatus,
  recipeImportQuotaReason,
} from "../src/agent-recipe-imports";
import type { DbTransaction } from "../src/db/types";

const job = {
  id: "00000000-0000-4000-8000-000000000099",
  userId: "user-1",
  status: "queued" as const,
  currentStage: null,
  progressLabel: null,
  errorType: null,
  errorMessage: null,
  workflowInstanceId: null,
  imageCount: 1,
  createdAt: new Date("2026-09-27T12:00:00Z"),
  updatedAt: new Date("2026-09-27T12:00:00Z"),
  finishedAt: null,
};

function agentSession(): AgentSession {
  return {
    type: "delegated",
    agentId: "agent-1",
    userId: "user-1",
    agent: {
      id: "agent-1",
      name: "Recipe helper",
      mode: "delegated",
      capabilityGrants: [],
      hostId: "host-1",
      createdAt: new Date("2026-09-27T10:00:00Z"),
      activatedAt: new Date("2026-09-27T10:01:00Z"),
      metadata: null,
    },
    host: { id: "host-1", userId: "user-1", status: "active" },
    user: { id: "user-1", name: "Cook", email: "cook@example.test" },
  };
}

function importDb(queryResults: unknown[][]) {
  let queryIndex = 0;
  const state = {
    inserts: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
    updates: [] as Record<string, unknown>[],
  };
  const db = {
    select: () => {
      const result = queryResults[queryIndex++] ?? [];
      const query = {
        from: () => query,
        where: () => query,
        orderBy: () => query,
        limit: () => Promise.resolve(result),
        for: () => Promise.resolve(result),
        then: <TResult1 = unknown[]>(
          resolve?:
            | ((value: unknown[]) => TResult1 | PromiseLike<TResult1>)
            | null,
        ) => Promise.resolve(result).then(resolve),
      };
      return query;
    },
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        state.inserts.push({ table, values });
        const result = table === schema.recipeImportJob ? [job] : [];
        return {
          returning: () => Promise.resolve(result),
          then: <TResult1 = unknown>(
            resolve?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
          ) => Promise.resolve(undefined).then(resolve),
        };
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          state.updates.push(values);
          return Promise.resolve();
        },
      }),
    }),
    transaction: (callback: (tx: Db) => Promise<unknown>) =>
      callback(db as unknown as Db),
  };
  return { db: db as unknown as Db, state };
}

function services(bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])) {
  const put = vi.fn().mockResolvedValue(undefined);
  const create = vi.fn().mockResolvedValue(undefined);
  const remove = vi.fn().mockResolvedValue(undefined);
  return {
    value: {
      artifacts: {
        put,
        list: vi.fn().mockResolvedValue({ objects: [{ key: "source.png" }] }),
        delete: remove,
      } as unknown as R2Bucket,
      workflow: { create } as unknown as Workflow,
      fetcher: vi.fn().mockResolvedValue(
        new Response(bytes, { headers: { "content-type": "image/png" } }),
      ),
    },
    put,
    create,
    remove,
  };
}

describe("agent recipe imports", () => {
  it("requires configured services and a bounded source list", async () => {
    const input = {
      imageUrls: ["https://images.example.test/recipe.png"],
      idempotencyKey: "0198f1f0-abcd-7abc-8abc-abcdefabcdef",
      reason: "Import one recipe",
    };

    await expect(
      createAgentRecipeImport(importDb([]).db, {}, agentSession(), input),
    ).rejects.toThrow("not configured");
    await expect(
      createAgentRecipeImport(
        importDb([]).db,
        services().value,
        agentSession(),
        { ...input, imageUrls: [] },
      ),
    ).rejects.toThrow("between 1 and 6");
  });

  it("creates an attributed import without persisting source URLs", async () => {
    const { db, state } = importDb([[{ id: "user-1" }], [], [{ value: 0 }], [{ value: 0 }]]);
    const storage = services();

    const result = await createAgentRecipeImport(
      db,
      storage.value,
      agentSession(),
      {
        imageUrls: ["https://images.example.test/recipe.png?token=secret"],
        idempotencyKey: "0198f1f0-eeee-7eee-8eee-eeeeeeeeeeee",
        reason: "Import the cook's recipe photo",
      },
    );

    expect(result).toMatchObject({
      replayed: false,
      import: { id: job.id, status: "queued", imageCount: 1 },
    });
    expect(storage.put).toHaveBeenCalledOnce();
    expect(storage.create).toHaveBeenCalledWith({
      id: job.id,
      params: { jobId: job.id },
    });
    const attribution = state.inserts.find(
      (entry) => entry.table === schema.agentMutationChangeSet,
    )?.values;
    expect(attribution).toMatchObject({
      actorAgentId: "agent-1",
      actorHostId: "host-1",
      capability: "recipe_import.create",
      targetId: job.id,
      idempotencyKey: "0198f1f0-eeee-7eee-8eee-eeeeeeeeeeee",
    });
    expect(attribution?.commandFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(attribution)).not.toContain("token=secret");
  });

  it("replays the original job without fetching or restarting work", async () => {
    const fingerprintBytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        JSON.stringify(["Retry import", ["https://images.example.test/recipe.png"]]),
      ),
    );
    const fingerprint = Array.from(new Uint8Array(fingerprintBytes), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const { db } = importDb([
      [{ id: "user-1" }],
      [
        {
          actorType: "agent",
          actorUserId: "user-1",
          actorAgentId: "agent-1",
          actorHostId: "host-1",
          capability: "recipe_import.create",
          commandFingerprint: fingerprint,
          targetId: job.id,
        },
      ],
      [job],
    ]);
    const storage = services();

    await expect(
      createAgentRecipeImport(db, storage.value, agentSession(), {
        imageUrls: ["https://images.example.test/recipe.png"],
        idempotencyKey: "0198f1f0-ffff-7fff-8fff-ffffffffffff",
        reason: "Retry import",
      }),
    ).resolves.toMatchObject({ replayed: true, import: { id: job.id } });
    expect(storage.value.fetcher).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
    expect(storage.create).not.toHaveBeenCalled();
  });

  it("marks the job failed and cleans uploads when image validation fails", async () => {
    const { db, state } = importDb([[{ id: "user-1" }], [], [{ value: 0 }], [{ value: 0 }]]);
    const storage = services(new Uint8Array([1, 2, 3]));

    await expect(
      createAgentRecipeImport(db, storage.value, agentSession(), {
        imageUrls: ["https://images.example.test/not-a-png"],
        idempotencyKey: "0198f1f0-aaaa-7aaa-8aaa-aaaaaaaaaaaa",
        reason: "Import an invalid image",
      }),
    ).rejects.toThrow("Failed to start the import");
    expect(storage.remove).toHaveBeenCalledWith("source.png");
    expect(storage.create).not.toHaveBeenCalled();
    expect(state.updates).toContainEqual(
      expect.objectContaining({ status: "failed", errorType: "StartError" }),
    );
  });

  it("follows safe redirects before validating the image", async () => {
    const { db } = importDb([
      [{ id: "user-1" }],
      [],
      [{ value: 0 }],
      [{ value: 0 }],
    ]);
    const storage = services();
    vi.mocked(storage.value.fetcher as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "/final.png" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), {
          headers: { "content-type": "image/png" },
        }),
      );

    await expect(
      createAgentRecipeImport(db, storage.value, agentSession(), {
        imageUrls: ["https://images.example.test/start"],
        idempotencyKey: "0198f1f0-bbbb-7bbb-8bbb-bbbbbbbbbbbb",
        reason: "Follow the recipe image redirect",
      }),
    ).resolves.toMatchObject({ replayed: false });
    expect(storage.value.fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects failed and unsupported image responses", async () => {
    for (const response of [
      new Response("missing", { status: 404 }),
      new Response("text", { headers: { "content-type": "text/plain" } }),
      new Response(null, { status: 302 }),
    ]) {
      const { db } = importDb([
        [{ id: "user-1" }],
        [],
        [{ value: 0 }],
        [{ value: 0 }],
      ]);
      const storage = services();
      storage.value.fetcher = vi.fn().mockResolvedValue(response);

      await expect(
        createAgentRecipeImport(db, storage.value, agentSession(), {
          imageUrls: ["https://images.example.test/recipe"],
          idempotencyKey: crypto.randomUUID(),
          reason: "Reject an invalid image response",
        }),
      ).rejects.toThrow("Failed to start the import");
    }
  });

  it("rejects an idempotency key reused by a different actor", async () => {
    const { db } = importDb([
      [{ id: "user-1" }],
      [
        {
          actorType: "agent",
          actorUserId: "user-1",
          actorAgentId: "another-agent",
          actorHostId: "host-1",
          capability: "recipe_import.create",
          commandFingerprint: "irrelevant",
          targetId: job.id,
        },
      ],
    ]);

    await expect(
      createAgentRecipeImport(db, services().value, agentSession(), {
        imageUrls: ["https://images.example.test/recipe.png"],
        idempotencyKey: "0198f1f0-cccc-7ccc-8ccc-cccccccccccc",
        reason: "Do not replay another actor's import",
      }),
    ).rejects.toThrow("different operation");
  });

  it("reads one owned import by id and includes safe failure details", async () => {
    const failedJob = {
      ...job,
      status: "failed" as const,
      errorType: "StartError",
      errorMessage: "Failed to start the import",
    };

    await expect(
      readAgentRecipeImportStatus(importDb([[failedJob]]).db, "user-1", {
        jobId: job.id,
        limit: 10,
      }),
    ).resolves.toEqual({
      imports: [
        expect.objectContaining({
          id: job.id,
          error: {
            type: "StartError",
            message: "Failed to start the import",
          },
        }),
      ],
    });
  });

  it("reports shared active and daily quota limits", async () => {
    const active = importDb([[{ value: 2 }], [{ value: 2 }]]).db;
    const daily = importDb([[{ value: 0 }], [{ value: 10 }]]).db;
    const available = importDb([[{ value: 0 }], [{ value: 0 }]]).db;

    await expect(
      recipeImportQuotaReason(active as unknown as DbTransaction, "user-1"),
    ).resolves.toBe("active");
    await expect(
      recipeImportQuotaReason(daily as unknown as DbTransaction, "user-1"),
    ).resolves.toBe("daily");
    await expect(
      recipeImportQuotaReason(available as unknown as DbTransaction, "user-1"),
    ).resolves.toBe(undefined);
  });
});
