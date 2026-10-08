import type { Db } from "recipe-db";
import { listMutationHistory } from "../repositories/mutation-ledger-repository";

export async function listPantryMutationHistory(db: Db, userId: string) {
  return db.transaction(async (tx) => {
    const changeSets = await listMutationHistory(tx, userId);
    return changeSets.map((set) => ({
      id: set.id,
      actorType: set.actorType,
      agentId: set.actorAgentId,
      agentName: set.actorAgentName,
      hostId: set.actorHostId,
      hostName: set.actorHostName,
      capability: set.capability,
      targetType: set.targetType,
      targetId: set.targetId,
      reason: set.reason,
      compensatesChangeSetId: set.compensatesChangeSetId,
      createdAt: set.createdAt.toISOString(),
      items: set.items.map((item) => ({
        stableItemId: item.stableItemId,
        ingredientSlug: item.ingredientSlug,
        beforeValue: item.beforeValue,
        afterValue: item.afterValue,
        beforeVersion: item.beforeVersion?.toString() ?? null,
        afterVersion: item.afterVersion.toString(),
      })),
    }));
  });
}
