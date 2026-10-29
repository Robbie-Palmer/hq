import { describe, expect, it, vi } from "vitest";
import {
  encryptionAdditionalData,
  encryptedObjectKey,
  expiresAt,
  lifecycleRules,
  purgeAndVerifyEncryptedObject,
  retentionDays,
  validateEnvelopeMetadata,
  type EncryptedEnvelopeMetadata,
  type EncryptedObjectBucket,
} from "../src/object-storage";

const accountId = "018f3118-8cba-7c21-a411-4a7b76f3e652";
const objectId = "018f3118-a1a8-7d8c-aeb1-804a29ae17af";

function metadata(): EncryptedEnvelopeMetadata {
  return {
    accountId,
    objectId,
    objectVersion: 3,
    contentClass: "raw_mime",
    envelopeVersion: 1,
    ciphertextAlgorithm: "AES-256-GCM",
    keyWrapAlgorithm: "AES-256-KW",
    keyVersion: "mail-archive-kek-v1",
    nonceBase64: "AAECAwQFBgcICQoL",
    wrappedDataKeyBase64:
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
  };
}

describe("encrypted object layout", () => {
  it("uses opaque account and object IDs in a versioned class prefix", () => {
    expect(
      encryptedObjectKey({
        accountId,
        objectId,
        objectVersion: 3,
        contentClass: "raw_mime",
      }),
    ).toBe(
      `inbox-signal/v1/raw_mime/accounts/${accountId}/objects/${objectId}/00000003.enc`,
    );
    expect(
      encryptionAdditionalData({
        accountId,
        objectId,
        objectVersion: 3,
        contentClass: "raw_mime",
      }),
    ).toBe(
      `inbox-signal:envelope-v1:${accountId}:${objectId}:object-v3:raw_mime`,
    );
  });

  it("rejects identifiers that could leak provider or mailbox data", () => {
    expect(() =>
      encryptedObjectKey({
        accountId: "person@example.com",
        objectId,
        objectVersion: 1,
        contentClass: "attachment",
      }),
    ).toThrow("accountId must be an opaque UUID");
  });

  it("retains archive content indefinitely and expires isolated work areas", () => {
    expect(retentionDays("raw_mime")).toBeNull();
    expect(retentionDays("attachment")).toBeNull();
    expect(retentionDays("retained_document")).toBeNull();
    expect(expiresAt("raw_mime", new Date("2026-01-01T00:00:00Z"))).toBeNull();
    expect(expiresAt("evaluation_sample", new Date("2026-01-01T00:00:00Z"))).toEqual(
      new Date("2026-06-30T00:00:00Z"),
    );
    expect(lifecycleRules).toEqual([
      {
        prefix: "inbox-signal/v1/evaluation_sample/",
        expirationDays: 180,
      },
      {
        prefix: "inbox-signal/v1/export_bundle/",
        expirationDays: 1,
      },
      {
        prefix: "inbox-signal/v1/temporary_work/",
        expirationDays: 1,
      },
    ]);
  });

  it("validates the versioned AES-GCM envelope", () => {
    expect(() => validateEnvelopeMetadata(metadata())).not.toThrow();
    expect(() =>
      validateEnvelopeMetadata({
        ...metadata(),
        accountId: { mailbox: "person@example.com" },
      }),
    ).toThrow("accountId must be an opaque UUID");
    expect(() =>
      validateEnvelopeMetadata({
        ...metadata(),
        nonceBase64: "too-short",
      }),
    ).toThrow("96-bit AES-GCM nonce");
    expect(() =>
      validateEnvelopeMetadata({
        ...metadata(),
        ciphertextAlgorithm: "AES-128-GCM",
      }),
    ).toThrow("ciphertextAlgorithm must be AES-256-GCM");
  });

  it("rejects malformed envelope identity fields", () => {
    expect(() => validateEnvelopeMetadata(null)).toThrow(
      "envelope metadata must be an object",
    );
    expect(() =>
      validateEnvelopeMetadata({ ...metadata(), objectId: {} }),
    ).toThrow("objectId must be an opaque UUID");
    expect(() =>
      validateEnvelopeMetadata({ ...metadata(), objectVersion: "3" }),
    ).toThrow("objectVersion must be a positive integer");
    expect(() =>
      validateEnvelopeMetadata({ ...metadata(), envelopeVersion: "1" }),
    ).toThrow("envelopeVersion must be a positive integer");
    expect(() =>
      validateEnvelopeMetadata({ ...metadata(), contentClass: "plaintext" }),
    ).toThrow("contentClass is not supported");
  });

  it("rejects unsupported or incomplete encryption metadata", () => {
    expect(() =>
      validateEnvelopeMetadata({
        ...metadata(),
        keyWrapAlgorithm: "RSA-OAEP",
      }),
    ).toThrow("keyWrapAlgorithm must be AES-256-KW");
    expect(() =>
      validateEnvelopeMetadata({ ...metadata(), keyVersion: " " }),
    ).toThrow("keyVersion must not be blank");
    expect(() =>
      validateEnvelopeMetadata({ ...metadata(), wrappedDataKeyBase64: "%" }),
    ).toThrow("wrappedDataKeyBase64 must contain valid base64");
  });
});

describe("encrypted object purge verification", () => {
  const key = encryptedObjectKey({
    accountId,
    objectId,
    objectVersion: 1,
    contentClass: "raw_mime",
  });

  it("verifies both direct lookup and prefix listing after deletion", async () => {
    const bucket: EncryptedObjectBucket = {
      delete: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
      list: vi.fn().mockResolvedValue({ objects: [], truncated: false }),
    };

    await expect(purgeAndVerifyEncryptedObject(bucket, key)).resolves.toBeUndefined();
    expect(bucket.delete).toHaveBeenCalledWith(key);
    expect(bucket.get).toHaveBeenCalledWith(key);
    expect(bucket.list).toHaveBeenCalledWith({ prefix: key });
  });

  it("fails closed when either deletion check still finds the object", async () => {
    const bucket: EncryptedObjectBucket = {
      delete: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
      list: vi.fn().mockResolvedValue({
        objects: [{ key }],
        truncated: false,
      }),
    };

    await expect(purgeAndVerifyEncryptedObject(bucket, key)).rejects.toThrow(
      "purge could not be verified",
    );
  });
});
