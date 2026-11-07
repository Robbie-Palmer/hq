import {
  currentEnvelopeVersion,
  purgeAndVerifyObject,
  validateEncryptedEnvelopeMetadata,
  type EncryptedEnvelopeMetadata as SharedEncryptedEnvelopeMetadata,
  type ObjectBucket,
  type ObjectLifecycleRule,
} from "object-storage";

export {
  ciphertextAlgorithm,
  currentEnvelopeVersion,
  keyWrapAlgorithm,
} from "object-storage";

export const encryptedContentClasses = [
  "raw_mime",
  "attachment",
  "retained_document",
  "evaluation_sample",
  "export_bundle",
  "temporary_work",
] as const;

export type EncryptedContentClass = (typeof encryptedContentClasses)[number];

const objectRoot = "inbox-signal/v1";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type EncryptedObjectIdentity = {
  accountId: string;
  objectId: string;
  objectVersion: number;
  contentClass: EncryptedContentClass;
};

export type EncryptedEnvelopeMetadata = EncryptedObjectIdentity &
  SharedEncryptedEnvelopeMetadata;

export type LifecycleRule = ObjectLifecycleRule;
export type EncryptedObjectBucket = ObjectBucket;

export const lifecycleRules = [
  {
    prefix: `${objectRoot}/evaluation_sample/`,
    expirationDays: 180,
  },
  {
    prefix: `${objectRoot}/export_bundle/`,
    expirationDays: 1,
  },
  {
    prefix: `${objectRoot}/temporary_work/`,
    expirationDays: 1,
  },
] as const satisfies readonly LifecycleRule[];

function assertUuid(name: string, value: string): void {
  if (!uuidPattern.test(value)) {
    throw new Error(`${name} must be an opaque UUID`);
  }
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function isContentClass(value: unknown): value is EncryptedContentClass {
  return (
    typeof value === "string" &&
    encryptedContentClasses.includes(value as EncryptedContentClass)
  );
}

export function encryptedObjectKey(identity: EncryptedObjectIdentity): string {
  assertUuid("accountId", identity.accountId);
  assertUuid("objectId", identity.objectId);
  assertPositiveInteger("objectVersion", identity.objectVersion);
  if (!isContentClass(identity.contentClass)) {
    throw new Error("contentClass is not supported");
  }
  const version = identity.objectVersion.toString().padStart(8, "0");
  return `${objectRoot}/${identity.contentClass}/accounts/${identity.accountId}/objects/${identity.objectId}/${version}.enc`;
}

export function encryptionAdditionalData(
  identity: EncryptedObjectIdentity,
  envelopeVersion = currentEnvelopeVersion,
): string {
  encryptedObjectKey(identity);
  assertPositiveInteger("envelopeVersion", envelopeVersion);
  return [
    "inbox-signal",
    `envelope-v${envelopeVersion}`,
    identity.accountId,
    identity.objectId,
    `object-v${identity.objectVersion}`,
    identity.contentClass,
  ].join(":");
}

export function retentionDays(
  contentClass: EncryptedContentClass,
): number | null {
  switch (contentClass) {
    case "raw_mime":
    case "attachment":
    case "retained_document":
      return null;
    case "evaluation_sample":
      return 180;
    case "export_bundle":
    case "temporary_work":
      return 1;
  }
}

export function expiresAt(
  contentClass: EncryptedContentClass,
  createdAt: Date,
): Date | null {
  const days = retentionDays(contentClass);
  if (days === null) return null;
  return new Date(createdAt.getTime() + days * 24 * 60 * 60 * 1_000);
}

export function validateEnvelopeMetadata(
  value: unknown,
): asserts value is EncryptedEnvelopeMetadata {
  validateEncryptedEnvelopeMetadata(value);
  const metadata = value as SharedEncryptedEnvelopeMetadata &
    Record<string, unknown>;
  if (typeof metadata.accountId !== "string") {
    throw new TypeError("accountId must be an opaque UUID");
  }
  if (typeof metadata.objectId !== "string") {
    throw new TypeError("objectId must be an opaque UUID");
  }
  if (typeof metadata.objectVersion !== "number") {
    throw new TypeError("objectVersion must be a positive integer");
  }
  assertUuid("accountId", metadata.accountId);
  assertUuid("objectId", metadata.objectId);
  assertPositiveInteger("objectVersion", metadata.objectVersion);
  if (!isContentClass(metadata.contentClass)) {
    throw new Error("contentClass is not supported");
  }
}

export async function purgeAndVerifyEncryptedObject(
  bucket: EncryptedObjectBucket,
  key: string,
): Promise<void> {
  await purgeAndVerifyObject(bucket, key, `${objectRoot}/`);
}
