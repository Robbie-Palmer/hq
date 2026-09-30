import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "recipe-db";
import { readBatchDrafts, updateEditableDraft } from "recipe-db/batch-drafts";
import {
  recipeImportBatch as batches,
  recipeImportReviewEvent as events,
  recipeImportJob as jobs,
  recipe,
  user,
} from "recipe-db/schema";
import {
  type BatchDraft,
  type BatchSource,
  batchSourceKey,
  CreateBatchSchema,
} from "recipe-domain/batch-import";
import { SavedRecipePayloadSchema } from "recipe-domain/serialization";
import { sha256Hex } from "ts-base/crypto";
import { validateRecipeUrl } from "./recipe-url-import";

export class BatchImportError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 429 | 503,
  ) {
    super(message);
  }
}

export function preflightSources(sources: BatchSource[]) {
  const seen = new Set<string>();
  return sources.map((source, position) => {
    let error: string | undefined;
    let identity = JSON.stringify(source);
    if (source.type === "url") {
      try {
        const url = validateRecipeUrl(source.url);
        url.hash = "";
        identity = url.toString();
      } catch (cause) {
        error = cause instanceof Error ? cause.message : "Invalid URL";
      }
    }
    if (seen.has(identity)) error = "Duplicate source in this batch";
    seen.add(identity);
    return {
      position,
      label: source.type === "url" ? source.url : source.filename,
      error,
    };
  });
}

export async function createBatch(
  db: Db,
  userId: string,
  raw: unknown,
  artifacts: R2Bucket,
) {
  const input = CreateBatchSchema.parse(raw);
  const preflight = preflightSources(input.sources);
  const fingerprint = await sha256Hex(
    JSON.stringify([input.sources, input.visibility]),
  );
  return db.transaction(async (tx) => {
    await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .for("update");
    const [existing] = await tx
      .select()
      .from(batches)
      .where(
        and(
          eq(batches.userId, userId),
          eq(batches.idempotencyKey, input.idempotencyKey),
        ),
      );
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        throw new BatchImportError(
          "Submission key was used for different sources",
          409,
        );
      return existing;
    }
    // Deterministic parsing has its own quota; photo/provider limits remain unchanged.
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const [daily] = await tx
      .select({ value: count() })
      .from(jobs)
      .where(
        and(
          eq(jobs.userId, userId),
          inArray(jobs.sourceType, ["url", "file"]),
          gte(jobs.createdAt, since),
        ),
      );
    if ((daily?.value ?? 0) + input.sources.length > 100)
      throw new BatchImportError(
        "Daily batch limit of 100 sources reached",
        429,
      );
    const [batch] = await tx
      .insert(batches)
      .values({
        userId,
        idempotencyKey: input.idempotencyKey,
        fingerprint,
        visibility: input.visibility,
      })
      .returning();
    if (!batch) throw new Error("Batch insert returned no row");
    await storeBatchSources(
      tx,
      artifacts,
      userId,
      batch.id,
      input.sources,
      preflight,
    );
    return batch;
  });
}

async function storeBatchSources(
  tx: Tx,
  artifacts: R2Bucket,
  userId: string,
  batchId: string,
  sources: BatchSource[],
  preflight: ReturnType<typeof preflightSources>,
) {
  for (const [position, source] of sources.entries()) {
    const id = crypto.randomUUID();
    const check = preflight[position];
    if (!check) throw new Error("Missing preflight result");
    const sourceBody = JSON.stringify(source);
    const sourceChecksum = await sha256Hex(sourceBody);
    await artifacts.put(batchSourceKey(id), sourceBody, {
      httpMetadata: { contentType: "application/json" },
    });
    await tx.insert(jobs).values({
      id,
      userId,
      batchId,
      position,
      sourceType: source.type,
      sourceLabel: check.label,
      sourceChecksum,
      imageCount: 0,
      status: check.error ? "failed" : "queued",
      reviewState: check.error ? "needs_attention" : "waiting",
      errorType: check.error ? "PreflightError" : null,
      errorMessage: check.error,
      finishedAt: check.error ? new Date() : null,
    });
  }
}

export async function listBatches(db: Db, userId: string) {
  return db
    .select()
    .from(batches)
    .where(eq(batches.userId, userId))
    .orderBy(desc(batches.createdAt))
    .limit(100);
}

export async function readBatch(db: Db, userId: string, batchId: string) {
  const [batch] = await db
    .select()
    .from(batches)
    .where(and(eq(batches.id, batchId), eq(batches.userId, userId)));
  if (!batch) throw new BatchImportError("Batch not found", 404);
  const items = await db
    .select()
    .from(jobs)
    .where(eq(jobs.batchId, batch.id))
    .orderBy(jobs.position);
  const draftByJob = await readBatchDrafts(
    db,
    items.map((item) => item.id),
  );
  return {
    ...batch,
    items: items.map((item) => ({ ...item, ...draftByJob.get(item.id) })),
    ...batchProgress(items),
    ...(!batch.startedAt ? { status: "preparing" } : {}),
  };
}

export function batchProgress(
  items: Array<{ reviewState: string; status: string }>,
) {
  const counts = {
    processing: 0,
    ready: 0,
    failed: 0,
    accepted: 0,
    skipped: 0,
  };
  for (const item of items) {
    if (item.reviewState === "accepted" || item.reviewState === "skipped")
      counts[item.reviewState]++;
    else if (item.status === "queued" || item.status === "running")
      counts.processing++;
    else if (item.status === "failed") counts.failed++;
    else counts.ready++;
  }
  let status = "completed";
  if (counts.ready || counts.failed) status = "awaiting_review";
  if (counts.processing) status = "processing";
  return { counts, status };
}

// Calling create with the same workflow ID is safe after a lost response. An existing
// instance is evidence of dispatch; all other failures remain visible and resumable.
async function reconcileDispatch(
  db: Db,
  item: typeof jobs.$inferSelect,
  workflow: Workflow,
  id: string,
) {
  const state = await (await workflow.get(id)).status();
  if (!["errored", "terminated", "complete"].includes(state.status)) return;
  await db
    .update(jobs)
    .set({
      status: "failed",
      reviewState: "needs_attention",
      errorType: "WorkflowError",
      errorMessage:
        "Processing stopped before the draft was saved. Retry this item.",
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(jobs.id, item.id),
        eq(jobs.executionAttempt, item.executionAttempt),
        eq(jobs.reviewState, "waiting"),
      ),
    );
}

export async function startBatch(
  db: Db,
  userId: string,
  batchId: string,
  workflow: Workflow,
) {
  const batch = await readBatch(db, userId, batchId);
  await db
    .update(batches)
    .set({ startedAt: sql`coalesce(${batches.startedAt}, now())` })
    .where(eq(batches.id, batchId));
  for (const item of batch.items) {
    if (item.reviewState !== "waiting") continue;
    const id = `${item.id}-${item.executionAttempt}`;
    if (item.status === "running") {
      await reconcileDispatch(db, item, workflow, id);
      continue;
    }
    if (item.status !== "queued") continue;
    try {
      await workflow.create({
        id,
        params: { jobId: item.id, batchAttempt: item.executionAttempt },
      });
    } catch (error) {
      try {
        await reconcileDispatch(db, item, workflow, id);
      } catch {
        throw error;
      }
    }
  }
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
async function lockedItem(
  tx: Tx,
  userId: string,
  batchId: string,
  jobId: string,
) {
  const [item] = await tx
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.batchId, batchId),
        eq(jobs.userId, userId),
      ),
    )
    .for("update");
  if (!item) throw new BatchImportError("Batch item not found", 404);
  return item;
}

export async function autosaveDraft(
  db: Db,
  userId: string,
  batchId: string,
  jobId: string,
  version: number,
  draft: BatchDraft,
) {
  return db.transaction(async (tx) => {
    const item = await lockedItem(tx, userId, batchId, jobId);
    if (item.reviewState !== "ready" || item.draftVersion !== version)
      throw new BatchImportError(
        "Draft changed. Reload this item before editing.",
        409,
      );
    const original = (await readBatchDrafts(tx, [jobId])).get(
      jobId,
    )?.generatedDraft;
    await updateEditableDraft(tx, jobId, { ...draft, url: original?.url });
    // Source provenance cannot be replaced by an editor request.
    const [updated] = await tx
      .update(jobs)
      .set({
        draftVersion: version + 1,
      })
      .where(eq(jobs.id, jobId))
      .returning();
    await tx
      .insert(events)
      .values({ jobId, action: "autosave", draftVersion: version + 1 });
    return updated;
  });
}

async function retryItem(tx: Tx, item: typeof jobs.$inferSelect) {
  if (
    item.status !== "failed" ||
    item.errorType === "PreflightError" ||
    item.reviewState === "skipped"
  )
    throw new BatchImportError("Only failed imports can be retried", 409);
  await tx
    .update(jobs)
    .set({
      status: "queued",
      reviewState: "waiting",
      executionAttempt: item.executionAttempt + 1,
      errorMessage: null,
      errorType: null,
      finishedAt: null,
    })
    .where(eq(jobs.id, item.id));
}
async function skipItem(tx: Tx, item: typeof jobs.$inferSelect) {
  if (item.status === "running" || item.status === "queued")
    throw new BatchImportError(
      "Wait for processing to finish before skipping",
      409,
    );
  await tx
    .update(jobs)
    .set({ reviewState: "skipped" })
    .where(eq(jobs.id, item.id));
}
export async function reviewAction(
  db: Db,
  userId: string,
  batchId: string,
  jobId: string,
  action: "skip" | "retry",
) {
  return db.transaction(async (tx) => {
    const item = await lockedItem(tx, userId, batchId, jobId);
    if (item.reviewState === "accepted")
      throw new BatchImportError(
        "Accepted recipes cannot be changed here",
        409,
      );
    if (item.reviewState === "skipped" && action === "skip") return;
    if (action === "retry") await retryItem(tx, item);
    else await skipItem(tx, item);
    await tx
      .insert(events)
      .values({ jobId, action, draftVersion: item.draftVersion });
  });
}

export async function readBatchItem(
  db: Db,
  userId: string,
  batchId: string,
  jobId: string,
) {
  const [item] = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.batchId, batchId),
        eq(jobs.userId, userId),
      ),
    );
  if (!item) throw new BatchImportError("Batch item not found", 404);
  return { ...item, ...(await readBatchDrafts(db, [jobId])).get(jobId) };
}

function assertAcceptanceSnapshot(
  input: Parameters<typeof acceptDraft>[4],
  draft: BatchDraft,
  canonical: string | undefined,
  defaultVisibility: string | undefined,
) {
  const payload = SavedRecipePayloadSchema.parse(JSON.parse(input.recipe.body));
  const expectedMetadata = [
    draft.title.trim(),
    draft.description.trim(),
    draft.cuisine
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean),
    draft.servings,
    draft.prepTime,
    draft.cookTime,
    canonical,
  ];
  const actualMetadata = [
    payload.recipe.title,
    payload.recipe.description,
    payload.recipe.cuisine,
    payload.recipe.servings,
    payload.recipe.prepTime,
    payload.recipe.cookTime,
    payload.recipe.canonical,
  ];
  if (
    payload.source !== draft.source ||
    input.recipe.title !== draft.title.trim() ||
    (input.recipe.description ?? "") !== draft.description.trim() ||
    input.recipe.visibility !== (draft.visibility ?? defaultVisibility) ||
    JSON.stringify(actualMetadata) !== JSON.stringify(expectedMetadata)
  )
    throw new BatchImportError(
      "Save the current draft before accepting it",
      409,
    );
}

export async function acceptDraft(
  db: Db,
  userId: string,
  batchId: string,
  jobId: string,
  input: {
    version: number;
    idempotencyKey: string;
    recipe: {
      slug: string;
      title: string;
      description?: string;
      body: string;
      visibility: "private" | "household" | "public";
    };
  },
) {
  const fingerprint = await sha256Hex(
    JSON.stringify([input.version, input.recipe]),
  );
  return db.transaction(async (tx) => {
    const item = await lockedItem(tx, userId, batchId, jobId);
    if (item.reviewState === "accepted") {
      if (
        item.acceptKey !== input.idempotencyKey ||
        item.acceptedVersion !== input.version ||
        item.acceptFingerprint !== fingerprint
      )
        throw new BatchImportError("This item was already accepted", 409);
      return { recipeId: item.acceptedRecipeId, replayed: true };
    }
    const stored = (await readBatchDrafts(tx, [jobId])).get(jobId);
    const draft = stored?.draft;
    if (
      item.reviewState !== "ready" ||
      item.status !== "succeeded" ||
      item.draftVersion !== input.version ||
      !draft
    )
      throw new BatchImportError("Draft changed. Reload before saving.", 409);
    const [batch] = await tx
      .select({ visibility: batches.visibility })
      .from(batches)
      .where(eq(batches.id, batchId));
    assertAcceptanceSnapshot(
      input,
      draft,
      stored?.generatedDraft?.url,
      batch?.visibility,
    );
    const [saved] = await tx
      .insert(recipe)
      .values({ ...input.recipe, userId })
      .returning();
    if (!saved) throw new Error("Recipe insert returned no row");
    await tx
      .update(jobs)
      .set({
        reviewState: "accepted",
        acceptedRecipeId: saved.id,
        acceptKey: input.idempotencyKey,
        acceptedVersion: input.version,
        acceptFingerprint: fingerprint,
      })
      .where(eq(jobs.id, jobId));
    await tx
      .insert(events)
      .values({ jobId, action: "accept", draftVersion: input.version });
    return { recipeId: saved.id, slug: saved.slug, replayed: false };
  });
}
