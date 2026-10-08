import { and, eq, inArray } from "drizzle-orm";
import type { BatchDraft } from "recipe-domain/batch-import";
import type { Db } from "./index";
import {
  recipeImportDraftCuisine as cuisines,
  recipeImportDraft as drafts,
} from "./schema";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type DraftDb = Pick<Db, "select" | "insert" | "update" | "delete"> | Tx;

function draftColumns(draft: BatchDraft) {
  return {
    title: draft.title,
    description: draft.description,
    servings: draft.servings,
    prepTime: draft.prepTime ?? null,
    cookTime: draft.cookTime ?? null,
    source: draft.source,
    sourceUrl: draft.url ?? null,
    visibility: draft.visibility ?? null,
  };
}

async function insertCuisines(db: DraftDb, draftId: string, cuisine: string) {
  const labels = cuisine
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
  if (!labels.length) return;
  await db
    .insert(cuisines)
    .values(labels.map((label, position) => ({ draftId, position, label })))
    .onConflictDoNothing();
}

// Caller holds the job lock and writes generated and editable drafts in the same
// transaction as execution success. Replays preserve the first generated evidence.
export async function insertGeneratedDraft(
  db: DraftDb,
  jobId: string,
  draft: BatchDraft,
) {
  const inserted = await db
    .insert(drafts)
    .values(
      (["generated", "editable"] as const).map((kind) => ({
        jobId,
        kind,
        ...draftColumns(draft),
      })),
    )
    .onConflictDoNothing()
    .returning();
  const labels = draft.cuisine
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
  const rows = inserted.flatMap((row) =>
    labels.map((label, position) => ({ draftId: row.id, position, label })),
  );
  if (rows.length) await db.insert(cuisines).values(rows).onConflictDoNothing();
}

export async function updateEditableDraft(
  db: DraftDb,
  jobId: string,
  draft: BatchDraft,
) {
  const [updated] = await db
    .update(drafts)
    .set(draftColumns(draft))
    .where(and(eq(drafts.jobId, jobId), eq(drafts.kind, "editable")))
    .returning();
  if (!updated) throw new Error("Editable import draft not found");
  await db.delete(cuisines).where(eq(cuisines.draftId, updated.id));
  await insertCuisines(db, updated.id, draft.cuisine);
}

function draftFromRow(
  row: typeof drafts.$inferSelect,
  labels: string[],
): BatchDraft {
  return {
    title: row.title,
    description: row.description,
    servings: row.servings,
    source: row.source,
    cuisine: labels.join(", "),
    ...(row.prepTime === null ? {} : { prepTime: row.prepTime }),
    ...(row.cookTime === null ? {} : { cookTime: row.cookTime }),
    ...(row.sourceUrl === null ? {} : { url: row.sourceUrl }),
    ...(row.visibility === null ? {} : { visibility: row.visibility }),
  };
}

export async function readBatchDrafts(
  db: Pick<Db, "select"> | Tx,
  jobIds: string[],
) {
  const result = new Map<
    string,
    { draft?: BatchDraft; generatedDraft?: BatchDraft }
  >();
  if (!jobIds.length) return result;
  const rows = await db
    .select()
    .from(drafts)
    .where(inArray(drafts.jobId, jobIds));
  if (!rows.length) return result;
  const labels = await db
    .select()
    .from(cuisines)
    .where(
      inArray(
        cuisines.draftId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(cuisines.position);
  const labelsByDraft = new Map<string, string[]>();
  for (const row of labels) {
    const list = labelsByDraft.get(row.draftId) ?? [];
    list.push(row.label);
    labelsByDraft.set(row.draftId, list);
  }
  for (const row of rows) {
    const value = result.get(row.jobId) ?? {};
    const draft = draftFromRow(row, labelsByDraft.get(row.id) ?? []);
    if (row.kind === "editable") value.draft = draft;
    else value.generatedDraft = draft;
    result.set(row.jobId, value);
  }
  return result;
}
