import { and, asc, desc, eq, inArray } from "drizzle-orm";
import * as schema from "recipe-db/schema";
import type {
  CookLogChangeRecord,
  CookLogMutationEvent,
} from "recipe-domain/cook-log";
import type { DbTransaction } from "../../db/types";

export async function findCookLogChangeItems(
  tx: DbTransaction,
  changeSetId: string,
): Promise<CookLogChangeRecord[]> {
  const rows = await tx
    .select()
    .from(schema.agentCookLogChangeItem)
    .where(eq(schema.agentCookLogChangeItem.changeSetId, changeSetId))
    .orderBy(asc(schema.agentCookLogChangeItem.ordinal));
  return rows.map((row) => ({
    sessionId: row.sessionId,
    beforeValue: row.beforeValue,
    afterValue: row.afterValue,
    beforeVersion: row.beforeVersion,
    afterVersion: row.afterVersion,
  }));
}

export async function insertCookLogChangeItems(
  tx: DbTransaction,
  changeSetId: string,
  records: CookLogChangeRecord[],
): Promise<void> {
  await tx.insert(schema.agentCookLogChangeItem).values(
    records.map((record, ordinal) => ({
      changeSetId,
      ordinal,
      sessionId: record.sessionId,
      beforeValue: record.beforeValue,
      afterValue: record.afterValue,
      beforeVersion: record.beforeVersion,
      afterVersion: record.afterVersion,
    })),
  );
}

export async function listCookLogMutationHistory(
  tx: DbTransaction,
  userId: string,
) {
  const changeSets = await tx
    .select()
    .from(schema.agentMutationChangeSet)
    .where(
      and(
        eq(schema.agentMutationChangeSet.actorUserId, userId),
        eq(schema.agentMutationChangeSet.targetType, "cook_log"),
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
    .from(schema.agentCookLogChangeItem)
    .where(
      inArray(
        schema.agentCookLogChangeItem.changeSetId,
        changeSets.map((set) => set.id),
      ),
    )
    .orderBy(asc(schema.agentCookLogChangeItem.ordinal));
  return changeSets.map((set) => ({
    ...set,
    items: items.filter((item) => item.changeSetId === set.id),
  }));
}

export async function findCookLogSessions(
  tx: DbTransaction,
  userId: string,
  sessionIds: string[],
  lock = false,
) {
  if (sessionIds.length === 0) return [];
  const query = tx
    .select()
    .from(schema.cookingSession)
    .where(
      and(
        eq(schema.cookingSession.userId, userId),
        inArray(schema.cookingSession.id, sessionIds),
      ),
    );
  return lock ? query.for("update") : query;
}

export async function insertCookLogSessions(
  tx: DbTransaction,
  userId: string,
  changeSetId: string,
  events: CookLogMutationEvent[],
): Promise<void> {
  await tx.insert(schema.cookingSession).values(
    events.map((event) => ({
      id: event.sessionId,
      userId,
      recipeSlug: event.recipeSlug,
      recipeTitle: event.recipeTitle,
      servings: event.servings,
      diners: event.diners,
      startedAt: new Date(event.cookedAt),
      completedAt: new Date(event.cookedAt),
      version: 1n,
      createdByChangeSetId: changeSetId,
    })),
  );
}

export async function deleteCookLogSession(
  tx: DbTransaction,
  userId: string,
  changeSetId: string,
  sessionId: string,
  version: bigint,
): Promise<boolean> {
  const deleted = await tx
    .delete(schema.cookingSession)
    .where(
      and(
        eq(schema.cookingSession.id, sessionId),
        eq(schema.cookingSession.userId, userId),
        eq(schema.cookingSession.createdByChangeSetId, changeSetId),
        eq(schema.cookingSession.version, version),
      ),
    )
    .returning({ id: schema.cookingSession.id });
  return deleted.length === 1;
}
