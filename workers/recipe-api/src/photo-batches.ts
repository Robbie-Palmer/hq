import { and, count, desc, eq, gte, inArray, max } from "drizzle-orm";
import type { Db } from "recipe-db";
import {
  recipeImportBatch as batches,
  recipeImportJob as jobs,
  recipeImportPhotoGroup as groups,
  recipeImportPhotoGroupImage as groupImages,
  recipeImportPhotoImage as images,
  recipeImportPhotoManifest as manifests,
  recipeImportReviewEvent as reviewEvents,
  user,
} from "recipe-db/schema";
import {
  type ConfirmPhotoBatchManifest,
  photoBatchImageKey,
  photoJobSourceManifestKey,
  PhotoJobSourceManifestSchema,
  RECIPE_PHOTO_MANIFEST_SCHEMA_VERSION,
} from "recipe-domain/photo-batch";
import type { RecipeVisibility } from "recipe-domain/visibility";
import { sha256Hex } from "ts-base/crypto";
import { BatchImportError } from "./batch-import-error";

export type PreparedPhotoBatchImage = {
  file: File;
  extension: string;
  checksum: string;
};

type PhotoBatchImageRow = typeof images.$inferSelect;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type PreparedPhotoGroup = ConfirmPhotoBatchManifest["groups"][number] & {
  position: number;
  checksum: string;
};
type ResolvedPhotoGroup = PreparedPhotoGroup & {
  id: string;
  jobId: string;
};

export async function createPhotoBatch(
  db: Db,
  artifacts: R2Bucket,
  userId: string,
  input: {
    idempotencyKey: string;
    visibility: RecipeVisibility;
    duplicatePolicy: "skip" | "allow";
    images: PreparedPhotoBatchImage[];
  },
) {
  const fingerprint = await sha256Hex(
    JSON.stringify([
      input.images.map(({ file, checksum }) => [
        file.name,
        file.type,
        file.size,
        checksum,
      ]),
      input.visibility,
      input.duplicatePolicy,
    ]),
  );
  const batchId = crypto.randomUUID();
  const prepared = input.images.map((image, position) => {
    const id = crypto.randomUUID();
    return {
      ...image,
      id,
      position,
      r2Key: photoBatchImageKey(batchId, id, image.extension),
    };
  });
  const uploadedKeys: string[] = [];
  try {
    return await db.transaction(async (tx) => {
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
        if (existing.kind !== "photo" || existing.fingerprint !== fingerprint)
          throw new BatchImportError(
            "Submission key was used for a different photo batch",
            409,
          );
        return existing;
      }
      const [batch] = await tx
        .insert(batches)
        .values({
          id: batchId,
          userId,
          kind: "photo",
          idempotencyKey: input.idempotencyKey,
          fingerprint,
          visibility: input.visibility,
          duplicatePolicy: input.duplicatePolicy,
        })
        .returning();
      if (!batch) throw new Error("Photo batch insert returned no row");
      const uploads = await Promise.allSettled(
        prepared.map(async (image) => {
          await artifacts.put(image.r2Key, image.file, {
            httpMetadata: { contentType: image.file.type },
          });
          uploadedKeys.push(image.r2Key);
        }),
      );
      const failedUpload = uploads.find((upload) => upload.status === "rejected");
      if (failedUpload?.status === "rejected") throw failedUpload.reason;
      await tx.insert(images).values(
        prepared.map((image) => ({
          id: image.id,
          batchId,
          position: image.position,
          filename: image.file.name,
          contentType: image.file.type,
          byteSize: image.file.size,
          r2Key: image.r2Key,
          checksum: image.checksum,
        })),
      );
      return batch;
    });
  } catch (error) {
    await Promise.all(
      uploadedKeys.map((key) => artifacts.delete(key).catch(() => undefined)),
    );
    throw error;
  }
}

async function latestManifest(db: Pick<Db, "select"> | Tx, batchId: string) {
  const [manifest] = await db
    .select()
    .from(manifests)
    .where(eq(manifests.batchId, batchId))
    .orderBy(desc(manifests.version))
    .limit(1);
  return manifest;
}

export async function readPhotoBatchProjection(
  db: Pick<Db, "select"> | Tx,
  batchId: string,
) {
  const photoImages = await db
    .select({
      id: images.id,
      filename: images.filename,
      contentType: images.contentType,
      byteSize: images.byteSize,
      position: images.position,
    })
    .from(images)
    .where(eq(images.batchId, batchId))
    .orderBy(images.position);
  const manifest = await latestManifest(db, batchId);
  if (!manifest) {
    return {
      photoImages,
      photoManifest: null,
      jobIds: [] as string[],
    };
  }
  const groupRows = await db
    .select()
    .from(groups)
    .where(eq(groups.manifestId, manifest.id))
    .orderBy(groups.position);
  const memberRows = groupRows.length
    ? await db
        .select()
        .from(groupImages)
        .where(
          inArray(
            groupImages.groupId,
            groupRows.map((group) => group.id),
          ),
        )
        .orderBy(groupImages.position)
    : [];
  const membersByGroup = new Map<string, string[]>();
  for (const member of memberRows) {
    const values = membersByGroup.get(member.groupId) ?? [];
    values.push(member.imageId);
    membersByGroup.set(member.groupId, values);
  }
  return {
    photoImages,
    photoManifest: {
      version: manifest.version,
      checksum: manifest.checksum,
      confirmedAt: manifest.confirmedAt,
      groups: groupRows.map((group) => ({
        position: group.position,
        title: group.title ?? undefined,
        jobId: group.jobId,
        imageIds: membersByGroup.get(group.id) ?? [],
      })),
    },
    jobIds: groupRows.map((group) => group.jobId),
  };
}

function assertExactImageMembership(
  uploaded: PhotoBatchImageRow[],
  input: ConfirmPhotoBatchManifest,
) {
  const expected = new Set(uploaded.map((image) => image.id));
  const received = input.groups.flatMap((group) => group.imageIds);
  if (
    received.length !== expected.size ||
    received.some((imageId) => !expected.has(imageId))
  ) {
    throw new BatchImportError(
      "Every uploaded image must appear exactly once in the manifest",
      409,
    );
  }
}

async function photoJobsCreatedToday(tx: Tx, userId: string) {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const [result] = await tx
    .select({ value: count() })
    .from(jobs)
    .where(
      and(
        eq(jobs.userId, userId),
        eq(jobs.sourceType, "photo"),
        gte(jobs.createdAt, dayStart),
      ),
    );
  return result?.value ?? 0;
}

async function currentPhotoGroups(tx: Tx, manifestId: string) {
  return tx
    .select({ group: groups, job: jobs })
    .from(groups)
    .innerJoin(jobs, eq(groups.jobId, jobs.id))
    .where(eq(groups.manifestId, manifestId))
    .orderBy(groups.position);
}

function assertRegroupAllowed(
  previousGroups: Awaited<ReturnType<typeof currentPhotoGroups>>,
  preparedGroups: PreparedPhotoGroup[],
) {
  if (
    previousGroups.some(({ job }) =>
      ["queued", "running"].includes(job.status),
    )
  ) {
    throw new BatchImportError(
      "Wait for running photo groups before changing the manifest",
      409,
    );
  }
  const nextChecksums = new Set(preparedGroups.map((group) => group.checksum));
  for (const { group, job } of previousGroups) {
    if (job.status === "succeeded" && !nextChecksums.has(group.checksum)) {
      throw new BatchImportError(
        "Successful photo groups must stay unchanged when regrouping failures",
        409,
      );
    }
  }
}

async function preparePhotoManifestConfirmation(
  tx: Tx,
  userId: string,
  batchId: string,
  input: ConfirmPhotoBatchManifest,
  requestFingerprint: string,
) {
  const [batch] = await tx
    .select()
    .from(batches)
    .where(and(eq(batches.id, batchId), eq(batches.userId, userId)))
    .for("update");
  if (batch?.kind !== "photo")
    throw new BatchImportError("Photo batch not found", 404);
  if (batch.undoStartedAt)
    throw new BatchImportError("This batch is being undone", 409);

  const [replay] = await tx
    .select()
    .from(manifests)
    .where(
      and(
        eq(manifests.batchId, batchId),
        eq(manifests.idempotencyKey, input.idempotencyKey),
      ),
    );
  if (replay) {
    if (replay.requestFingerprint !== requestFingerprint) {
      throw new BatchImportError(
        "Manifest key was used for different grouping",
        409,
      );
    }
    return { replay } as const;
  }

  const previous = await latestManifest(tx, batchId);
  const previousVersion = previous?.version ?? 0;
  if (previousVersion !== input.expectedVersion) {
    throw new BatchImportError(
      "The grouping changed. Reload it before confirming.",
      409,
    );
  }
  const uploaded = await tx
    .select()
    .from(images)
    .where(eq(images.batchId, batchId))
    .orderBy(images.position);
  assertExactImageMembership(uploaded, input);
  const nextVersion = previousVersion + 1;
  const preparedGroups = await Promise.all(
    input.groups.map(async (group, position) => ({
      ...group,
      position,
      checksum: await sha256Hex(JSON.stringify(group.imageIds)),
    })),
  );
  const manifestChecksum = await sha256Hex(
    JSON.stringify({
      schemaVersion: RECIPE_PHOTO_MANIFEST_SCHEMA_VERSION,
      version: nextVersion,
      groups: preparedGroups.map(({ title, imageIds }) => ({
        title,
        imageIds,
      })),
    }),
  );
  const previousGroups = previous
    ? await currentPhotoGroups(tx, previous.id)
    : [];
  assertRegroupAllowed(previousGroups, preparedGroups);
  return {
    replay: null,
    uploaded,
    nextVersion,
    preparedGroups,
    manifestChecksum,
    previousGroups,
  } as const;
}

async function createPhotoJobs(
  tx: Tx,
  artifacts: R2Bucket,
  input: {
    userId: string;
    batchId: string;
    nextVersion: number;
    manifestChecksum: string;
    preparedGroups: PreparedPhotoGroup[];
    uploaded: PhotoBatchImageRow[];
    previousGroups: Awaited<ReturnType<typeof currentPhotoGroups>>;
    writtenSourceKeys: string[];
  },
): Promise<ResolvedPhotoGroup[]> {
  const reusable = new Map(
    input.previousGroups.map(({ group, job }) => [group.checksum, job]),
  );
  const newGroupCount = input.preparedGroups.filter(
    (group) => !reusable.has(group.checksum),
  ).length;
  if ((await photoJobsCreatedToday(tx, input.userId)) + newGroupCount > 10)
    throw new BatchImportError("Daily import limit reached", 429);

  const [positionResult] = await tx
    .select({ value: max(jobs.position) })
    .from(jobs)
    .where(eq(jobs.batchId, input.batchId));
  let nextJobPosition = (positionResult?.value ?? -1) + 1;
  const imageById = new Map(input.uploaded.map((image) => [image.id, image]));
  const resolvedGroups: ResolvedPhotoGroup[] = [];
  for (const group of input.preparedGroups) {
    const existingJob = reusable.get(group.checksum);
    let jobId = existingJob?.id;
    if (!jobId) {
      jobId = crypto.randomUUID();
      const source = PhotoJobSourceManifestSchema.parse({
        schemaVersion: RECIPE_PHOTO_MANIFEST_SCHEMA_VERSION,
        batchId: input.batchId,
        manifestVersion: input.nextVersion,
        manifestChecksum: input.manifestChecksum,
        groupPosition: group.position,
        groupChecksum: group.checksum,
        images: group.imageIds.map((imageId) => {
          const image = imageById.get(imageId);
          if (!image) throw new Error("Manifest image disappeared");
          return {
            id: image.id,
            r2Key: image.r2Key,
            checksum: image.checksum,
            contentType: image.contentType,
          };
        }),
      });
      const sourceBody = JSON.stringify(source);
      const sourceKey = photoJobSourceManifestKey(jobId);
      await artifacts.put(sourceKey, sourceBody, {
        httpMetadata: { contentType: "application/json" },
      });
      input.writtenSourceKeys.push(sourceKey);
      await tx.insert(jobs).values({
        id: jobId,
        userId: input.userId,
        batchId: input.batchId,
        position: nextJobPosition++,
        sourceType: "photo",
        sourceLabel: group.title || `Photo recipe ${group.position + 1}`,
        sourceChecksum: await sha256Hex(sourceBody),
        photoGroupChecksum: group.checksum,
        photoManifestVersion: input.nextVersion,
        imageCount: group.imageIds.length,
      });
    }
    resolvedGroups.push({ ...group, id: crypto.randomUUID(), jobId });
  }
  return resolvedGroups;
}

async function retireReplacedPhotoJobs(
  tx: Tx,
  previousGroups: Awaited<ReturnType<typeof currentPhotoGroups>>,
  resolvedGroups: ResolvedPhotoGroup[],
) {
  const retainedJobs = new Set(resolvedGroups.map((group) => group.jobId));
  const retired = previousGroups.filter(
    ({ job }) => !retainedJobs.has(job.id) && job.status !== "succeeded",
  );
  if (!retired.length) return;
  await tx
    .update(jobs)
    .set({ reviewState: "skipped" })
    .where(
      inArray(
        jobs.id,
        retired.map(({ job }) => job.id),
      ),
    );
  await tx.insert(reviewEvents).values(
    retired.map(({ job }) => ({
      jobId: job.id,
      action: "regroup",
      draftVersion: job.draftVersion,
    })),
  );
}

export async function confirmPhotoManifest(
  db: Db,
  artifacts: R2Bucket,
  userId: string,
  batchId: string,
  input: ConfirmPhotoBatchManifest,
) {
  const requestFingerprint = await sha256Hex(
    JSON.stringify([input.expectedVersion, input.groups]),
  );
  const writtenSourceKeys: string[] = [];
  try {
    return await db.transaction(async (tx) => {
      const prepared = await preparePhotoManifestConfirmation(
        tx,
        userId,
        batchId,
        input,
        requestFingerprint,
      );
      if (prepared.replay) return prepared.replay;
      const manifestId = crypto.randomUUID();
      await tx.insert(manifests).values({
        id: manifestId,
        batchId,
        version: prepared.nextVersion,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint,
        checksum: prepared.manifestChecksum,
      });
      const resolvedGroups = await createPhotoJobs(tx, artifacts, {
        userId,
        batchId,
        nextVersion: prepared.nextVersion,
        manifestChecksum: prepared.manifestChecksum,
        preparedGroups: prepared.preparedGroups,
        uploaded: prepared.uploaded,
        previousGroups: prepared.previousGroups,
        writtenSourceKeys,
      });
      await tx.insert(groups).values(
        resolvedGroups.map((group) => ({
          id: group.id,
          manifestId,
          jobId: group.jobId,
          position: group.position,
          title: group.title,
          checksum: group.checksum,
        })),
      );
      await tx.insert(groupImages).values(
        resolvedGroups.flatMap((group) =>
          group.imageIds.map((imageId, position) => ({
            manifestId,
            groupId: group.id,
            imageId,
            position,
          })),
        ),
      );
      await retireReplacedPhotoJobs(
        tx,
        prepared.previousGroups,
        resolvedGroups,
      );
      const manifest = await latestManifest(tx, batchId);
      if (!manifest) throw new Error("Photo manifest insert returned no row");
      return manifest;
    });
  } catch (error) {
    await Promise.all(
      writtenSourceKeys.map((key) => artifacts.delete(key).catch(() => undefined)),
    );
    throw error;
  }
}

export async function readPhotoImage(
  db: Db,
  artifacts: R2Bucket,
  userId: string,
  batchId: string,
  imageId: string,
) {
  const [image] = await db
    .select({ image: images })
    .from(images)
    .innerJoin(batches, eq(images.batchId, batches.id))
    .where(
      and(
        eq(images.id, imageId),
        eq(images.batchId, batchId),
        eq(batches.userId, userId),
      ),
    );
  if (!image) throw new BatchImportError("Photo not found", 404);
  const object = await artifacts.get(image.image.r2Key);
  if (!object) throw new BatchImportError("Photo source is unavailable", 404);
  return { image: image.image, object };
}
