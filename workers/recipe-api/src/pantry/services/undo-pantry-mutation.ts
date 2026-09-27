import type { Db } from "recipe-db";
import {
  PantryMutationConflictError,
  planPantryCompensation,
} from "recipe-domain/pantry";
import type { DbTransaction } from "../../db/types";
import {
  findChangeSetByIdempotencyKey,
  insertMutationChangeItems,
  insertMutationChangeSet,
} from "../repositories/mutation-ledger-repository";
import {
  applyPantryTransition,
  enforcePantryItemLimit,
  incrementPantryRevision,
} from "../repositories/pantry-repository";
import { loadPantryMutationUndoPreview } from "./preview-pantry-mutation-undo";

export type UndoPantryMutationInput = {
  userId: string;
  changeSetId: string;
  idempotencyKey: string;
  stableItemIds?: string[];
};

async function replayedUndo(
  tx: DbTransaction,
  input: UndoPantryMutationInput,
  requestFingerprint: string,
) {
  const existing = await findChangeSetByIdempotencyKey(
    tx,
    input.idempotencyKey,
  );
  if (!existing) return null;
  const matches =
    existing.actorType === "user" &&
    existing.actorUserId === input.userId &&
    existing.compensatesChangeSetId === input.changeSetId &&
    existing.commandFingerprint === requestFingerprint;
  if (!matches) {
    throw new PantryMutationConflictError(
      "Idempotency key was already used for a different mutation",
    );
  }
  return {
    applied: true as const,
    changeSetId: existing.id,
    replayed: true as const,
  };
}

export async function undoPantryMutation(
  db: Db,
  input: UndoPantryMutationInput,
) {
  const requestFingerprint = JSON.stringify([
    input.changeSetId,
    input.stableItemIds
      ? [...input.stableItemIds].sort((a, b) => a.localeCompare(b))
      : "*",
  ]);
  return db.transaction(async (tx) => {
    const replay = await replayedUndo(tx, input, requestFingerprint);
    if (replay) return replay;

    const preview = await loadPantryMutationUndoPreview(
      tx,
      input.userId,
      input.changeSetId,
    );
    if (!preview) return null;
    const lockedReplay = await replayedUndo(tx, input, requestFingerprint);
    if (lockedReplay) return lockedReplay;
    const selectedIds = input.stableItemIds
      ? new Set(input.stableItemIds)
      : new Set(preview.items.map((item) => item.stableItemId));
    const selectedItems = preview.items.filter((item) =>
      selectedIds.has(item.stableItemId),
    );
    const invalidSelection =
      selectedItems.length === 0 ||
      selectedItems.length !== selectedIds.size ||
      selectedItems.some((item) => item.status === "conflict");
    if (invalidSelection) {
      return { applied: false as const, preview: { items: preview.items } };
    }

    const selectedRecords = preview.records.filter((record) =>
      selectedIds.has(record.stableItemId),
    );
    const transitions = selectedRecords.map((record) =>
      planPantryCompensation(
        record,
        preview.current.get(record.ingredientSlug),
        preview.absences.get(record.ingredientSlug),
      ),
    );
    const compensationId = crypto.randomUUID();
    await insertMutationChangeSet(tx, {
      id: compensationId,
      actor: { type: "user", userId: input.userId },
      capability: "agent_mutation.undo",
      targetType: "pantry",
      targetId: preview.changeSet.targetId,
      reason: `Undo: ${preview.changeSet.reason}`,
      idempotencyKey: input.idempotencyKey,
      commandFingerprint: requestFingerprint,
      compensatesChangeSetId: input.changeSetId,
    });
    for (const transition of transitions) {
      await applyPantryTransition(tx, {
        aggregateId: preview.aggregate.id,
        changeSetId: compensationId,
        scope: preview.scope,
        transition,
      });
    }
    await insertMutationChangeItems(tx, compensationId, transitions);
    await enforcePantryItemLimit(tx, preview.scope);
    await incrementPantryRevision(tx, preview.aggregate.id);
    return {
      applied: true as const,
      changeSetId: compensationId,
      replayed: false as const,
    };
  });
}
