import type { Db } from "recipe-db";
import type { CookLogChangeRecord } from "recipe-domain/cook-log";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteCookLogSession: vi.fn(),
  findChangeSetByIdempotencyKey: vi.fn(),
  findCookLogChangeItems: vi.fn(),
  findCookLogSessions: vi.fn(),
  findMutationChangeSet: vi.fn(),
  insertCookLogChangeItems: vi.fn(),
  insertCookLogSessions: vi.fn(),
  insertMutationChangeSet: vi.fn(),
}));

vi.mock("../src/pantry/repositories/mutation-ledger-repository", () => ({
  findChangeSetByIdempotencyKey: mocks.findChangeSetByIdempotencyKey,
  findMutationChangeSet: mocks.findMutationChangeSet,
  insertMutationChangeSet: mocks.insertMutationChangeSet,
}));

vi.mock("../src/cook-log/repositories/cook-log-mutation-repository", () => ({
  deleteCookLogSession: mocks.deleteCookLogSession,
  findCookLogChangeItems: mocks.findCookLogChangeItems,
  findCookLogSessions: mocks.findCookLogSessions,
  insertCookLogChangeItems: mocks.insertCookLogChangeItems,
  insertCookLogSessions: mocks.insertCookLogSessions,
}));

import { appendCookLog } from "../src/cook-log/services/append-cook-log";
import { previewCookLogMutationUndo } from "../src/cook-log/services/preview-cook-log-mutation-undo";
import { undoCookLogMutation } from "../src/cook-log/services/undo-cook-log-mutation";

const tx = {};
const db = {
  transaction: vi.fn((operation: (value: typeof tx) => unknown) =>
    operation(tx),
  ),
} as unknown as Db;
const cookedAt = "2026-09-27T18:30:00.000Z";
const event = {
  sessionId: "0199a770-1111-7111-8111-111111111111",
  recipeSlug: "tomato-soup",
  recipeTitle: "Tomato Soup",
  servings: 2,
  diners: ["Alex", "Sam"],
  cookedAt,
};
const actor = {
  type: "agent" as const,
  userId: "user-1",
  agentId: "agent-1",
  agentName: "Kitchen helper",
  hostId: "host-1",
};
const changeSet = {
  id: "change-set-1",
  actorType: "agent" as const,
  actorUserId: "user-1",
  actorAgentId: "agent-1",
  actorAgentName: "Kitchen helper",
  actorHostId: "host-1",
  actorHostName: null,
  capability: "cook_log.append",
  targetType: "cook_log",
  targetId: "user-1",
  reason: "Record dinner",
  idempotencyKey: "0199a770-2222-7222-8222-222222222222",
  commandFingerprint: JSON.stringify([
    "cook_log.append",
    "Record dinner",
    [[event.sessionId, event.recipeSlug, event.recipeTitle, 2, event.diners, cookedAt]],
  ]),
  compensatesChangeSetId: null,
  createdAt: new Date("2026-09-27T18:31:00.000Z"),
};
const record: CookLogChangeRecord = {
  sessionId: event.sessionId,
  beforeValue: null,
  afterValue: event,
  beforeVersion: null,
  afterVersion: 1n,
};

describe("cook-log mutation services", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findChangeSetByIdempotencyKey.mockResolvedValue(undefined);
    mocks.findCookLogSessions.mockResolvedValue([]);
    mocks.findMutationChangeSet.mockResolvedValue(changeSet);
    mocks.findCookLogChangeItems.mockResolvedValue([record]);
    mocks.deleteCookLogSession.mockResolvedValue(true);
  });

  it("appends an attributed batch and replays the same idempotency key", async () => {
    const input = {
      actor,
      reason: "Record dinner",
      idempotencyKey: changeSet.idempotencyKey,
      events: [event],
    };
    await expect(appendCookLog(db, input)).resolves.toMatchObject({
      replayed: false,
    });
    expect(mocks.insertMutationChangeSet).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        actor,
        capability: "cook_log.append",
        targetId: "user-1",
      }),
    );
    expect(mocks.insertCookLogSessions).toHaveBeenCalledWith(
      tx,
      "user-1",
      expect.any(String),
      [event],
    );

    mocks.findChangeSetByIdempotencyKey.mockResolvedValue(changeSet);
    await expect(appendCookLog(db, input)).resolves.toEqual({
      changeSetId: "change-set-1",
      replayed: true,
    });
    await expect(
      appendCookLog(db, { ...input, actor: { ...actor, userId: "user-2" } }),
    ).rejects.toThrow("Idempotency key was already used");
  });

  it("rejects cooking-session collisions", async () => {
    mocks.findCookLogSessions.mockResolvedValue([{ id: event.sessionId }]);
    await expect(
      appendCookLog(db, {
        actor,
        reason: "Record dinner",
        idempotencyKey: changeSet.idempotencyKey,
        events: [event],
      }),
    ).rejects.toThrow("already in use");
  });

  it("previews a safe undo and isolates change sets by delegated user", async () => {
    mocks.findCookLogSessions.mockResolvedValue([
      {
        id: event.sessionId,
        createdByChangeSetId: changeSet.id,
        version: 1n,
        recipeSlug: event.recipeSlug,
        recipeTitle: event.recipeTitle,
        servings: event.servings,
        diners: event.diners,
        completedAt: new Date(cookedAt),
      },
    ]);
    await expect(
      previewCookLogMutationUndo(db, "user-1", changeSet.id),
    ).resolves.toMatchObject({ canUndo: true, items: [{ status: "ready" }] });

    mocks.findMutationChangeSet.mockResolvedValue(undefined);
    await expect(
      previewCookLogMutationUndo(db, "user-2", changeSet.id),
    ).resolves.toBeNull();
  });

  it("compensates selected rows while preserving later conflicting changes", async () => {
    const second = {
      ...record,
      sessionId: "0199a770-3333-7333-8333-333333333333",
      afterValue: {
        ...event,
        sessionId: "0199a770-3333-7333-8333-333333333333",
      },
    };
    mocks.findCookLogChangeItems.mockResolvedValue([record, second]);
    mocks.findCookLogSessions.mockResolvedValue([
      {
        id: event.sessionId,
        createdByChangeSetId: changeSet.id,
        version: 1n,
        recipeSlug: event.recipeSlug,
        recipeTitle: event.recipeTitle,
        servings: event.servings,
        diners: event.diners,
        completedAt: new Date(cookedAt),
      },
      {
        id: second.sessionId,
        createdByChangeSetId: changeSet.id,
        version: 2n,
        recipeSlug: event.recipeSlug,
        recipeTitle: event.recipeTitle,
        servings: event.servings,
        diners: event.diners,
        completedAt: new Date(cookedAt),
      },
    ]);

    await expect(
      undoCookLogMutation(db, {
        userId: "user-1",
        changeSetId: changeSet.id,
        idempotencyKey: "0199a770-4444-7444-8444-444444444444",
      }),
    ).resolves.toMatchObject({ applied: false });
    await expect(
      undoCookLogMutation(db, {
        userId: "user-1",
        changeSetId: changeSet.id,
        idempotencyKey: "0199a770-5555-7555-8555-555555555555",
        sessionIds: [event.sessionId],
      }),
    ).resolves.toMatchObject({ applied: true, replayed: false });
    expect(mocks.deleteCookLogSession).toHaveBeenCalledWith(
      tx,
      "user-1",
      changeSet.id,
      event.sessionId,
      1n,
    );
  });

  it("replays only the matching cook-log compensation", async () => {
    const idempotencyKey = "0199a770-6666-7666-8666-666666666666";
    mocks.findChangeSetByIdempotencyKey.mockResolvedValue({
      ...changeSet,
      id: "compensation-1",
      actorType: "user",
      actorAgentId: null,
      actorAgentName: null,
      actorHostId: null,
      capability: "agent_mutation.undo",
      targetType: "cook_log",
      idempotencyKey,
      compensatesChangeSetId: changeSet.id,
      commandFingerprint: JSON.stringify([changeSet.id, "*"]),
    });

    await expect(
      undoCookLogMutation(db, {
        userId: "user-1",
        changeSetId: changeSet.id,
        idempotencyKey,
      }),
    ).resolves.toEqual({
      applied: true,
      changeSetId: "compensation-1",
      replayed: true,
    });

    mocks.findChangeSetByIdempotencyKey.mockResolvedValue({
      ...changeSet,
      actorType: "user",
      actorAgentId: null,
      actorAgentName: null,
      actorHostId: null,
      capability: "agent_mutation.undo",
      targetType: "cook_log",
      idempotencyKey,
      compensatesChangeSetId: "different-change-set",
      commandFingerprint: JSON.stringify([changeSet.id, "*"]),
    });
    await expect(
      undoCookLogMutation(db, {
        userId: "user-1",
        changeSetId: changeSet.id,
        idempotencyKey,
      }),
    ).rejects.toThrow("Idempotency key was already used");
  });

  it("aborts compensation when a cook-log row changes during deletion", async () => {
    mocks.findCookLogSessions.mockResolvedValue([
      {
        id: event.sessionId,
        createdByChangeSetId: changeSet.id,
        version: 1n,
        recipeSlug: event.recipeSlug,
        recipeTitle: event.recipeTitle,
        servings: event.servings,
        diners: event.diners,
        completedAt: new Date(cookedAt),
      },
    ]);
    mocks.deleteCookLogSession.mockResolvedValue(false);

    await expect(
      undoCookLogMutation(db, {
        userId: "user-1",
        changeSetId: changeSet.id,
        idempotencyKey: "0199a770-7777-7777-8777-777777777777",
      }),
    ).rejects.toThrow("changed while the undo was being applied");
  });
});
