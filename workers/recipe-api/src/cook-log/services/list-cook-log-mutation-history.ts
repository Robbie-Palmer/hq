import type { Db } from "recipe-db";
import { listCookLogMutationHistory as listHistory } from "../repositories/cook-log-mutation-repository";

export async function listCookLogMutationHistory(db: Db, userId: string) {
  return db.transaction(async (tx) => {
    const changeSets = await listHistory(tx, userId);
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
        sessionId: item.sessionId,
        beforeValue: item.beforeValue,
        afterValue: item.afterValue,
        beforeVersion: item.beforeVersion?.toString() ?? null,
        afterVersion: item.afterVersion.toString(),
      })),
    }));
  });
}
