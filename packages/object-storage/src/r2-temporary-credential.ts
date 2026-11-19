import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  destroyBuckets,
  proveScope,
  safeConsumerEnvironment,
  safeGuardEnvironment,
  unsafeExternalCleanupExitCode,
} from "./r2-broker-process.js";
import {
  acquireReceiptLock,
  brokerBucketPrefixPattern,
  createReceipt,
  parseReceipt,
  removeReceipt,
  replaceReceipt,
  type BrokerReceipt,
} from "./r2-broker-receipt.js";
import type {
  R2CredentialBrokerDependencies,
  R2CredentialBrokerInput,
  R2CredentialRecoveryInput,
  R2ParentCredentials,
} from "./r2-broker-types.js";
import {
  CloudflareR2AdminClient,
  CloudflareR2RequestError,
} from "./r2-cloudflare-admin.js";

export type {
  BrokerProcessRequest,
  BrokerProcessResult,
  BrokerProcessRunner,
  R2CredentialBrokerDependencies,
  R2CredentialBrokerInput,
  R2CredentialRecoveryInput,
  R2ParentCredentials,
  R2TemporaryCredentials,
} from "./r2-broker-types.js";

const temporaryCredentialTtlMaximum = 604_800;

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

export function parseR2ParentCredentials(source: string): R2ParentCredentials {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("CLOUDFLARE_R2_PARENT_CREDENTIALS must be valid JSON");
  }
  if (typeof value !== "object" || value === null) {
    throw new Error("CLOUDFLARE_R2_PARENT_CREDENTIALS must be an object");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1) {
    throw new Error("CLOUDFLARE_R2_PARENT_CREDENTIALS schemaVersion must be 1");
  }
  return {
    schemaVersion: 1,
    apiToken: requiredString(candidate.apiToken, "apiToken"),
    accessKeyId: requiredString(candidate.accessKeyId, "accessKeyId"),
    secretAccessKey: requiredString(candidate.secretAccessKey, "secretAccessKey"),
  };
}

function validateInput(input: R2CredentialBrokerInput): void {
  if (!/^[a-f0-9]{32}$/i.test(input.accountId)) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID must be a 32-character hexadecimal ID");
  }
  if (!brokerBucketPrefixPattern.test(input.bucketPrefix)) {
    throw new Error(
      "R2 bucket prefix must be 4-40 lowercase letters, digits, or interior hyphens",
    );
  }
  if (
    !Number.isSafeInteger(input.ttlSeconds) ||
    input.ttlSeconds < 1 ||
    input.ttlSeconds > temporaryCredentialTtlMaximum
  ) {
    throw new Error("Temporary credential TTL must be between 1 and 604800 seconds");
  }
  requiredString(input.command, "consumer command");
  requiredString(input.helperCommand, "S3 helper command");
}

async function createRecordedBucket(
  client: CloudflareR2AdminClient,
  receiptPath: string,
  receipt: BrokerReceipt,
  bucket: string,
): Promise<BrokerReceipt> {
  receipt.pendingBuckets.push(bucket);
  await replaceReceipt(receiptPath, receipt);
  try {
    await client.createBucket(bucket);
  } catch (error) {
    if (error instanceof CloudflareR2RequestError && error.status === 409) {
      receipt.pendingBuckets = receipt.pendingBuckets.filter((name) => name !== bucket);
      await replaceReceipt(receiptPath, receipt);
    }
    throw error;
  }
  receipt.ownedBuckets.push(bucket);
  receipt.pendingBuckets = receipt.pendingBuckets.filter((name) => name !== bucket);
  await replaceReceipt(receiptPath, receipt);
  return receipt;
}

export async function runR2CredentialBroker(
  input: R2CredentialBrokerInput,
  dependencies: R2CredentialBrokerDependencies,
): Promise<{ bucket: string }> {
  validateInput(input);
  const releaseReceiptLock = await acquireReceiptLock(input.receiptPath);
  try {
    const fetchImplementation = dependencies.fetch ?? globalThis.fetch;
    const suffix = (
      dependencies.randomSuffix ?? (() => randomBytes(5).toString("hex"))
    )();
    if (!/^[a-f0-9]{10}$/.test(suffix)) {
      throw new Error("Broker suffix must be 10 lowercase hex characters");
    }
    const allowedBucket = `${input.bucketPrefix}-${suffix}`;
    const deniedBucket = `${input.bucketPrefix}-${suffix}-scope`;
    let receipt: BrokerReceipt = {
      schemaVersion: 1,
      accountId: input.accountId,
      bucketPrefix: input.bucketPrefix,
      plannedBuckets: [allowedBucket, deniedBucket],
      ownedBuckets: [],
      pendingBuckets: [],
      createdAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    };
    await createReceipt(input.receiptPath, receipt);
    const client = new CloudflareR2AdminClient(
      input.accountId,
      input.parentCredentials.apiToken,
      fetchImplementation,
    );
    const endpoint = `https://${input.accountId}.r2.cloudflarestorage.com`;
    let operationFailure: unknown;
    let externalCleanupSafe = true;
    try {
      receipt = await createRecordedBucket(
        client,
        input.receiptPath,
        receipt,
        allowedBucket,
      );
      receipt = await createRecordedBucket(
        client,
        input.receiptPath,
        receipt,
        deniedBucket,
      );
      const credentials = await client.createTemporaryCredentials(
        allowedBucket,
        input.parentCredentials.accessKeyId,
        input.ttlSeconds,
      );
      await proveScope(
        dependencies.runProcess,
        input.helperCommand,
        endpoint,
        allowedBucket,
        deniedBucket,
        credentials,
      );
      const consumer = await dependencies.runProcess({
        command: input.command,
        arguments: input.commandArguments,
        environment: safeConsumerEnvironment(
          input.environment ?? process.env,
          endpoint,
          allowedBucket,
          credentials,
        ),
        inheritOutput: true,
      });
      externalCleanupSafe = consumer.exitCode !== unsafeExternalCleanupExitCode;
      if (consumer.exitCode !== 0) {
        throw new Error(`R2 broker consumer failed with exit code ${consumer.exitCode}`);
      }
    } catch (error) {
      operationFailure = error;
    }
    let cleanupFailure: unknown;
    if (!externalCleanupSafe) {
      cleanupFailure = new Error(
        "R2 broker cleanup was blocked because consumer containers may still be active; receipt retained",
      );
    } else {
      try {
        await destroyBuckets(
          client,
          dependencies.runProcess,
          input.helperCommand,
          endpoint,
          receipt,
          input.parentCredentials,
        );
        await removeReceipt(input.receiptPath);
      } catch (error) {
        cleanupFailure = error;
      }
    }
    if (cleanupFailure) throw cleanupFailure;
    if (operationFailure) throw operationFailure;
    return { bucket: allowedBucket };
  } finally {
    await releaseReceiptLock();
  }
}

export async function recoverR2CredentialBroker(
  input: R2CredentialRecoveryInput,
  dependencies: Pick<R2CredentialBrokerDependencies, "fetch" | "runProcess">,
): Promise<void> {
  const releaseReceiptLock = await acquireReceiptLock(input.receiptPath);
  try {
    if (input.guardCommand) {
      const guard = await dependencies.runProcess({
        command: input.guardCommand,
        arguments: input.guardArguments ?? [],
        environment: safeGuardEnvironment(input.environment ?? process.env),
        inheritOutput: true,
      });
      if (guard.exitCode !== 0) {
        throw new Error(
          `R2 broker recovery guard failed with exit code ${guard.exitCode}; receipt retained`,
        );
      }
    }
    const receipt = parseReceipt(await readFile(input.receiptPath, "utf8"));
    if (receipt.accountId !== input.accountId) {
      throw new Error("R2 broker receipt belongs to a different Cloudflare account");
    }
    const client = new CloudflareR2AdminClient(
      input.accountId,
      input.parentCredentials.apiToken,
      dependencies.fetch ?? globalThis.fetch,
    );
    await destroyBuckets(
      client,
      dependencies.runProcess,
      input.helperCommand,
      `https://${input.accountId}.r2.cloudflarestorage.com`,
      receipt,
      input.parentCredentials,
    );
    await removeReceipt(input.receiptPath);
  } finally {
    await releaseReceiptLock();
  }
}
