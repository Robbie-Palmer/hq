import type { Db } from "recipe-db";
import { CookLogMutationConflictError } from "recipe-domain/cook-log";
import type { DbTransaction } from "../../db/types";
import {
  findChangeSetByIdempotencyKey,
  insertMutationChangeSet,
} from "../../pantry/repositories/mutation-ledger-repository";
import {
  deleteCookLogSession,
  insertCookLogChangeItems,
} from "../repositories/cook-log-mutation-repository";
import { loadCookLogMutationUndoPreview } from "./preview-cook-log-mutation-undo";

export type UndoCookLogMutationInput = {
  userId: string;
  changeSetId: string;
  idempotencyKey: string;
  sessionIds?: string[];
};

async function replayedUndo(
  tx: DbTransaction,
  input: UndoCookLogMutationInput,
  fingerprint: string,
) {
  const existing = await findChangeSetByIdempotencyKey(
    tx,
    input.idempotencyKey,
  );
  if (!existing) return null;
  if (
    existing.actorType !== "user" ||
    existing.actorUserId !== input.userId ||
    existing.targetType !== "cook_log" ||
    existing.compensatesChangeSetId !== input.changeSetId ||
    existing.commandFingerprint !== fingerprint
  ) {
    throw new CookLogMutationConflictError(
      "Idempotency key was already used for a different mutation",
    );
  }
  return {
    applied: true as const,
    changeSetId: existing.id,
    replayed: true as const,
  };
}

export async function undoCookLogMutation(
  db: Db,
  input: UndoCookLogMutationInput,
) {
  const fingerprint = JSON.stringify([
    input.changeSetId,
    input.sessionIds
      ? [...input.sessionIds].sort((a, b) => a.localeCompare(b))
      : "*",
  ]);
  return db.transaction(async (tx) => {
    const replay = await replayedUndo(tx, input, fingerprint);
    if (replay) return replay;
    const preview = await loadCookLogMutationUndoPreview(
      tx,
      input.userId,
      input.changeSetId,
      true,
    );
    if (!preview) return null;
    const selectedIds = input.sessionIds
      ? new Set(input.sessionIds)
      : new Set(preview.items.map((item) => item.sessionId));
    const selected = preview.items.filter((item) =>
      selectedIds.has(item.sessionId),
    );
    if (
      selected.length === 0 ||
      selected.length !== selectedIds.size ||
      selected.some((item) => item.status === "conflict")
    ) {
      return { applied: false as const, preview: { items: preview.items } };
    }

    const records = preview.records.filter((record) =>
      selectedIds.has(record.sessionId),
    );
    const compensationId = crypto.randomUUID();
    await insertMutationChangeSet(tx, {
      id: compensationId,
      actor: { type: "user", userId: input.userId },
      capability: "agent_mutation.undo",
      targetType: "cook_log",
      targetId: input.userId,
      reason: `Undo: ${preview.changeSet.reason}`,
      idempotencyKey: input.idempotencyKey,
      commandFingerprint: fingerprint,
      compensatesChangeSetId: input.changeSetId,
    });
    for (const record of records) {
      if (
        !(await deleteCookLogSession(
          tx,
          input.userId,
          input.changeSetId,
          record.sessionId,
          record.afterVersion,
        ))
      ) {
        throw new CookLogMutationConflictError(
          "Cook log changed while the undo was being applied",
        );
      }
    }
    await insertCookLogChangeItems(
      tx,
      compensationId,
      records.map((record) => ({
        sessionId: record.sessionId,
        beforeValue: record.afterValue,
        afterValue: null,
        beforeVersion: record.afterVersion,
        afterVersion: record.afterVersion + 1n,
      })),
    );
    return {
      applied: true as const,
      changeSetId: compensationId,
      replayed: false as const,
    };
  });
}
