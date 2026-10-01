import { and, eq, sql } from "drizzle-orm";
import type { Db } from "recipe-db";
import { recipe, recipeImportBatch as batches, recipeImportJob as jobs, recipeImportArchiveEntry as entries, recipeImportReviewEvent as events } from "recipe-db/schema";
import { BatchImportError } from "./batch-imports";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
async function ownedBatch(tx: Tx, userId: string, id: string) {
  const [batch] = await tx.select().from(batches).where(and(eq(batches.id, id), eq(batches.userId, userId))).for("update");
  if (!batch) throw new BatchImportError("Batch not found", 404);
  const [entry] = await tx.select({ id: entries.jobId }).from(entries).innerJoin(jobs, eq(jobs.id, entries.jobId)).where(eq(jobs.batchId, id)).limit(1);
  if (!entry) throw new BatchImportError("Undo is only supported for collection imports", 409);
  return batch;
}

async function inspectItem(tx: Tx, userId: string, item: typeof jobs.$inferSelect) {
  if (!item.acceptedRecipeId) return { outcome: "deleted", message: "Recipe already deleted" };
  const [saved] = await tx.select().from(recipe).where(eq(recipe.id, item.acceptedRecipeId)).for("update");
  if (!saved) return { outcome: "deleted", message: "Recipe already deleted" };
  if (saved.userId !== userId) return { outcome: "preserved", message: "Recipe has been transferred" };
  if (!item.acceptedRecipeUpdatedAt || saved.updatedAt.getTime() !== item.acceptedRecipeUpdatedAt.getTime()) return { outcome: "preserved", message: "Recipe has been changed since import" };
  // The recipe lock conflicts with FK insertion by a concurrent fork. Slug-based
  // references are checked under SERIALIZABLE isolation by the caller.
  const references = await tx.execute(sql`select
    exists(select 1 from recipe where parent_recipe_id = ${saved.id}) as forked,
    exists(select 1 from cooking_session where recipe_slug = ${saved.slug})
    or exists(select 1 from user_recipe_box_item where recipe_slug = ${saved.slug} and user_id <> ${userId})
    or exists(select 1 from notification_recipe_recommendation_event where recipe_id = ${saved.id})
    or exists(select 1 from shopping_list where snapshot->'recipes' @> ${JSON.stringify([{ slug: saved.slug }])}::jsonb) as used`);
  const reference = references[0];
  if (reference?.forked) return { outcome: "preserved", message: "Recipe has been forked" };
  if (reference?.used) return { outcome: "preserved", message: "Recipe is referenced by cooking, saved recipes, recommendations, or meal plans" };
  return { outcome: "eligible", message: "Ready to delete" };
}

export async function previewBatchUndo(db: Db, userId: string, batchId: string) {
  return db.transaction(async tx => {
    const batch = await ownedBatch(tx, userId, batchId);
    const items = await tx.select().from(jobs).where(and(eq(jobs.batchId, batchId), eq(jobs.reviewState, "accepted"))).orderBy(jobs.position);
    const results = [];
    for (const item of items) results.push({ itemId: item.id, label: item.sourceLabel, recipeId: item.acceptedRecipeSnapshotId, ...(item.undoOutcome ? { outcome: item.undoOutcome, message: item.undoMessage } : await inspectItem(tx, userId, item)) });
    return { state: batch.undoCompletedAt ? "completed" : batch.undoStartedAt ? "running" : "preview", items: results };
  });
}

export async function beginBatchUndo(db: Db, userId: string, batchId: string) {
  return db.transaction(async tx => {
    await ownedBatch(tx, userId, batchId);
    const [active] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.batchId, batchId), sql`${jobs.status} in ('queued', 'running')`)).limit(1);
    if (active) throw new BatchImportError("Wait for processing to finish before undoing this batch", 409);
    await tx.update(batches).set({ undoStartedAt: sql`coalesce(${batches.undoStartedAt}, now())`, undoCompletedAt: null }).where(eq(batches.id, batchId));
  });
}

export async function executeBatchUndo(db: Db, userId: string, batchId: string) {
  const items = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.batchId, batchId), eq(jobs.userId, userId), eq(jobs.reviewState, "accepted")));
  for (const { id } of items) {
    try {
      await db.transaction(async tx => {
        const batch = await ownedBatch(tx, userId, batchId);
        if (!batch.undoStartedAt) throw new BatchImportError("Undo has not started", 409);
        const [item] = await tx.select().from(jobs).where(eq(jobs.id, id)).for("update");
        if (!item || ["deleted", "preserved"].includes(item.undoOutcome ?? "")) return;
        const result = await inspectItem(tx, userId, item);
        if (result.outcome === "eligible" && item.acceptedRecipeId) {
          await tx.delete(recipe).where(eq(recipe.id, item.acceptedRecipeId));
          result.outcome = "deleted";
          result.message = "Imported recipe deleted";
        }
        await tx.update(jobs).set({ undoOutcome: result.outcome, undoMessage: result.message }).where(eq(jobs.id, id));
        await tx.insert(events).values({ jobId: id, action: `undo_${result.outcome}`, draftVersion: item.draftVersion });
      }, { isolationLevel: "serializable" });
    } catch {
      // Do not overwrite a receipt committed by another concurrent executor.
      await db.update(jobs).set({ undoOutcome: "failed", undoMessage: "Could not undo this recipe. Retry the batch undo." }).where(and(eq(jobs.id, id), sql`(${jobs.undoOutcome} is null or ${jobs.undoOutcome} = 'failed')`));
    }
  }
  await db.transaction(async tx => {
    await ownedBatch(tx, userId, batchId);
    await tx.update(batches).set({ undoCompletedAt: new Date() }).where(eq(batches.id, batchId));
  });
}
