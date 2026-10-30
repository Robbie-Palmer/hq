import { describe, expect, it } from "vitest";
import { ConfirmPhotoBatchManifestSchema } from "../src/photo-batch";

const imageId = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;

describe("photo batch manifests", () => {
  it("preserves group and page order for groups of one to six images", () => {
    const input = {
      idempotencyKey: crypto.randomUUID(),
      expectedVersion: 0,
      groups: [
        { title: "Soup", imageIds: [imageId(2), imageId(1)] },
        { title: "Bread", imageIds: [imageId(3)] },
      ],
    };

    expect(ConfirmPhotoBatchManifestSchema.parse(input)).toEqual(input);
  });

  it("rejects duplicate membership and groups larger than six pages", () => {
    const base = {
      idempotencyKey: crypto.randomUUID(),
      expectedVersion: 1,
    };
    expect(
      ConfirmPhotoBatchManifestSchema.safeParse({
        ...base,
        groups: [
          { imageIds: [imageId(1)] },
          { imageIds: [imageId(1)] },
        ],
      }).success,
    ).toBe(false);
    expect(
      ConfirmPhotoBatchManifestSchema.safeParse({
        ...base,
        groups: [{ imageIds: Array.from({ length: 7 }, (_, index) => imageId(index)) }],
      }).success,
    ).toBe(false);
  });
});
