import type { Db } from "recipe-db";
import type { PantryChangeRecord } from "recipe-domain/pantry";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyPantryTransition: vi.fn(),
  enforcePantryItemLimit: vi.fn(),
  ensureLockedPantryAggregate: vi.fn(),
  findChangeSetByIdempotencyKey: vi.fn(),
  findCurrentPantryItems: vi.fn(),
  findMutationChangeItems: vi.fn(),
  findPantryAbsenceRevisions: vi.fn(),
  findPantryChangeSet: vi.fn(),
  incrementPantryRevision: vi.fn(),
  insertMutationChangeItems: vi.fn(),
  insertMutationChangeSet: vi.fn(),
  listMutationHistory: vi.fn(),
  lockPantryScope: vi.fn(),
  pantryResponseForScope: vi.fn(),
}));

vi.mock("../src/pantry", () => ({
  pantryResourceId: (scope: { userId?: string; householdId?: string }) =>
    scope.householdId ?? scope.userId,
  pantryResponseForScope: mocks.pantryResponseForScope,
}));

vi.mock("../src/pantry/repositories/mutation-ledger-repository", () => ({
  findChangeSetByIdempotencyKey: mocks.findChangeSetByIdempotencyKey,
  findMutationChangeItems: mocks.findMutationChangeItems,
  findPantryChangeSet: mocks.findPantryChangeSet,
  insertMutationChangeItems: mocks.insertMutationChangeItems,
  insertMutationChangeSet: mocks.insertMutationChangeSet,
  listMutationHistory: mocks.listMutationHistory,
}));

vi.mock("../src/pantry/repositories/pantry-repository", () => ({
  applyPantryTransition: mocks.applyPantryTransition,
  enforcePantryItemLimit: mocks.enforcePantryItemLimit,
  ensureLockedPantryAggregate: mocks.ensureLockedPantryAggregate,
  findCurrentPantryItems: mocks.findCurrentPantryItems,
  findPantryAbsenceRevisions: mocks.findPantryAbsenceRevisions,
  incrementPantryRevision: mocks.incrementPantryRevision,
  lockPantryScope: mocks.lockPantryScope,
}));

import type { MutationChangeSet } from "../src/pantry/repositories/mutation-ledger-repository";
import { listPantryMutationHistory } from "../src/pantry/services/list-pantry-mutation-history";
import { previewPantryMutationUndo } from "../src/pantry/services/preview-pantry-mutation-undo";
import { reconcilePantry } from "../src/pantry/services/reconcile-pantry";
import { undoPantryMutation } from "../src/pantry/services/undo-pantry-mutation";

const tx = {};
const db = {
  transaction: vi.fn((operation: (value: typeof tx) => unknown) =>
    operation(tx),
  ),
} as unknown as Db;
const scope = { type: "personal" as const, userId: "user-1" };
const aggregate = { id: "aggregate-1" };
const createdAt = new Date("2026-08-22T10:00:00.000Z");

function changeSet(
  overrides: Partial<MutationChangeSet> = {},
): MutationChangeSet {
  return {
    id: "change-set-1",
    actorType: "agent",
    actorUserId: "user-1",
    actorAgentId: "agent-1",
    actorAgentName: "Pantry helper",
    actorHostId: "host-1",
    actorHostName: "Kitchen terminal",
    capability: "pantry.reconcile",
    targetType: "pantry",
    targetId: "user-1",
    reason: "Put away groceries",
    idempotencyKey: "0198f1f0-5555-7555-8555-555555555555",
    commandFingerprint: JSON.stringify([
      "pantry.reconcile",
      "Put away groceries",
      [["onion", null, "fresh"]],
    ]),
    compensatesChangeSetId: null,
    createdAt,
    ...overrides,
  };
}

const record: PantryChangeRecord = {
  stableItemId: "item-1",
  ingredientSlug: "onion",
  beforeValue: null,
  afterValue: { ingredientSlug: "onion", location: "fresh" },
  beforeVersion: null,
  afterVersion: 1n,
};

describe("pantry mutation services", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lockPantryScope.mockResolvedValue(scope);
    mocks.ensureLockedPantryAggregate.mockResolvedValue(aggregate);
    mocks.findChangeSetByIdempotencyKey.mockResolvedValue(undefined);
    mocks.findCurrentPantryItems.mockResolvedValue(new Map());
    mocks.findPantryAbsenceRevisions.mockResolvedValue(new Map());
    mocks.findMutationChangeItems.mockResolvedValue([record]);
    mocks.incrementPantryRevision.mockResolvedValue(1n);
    mocks.pantryResponseForScope.mockResolvedValue({ revision: "1" });
  });

  it("reconciles a pantry through the ledger and projection repositories", async () => {
    const result = await reconcilePantry(db, {
      actor: {
        type: "agent",
        userId: "user-1",
        agentId: "agent-1",
        agentName: "Pantry helper",
        hostId: "host-1",
      },
      capability: "pantry.reconcile",
      reason: "Put away groceries",
      idempotencyKey: "0198f1f0-5555-7555-8555-555555555555",
      changes: [
        {
          ingredientSlug: "onion",
          expectedVersion: null,
          location: "fresh",
        },
      ],
    });

    expect(result).toMatchObject({ replayed: false, pantry: { revision: "1" } });
    expect(mocks.insertMutationChangeSet).toHaveBeenCalledOnce();
    expect(mocks.applyPantryTransition).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        aggregateId: "aggregate-1",
        scope,
        transition: expect.objectContaining({
          ingredientSlug: "onion",
          afterVersion: 1n,
        }),
      }),
    );
    expect(mocks.enforcePantryItemLimit).toHaveBeenCalledWith(tx, scope);
  });

  it("returns an idempotent reconcile replay and rejects a mismatched actor", async () => {
    mocks.findChangeSetByIdempotencyKey.mockResolvedValue(changeSet());
    const input = {
      actor: {
        type: "agent" as const,
        userId: "user-1",
        agentId: "agent-1",
        agentName: "Pantry helper",
        hostId: "host-1",
      },
      capability: "pantry.reconcile",
      reason: "Put away groceries",
      idempotencyKey: "0198f1f0-5555-7555-8555-555555555555",
      changes: [
        {
          ingredientSlug: "onion",
          expectedVersion: null,
          location: "fresh" as const,
        },
      ],
    };

    await expect(reconcilePantry(db, input)).resolves.toMatchObject({
      changeSetId: "change-set-1",
      replayed: true,
    });
    await expect(
      reconcilePantry(db, {
        ...input,
        actor: { ...input.actor, hostId: "another-host" },
      }),
    ).rejects.toThrow("Idempotency key was already used");
  });

  it("maps persisted history into the API contract", async () => {
    mocks.listMutationHistory.mockResolvedValue([
      {
        ...changeSet(),
        items: [record],
      },
    ]);

    await expect(listPantryMutationHistory(db, "user-1")).resolves.toEqual([
      expect.objectContaining({
        id: "change-set-1",
        createdAt: "2026-08-22T10:00:00.000Z",
        items: [
          expect.objectContaining({
            beforeVersion: null,
            afterVersion: "1",
          }),
        ],
      }),
    ]);
  });

  it("previews ready, missing, and moved pantry mutations", async () => {
    mocks.findPantryChangeSet.mockResolvedValue(changeSet());
    mocks.findCurrentPantryItems.mockResolvedValue(
      new Map([
        [
          "onion",
          {
            stableItemId: "item-1",
            ingredientSlug: "onion",
            location: "fresh",
            version: 1n,
          },
        ],
      ]),
    );
    await expect(
      previewPantryMutationUndo(db, "user-1", "change-set-1"),
    ).resolves.toMatchObject({ canUndo: true, items: [{ status: "ready" }] });

    mocks.findPantryChangeSet.mockResolvedValueOnce(undefined);
    await expect(
      previewPantryMutationUndo(db, "user-1", "missing"),
    ).resolves.toBeNull();

    mocks.findPantryChangeSet.mockResolvedValueOnce(
      changeSet({ targetId: "another-user" }),
    );
    await expect(
      previewPantryMutationUndo(db, "user-1", "change-set-1"),
    ).rejects.toThrow("pantry owner changed");
  });

  it("undoes selected records and enforces the pantry limit", async () => {
    mocks.findPantryChangeSet.mockResolvedValue(changeSet());
    mocks.findCurrentPantryItems.mockResolvedValue(
      new Map([
        [
          "onion",
          {
            stableItemId: "item-1",
            ingredientSlug: "onion",
            location: "fresh",
            version: 1n,
          },
        ],
      ]),
    );

    await expect(
      undoPantryMutation(db, {
        userId: "user-1",
        changeSetId: "change-set-1",
        idempotencyKey: "0198f1f0-6666-7666-8666-666666666666",
        stableItemIds: ["item-1"],
      }),
    ).resolves.toMatchObject({ applied: true, replayed: false });
    expect(mocks.applyPantryTransition).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        transition: expect.objectContaining({ afterValue: null }),
      }),
    );
    expect(mocks.enforcePantryItemLimit).toHaveBeenCalledWith(tx, scope);
  });

  it("returns sequential and lock-waited undo replays", async () => {
    const replay = changeSet({
      id: "compensation-1",
      actorType: "user",
      actorAgentId: null,
      actorAgentName: null,
      actorHostId: null,
      actorHostName: null,
      compensatesChangeSetId: "change-set-1",
      commandFingerprint: JSON.stringify(["change-set-1", "*"]),
    });
    mocks.findChangeSetByIdempotencyKey.mockResolvedValueOnce(replay);
    await expect(
      undoPantryMutation(db, {
        userId: "user-1",
        changeSetId: "change-set-1",
        idempotencyKey: replay.idempotencyKey,
      }),
    ).resolves.toMatchObject({ changeSetId: "compensation-1", replayed: true });

    mocks.findChangeSetByIdempotencyKey
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(replay);
    mocks.findPantryChangeSet.mockResolvedValueOnce(changeSet());
    await expect(
      undoPantryMutation(db, {
        userId: "user-1",
        changeSetId: "change-set-1",
        idempotencyKey: replay.idempotencyKey,
      }),
    ).resolves.toMatchObject({ changeSetId: "compensation-1", replayed: true });
  });

  it("rejects reused undo keys and conflicting selections", async () => {
    mocks.findChangeSetByIdempotencyKey.mockResolvedValueOnce(
      changeSet({ actorType: "user" }),
    );
    await expect(
      undoPantryMutation(db, {
        userId: "user-1",
        changeSetId: "change-set-1",
        idempotencyKey: "reused-key",
      }),
    ).rejects.toThrow("Idempotency key was already used");

    mocks.findChangeSetByIdempotencyKey.mockResolvedValue(undefined);
    mocks.findPantryChangeSet.mockResolvedValueOnce(changeSet());
    await expect(
      undoPantryMutation(db, {
        userId: "user-1",
        changeSetId: "change-set-1",
        idempotencyKey: "new-key",
      }),
    ).resolves.toMatchObject({ applied: false });

    mocks.findPantryChangeSet.mockResolvedValueOnce(undefined);
    await expect(
      undoPantryMutation(db, {
        userId: "user-1",
        changeSetId: "missing",
        idempotencyKey: "another-key",
      }),
    ).resolves.toBeNull();
  });
});
