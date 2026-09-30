import type { WorkflowStep } from "cloudflare:workers";
import { and, count, eq, type SQL } from "drizzle-orm";
import { type Db, withDb } from "recipe-db";
import { insertGeneratedDraft } from "recipe-db/batch-drafts";
import { recipeImportJob as jobs, user } from "recipe-db/schema";
import {
  BatchDraftSchema,
  BatchSourceSchema,
  batchSourceKey,
} from "recipe-domain/batch-import";
import { parseRecipeFile } from "recipe-parsing/recipe-file";
import { fetchRecipePage } from "recipe-parsing/recipe-url-import";
import { parseSchemaOrgRecipeHtml } from "recipe-parsing/schema-org";
import { sha256Hex } from "ts-base/crypto";
import { writeArtifact } from "./artifacts";
import type { Env } from "./env";

async function admitJob(
  db: Db,
  condition: SQL | undefined,
  instanceId: string,
) {
  return db.transaction(async (tx) => {
    const [item] = await tx.select().from(jobs).where(condition);
    if (!item) return "obsolete";
    await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, item.userId))
      .for("update");
    if (item.status === "running" && item.workflowInstanceId === instanceId)
      return "admitted";
    const [active] = await tx
      .select({ value: count() })
      .from(jobs)
      .where(and(eq(jobs.userId, item.userId), eq(jobs.status, "running")));
    if (active && active.value >= 2) return "wait";
    await tx
      .update(jobs)
      .set({
        status: "running",
        workflowInstanceId: instanceId,
        progressLabel: "Reading recipe source",
      })
      .where(condition);
    return "admitted";
  });
}

export async function runBatchItem(
  env: Env,
  jobId: string,
  attempt: number,
  instanceId: string,
  step: WorkflowStep,
) {
  const current = () =>
    and(
      eq(jobs.id, jobId),
      eq(jobs.executionAttempt, attempt),
      eq(jobs.reviewState, "waiting"),
    );
  try {
    // Workflow sleeps are durable. Waiting sources reserve no provider or parsing slot.
    let admitted = false;
    for (let check = 0; !admitted; check++) {
      const outcome = await step.do(`admit-${check}`, () =>
        withDb(env, (db) => admitJob(db, current(), instanceId)),
      );
      if (outcome === "obsolete") return;
      admitted = outcome === "admitted";
      if (!admitted) await step.sleep(`wait-${check}`, "5 seconds");
    }
    const source = await step.do("read-source", async () => {
      const object = await env.ARTIFACTS.get(batchSourceKey(jobId));
      if (!object)
        throw new Error(
          "Recipe source has expired. Start a new batch with the original source.",
        );
      const body = await object.text();
      const [item] = await withDb(env, (db) =>
        db.select().from(jobs).where(current()),
      );
      if (!item || (await sha256Hex(body)) !== item.sourceChecksum)
        throw new Error("Recipe source checksum does not match");
      return BatchSourceSchema.parse(JSON.parse(body));
    });
    const draft = await step.do(
      "parse-source",
      {
        retries: { limit: 2, delay: "2 seconds", backoff: "exponential" },
        timeout: "1 minute",
      },
      async () => {
        let result: Awaited<ReturnType<typeof parseRecipeFile>> = null;
        if (source.type === "url") {
          const page = await fetchRecipePage(source.url);
          result = await parseSchemaOrgRecipeHtml(page.html, page.url);
          if (result) result = { ...result, url: page.url };
        } else result = await parseRecipeFile(source.filename, source.content);
        if (!result) throw new Error("No complete recipe found in this source");
        return BatchDraftSchema.parse(result);
      },
    );
    await step.do("persist-draft", () =>
      withDb(env, async (db) => {
        await writeArtifact({
          env,
          db,
          jobId,
          stage: "finalize",
          kind: `batch-draft-${attempt}`,
          filename: `batch-draft-${attempt}.json`,
          payload: draft,
        });
        await db.transaction(async (tx) => {
          const [item] = await tx
            .select()
            .from(jobs)
            .where(current())
            .for("update");
          if (!item) return;
          await insertGeneratedDraft(tx, jobId, draft);
          await tx
            .update(jobs)
            .set({
              status: "succeeded",
              reviewState: "ready",
              progressLabel: "Draft ready",
              finishedAt: new Date(),
            })
            .where(current());
        });
      }),
    );
  } catch (error) {
    await step.do("record-batch-failure", () =>
      withDb(env, (db) =>
        db
          .update(jobs)
          .set({
            status: "failed",
            reviewState: "needs_attention",
            progressLabel: "Import failed",
            errorType: "ParseError",
            errorMessage:
              error instanceof Error ? error.message : "Import failed",
            finishedAt: new Date(),
          })
          .where(current())
          .then(() => undefined),
      ),
    );
  }
}
