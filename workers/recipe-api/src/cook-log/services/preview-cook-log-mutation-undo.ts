import type { Db } from "recipe-db";
import type { CookLogMutationValue } from "recipe-domain/cook-log";
import type { DbTransaction } from "../../db/types";
import {
  findMutationChangeSet,
  type MutationChangeSet,
} from "../../pantry/repositories/mutation-ledger-repository";
import {
  findCookLogChangeItems,
  findCookLogSessions,
} from "../repositories/cook-log-mutation-repository";

function rowMatches(
  row: Awaited<ReturnType<typeof findCookLogSessions>>[number] | undefined,
  changeSet: MutationChangeSet,
  value: CookLogMutationValue,
  version: bigint,
) {
  return (
    row?.createdByChangeSetId === changeSet.id &&
    row.version === version &&
    row.recipeSlug === value.recipeSlug &&
    row.recipeTitle === value.recipeTitle &&
    row.servings === value.servings &&
    row.completedAt?.toISOString() === value.cookedAt &&
    row.diners.length === value.diners.length &&
    row.diners.every((diner, index) => diner === value.diners[index])
  );
}

export async function loadCookLogMutationUndoPreview(
  tx: DbTransaction,
  userId: string,
  changeSetId: string,
  lock = false,
) {
  const changeSet = await findMutationChangeSet(tx, userId, changeSetId);
  if (changeSet?.targetType !== "cook_log") return null;
  const records = await findCookLogChangeItems(tx, changeSetId);
  const currentRows = await findCookLogSessions(
    tx,
    userId,
    records.map((record) => record.sessionId),
    lock,
  );
  const current = new Map(currentRows.map((row) => [row.id, row]));
  const items = records.map((record) => ({
    sessionId: record.sessionId,
    beforeValue: record.beforeValue,
    afterValue: record.afterValue,
    currentValue: current.has(record.sessionId)
      ? record.afterValue
      : null,
    status:
      record.afterValue &&
      rowMatches(
        current.get(record.sessionId),
        changeSet,
        record.afterValue,
        record.afterVersion,
      )
        ? ("ready" as const)
        : ("conflict" as const),
  }));
  return {
    changeSet,
    records,
    items,
    canUndo: items.length > 0 && items.every((item) => item.status === "ready"),
  };
}

export async function previewCookLogMutationUndo(
  db: Db,
  userId: string,
  changeSetId: string,
) {
  const preview = await db.transaction(
    (tx) => loadCookLogMutationUndoPreview(tx, userId, changeSetId),
    { accessMode: "read only", isolationLevel: "repeatable read" },
  );
  if (!preview) return null;
  return { canUndo: preview.canUndo, items: preview.items };
}
