import type { Db } from "recipe-db";
import type { MutationActor } from "recipe-domain/mutation";
import {
  type PantryMutationChange,
  PantryMutationConflictError,
  planPantryTransition,
  validatePantryMutationChanges,
} from "recipe-domain/pantry";
import { pantryResourceId, pantryResponseForScope } from "../../pantry";
import {
  findChangeSetByIdempotencyKey,
  insertMutationChangeItems,
  insertMutationChangeSet,
  type MutationChangeSet,
} from "../repositories/mutation-ledger-repository";
import {
  applyPantryTransition,
  enforcePantryItemLimit,
  ensureLockedPantryAggregate,
  findCurrentPantryItems,
  incrementPantryRevision,
  lockPantryScope,
} from "../repositories/pantry-repository";

export type ReconcilePantryInput = {
  actor: MutationActor;
  capability: string;
  reason: string;
  idempotencyKey: string;
  changes: PantryMutationChange[];
};

function commandFingerprint(input: ReconcilePantryInput): string {
  return JSON.stringify([
    input.capability,
    input.reason,
    [...input.changes]
      .sort((a, b) => a.ingredientSlug.localeCompare(b.ingredientSlug))
      .map((change) => [
        change.ingredientSlug,
        change.expectedVersion,
        change.location,
      ]),
  ]);
}

function actorMatches(changeSet: MutationChangeSet, actor: MutationActor) {
  if (
    changeSet.actorType !== actor.type ||
    changeSet.actorUserId !== actor.userId
  ) {
    return false;
  }
  return actor.type === "user"
    ? changeSet.actorAgentId === null && changeSet.actorHostId === null
    : changeSet.actorAgentId === actor.agentId &&
        changeSet.actorHostId === actor.hostId;
}

export async function reconcilePantry(db: Db, input: ReconcilePantryInput) {
  validatePantryMutationChanges(input.changes);
  const fingerprint = commandFingerprint(input);
  return db.transaction(async (tx) => {
    const scope = await lockPantryScope(tx, input.actor.userId);
    const aggregate = await ensureLockedPantryAggregate(tx, scope);
    const targetId = pantryResourceId(scope);
    const existing = await findChangeSetByIdempotencyKey(
      tx,
      input.idempotencyKey,
    );
    if (existing) {
      const matches =
        actorMatches(existing, input.actor) &&
        existing.capability === input.capability &&
        existing.targetId === targetId &&
        existing.commandFingerprint === fingerprint;
      if (!matches) {
        throw new PantryMutationConflictError(
          "Idempotency key was already used for a different mutation",
        );
      }
      return {
        changeSetId: existing.id,
        replayed: true as const,
        pantry: await pantryResponseForScope(tx, scope),
      };
    }

    const current = await findCurrentPantryItems(
      tx,
      scope,
      input.changes.map((change) => change.ingredientSlug),
    );
    const transitions = input.changes.map((change) =>
      planPantryTransition(
        change,
        current.get(change.ingredientSlug),
        crypto.randomUUID(),
      ),
    );
    const changeSetId = crypto.randomUUID();
    await insertMutationChangeSet(tx, {
      id: changeSetId,
      actor: input.actor,
      capability: input.capability,
      targetType: "pantry",
      targetId,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      commandFingerprint: fingerprint,
    });
    for (const transition of transitions) {
      await applyPantryTransition(tx, {
        aggregateId: aggregate.id,
        changeSetId,
        scope,
        transition,
      });
    }
    await insertMutationChangeItems(tx, changeSetId, transitions);
    await enforcePantryItemLimit(tx, scope);
    const revision = await incrementPantryRevision(tx, aggregate.id);
    return {
      changeSetId,
      replayed: false as const,
      pantry: await pantryResponseForScope(tx, scope, { revision }),
    };
  });
}
