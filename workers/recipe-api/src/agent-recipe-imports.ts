import type { AgentSession } from "@better-auth/agent-auth";
import { and, count, desc, eq, gte, inArray } from "drizzle-orm";
import type { Db } from "recipe-db";
import * as schema from "recipe-db/schema";
import { importJobPrefix, sourceImageKey } from "recipe-domain/import-storage";
import { hasExpectedImageSignature } from "./image-signature";
import { insertMutationChangeSet } from "./pantry/repositories/mutation-ledger-repository";
import { validateRecipeUrl } from "./recipe-url-import";

export const RECIPE_IMPORT_MAX_IMAGES = 6;
export const RECIPE_IMPORT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const RECIPE_IMPORT_MAX_TOTAL_BYTES = 30 * 1024 * 1024;
const RECIPE_IMPORT_MAX_ACTIVE_JOBS = 2;
const RECIPE_IMPORT_DAILY_JOB_LIMIT = 10;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 10_000;
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type AgentRecipeImportServices = {
  artifacts?: R2Bucket;
  workflow?: Workflow;
  fetcher?: typeof fetch;
};

type ImportJob = typeof schema.recipeImportJob.$inferSelect;

export function agentImportJobResponse(job: ImportJob) {
  return {
    id: job.id,
    status: job.status,
    currentStage: job.currentStage,
    progressLabel: job.progressLabel,
    imageCount: job.imageCount,
    error: job.errorMessage
      ? { type: job.errorType, message: job.errorMessage }
      : null,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
  };
}

async function readImage(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > RECIPE_IMPORT_MAX_IMAGE_BYTES) {
    throw new Error("Each image must be 10MB or smaller");
  }
  if (!response.body) throw new Error("The image response was empty");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > RECIPE_IMPORT_MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new Error("Each image must be 10MB or smaller");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function imageContentType(response: Response) {
  if (!response.ok) throw new Error("The image could not be fetched");
  const contentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (!contentType || !IMAGE_EXTENSIONS[contentType]) {
    throw new Error("Images must be JPEG, PNG, or WebP");
  }
  return contentType;
}

function redirectTarget(response: Response, url: URL, redirect: number) {
  if (response.status < 300 || response.status >= 400) return undefined;
  const location = response.headers.get("location");
  if (!location || redirect === MAX_REDIRECTS) {
    throw new Error("The image redirected too many times");
  }
  return validateRecipeUrl(new URL(location, url));
}

async function fetchImage(rawUrl: string, fetcher: typeof fetch) {
  let url = validateRecipeUrl(rawUrl);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const response = await fetcher(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "image/jpeg,image/png,image/webp" },
    });
    const nextUrl = redirectTarget(response, url, redirect);
    if (nextUrl) {
      url = nextUrl;
      continue;
    }
    const contentType = imageContentType(response);
    const extension = IMAGE_EXTENSIONS[contentType] as string;
    const bytes = await readImage(response);
    if (bytes.byteLength === 0) throw new Error("Images must not be empty");
    const file = new File([bytes], `source.${extension}`, { type: contentType });
    if (!(await hasExpectedImageSignature(file, contentType))) {
      throw new Error("Image contents do not match the declared file type");
    }
    return { file, extension };
  }
  throw new Error("The image could not be fetched");
}

async function replayedJob(
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
  session: AgentSession,
  idempotencyKey: string,
  fingerprint: string,
) {
  const [existing] = await tx
    .select()
    .from(schema.agentMutationChangeSet)
    .where(eq(schema.agentMutationChangeSet.idempotencyKey, idempotencyKey))
    .limit(1);
  if (!existing) return undefined;
  if (
    !actorMatches(existing, session) ||
    existing.capability !== "recipe_import.create" ||
    existing.commandFingerprint !== fingerprint
  ) {
    throw new Error("Idempotency key was already used for a different operation");
  }
  const [job] = await tx
    .select()
    .from(schema.recipeImportJob)
    .where(
      and(
        eq(schema.recipeImportJob.id, existing.targetId),
        eq(schema.recipeImportJob.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!job) throw new Error("The previous import no longer exists");
  return job;
}

export async function recipeImportQuotaReason(
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
  userId: string,
): Promise<"active" | "daily" | undefined> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const [[active], [today]] = await Promise.all([
    tx
      .select({ value: count() })
      .from(schema.recipeImportJob)
      .where(
        and(
          eq(schema.recipeImportJob.userId, userId),
          inArray(schema.recipeImportJob.status, ["queued", "running"]),
        ),
      ),
    tx
      .select({ value: count() })
      .from(schema.recipeImportJob)
      .where(
        and(
          eq(schema.recipeImportJob.userId, userId),
          gte(schema.recipeImportJob.createdAt, dayStart),
        ),
      ),
  ]);
  if ((active?.value ?? 0) >= RECIPE_IMPORT_MAX_ACTIVE_JOBS) return "active";
  if ((today?.value ?? 0) >= RECIPE_IMPORT_DAILY_JOB_LIMIT) return "daily";
  return undefined;
}

function actorMatches(
  row: typeof schema.agentMutationChangeSet.$inferSelect,
  session: AgentSession,
) {
  return (
    row.actorType === "agent" &&
    row.actorUserId === session.user.id &&
    row.actorAgentId === session.agent.id &&
    row.actorHostId === session.agent.hostId
  );
}

async function reserveJob(
  db: Db,
  session: AgentSession,
  input: { imageUrls: string[]; idempotencyKey: string; reason: string },
) {
  const fingerprintBytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify([input.reason, input.imageUrls])),
  );
  const fingerprint = Array.from(new Uint8Array(fingerprintBytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return db.transaction(async (tx) => {
    await tx
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.id, session.user.id))
      .for("update");
    const existing = await replayedJob(
      tx,
      session,
      input.idempotencyKey,
      fingerprint,
    );
    if (existing) return { job: existing, replayed: true as const };
    const quotaReason = await recipeImportQuotaReason(tx, session.user.id);
    if (quotaReason === "active") {
      throw new Error("Too many imports in progress");
    }
    if (quotaReason === "daily") throw new Error("Daily import limit reached");
    const [job] = await tx
      .insert(schema.recipeImportJob)
      .values({
        userId: session.user.id,
        imageCount: input.imageUrls.length,
      })
      .returning();
    if (!job) throw new Error("Recipe import job insert returned no row");
    await insertMutationChangeSet(tx, {
      id: crypto.randomUUID(),
      actor: {
        type: "agent",
        userId: session.user.id,
        agentId: session.agent.id,
        agentName: session.agent.name,
        hostId: session.agent.hostId,
      },
      capability: "recipe_import.create",
      targetType: "recipe_import",
      targetId: job.id,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      commandFingerprint: fingerprint,
    });
    return { job, replayed: false as const };
  });
}

export async function createAgentRecipeImport(
  db: Db,
  services: AgentRecipeImportServices,
  session: AgentSession,
  input: { imageUrls: string[]; idempotencyKey: string; reason: string },
) {
  if (!services.artifacts || !services.workflow) throw new Error("Recipe import is not configured");
  const artifacts = services.artifacts;
  const workflow = services.workflow;
  if (
    input.imageUrls.length < 1 ||
    input.imageUrls.length > RECIPE_IMPORT_MAX_IMAGES
  ) {
    throw new Error("Provide between 1 and 6 image URLs");
  }
  for (const url of input.imageUrls) validateRecipeUrl(url);
  const reserved = await reserveJob(db, session, input);
  if (reserved.replayed) {
    return { import: agentImportJobResponse(reserved.job), replayed: true };
  }
  try {
    const images: Awaited<ReturnType<typeof fetchImage>>[] = [];
    let totalBytes = 0;
    for (const url of input.imageUrls) {
      const image = await fetchImage(url, services.fetcher ?? fetch);
      totalBytes += image.file.size;
      if (totalBytes > RECIPE_IMPORT_MAX_TOTAL_BYTES) {
        throw new Error("Images must total 30MB or less");
      }
      images.push(image);
    }
    await Promise.all(
      images.map(({ file, extension }, index) =>
        artifacts.put(
          sourceImageKey(reserved.job.id, index, extension),
          file,
          { httpMetadata: { contentType: file.type } },
        ),
      ),
    );
    await workflow.create({
      id: reserved.job.id,
      params: { jobId: reserved.job.id },
    });
  } catch {
    await artifacts
      .list({ prefix: importJobPrefix(reserved.job.id) })
      .then((listed) =>
        Promise.all(
          listed.objects.map((object) =>
            artifacts.delete(object.key),
          ),
        ),
      )
      .catch(() => undefined);
    await db
      .update(schema.recipeImportJob)
      .set({
        status: "failed",
        progressLabel: "Import failed",
        errorType: "StartError",
        errorMessage: "Failed to start the import",
        finishedAt: new Date(),
      })
      .where(eq(schema.recipeImportJob.id, reserved.job.id));
    throw new Error("Failed to start the import");
  }
  return { import: agentImportJobResponse(reserved.job), replayed: false };
}

export async function readAgentRecipeImportStatus(
  db: Db,
  userId: string,
  input: { jobId?: string; limit: number },
) {
  const query = db.select().from(schema.recipeImportJob);
  const jobs = input.jobId
    ? await query
        .where(
          and(
            eq(schema.recipeImportJob.userId, userId),
            eq(schema.recipeImportJob.id, input.jobId),
          ),
        )
        .limit(1)
    : await query
        .where(eq(schema.recipeImportJob.userId, userId))
        .orderBy(desc(schema.recipeImportJob.createdAt))
        .limit(input.limit);
  return { imports: jobs.map(agentImportJobResponse) };
}
