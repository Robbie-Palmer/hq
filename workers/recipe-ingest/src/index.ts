import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
  type WorkflowStepConfig,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { eq } from "drizzle-orm";
import {
  SpanKind,
  type TraceCarrier,
  withPostHogRequest,
  withPostHogSpan,
} from "observability";
import { withDb } from "recipe-db";
import { recipeImportJob as jobs } from "recipe-db/schema";
import type { BatchDraft } from "recipe-domain/batch-import";
import { canonicalEquipment } from "recipe-parsing/canonical-equipment-data";
import { canonicalIngredients } from "recipe-parsing/canonical-ingredients-data";
import {
  buildCooklangDraftFromExtraction,
  deriveRecipeFromCooklang,
} from "recipe-parsing/cooklang";
import {
  applyDisambiguationChoices,
  applyEquipmentDecisionsToEntry,
  applyLlmDecisionsToEntry,
  buildCategoryMap,
  collectUnresolved,
  extractEquipmentContext,
  extractRecipeContext,
} from "recipe-parsing/disambiguation";
import { canonicalizePredictionEntry } from "recipe-parsing/ingredient-canonicalization";
import {
  type DisambiguationChoice,
  disambiguateEquipment,
  disambiguateIngredients,
  extractRecipeFromImages,
  normalizeExtractionToCooklang,
} from "recipe-parsing/openrouter";
import type { ExtractionRecipe } from "recipe-parsing/schemas/ground-truth";
import type { CooklangRecipe } from "recipe-parsing/schemas/stage-artifacts";
import {
  buildOntology,
  buildOntologyIndex,
} from "recipe-parsing/slug-matching";
import { writeArtifact } from "./artifacts";
import { runLlmCall } from "./attempts";
import { admitBatchJob, runBatchItem } from "./batch";
import { buildFinalDraft } from "./draft";
import type { Env } from "./env";
import {
  listSourceImageKeys,
  loadImageDataUrls,
  readPhotoJobSourceManifest,
} from "./images";
import {
  markJobFailed,
  markJobRunning,
  markJobSucceeded,
  updateJobStage,
} from "./jobs";
import { type StageParams, stageParams } from "./params";

export type IngestParams = {
  jobId: string;
  batchAttempt?: number;
  batchPhoto?: boolean;
  traceContext?: TraceCarrier;
};

function llmStepConfig(params: StageParams): WorkflowStepConfig {
  return {
    retries: {
      limit: params.retryLimit,
      delay: 1_000,
      backoff: "exponential",
    },
    // Per-attempt ceiling: R2 reads + one provider call + attempt bookkeeping.
    timeout: params.requestTimeoutMs + 60_000,
  };
}

export async function awaitBatchAdmission(
  env: Env,
  jobId: string,
  batchAttempt: number,
  instanceId: string,
  step: WorkflowStep,
): Promise<boolean> {
  let check = 0;
  while (true) {
    const outcome = await step.do(`admit-${check}`, () =>
      withDb(env, (db) =>
        admitBatchJob(db, jobId, batchAttempt, instanceId),
      ),
    );
    if (outcome === "obsolete") return false;
    if (outcome === "admitted") return true;
    await step.sleep(`wait-${check}`, "5 seconds");
    check++;
  }
}

export class RecipeIngestWorkflow extends WorkflowEntrypoint<Env, IngestParams> {
  override async run(
    event: WorkflowEvent<IngestParams>,
    step: WorkflowStep,
  ): Promise<void> {
    if (
      event.payload.batchAttempt !== undefined &&
      !event.payload.batchPhoto
    ) {
      await runBatchItem(this.env, event.payload.jobId, event.payload.batchAttempt, event.instanceId, step);
      return;
    }
    await this.runTraced(event, step);
  }

  private async runTraced(
    event: WorkflowEvent<IngestParams>,
    step: WorkflowStep,
  ): Promise<void> {
    const { jobId } = event.payload;
    const batchAttempt = event.payload.batchPhoto
      ? event.payload.batchAttempt
      : undefined;
    const env = this.env;
    const traceStep = <T>(
      name: string,
      operation: () => Promise<T> | T,
    ): Promise<T> =>
      withPostHogSpan(
        {
          env,
          serviceName: "recipe-ingest",
          spanName: `workflow.step ${name}`,
          traceCarrier: event.payload.traceContext,
          kind: SpanKind.CONSUMER,
          waitUntil: this.ctx,
          attributes: {
            "recipe.import.job_id": jobId,
            "cloudflare.workflow.instance_id": event.instanceId,
            "cloudflare.workflow.step": name,
          },
        },
        operation,
      );

    try {
      if (
        batchAttempt !== undefined &&
        !(await awaitBatchAdmission(
          env,
          jobId,
          batchAttempt,
          event.instanceId,
          step,
        ))
      ) {
        return;
      }

      const source = await step.do("start", async () =>
        traceStep("start", async () => {
          let photoManifest:
            | Awaited<ReturnType<typeof readPhotoJobSourceManifest>>
            | undefined;
          let keys: string[];
          if (batchAttempt === undefined) {
            keys = await listSourceImageKeys(env, jobId);
          } else {
            const [item] = await withDb(env, (db) =>
              db
                .select({ sourceChecksum: jobs.sourceChecksum })
                .from(jobs)
                .where(eq(jobs.id, jobId)),
            );
            photoManifest = await readPhotoJobSourceManifest(
              env,
              jobId,
              item?.sourceChecksum ?? null,
            );
            keys = photoManifest.images.map((image) => image.r2Key);
          }
          if (keys.length === 0) {
            throw new NonRetryableError(
              `No source images found for job ${jobId}`,
            );
          }
          await withDb(env, async (db) => {
            await markJobRunning(
              db,
              jobId,
              event.instanceId,
              batchAttempt,
            );
            if (photoManifest) {
              await writeArtifact({
                env,
                db,
                jobId,
                stage: "extract",
                kind: "photo-group-source-manifest",
                filename: "source-manifest.json",
                payload: photoManifest,
                preview: {
                  manifestVersion: photoManifest.manifestVersion,
                  manifestChecksum: photoManifest.manifestChecksum,
                  groupChecksum: photoManifest.groupChecksum,
                },
              });
            }
          });
          return { sourceKeys: keys, photoManifest };
        }),
      );
      const { sourceKeys, photoManifest } = source;

      const extractParams = stageParams(env, "extract");
      const extraction = await step.do(
        "extract",
        llmStepConfig(extractParams),
        async (): Promise<ExtractionRecipe> =>
          traceStep("extract", async () => {
            const imageDataUrls = await loadImageDataUrls(
              env,
              sourceKeys,
              photoManifest
                ? new Map(
                    photoManifest.images.map((image) => [
                      image.r2Key,
                      image.checksum,
                    ]),
                  )
                : undefined,
            );
            return runLlmCall({
              env,
              jobId,
              stage: "extract",
              model: extractParams.model,
              call: () =>
                extractRecipeFromImages({
                  apiKey: env.OPENROUTER_API_KEY,
                  imageDataUrls,
                  model: extractParams.model,
                  requestTimeoutMs: extractParams.requestTimeoutMs,
                }),
            });
          }),
      );

      await step.do("persist-extract", async () =>
        traceStep("persist-extract", async () => {
          await withDb(env, async (db) => {
            await writeArtifact({
              env,
              db,
              jobId,
              stage: "extract",
              kind: "extraction",
              filename: "extraction.json",
              payload: extraction,
              model: extractParams.model,
            });
            await updateJobStage(
              db,
              jobId,
              "normalize",
              "Tidying the recipe into a draft",
              batchAttempt,
            );
          });
        }),
      );

      const normalizeParams = stageParams(env, "normalize");
      let cooklang: CooklangRecipe;
      try {
        cooklang = await step.do(
          "normalize",
          llmStepConfig(normalizeParams),
          async (): Promise<CooklangRecipe> =>
            traceStep("normalize", async () => {
              const llmCooklang = await runLlmCall({
                env,
                jobId,
                stage: "normalize",
                model: normalizeParams.model,
                call: () =>
                  normalizeExtractionToCooklang({
                    apiKey: env.OPENROUTER_API_KEY,
                    extracted: extraction,
                    model: normalizeParams.model,
                    requestTimeoutMs: normalizeParams.requestTimeoutMs,
                  }),
              });

              // Always re-derive from the body to ensure slug normalization is applied.
              const derived = deriveRecipeFromCooklang({
                ...llmCooklang,
                derived: undefined,
              });
              if (derived.derived) {
                return derived;
              }

              // LLM produced Cooklang but derivation failed — deterministic draft fallback.
              const draft = buildCooklangDraftFromExtraction(extraction);
              if (draft.derived) {
                return {
                  ...derived,
                  derived: draft.derived,
                  diagnostics: [
                    ...derived.diagnostics,
                    "LLM cooklang derivation failed; using deterministic draft.",
                  ],
                };
              }
              throw new NonRetryableError(derived.diagnostics.join(" | "));
            }),
        );
      } catch (normalizeError) {
        // Normalization failed outright — fall back to the deterministic draft,
        // mirroring the evaluation pipeline's behaviour.
        cooklang = await step.do("normalize-fallback", async () =>
          traceStep("normalize-fallback", () => {
            const draft = buildCooklangDraftFromExtraction(extraction);
            if (!draft.derived) {
              throw new NonRetryableError(
                "Normalization failed and deterministic draft could not produce a recipe",
              );
            }
            return {
              ...draft,
              diagnostics: [
                ...draft.diagnostics,
                `Normalization LLM failed; using deterministic draft. (${
                  normalizeError instanceof Error
                    ? normalizeError.message
                    : String(normalizeError)
                })`,
              ],
            };
          }),
        );
      }

      await step.do("persist-normalize", async () =>
        traceStep("persist-normalize", async () => {
          await withDb(env, async (db) => {
            await writeArtifact({
              env,
              db,
              jobId,
              stage: "normalize",
              kind: "cooklang",
              filename: "cooklang.json",
              payload: cooklang,
              model: normalizeParams.model,
            });
            await updateJobStage(
              db,
              jobId,
              "canonicalize",
              "Matching ingredients to the pantry",
              batchAttempt,
            );
          });
        }),
      );

      const canonicalizeParams = stageParams(env, "canonicalize");

      // Deterministic canonicalization only — no provider call, so it needs no
      // LLM retry budget. The two disambiguation steps below own the retries.
      const { entry, decisions, cookwareDecisions } = await step.do(
        "canonicalize",
        async () =>
          traceStep("canonicalize", () => {
            const recipe = cooklang.derived;
            if (!recipe) {
              throw new NonRetryableError(
                "Normalized recipe missing derived output",
              );
            }

            const ingredientOntology = buildOntology(
              canonicalIngredients.ingredients,
              "ingredient",
            );
            const equipmentOntology = buildOntology(
              canonicalEquipment.equipment,
              "equipment",
            );
            return canonicalizePredictionEntry(
              { images: sourceKeys, predicted: recipe },
              {
                ingredients: ingredientOntology,
                ingredientIndex: buildOntologyIndex(ingredientOntology),
                equipment: equipmentOntology,
                equipmentIndex: buildOntologyIndex(equipmentOntology),
              },
            );
          }),
      );

      // Each registry is disambiguated in its own step so retrying one provider
      // call never re-runs (or re-charges) the other. Disambiguation is
      // best-effort: once retries are exhausted the deterministic result stands.
      const bestEffortDisambiguation = async (
        ctx: { attempt: number },
        call: () => Promise<DisambiguationChoice[]>,
      ): Promise<DisambiguationChoice[]> => {
        try {
          return await call();
        } catch (error) {
          const attemptsRemain = ctx.attempt <= canonicalizeParams.retryLimit;
          if (attemptsRemain && !(error instanceof NonRetryableError)) {
            throw error;
          }
          console.warn(
            `LLM disambiguation failed for job ${jobId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return [];
        }
      };

      const unresolvedIngredients = collectUnresolved(
        decisions,
        buildCategoryMap(canonicalIngredients.ingredients),
      );
      if (unresolvedIngredients.length > 0) {
        const requestIngredientDisambiguation = () =>
          disambiguateIngredients({
            apiKey: env.OPENROUTER_API_KEY,
            unresolvedItems: unresolvedIngredients,
            recipeContext: extractRecipeContext(entry, decisions),
            model: canonicalizeParams.model,
            requestTimeoutMs: canonicalizeParams.requestTimeoutMs,
          });
        const choices = await step.do(
          "disambiguate-ingredients",
          llmStepConfig(canonicalizeParams),
          (ctx) =>
            traceStep("disambiguate-ingredients", () =>
              bestEffortDisambiguation(ctx, () =>
                runLlmCall({
                  env,
                  jobId,
                  stage: "canonicalize",
                  model: canonicalizeParams.model,
                  call: requestIngredientDisambiguation,
                }),
              ),
            ),
        );
        applyDisambiguationChoices(decisions, unresolvedIngredients, choices);
      }

      const unresolvedEquipment = collectUnresolved(
        cookwareDecisions,
        buildCategoryMap(canonicalEquipment.equipment),
      );
      if (unresolvedEquipment.length > 0) {
        const requestEquipmentDisambiguation = () =>
          disambiguateEquipment({
            apiKey: env.OPENROUTER_API_KEY,
            unresolvedItems: unresolvedEquipment,
            equipmentContext: extractEquipmentContext(
              entry,
              cookwareDecisions,
            ),
            model: canonicalizeParams.model,
            requestTimeoutMs: canonicalizeParams.requestTimeoutMs,
          });
        const choices = await step.do(
          "disambiguate-equipment",
          llmStepConfig(canonicalizeParams),
          (ctx) =>
            traceStep("disambiguate-equipment", () =>
              bestEffortDisambiguation(ctx, () =>
                runLlmCall({
                  env,
                  jobId,
                  stage: "canonicalize",
                  model: canonicalizeParams.model,
                  call: requestEquipmentDisambiguation,
                }),
              ),
            ),
        );
        applyDisambiguationChoices(
          cookwareDecisions,
          unresolvedEquipment,
          choices,
        );
      }

      const finalEntry = applyEquipmentDecisionsToEntry(
        applyLlmDecisionsToEntry(entry, decisions),
        cookwareDecisions,
      );
      const canonical = {
        recipe: finalEntry.predicted,
        decisions,
        cookwareDecisions,
      };

      await step.do("persist-canonicalize", async () =>
        traceStep("persist-canonicalize", async () => {
          await withDb(env, async (db) => {
            await writeArtifact({
              env,
              db,
              jobId,
              stage: "canonicalize",
              kind: "canonicalization-decisions",
              filename: "decisions.json",
              payload: {
                decisions: canonical.decisions,
                cookwareDecisions: canonical.cookwareDecisions,
              },
              model: canonicalizeParams.model,
            });
            await updateJobStage(
              db,
              jobId,
              "finalize",
              "Preparing your draft",
              batchAttempt,
            );
          });
        }),
      );

      await step.do("finalize", async () =>
        traceStep("finalize", async () => {
          const draft = buildFinalDraft(
            sourceKeys,
            cooklang,
            canonical.recipe,
            canonical.cookwareDecisions,
          );
          await withDb(env, async (db) => {
            await writeArtifact({
              env,
              db,
              jobId,
              stage: "finalize",
              kind: "draft",
              filename: "draft.json",
              payload: draft,
              preview: draft,
            });
            const batchDraft: BatchDraft | undefined =
              batchAttempt === undefined
                ? undefined
                : {
                    title: draft.recipe.title,
                    description: draft.recipe.description,
                    cuisine: draft.recipe.cuisine.join(", "),
                    servings: draft.recipe.servings,
                    prepTime: draft.recipe.prepTime,
                    cookTime: draft.recipe.cookTime,
                    source: draft.cooklang.body,
                  };
            await markJobSucceeded(
              db,
              jobId,
              batchDraft && batchAttempt !== undefined
                ? { batchAttempt, draft: batchDraft }
                : undefined,
            );
          });
        }),
      );
    } catch (error) {
      const errorType =
        error instanceof Error && error.name ? error.name : "IngestError";
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("Recipe ingestion failed", {
        jobId,
        errorType,
        errorMessage,
      });
      await step.do("mark-failed", async () =>
        traceStep("mark-failed", async () => {
          await withDb(env, (db) =>
            markJobFailed(
              db,
              jobId,
              errorType,
              errorMessage,
              batchAttempt,
            ),
          );
        }),
      );
      throw error;
    }
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return withPostHogRequest(
      {
        env,
        serviceName: "recipe-ingest",
        spanName: `${request.method} ${new URL(request.url).pathname}`,
        request,
        waitUntil: ctx,
      },
      () => {
        const url = new URL(request.url);
        if (url.pathname === "/health") {
          return Response.json({ status: "ok", service: "recipe-ingest" });
        }
        return new Response("Not found", { status: 404 });
      },
    );
  },
};
