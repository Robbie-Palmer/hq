export const ciphertextAlgorithm = "AES-256-GCM" as const;
export const keyWrapAlgorithm = "AES-256-KW" as const;
export const currentEnvelopeVersion = 1 as const;

const noncePattern = /^[A-Za-z0-9+/]{16}$/;
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export type EncryptedEnvelopeMetadata = {
  envelopeVersion: number;
  ciphertextAlgorithm: typeof ciphertextAlgorithm;
  keyWrapAlgorithm: typeof keyWrapAlgorithm;
  keyVersion: string;
  nonceBase64: string;
  wrappedDataKeyBase64: string;
};

export type ObjectLifecycleRule = {
  prefix: string;
  expirationDays: number;
};

export interface ObjectBucket {
  delete(key: string): Promise<void>;
  get(key: string): Promise<unknown | null>;
  list(options: {
    prefix: string;
    cursor?: string;
  }): Promise<{
    objects: readonly { key: string }[];
    truncated: boolean;
    cursor?: string;
  }>;
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

export function validateEncryptedEnvelopeMetadata(
  value: unknown,
): asserts value is EncryptedEnvelopeMetadata {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("encrypted envelope metadata must be an object");
  }
  const metadata = value as Record<string, unknown>;
  if (typeof metadata.envelopeVersion !== "number") {
    throw new TypeError("envelopeVersion must be a positive integer");
  }
  assertPositiveInteger("envelopeVersion", metadata.envelopeVersion);
  if (metadata.ciphertextAlgorithm !== ciphertextAlgorithm) {
    throw new Error(`ciphertextAlgorithm must be ${ciphertextAlgorithm}`);
  }
  if (metadata.keyWrapAlgorithm !== keyWrapAlgorithm) {
    throw new Error(`keyWrapAlgorithm must be ${keyWrapAlgorithm}`);
  }
  if (typeof metadata.keyVersion !== "string") {
    throw new TypeError("keyVersion must be a string");
  }
  if (metadata.keyVersion.trim() === "") {
    throw new Error("keyVersion must not be blank");
  }
  if (typeof metadata.nonceBase64 !== "string") {
    throw new TypeError("nonceBase64 must be a string");
  }
  if (!noncePattern.test(metadata.nonceBase64)) {
    throw new Error("nonceBase64 must encode a 96-bit AES-GCM nonce");
  }
  if (typeof metadata.wrappedDataKeyBase64 !== "string") {
    throw new TypeError("wrappedDataKeyBase64 must be a string");
  }
  if (
    metadata.wrappedDataKeyBase64.length === 0 ||
    !base64Pattern.test(metadata.wrappedDataKeyBase64)
  ) {
    throw new Error("wrappedDataKeyBase64 must contain valid base64");
  }
}

async function listedObjectExists(
  bucket: ObjectBucket,
  key: string,
): Promise<boolean> {
  let cursor: string | undefined;
  while (true) {
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
  }
}

export async function purgeAndVerifyObject(
  bucket: ObjectBucket,
  key: string,
  allowedPrefix: string,
): Promise<void> {
  if (allowedPrefix.length === 0 || !key.startsWith(allowedPrefix)) {
    throw new Error("Refusing to purge an object outside the allowed prefix");
  }
  await bucket.delete(key);
  const [directObject, listed] = await Promise.all([
    bucket.get(key),
    listedObjectExists(bucket, key),
  ]);
  if (directObject !== null || listed) {
    throw new Error(`Object purge could not be verified for ${key}`);
  }
}
