export const encryptedContentClasses = [
  "raw_mime",
  "attachment",
  "retained_document",
  "evaluation_sample",
  "export_bundle",
  "temporary_work",
] as const;

export type EncryptedContentClass = (typeof encryptedContentClasses)[number];

export const ciphertextAlgorithm = "AES-256-GCM" as const;
export const keyWrapAlgorithm = "AES-256-KW" as const;
export const currentEnvelopeVersion = 1 as const;

const objectRoot = "inbox-signal/v1";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const noncePattern = /^[A-Za-z0-9+/]{16}$/;
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export type EncryptedObjectIdentity = {
  accountId: string;
  objectId: string;
  objectVersion: number;
  contentClass: EncryptedContentClass;
};

export type EncryptedEnvelopeMetadata = EncryptedObjectIdentity & {
  envelopeVersion: number;
  ciphertextAlgorithm: typeof ciphertextAlgorithm;
  keyWrapAlgorithm: typeof keyWrapAlgorithm;
  keyVersion: string;
  nonceBase64: string;
  wrappedDataKeyBase64: string;
};

export type LifecycleRule = {
  prefix: string;
  expirationDays: number;
};

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

export interface EncryptedObjectBucket {
  delete(key: string): Promise<void>;
  get(key: string): Promise<object | null>;
  list(options: {
    prefix: string;
    cursor?: string;
  }): Promise<{
    objects: readonly { key: string }[];
    truncated: boolean;
    cursor?: string;
  }>;
}

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
  if (typeof value !== "object" || value === null) {
    throw new Error("envelope metadata must be an object");
  }
  const metadata = value as Record<string, unknown>;
  if (typeof metadata.accountId !== "string") {
    throw new Error("accountId must be an opaque UUID");
  }
  if (typeof metadata.objectId !== "string") {
    throw new Error("objectId must be an opaque UUID");
  }
  if (typeof metadata.objectVersion !== "number") {
    throw new Error("objectVersion must be a positive integer");
  }
  if (typeof metadata.envelopeVersion !== "number") {
    throw new Error("envelopeVersion must be a positive integer");
  }
  assertUuid("accountId", metadata.accountId);
  assertUuid("objectId", metadata.objectId);
  assertPositiveInteger("objectVersion", metadata.objectVersion);
  assertPositiveInteger("envelopeVersion", metadata.envelopeVersion);
  if (!isContentClass(metadata.contentClass)) {
    throw new Error("contentClass is not supported");
  }
  if (metadata.ciphertextAlgorithm !== ciphertextAlgorithm) {
    throw new Error(`ciphertextAlgorithm must be ${ciphertextAlgorithm}`);
  }
  if (metadata.keyWrapAlgorithm !== keyWrapAlgorithm) {
    throw new Error(`keyWrapAlgorithm must be ${keyWrapAlgorithm}`);
  }
  if (
    typeof metadata.keyVersion !== "string" ||
    metadata.keyVersion.trim() === ""
  ) {
    throw new Error("keyVersion must not be blank");
  }
  if (
    typeof metadata.nonceBase64 !== "string" ||
    !noncePattern.test(metadata.nonceBase64)
  ) {
    throw new Error("nonceBase64 must encode a 96-bit AES-GCM nonce");
  }
  if (
    typeof metadata.wrappedDataKeyBase64 !== "string" ||
    metadata.wrappedDataKeyBase64.length === 0 ||
    !base64Pattern.test(metadata.wrappedDataKeyBase64)
  ) {
    throw new Error("wrappedDataKeyBase64 must contain valid base64");
  }
}

async function listedObjectExists(
  bucket: EncryptedObjectBucket,
  key: string,
): Promise<boolean> {
  let cursor: string | undefined;
  do {
    const page = await bucket.list({
      prefix: key,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (page.objects.some((object) => object.key === key)) return true;
    if (!page.truncated) return false;
    if (!page.cursor) {
      throw new Error("Truncated object listing did not provide a cursor");
    }
    cursor = page.cursor;
  } while (cursor);
  return false;
}

export async function purgeAndVerifyEncryptedObject(
  bucket: EncryptedObjectBucket,
  key: string,
): Promise<void> {
  if (!key.startsWith(`${objectRoot}/`)) {
    throw new Error("Refusing to purge an object outside the Inbox Signal root");
  }
  await bucket.delete(key);
  const [directObject, listed] = await Promise.all([
    bucket.get(key),
    listedObjectExists(bucket, key),
  ]);
  if (directObject !== null || listed) {
    throw new Error(`Encrypted object purge could not be verified for ${key}`);
  }
}
