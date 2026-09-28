import type { Db } from "recipe-db";
import type { MutationActor } from "recipe-domain/mutation";
import {
  type CookLogChangeRecord,
  CookLogMutationConflictError,
  type CookLogMutationEvent,
  validateCookLogMutationEvents,
} from "recipe-domain/cook-log";
import {
  findChangeSetByIdempotencyKey,
  insertMutationChangeSet,
  type MutationChangeSet,
} from "../../pantry/repositories/mutation-ledger-repository";
import {
  findCookLogSessions,
  insertCookLogChangeItems,
  insertCookLogSessions,
} from "../repositories/cook-log-mutation-repository";

export type AppendCookLogInput = {
  actor: MutationActor;
  reason: string;
  idempotencyKey: string;
  events: CookLogMutationEvent[];
};

function fingerprint(input: AppendCookLogInput): string {
  return JSON.stringify([
    "cook_log.append",
    input.reason,
    [...input.events]
      .sort((a, b) => a.sessionId.localeCompare(b.sessionId))
      .map((event) => [
        event.sessionId,
        event.recipeSlug,
        event.recipeTitle,
        event.servings,
        event.diners,
        new Date(event.cookedAt).toISOString(),
      ]),
  ]);
}

function replayMatches(
  existing: MutationChangeSet,
  input: AppendCookLogInput,
  commandFingerprint: string,
) {
  return (
    existing.actorType === input.actor.type &&
    existing.actorUserId === input.actor.userId &&
    existing.actorAgentId ===
      (input.actor.type === "agent" ? input.actor.agentId : null) &&
    existing.actorHostId ===
      (input.actor.type === "agent" ? input.actor.hostId : null) &&
    existing.capability === "cook_log.append" &&
    existing.targetType === "cook_log" &&
    existing.targetId === input.actor.userId &&
    existing.commandFingerprint === commandFingerprint
  );
}

export async function appendCookLog(db: Db, input: AppendCookLogInput) {
  validateCookLogMutationEvents(input.events);
  const commandFingerprint = fingerprint(input);
  return db.transaction(async (tx) => {
    const existing = await findChangeSetByIdempotencyKey(
      tx,
      input.idempotencyKey,
    );
    if (existing) {
      if (!replayMatches(existing, input, commandFingerprint)) {
        throw new CookLogMutationConflictError(
          "Idempotency key was already used for a different mutation",
        );
      }
      return { changeSetId: existing.id, replayed: true as const };
    }

    const sessionIds = input.events.map((event) => event.sessionId);
    const collisions = await findCookLogSessions(
      tx,
      input.actor.userId,
      sessionIds,
      true,
    );
    if (collisions.length > 0) {
      throw new CookLogMutationConflictError(
        "A cooking session ID is already in use",
      );
    }

    const changeSetId = crypto.randomUUID();
    await insertMutationChangeSet(tx, {
      id: changeSetId,
      actor: input.actor,
      capability: "cook_log.append",
      targetType: "cook_log",
      targetId: input.actor.userId,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      commandFingerprint,
    });
    await insertCookLogSessions(
      tx,
      input.actor.userId,
      changeSetId,
      input.events,
    );
    const records: CookLogChangeRecord[] = input.events.map((event) => ({
      sessionId: event.sessionId,
      beforeValue: null,
      afterValue: {
        ...event,
        cookedAt: new Date(event.cookedAt).toISOString(),
      },
      beforeVersion: null,
      afterVersion: 1n,
    }));
    await insertCookLogChangeItems(tx, changeSetId, records);
    return { changeSetId, replayed: false as const };
  });
}
