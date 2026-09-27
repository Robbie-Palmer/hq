import type { Db } from "recipe-db";
import {
  PantryMutationConflictError,
  previewPantryCompensation,
} from "recipe-domain/pantry";
import type { DbTransaction } from "../../db/types";
import { pantryResourceId } from "../../pantry";
import {
  findMutationChangeItems,
  findPantryChangeSet,
} from "../repositories/mutation-ledger-repository";
import {
  ensureLockedPantryAggregate,
  findCurrentPantryItems,
  findPantryAbsenceRevisions,
  lockPantryScope,
} from "../repositories/pantry-repository";

export async function loadPantryMutationUndoPreview(
  tx: DbTransaction,
  userId: string,
  changeSetId: string,
) {
  const changeSet = await findPantryChangeSet(tx, userId, changeSetId);
  if (!changeSet) return null;
  const scope = await lockPantryScope(tx, userId);
  if (changeSet.targetId !== pantryResourceId(scope)) {
    throw new PantryMutationConflictError(
      "The pantry owner changed after this mutation",
    );
  }
  const aggregate = await ensureLockedPantryAggregate(tx, scope);
  const records = await findMutationChangeItems(tx, changeSetId);
  const ingredientSlugs = records.map((record) => record.ingredientSlug);
  const current = await findCurrentPantryItems(tx, scope, ingredientSlugs);
  const absences = await findPantryAbsenceRevisions(
    tx,
    aggregate.id,
    ingredientSlugs,
  );
  const items = records.map((record) =>
    previewPantryCompensation(
      record,
      current.get(record.ingredientSlug),
      absences.get(record.ingredientSlug),
    ),
  );
  return { changeSet, scope, aggregate, records, current, absences, items };
}

export async function previewPantryMutationUndo(
  db: Db,
  userId: string,
  changeSetId: string,
) {
  return db.transaction(async (tx) => {
    const preview = await loadPantryMutationUndoPreview(
      tx,
      userId,
      changeSetId,
    );
    if (!preview) return null;
    return {
      changeSetId,
      reason: preview.changeSet.reason,
      createdAt: preview.changeSet.createdAt.toISOString(),
      items: preview.items,
      canUndo:
        preview.items.length > 0 &&
        preview.items.every((item) => item.status === "ready"),
    };
  });
}
