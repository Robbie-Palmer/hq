import { and, eq } from "drizzle-orm";
import type { Db } from "recipe-db";
import { insertGeneratedDraft } from "recipe-db/batch-drafts";
import { recipeImportJob } from "recipe-db/schema";
import type { BatchDraft } from "recipe-domain/batch-import";
import type { ImportStage } from "recipe-domain/import-storage";

function currentJob(jobId: string, batchAttempt?: number) {
  return batchAttempt === undefined
    ? eq(recipeImportJob.id, jobId)
    : and(
        eq(recipeImportJob.id, jobId),
        eq(recipeImportJob.executionAttempt, batchAttempt),
        eq(recipeImportJob.reviewState, "waiting"),
      );
}

export async function markJobRunning(
  db: Db,
  jobId: string,
  workflowInstanceId: string,
  batchAttempt?: number,
): Promise<void> {
  await db
    .update(recipeImportJob)
    .set({
      status: "running",
      currentStage: "extract",
      progressLabel: "Reading the recipe from your photos",
      workflowInstanceId,
    })
    .where(currentJob(jobId, batchAttempt));
}

export async function updateJobStage(
  db: Db,
  jobId: string,
  stage: ImportStage,
  progressLabel: string,
  batchAttempt?: number,
): Promise<void> {
  await db
    .update(recipeImportJob)
    .set({ currentStage: stage, progressLabel })
    .where(currentJob(jobId, batchAttempt));
}

export async function markJobSucceeded(
  db: Db,
  jobId: string,
  options?: { batchAttempt: number; draft: BatchDraft },
): Promise<void> {
  if (!options) {
    await db
      .update(recipeImportJob)
      .set({
        status: "succeeded",
        progressLabel: "Draft ready",
        finishedAt: new Date(),
      })
      .where(eq(recipeImportJob.id, jobId));
    return;
  }
  await db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(recipeImportJob)
      .where(currentJob(jobId, options.batchAttempt))
      .for("update");
    if (!item) return;
    await insertGeneratedDraft(tx, jobId, options.draft);
    await tx
      .update(recipeImportJob)
      .set({
        status: "succeeded",
        reviewState: "ready",
        progressLabel: "Draft ready",
        finishedAt: new Date(),
      })
      .where(currentJob(jobId, options.batchAttempt));
  });
}

export async function markJobFailed(
  db: Db,
  jobId: string,
  errorType: string,
  errorMessage: string,
  batchAttempt?: number,
): Promise<void> {
  await db
    .update(recipeImportJob)
    .set({
      status: "failed",
      progressLabel: "Import failed",
      errorType,
      errorMessage,
      ...(batchAttempt === undefined
        ? {}
        : { reviewState: "needs_attention" }),
      finishedAt: new Date(),
    })
    .where(currentJob(jobId, batchAttempt));
}
