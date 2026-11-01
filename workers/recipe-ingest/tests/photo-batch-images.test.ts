import {
  photoJobSourceManifestKey,
  type PhotoJobSourceManifest,
} from "recipe-domain/photo-batch";
import { sha256Hex } from "ts-base/crypto";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import {
  loadImageDataUrls,
  readPhotoJobSourceManifest,
} from "../src/images";

const jobId = "00000000-0000-4000-8000-000000000100";
const firstKey = "imports/batches/batch/images/first.png";
const secondKey = "imports/batches/batch/images/second.png";
const first = new Uint8Array([1, 2, 3]);
const second = new Uint8Array([4, 5, 6]);

async function fixture() {
  const manifest: PhotoJobSourceManifest = {
    schemaVersion: 1,
    batchId: "00000000-0000-4000-8000-000000000010",
    manifestVersion: 2,
    manifestChecksum: "a".repeat(64),
    groupPosition: 1,
    groupChecksum: "b".repeat(64),
    images: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        r2Key: firstKey,
        checksum: await sha256Hex(first),
        contentType: "image/png",
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        r2Key: secondKey,
        checksum: await sha256Hex(second),
        contentType: "image/png",
      },
    ],
  };
  const body = JSON.stringify(manifest);
  const values = new Map<string, { bytes?: Uint8Array; text?: string }>([
    [photoJobSourceManifestKey(jobId), { text: body }],
    [firstKey, { bytes: first }],
    [secondKey, { bytes: second }],
  ]);
  const get = vi.fn(async (key: string) => {
    const value = values.get(key);
    if (!value) return null;
    return {
      text: async () => value.text ?? "",
      arrayBuffer: async () => (value.bytes ?? new Uint8Array()).buffer,
      httpMetadata: { contentType: "image/png" },
    };
  });
  return {
    body,
    manifest,
    values,
    env: { ARTIFACTS: { get } } as unknown as Env,
  };
}

describe("photo batch image sources", () => {
  it("loads the confirmed page order and verifies every immutable checksum", async () => {
    const value = await fixture();
    const manifest = await readPhotoJobSourceManifest(
      value.env,
      jobId,
      await sha256Hex(value.body),
    );
    const urls = await loadImageDataUrls(
      value.env,
      manifest.images.map((image) => image.r2Key),
      new Map(manifest.images.map((image) => [image.r2Key, image.checksum])),
    );

    expect(manifest.images.map((image) => image.r2Key)).toEqual([
      firstKey,
      secondKey,
    ]);
    expect(urls).toEqual([
      "data:image/png;base64,AQID",
      "data:image/png;base64,BAUG",
    ]);
  });

  it("rejects changed manifests and changed image bytes", async () => {
    const value = await fixture();
    await expect(
      readPhotoJobSourceManifest(value.env, jobId, "0".repeat(64)),
    ).rejects.toThrow("manifest checksum");
    const firstImage = value.manifest.images.at(0);
    if (!firstImage) throw new Error("Missing first image fixture");
    value.values.set(firstKey, { bytes: new Uint8Array([9, 9, 9]) });
    await expect(
      loadImageDataUrls(
        value.env,
        [firstKey],
        new Map([[firstKey, firstImage.checksum]]),
      ),
    ).rejects.toThrow("Source image checksum");
  });
});
