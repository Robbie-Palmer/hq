import { and, asc, desc, eq, inArray } from "drizzle-orm";
import * as schema from "recipe-db/schema";
import type { MutationActor } from "recipe-domain/mutation";
import type { PantryChangeRecord } from "recipe-domain/pantry";
import type { DbTransaction } from "../../db/types";

export type MutationChangeSet =
  typeof schema.agentMutationChangeSet.$inferSelect;

export async function findChangeSetByIdempotencyKey(
  tx: DbTransaction,
  idempotencyKey: string,
): Promise<MutationChangeSet | undefined> {
  const [changeSet] = await tx
    .select()
    .from(schema.agentMutationChangeSet)
    .where(eq(schema.agentMutationChangeSet.idempotencyKey, idempotencyKey))
    .limit(1);
  return changeSet;
}

export async function insertMutationChangeSet(
  tx: DbTransaction,
  input: {
    id: string;
    actor: MutationActor;
    capability: string;
    targetType: string;
    targetId: string;
    reason: string;
    idempotencyKey: string;
    commandFingerprint: string;
    compensatesChangeSetId?: string;
  },
): Promise<void> {
  await tx.insert(schema.agentMutationChangeSet).values({
    id: input.id,
    actorType: input.actor.type,
    actorUserId: input.actor.userId,
    actorAgentId: input.actor.type === "agent" ? input.actor.agentId : null,
    actorAgentName:
      input.actor.type === "agent" ? input.actor.agentName : null,
    actorHostId: input.actor.type === "agent" ? input.actor.hostId : null,
    actorHostName:
      input.actor.type === "agent" ? input.actor.hostName : null,
    capability: input.capability,
    targetType: input.targetType,
    targetId: input.targetId,
    reason: input.reason,
    idempotencyKey: input.idempotencyKey,
    commandFingerprint: input.commandFingerprint,
    compensatesChangeSetId: input.compensatesChangeSetId,
  });
}

export async function insertMutationChangeItems(
  tx: DbTransaction,
  changeSetId: string,
  records: PantryChangeRecord[],
): Promise<void> {
  await tx.insert(schema.agentMutationChangeItem).values(
    records.map((record, ordinal) => ({
      changeSetId,
      ordinal,
      stableItemId: record.stableItemId,
      ingredientSlug: record.ingredientSlug,
      beforeValue: record.beforeValue,
      afterValue: record.afterValue,
      beforeVersion: record.beforeVersion,
      afterVersion: record.afterVersion,
    })),
  );
}

export async function findPantryChangeSet(
  tx: DbTransaction,
  userId: string,
  changeSetId: string,
): Promise<MutationChangeSet | undefined> {
  const [changeSet] = await tx
    .select()
    .from(schema.agentMutationChangeSet)
    .where(
      and(
        eq(schema.agentMutationChangeSet.id, changeSetId),
        eq(schema.agentMutationChangeSet.actorUserId, userId),
        eq(schema.agentMutationChangeSet.targetType, "pantry"),
      ),
    )
    .limit(1);
  return changeSet;
}

export async function findMutationChangeSet(
  tx: DbTransaction,
  userId: string,
  changeSetId: string,
): Promise<MutationChangeSet | undefined> {
  const [changeSet] = await tx
    .select()
    .from(schema.agentMutationChangeSet)
    .where(
      and(
        eq(schema.agentMutationChangeSet.id, changeSetId),
        eq(schema.agentMutationChangeSet.actorUserId, userId),
      ),
    )
    .limit(1);
  return changeSet;
}

export async function findMutationChangeItems(
  tx: DbTransaction,
  changeSetId: string,
): Promise<PantryChangeRecord[]> {
  const rows = await tx
    .select()
    .from(schema.agentMutationChangeItem)
    .where(eq(schema.agentMutationChangeItem.changeSetId, changeSetId))
    .orderBy(asc(schema.agentMutationChangeItem.ordinal));
  return rows.map((item) => ({
    stableItemId: item.stableItemId,
    ingredientSlug: item.ingredientSlug,
    beforeValue: item.beforeValue,
    afterValue: item.afterValue,
    beforeVersion: item.beforeVersion,
    afterVersion: item.afterVersion,
  }));
}

export async function listMutationHistory(
  tx: DbTransaction,
  userId: string,
) {
  const changeSets = await tx
    .select()
    .from(schema.agentMutationChangeSet)
    .where(
      and(
        eq(schema.agentMutationChangeSet.actorUserId, userId),
        eq(schema.agentMutationChangeSet.targetType, "pantry"),
      ),
    )
    .orderBy(
      desc(schema.agentMutationChangeSet.createdAt),
      desc(schema.agentMutationChangeSet.id),
    )
    .limit(50);
  if (changeSets.length === 0) return [];
  const items = await tx
    .select()
    .from(schema.agentMutationChangeItem)
    .where(
      inArray(
        schema.agentMutationChangeItem.changeSetId,
        changeSets.map((set) => set.id),
      ),
    )
    .orderBy(asc(schema.agentMutationChangeItem.ordinal));
  return changeSets.map((set) => ({
    ...set,
    items: items.filter((item) => item.changeSetId === set.id),
  }));
}

export async function purgeMutationHistoryForUser(
  tx: DbTransaction,
  userId: string,
): Promise<void> {
  const changeSets = await tx
    .select({ id: schema.agentMutationChangeSet.id })
    .from(schema.agentMutationChangeSet)
    .where(eq(schema.agentMutationChangeSet.actorUserId, userId));
  if (changeSets.length === 0) return;
  const changeSetIds = changeSets.map(({ id }) => id);
  await tx
    .delete(schema.agentCookLogChangeItem)
    .where(
      inArray(schema.agentCookLogChangeItem.changeSetId, changeSetIds),
    );
  await tx
    .delete(schema.agentMutationChangeItem)
    .where(
      inArray(schema.agentMutationChangeItem.changeSetId, changeSetIds),
    );
  await tx
    .delete(schema.pantryItemAbsence)
    .where(inArray(schema.pantryItemAbsence.changeSetId, changeSetIds));
  await tx
    .update(schema.agentMutationChangeSet)
    .set({ compensatesChangeSetId: null })
    .where(
      inArray(
        schema.agentMutationChangeSet.compensatesChangeSetId,
        changeSetIds,
      ),
    );
  await tx
    .update(schema.cookingSession)
    .set({ createdByChangeSetId: null })
    .where(
      and(
        eq(schema.cookingSession.userId, userId),
        inArray(schema.cookingSession.createdByChangeSetId, changeSetIds),
      ),
    );
  await tx
    .delete(schema.agentMutationChangeSet)
    .where(inArray(schema.agentMutationChangeSet.id, changeSetIds));
}
