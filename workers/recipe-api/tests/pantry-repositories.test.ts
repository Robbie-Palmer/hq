import type { PantryChangeRecord } from "recipe-domain/pantry";
import { PantryItemLimitError } from "recipe-domain/pantry";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pantryMocks = vi.hoisted(() => ({
  resolvePantryScope: vi.fn(),
}));

vi.mock("../src/pantry", () => ({
  pantryAggregateScopeFilter: vi.fn(() => "aggregate-filter"),
  pantryScopeFilter: vi.fn(() => "scope-filter"),
  resolvePantryScope: pantryMocks.resolvePantryScope,
}));

import type { DbTransaction } from "../src/db/types";
import {
  findChangeSetByIdempotencyKey,
  findMutationChangeItems,
  findPantryChangeSet,
  insertMutationChangeItems,
  insertMutationChangeSet,
  listMutationHistory,
  purgeMutationHistoryForUser,
} from "../src/pantry/repositories/mutation-ledger-repository";
import {
  applyPantryTransition,
  enforcePantryItemLimit,
  ensureLockedPantryAggregate,
  findCurrentPantryItems,
  findPantryAbsenceRevisions,
  incrementPantryRevision,
  lockPantryScope,
} from "../src/pantry/repositories/pantry-repository";

type Query = Record<string, ReturnType<typeof vi.fn>> &
  PromiseLike<unknown[]>;

function query(rows: unknown[] = []): Query {
  const result = Promise.resolve(rows);
  const chain = result as unknown as Query;
  for (const method of [
    "from",
    "where",
    "for",
    "limit",
    "orderBy",
    "values",
    "onConflictDoNothing",
    "onConflictDoUpdate",
    "set",
    "returning",
  ]) {
    chain[method] = vi.fn(() => chain);
  }
  return chain;
}

function transaction(input: {
  deletes?: Query[];
  inserts?: Query[];
  selects?: Query[];
  updates?: Query[];
} = {}) {
  const deletes = [...(input.deletes ?? [])];
  const inserts = [...(input.inserts ?? [])];
  const selects = [...(input.selects ?? [])];
  const updates = [...(input.updates ?? [])];
  return {
    delete: vi.fn(() => deletes.shift() ?? query()),
    insert: vi.fn(() => inserts.shift() ?? query()),
    select: vi.fn(() => selects.shift() ?? query()),
    update: vi.fn(() => updates.shift() ?? query()),
  } as unknown as DbTransaction;
}

const personalScope = { type: "personal" as const, userId: "user-1" };
const householdScope = {
  type: "household" as const,
  householdId: "household-1",
  householdName: "Home",
};
const record: PantryChangeRecord = {
  stableItemId: "item-1",
  ingredientSlug: "onion",
  beforeValue: null,
  afterValue: { ingredientSlug: "onion", location: "fresh" },
  beforeVersion: null,
  afterVersion: 1n,
};

describe("pantry repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pantryMocks.resolvePantryScope.mockResolvedValue(personalScope);
  });

  it("locks personal and household scopes", async () => {
    await expect(
      lockPantryScope(transaction({ selects: [query([{ id: "user-1" }])] }), "user-1"),
    ).resolves.toEqual(personalScope);

    pantryMocks.resolvePantryScope.mockResolvedValue(householdScope);
    await expect(
      lockPantryScope(
        transaction({
          selects: [query([{ id: "user-1" }]), query([{ id: "household-1" }])],
        }),
        "user-1",
      ),
    ).resolves.toEqual(householdScope);
    await expect(
      lockPantryScope(
        transaction({ selects: [query([{ id: "user-1" }]), query()] }),
        "user-1",
      ),
    ).rejects.toThrow("Household no longer exists");
  });

  it("creates and locks a pantry aggregate", async () => {
    await expect(
      ensureLockedPantryAggregate(
        transaction({
          inserts: [query()],
          selects: [query([{ id: "aggregate-1" }])],
        }),
        personalScope,
      ),
    ).resolves.toEqual({ id: "aggregate-1" });
    await expect(
      ensureLockedPantryAggregate(
        transaction({ inserts: [query()], selects: [query()] }),
        householdScope,
      ),
    ).rejects.toThrow("Pantry aggregate could not be created");
  });

  it("maps current items and absence revisions", async () => {
    await expect(
      findCurrentPantryItems(transaction(), personalScope, []),
    ).resolves.toEqual(new Map());
    await expect(
      findCurrentPantryItems(
        transaction({
          selects: [
            query([
              {
                id: "item-1",
                ingredientSlug: "onion",
                location: "fresh",
                version: 3n,
              },
            ]),
          ],
        }),
        personalScope,
        ["onion"],
      ),
    ).resolves.toEqual(
      new Map([
        [
          "onion",
          {
            stableItemId: "item-1",
            ingredientSlug: "onion",
            location: "fresh",
            version: 3n,
          },
        ],
      ]),
    );

    await expect(
      findPantryAbsenceRevisions(transaction(), "aggregate-1", []),
    ).resolves.toEqual(new Map());
    await expect(
      findPantryAbsenceRevisions(
        transaction({
          selects: [
            query([
              {
                ingredientSlug: "onion",
                stableItemId: "item-1",
                version: 4n,
              },
            ]),
          ],
        }),
        "aggregate-1",
        ["onion"],
      ),
    ).resolves.toEqual(
      new Map([["onion", { stableItemId: "item-1", version: 4n }]]),
    );
  });

  it("applies insert, update, and delete transitions", async () => {
    const insertQuery = query();
    const insertTx = transaction({
      deletes: [query()],
      inserts: [insertQuery],
    });
    await applyPantryTransition(insertTx, {
      aggregateId: "aggregate-1",
      changeSetId: "change-set-1",
      scope: personalScope,
      transition: record,
    });
    expect(insertQuery.values).toHaveBeenCalledWith(
      expect.objectContaining({ id: "item-1", userId: "user-1" }),
    );

    const updateQuery = query();
    await applyPantryTransition(
      transaction({ deletes: [query()], updates: [updateQuery] }),
      {
        aggregateId: "aggregate-1",
        changeSetId: "change-set-1",
        scope: householdScope,
        transition: {
          ...record,
          beforeValue: { ingredientSlug: "onion", location: "cupboards" },
          beforeVersion: 2n,
          afterVersion: 3n,
        },
      },
    );
    expect(updateQuery.set).toHaveBeenCalledWith(
      expect.objectContaining({ location: "fresh", version: 3n }),
    );

    const absenceQuery = query();
    await applyPantryTransition(
      transaction({ deletes: [query()], inserts: [absenceQuery] }),
      {
        aggregateId: "aggregate-1",
        changeSetId: "change-set-1",
        scope: personalScope,
        transition: {
          ...record,
          beforeValue: record.afterValue,
          afterValue: null,
          beforeVersion: 1n,
          afterVersion: 2n,
        },
      },
    );
    expect(absenceQuery.onConflictDoUpdate).toHaveBeenCalledOnce();
  });

  it("rejects an update without a previous version", async () => {
    await expect(
      applyPantryTransition(transaction(), {
        aggregateId: "aggregate-1",
        changeSetId: "change-set-1",
        scope: personalScope,
        transition: { ...record, beforeValue: record.afterValue },
      }),
    ).rejects.toThrow("must have a previous version");
  });

  it("enforces the item limit and increments revisions", async () => {
    await expect(
      enforcePantryItemLimit(
        transaction({ selects: [query(Array.from({ length: 500 }))] }),
        personalScope,
      ),
    ).resolves.toBeUndefined();
    await expect(
      enforcePantryItemLimit(
        transaction({ selects: [query(Array.from({ length: 501 }))] }),
        personalScope,
      ),
    ).rejects.toThrow(PantryItemLimitError);

    await expect(
      incrementPantryRevision(
        transaction({ updates: [query([{ revision: 5n }])] }),
        "aggregate-1",
      ),
    ).resolves.toBe(5n);
    await expect(
      incrementPantryRevision(
        transaction({ updates: [query()] }),
        "aggregate-1",
      ),
    ).rejects.toThrow("Pantry revision update failed");
  });
});

describe("mutation ledger repository", () => {
  const changeSet = {
    id: "change-set-1",
    actorType: "agent" as const,
    actorUserId: "user-1",
    actorAgentId: "agent-1",
    actorAgentName: "Pantry helper",
    actorHostId: "host-1",
    actorHostName: null,
    capability: "pantry.reconcile",
    targetType: "pantry",
    targetId: "user-1",
    reason: "Put away groceries",
    idempotencyKey: "key-1",
    commandFingerprint: "fingerprint",
    compensatesChangeSetId: null,
    createdAt: new Date("2026-08-22T10:00:00.000Z"),
  };

  it("finds change sets and maps their items", async () => {
    await expect(
      findChangeSetByIdempotencyKey(
        transaction({ selects: [query([changeSet])] }),
        "key-1",
      ),
    ).resolves.toEqual(changeSet);
    await expect(
      findPantryChangeSet(
        transaction({ selects: [query([changeSet])] }),
        "user-1",
        "change-set-1",
      ),
    ).resolves.toEqual(changeSet);
    await expect(
      findMutationChangeItems(
        transaction({ selects: [query([{ ...record, changeSetId: "change-set-1" }])] }),
        "change-set-1",
      ),
    ).resolves.toEqual([record]);
  });

  it("inserts user and agent change sets and their records", async () => {
    const agentQuery = query();
    await insertMutationChangeSet(
      transaction({ inserts: [agentQuery] }),
      {
        id: "change-set-1",
        actor: {
          type: "agent",
          userId: "user-1",
          agentId: "agent-1",
          agentName: "Pantry helper",
          hostId: "host-1",
        },
        capability: "pantry.reconcile",
        targetType: "pantry",
        targetId: "user-1",
        reason: "Put away groceries",
        idempotencyKey: "key-1",
        commandFingerprint: "fingerprint",
      },
    );
    expect(agentQuery.values).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: "agent", actorAgentId: "agent-1" }),
    );

    const userQuery = query();
    await insertMutationChangeSet(
      transaction({ inserts: [userQuery] }),
      {
        id: "change-set-2",
        actor: { type: "user", userId: "user-1" },
        capability: "pantry.undo",
        targetType: "pantry",
        targetId: "user-1",
        reason: "Undo",
        idempotencyKey: "key-2",
        commandFingerprint: "fingerprint-2",
        compensatesChangeSetId: "change-set-1",
      },
    );
    expect(userQuery.values).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: "user", actorAgentId: null }),
    );

    const itemQuery = query();
    await insertMutationChangeItems(
      transaction({ inserts: [itemQuery] }),
      "change-set-1",
      [record],
    );
    expect(itemQuery.values).toHaveBeenCalledWith([
      expect.objectContaining({ changeSetId: "change-set-1", ordinal: 0 }),
    ]);
  });

  it("lists empty and populated mutation history", async () => {
    await expect(
      listMutationHistory(transaction({ selects: [query()] }), "user-1"),
    ).resolves.toEqual([]);
    await expect(
      listMutationHistory(
        transaction({
          selects: [
            query([changeSet]),
            query([{ ...record, changeSetId: "change-set-1" }]),
          ],
        }),
        "user-1",
      ),
    ).resolves.toEqual([
      { ...changeSet, items: [{ ...record, changeSetId: "change-set-1" }] },
    ]);
  });

  it("purges every mutation-ledger reference for a user", async () => {
    const emptyTx = transaction({ selects: [query()] });
    await purgeMutationHistoryForUser(emptyTx, "user-1");
    expect(emptyTx.delete).not.toHaveBeenCalled();

    const populatedTx = transaction({
      deletes: [query(), query(), query(), query()],
      selects: [query([{ id: "change-set-1" }])],
      updates: [query(), query()],
    });
    await purgeMutationHistoryForUser(populatedTx, "user-1");
    expect(populatedTx.delete).toHaveBeenCalledTimes(4);
    expect(populatedTx.update).toHaveBeenCalledTimes(2);
  });
});
