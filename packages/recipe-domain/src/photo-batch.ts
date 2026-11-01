import { z } from "zod";

export const RECIPE_PHOTO_BATCH_MAX_IMAGES = 30;
export const RECIPE_PHOTO_MANIFEST_SCHEMA_VERSION = 1;

export const PhotoBatchGroupSchema = z.object({
  title: z.string().trim().max(120).optional(),
  imageIds: z.array(z.uuid().max(36)).min(1).max(6),
});

export const ConfirmPhotoBatchManifestSchema = z
  .object({
    idempotencyKey: z.uuid().max(36),
    expectedVersion: z
      .number()
      .int()
      .min(0)
      .max(2_147_483_647)
      .meta({ format: "int32" }),
    groups: z.array(PhotoBatchGroupSchema).min(1).max(RECIPE_PHOTO_BATCH_MAX_IMAGES),
  })
  .superRefine((input, context) => {
    const seen = new Set<string>();
    input.groups.forEach((group, groupIndex) => {
      group.imageIds.forEach((imageId, imageIndex) => {
        if (seen.has(imageId)) {
          context.addIssue({
            code: "custom",
            path: ["groups", groupIndex, "imageIds", imageIndex],
            message: "Each image must appear exactly once",
          });
        }
        seen.add(imageId);
      });
    });
  });

export const PhotoJobSourceManifestSchema = z.object({
  schemaVersion: z.literal(RECIPE_PHOTO_MANIFEST_SCHEMA_VERSION),
  batchId: z.uuid(),
  manifestVersion: z.number().int().min(1),
  manifestChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  groupPosition: z.number().int().min(0),
  groupChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  images: z
    .array(
      z.object({
        id: z.uuid(),
        r2Key: z.string().min(1).max(1024),
        checksum: z.string().regex(/^[a-f0-9]{64}$/),
        contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      }),
    )
    .min(1)
    .max(6),
});

export type ConfirmPhotoBatchManifest = z.infer<
  typeof ConfirmPhotoBatchManifestSchema
>;
export type PhotoJobSourceManifest = z.infer<
  typeof PhotoJobSourceManifestSchema
>;

export function photoBatchImageKey(
  batchId: string,
  imageId: string,
  extension: string,
): string {
  return `imports/batches/${batchId}/images/${imageId}.${extension}`;
}

export function photoJobSourceManifestKey(jobId: string): string {
  return `imports/${jobId}/source/photo-group-manifest.json`;
}
