import type { DbTransaction } from "../src/db/types";
import { describe, expect, it, vi } from "vitest";
import {
  deleteCookLogSession,
  findCookLogChangeItems,
  findCookLogSessions,
  insertCookLogChangeItems,
  insertCookLogSessions,
  listCookLogMutationHistory,
} from "../src/cook-log/repositories/cook-log-mutation-repository";

function query(rows: unknown[] = []) {
  const value = {
    values: vi.fn(() => value),
    where: vi.fn(() => value),
    orderBy: vi.fn(() => value),
    limit: vi.fn(() => Promise.resolve(rows)),
    for: vi.fn(() => Promise.resolve(rows)),
    returning: vi.fn(() => Promise.resolve(rows)),
    // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are intentionally thenable.
    then: <TResult1 = unknown[]>(
      resolve?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    ) => Promise.resolve(rows).then(resolve),
  };
  return value;
}

function transaction(options: {
  selects?: ReturnType<typeof query>[];
  inserts?: ReturnType<typeof query>[];
  deletes?: ReturnType<typeof query>[];
}): DbTransaction {
  const selects = [...(options.selects ?? [])];
  const inserts = [...(options.inserts ?? [])];
  const deletes = [...(options.deletes ?? [])];
  return {
    select: vi.fn(() => ({ from: () => selects.shift() ?? query() })),
    insert: vi.fn(() => inserts.shift() ?? query()),
    delete: vi.fn(() => deletes.shift() ?? query()),
  } as unknown as DbTransaction;
}

const value = {
  sessionId: "0199a770-1111-7111-8111-111111111111",
  recipeSlug: "tomato-soup",
  recipeTitle: "Tomato Soup",
  servings: 2,
  diners: ["Alex", "Sam"],
  cookedAt: "2026-09-27T18:30:00.000Z",
};

describe("cook-log mutation repository", () => {
  it("maps and inserts cook-log change records", async () => {
    const persisted = {
      id: "item-1",
      changeSetId: "change-set-1",
      ordinal: 0,
      sessionId: value.sessionId,
      beforeValue: null,
      afterValue: value,
      beforeVersion: null,
      afterVersion: 1n,
    };
    await expect(
      findCookLogChangeItems(
        transaction({ selects: [query([persisted])] }),
        "change-set-1",
      ),
    ).resolves.toEqual([
      {
        sessionId: value.sessionId,
        beforeValue: null,
        afterValue: value,
        beforeVersion: null,
        afterVersion: 1n,
      },
    ]);

    const insertQuery = query();
    await insertCookLogChangeItems(
      transaction({ inserts: [insertQuery] }),
      "change-set-1",
      [
        {
          sessionId: value.sessionId,
          beforeValue: null,
          afterValue: value,
          beforeVersion: null,
          afterVersion: 1n,
        },
      ],
    );
    expect(insertQuery.values).toHaveBeenCalledWith([
      expect.objectContaining({
        changeSetId: "change-set-1",
        ordinal: 0,
        sessionId: value.sessionId,
      }),
    ]);
  });

  it("lists empty and populated cook-log history", async () => {
    await expect(
      listCookLogMutationHistory(
        transaction({ selects: [query()] }),
        "user-1",
      ),
    ).resolves.toEqual([]);
    const changeSet = {
      id: "change-set-1",
      actorUserId: "user-1",
      targetType: "cook_log",
      createdAt: new Date("2026-09-27T18:31:00.000Z"),
    };
    const item = {
      changeSetId: "change-set-1",
      sessionId: value.sessionId,
    };
    await expect(
      listCookLogMutationHistory(
        transaction({ selects: [query([changeSet]), query([item])] }),
        "user-1",
      ),
    ).resolves.toEqual([{ ...changeSet, items: [item] }]);
  });

  it("loads, inserts, and conditionally deletes cooking sessions", async () => {
    await expect(
      findCookLogSessions(transaction({}), "user-1", []),
    ).resolves.toEqual([]);
    const unlocked = query([{ id: value.sessionId }]);
    await expect(
      findCookLogSessions(
        transaction({ selects: [unlocked] }),
        "user-1",
        [value.sessionId],
      ),
    ).resolves.toEqual([{ id: value.sessionId }]);
    const locked = query([{ id: value.sessionId }]);
    await findCookLogSessions(
      transaction({ selects: [locked] }),
      "user-1",
      [value.sessionId],
      true,
    );
    expect(locked.for).toHaveBeenCalledWith("update");

    const insertQuery = query();
    await insertCookLogSessions(
      transaction({ inserts: [insertQuery] }),
      "user-1",
      "change-set-1",
      [value],
    );
    expect(insertQuery.values).toHaveBeenCalledWith([
      expect.objectContaining({
        id: value.sessionId,
        userId: "user-1",
        diners: ["Alex", "Sam"],
        createdByChangeSetId: "change-set-1",
      }),
    ]);

    await expect(
      deleteCookLogSession(
        transaction({ deletes: [query([{ id: value.sessionId }])] }),
        "user-1",
        "change-set-1",
        value.sessionId,
        1n,
      ),
    ).resolves.toBe(true);
    await expect(
      deleteCookLogSession(
        transaction({ deletes: [query()] }),
        "user-1",
        "change-set-1",
        value.sessionId,
        1n,
      ),
    ).resolves.toBe(false);
  });
});
