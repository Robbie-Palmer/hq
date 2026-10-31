import { describe, expect, it, vi } from "vitest";
import {
  purgeAndVerifyObject,
  validateEncryptedEnvelopeMetadata,
  type EncryptedEnvelopeMetadata,
  type ObjectBucket,
} from "../src/index";

const metadata: EncryptedEnvelopeMetadata = {
  envelopeVersion: 1,
  ciphertextAlgorithm: "AES-256-GCM",
  keyWrapAlgorithm: "AES-256-KW",
  keyVersion: "archive-kek-v1",
  nonceBase64: "AAECAwQFBgcICQoL",
  wrappedDataKeyBase64:
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
};

describe("encrypted envelope metadata", () => {
  it("accepts the versioned AES-GCM and AES-KW contract", () => {
    expect(() => validateEncryptedEnvelopeMetadata(metadata)).not.toThrow();
  });

  it.each([
    [null, "encrypted envelope metadata must be an object"],
    [{ ...metadata, envelopeVersion: "1" }, "positive integer"],
    [{ ...metadata, envelopeVersion: 0 }, "positive integer"],
    [{ ...metadata, ciphertextAlgorithm: "AES-128-GCM" }, "AES-256-GCM"],
    [{ ...metadata, keyWrapAlgorithm: "RSA-OAEP" }, "AES-256-KW"],
    [{ ...metadata, keyVersion: 4 }, "keyVersion must be a string"],
    [{ ...metadata, keyVersion: " " }, "keyVersion must not be blank"],
    [{ ...metadata, nonceBase64: 4 }, "nonceBase64 must be a string"],
    [{ ...metadata, nonceBase64: "too-short" }, "96-bit AES-GCM nonce"],
    [
      { ...metadata, wrappedDataKeyBase64: 4 },
      "wrappedDataKeyBase64 must be a string",
    ],
    [
      { ...metadata, wrappedDataKeyBase64: "" },
      "wrappedDataKeyBase64 must contain valid base64",
    ],
    [
      { ...metadata, wrappedDataKeyBase64: "%" },
      "wrappedDataKeyBase64 must contain valid base64",
    ],
  ])("rejects invalid metadata %#", (value, message) => {
    expect(() => validateEncryptedEnvelopeMetadata(value)).toThrow(message);
  });
});

describe("object purge verification", () => {
  const key = "archive/v1/objects/018f3118.enc";

  it("deletes inside the allowed prefix and verifies both reads", async () => {
    const bucket: ObjectBucket = {
      delete: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
      list: vi
        .fn()
        .mockResolvedValueOnce({
          objects: [{ key: `${key}.other` }],
          truncated: true,
          cursor: "next-page",
        })
        .mockResolvedValueOnce({ objects: [], truncated: false }),
    };

    await expect(
      purgeAndVerifyObject(bucket, key, "archive/v1/"),
    ).resolves.toBeUndefined();
    expect(bucket.delete).toHaveBeenCalledWith(key);
    expect(bucket.get).toHaveBeenCalledWith(key);
    expect(bucket.list).toHaveBeenNthCalledWith(1, { prefix: key });
    expect(bucket.list).toHaveBeenNthCalledWith(2, {
      prefix: key,
      cursor: "next-page",
    });
  });

  it("refuses to delete outside the allowed prefix", async () => {
    const bucket = {} as ObjectBucket;
    await expect(purgeAndVerifyObject(bucket, key, "")).rejects.toThrow(
      "outside the allowed prefix",
    );
    await expect(
      purgeAndVerifyObject(bucket, key, "another-prefix/"),
    ).rejects.toThrow("outside the allowed prefix");
  });

  it("fails when a direct read or listing still finds the object", async () => {
    const directBucket: ObjectBucket = {
      delete: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue({}),
      list: vi.fn().mockResolvedValue({ objects: [], truncated: false }),
    };
    const listedBucket: ObjectBucket = {
      delete: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
      list: vi.fn().mockResolvedValue({
        objects: [{ key }],
        truncated: false,
      }),
    };

    await expect(
      purgeAndVerifyObject(directBucket, key, "archive/v1/"),
    ).rejects.toThrow("purge could not be verified");
    await expect(
      purgeAndVerifyObject(listedBucket, key, "archive/v1/"),
    ).rejects.toThrow("purge could not be verified");
  });

  it("fails closed when a truncated listing omits its cursor", async () => {
    const bucket: ObjectBucket = {
      delete: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
      list: vi.fn().mockResolvedValue({ objects: [], truncated: true }),
    };

    await expect(
      purgeAndVerifyObject(bucket, key, "archive/v1/"),
    ).rejects.toThrow("did not provide a cursor");
  });
});
