import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const cloudflareApiOrigin = "https://api.cloudflare.com";
const temporaryCredentialTtlMaximum = 604_800;
const bucketPrefixPattern = /^[a-z0-9](?:[a-z0-9-]{2,38}[a-z0-9])$/;

export type R2ParentCredentials = {
  schemaVersion: 1;
  apiToken: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export type R2TemporaryCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
};

export type BrokerProcessRequest = {
  command: string;
  arguments: readonly string[];
  environment: Readonly<Record<string, string>>;
  inheritOutput: boolean;
};

export type BrokerProcessResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type BrokerProcessRunner = (
  request: BrokerProcessRequest,
) => Promise<BrokerProcessResult>;

export type R2CredentialBrokerInput = {
  accountId: string;
  bucketPrefix: string;
  command: string;
  commandArguments: readonly string[];
  helperCommand: string;
  parentCredentials: R2ParentCredentials;
  receiptPath: string;
  ttlSeconds: number;
  environment?: Readonly<Record<string, string | undefined>>;
};

export type R2CredentialBrokerDependencies = {
  fetch?: typeof fetch;
  now?: () => Date;
  randomSuffix?: () => string;
  runProcess: BrokerProcessRunner;
};

type CloudflareResponse<T> = {
  success?: boolean;
  result?: T;
  errors?: readonly { message?: unknown }[];
};

type BrokerReceipt = {
  schemaVersion: 1;
  accountId: string;
  bucketPrefix: string;
  plannedBuckets: readonly [string, string];
  ownedBuckets: readonly string[];
  createdAt: string;
};

const requiredString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
};

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
  if (!bucketPrefixPattern.test(input.bucketPrefix)) {
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

function apiError<T>(response: Response, payload: CloudflareResponse<T>): Error {
  const messages = (payload.errors ?? [])
    .map(({ message }) => (typeof message === "string" ? message : ""))
    .filter(Boolean)
    .join("; ");
  return new Error(
    `Cloudflare R2 request failed (${response.status})${messages ? `: ${messages}` : ""}`,
  );
}

class CloudflareR2AdminClient {
  readonly #accountId: string;
  readonly #apiToken: string;
  readonly #fetch: typeof fetch;

  constructor(accountId: string, apiToken: string, fetchImplementation: typeof fetch) {
    this.#accountId = accountId;
    this.#apiToken = apiToken;
    this.#fetch = (input, init) => fetchImplementation(input, init);
  }

  async #request<T>(
    method: "DELETE" | "GET" | "POST",
    pathname: string,
    body?: unknown,
    allowNotFound = false,
  ): Promise<T | undefined> {
    const response = await this.#fetch(`${cloudflareApiOrigin}${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.#apiToken}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (allowNotFound && response.status === 404) return undefined;
    let payload: CloudflareResponse<T>;
    try {
      payload = (await response.json()) as CloudflareResponse<T>;
    } catch {
      throw new Error(`Cloudflare R2 request returned invalid JSON (${response.status})`);
    }
    if (!response.ok || payload.success !== true) throw apiError(response, payload);
    return payload.result;
  }

  async createBucket(bucket: string): Promise<void> {
    await this.#request(
      "POST",
      `/client/v4/accounts/${this.#accountId}/r2/buckets`,
      { name: bucket },
    );
  }

  async deleteBucket(bucket: string): Promise<void> {
    await this.#request(
      "DELETE",
      `/client/v4/accounts/${this.#accountId}/r2/buckets/${encodeURIComponent(bucket)}`,
      undefined,
      true,
    );
  }

  async bucketExists(bucket: string): Promise<boolean> {
    const result = await this.#request<Record<string, unknown>>(
      "GET",
      `/client/v4/accounts/${this.#accountId}/r2/buckets/${encodeURIComponent(bucket)}`,
      undefined,
      true,
    );
    return result !== undefined;
  }

  async createTemporaryCredentials(
    bucket: string,
    parentAccessKeyId: string,
    ttlSeconds: number,
  ): Promise<R2TemporaryCredentials> {
    const result = await this.#request<Record<string, unknown>>(
      "POST",
      `/client/v4/accounts/${this.#accountId}/r2/temp-access-credentials`,
      {
        bucket,
        parentAccessKeyId,
        permission: "object-read-write",
        ttlSeconds,
      },
    );
    if (!result) throw new Error("Cloudflare returned no temporary credentials");
    return {
      accessKeyId: requiredString(result.accessKeyId, "temporary accessKeyId"),
      secretAccessKey: requiredString(
        result.secretAccessKey,
        "temporary secretAccessKey",
      ),
      sessionToken: requiredString(result.sessionToken, "temporary sessionToken"),
    };
  }
}

function parseReceipt(source: string): BrokerReceipt {
  const value = JSON.parse(source) as Partial<BrokerReceipt>;
  if (
    value.schemaVersion !== 1 ||
    typeof value.accountId !== "string" ||
    typeof value.bucketPrefix !== "string" ||
    !Array.isArray(value.plannedBuckets) ||
    value.plannedBuckets.length !== 2 ||
    !value.plannedBuckets.every((bucket) => typeof bucket === "string") ||
    !Array.isArray(value.ownedBuckets) ||
    !value.ownedBuckets.every((bucket) => typeof bucket === "string") ||
    typeof value.createdAt !== "string"
  ) {
    throw new Error("R2 broker receipt is invalid");
  }
  const [allowedBucket, deniedBucket] = value.plannedBuckets;
  const ownedBuckets = new Set(value.ownedBuckets);
  if (
    !/^[a-f0-9]{32}$/i.test(value.accountId) ||
    !bucketPrefixPattern.test(value.bucketPrefix) ||
    !allowedBucket ||
    !deniedBucket ||
    !new RegExp(`^${value.bucketPrefix}-[a-f0-9]{10}$`).test(allowedBucket) ||
    deniedBucket !== `${allowedBucket}-scope` ||
    ownedBuckets.size !== value.ownedBuckets.length ||
    !value.ownedBuckets.every((bucket) => value.plannedBuckets?.includes(bucket)) ||
    !Number.isFinite(Date.parse(value.createdAt))
  ) {
    throw new Error("R2 broker receipt has invalid ownership fields");
  }
  return value as BrokerReceipt;
}

async function createReceipt(receiptPath: string, receipt: BrokerReceipt): Promise<void> {
  await mkdir(path.dirname(receiptPath), { recursive: true });
  try {
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      throw new Error(
        "An unfinished R2 broker receipt already exists; recover it before starting another run",
      );
    }
    throw error;
  }
}

async function replaceReceipt(
  receiptPath: string,
  receipt: BrokerReceipt,
): Promise<void> {
  const nextPath = `${receiptPath}.next`;
  await writeFile(nextPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(nextPath, receiptPath);
}

async function removeReceipt(receiptPath: string): Promise<void> {
  const retiredPath = `${receiptPath}.retired`;
  await rename(receiptPath, retiredPath);
  await rm(retiredPath);
}

const s3Environment = (
  endpoint: string,
  credentials: R2TemporaryCredentials | R2ParentCredentials,
): Record<string, string> => ({
  PATH: process.env.PATH ?? "",
  HOME: process.env.HOME ?? "",
  AWS_ACCESS_KEY_ID: credentials.accessKeyId,
  AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
  ...("sessionToken" in credentials
    ? { AWS_SESSION_TOKEN: credentials.sessionToken }
    : {}),
  AWS_DEFAULT_REGION: "auto",
  AWS_EC2_METADATA_DISABLED: "true",
  R2_ENDPOINT: endpoint,
});

const safeConsumerEnvironment = (
  source: Readonly<Record<string, string | undefined>>,
  endpoint: string,
  bucket: string,
  credentials: R2TemporaryCredentials,
): Record<string, string> => {
  const environment: Record<string, string> = {};
  for (const name of [
    "PATH",
    "HOME",
    "TMPDIR",
    "CI",
    "GITHUB_ACTIONS",
    "RUNNER_ARCH",
    "RUNNER_OS",
    "RUNNER_TEMP",
    "DOCKER_CONFIG",
    "DOCKER_HOST",
    "XDG_RUNTIME_DIR",
  ]) {
    const value = source[name];
    if (value !== undefined) environment[name] = value;
  }
  return {
    ...environment,
    AWS_ACCESS_KEY_ID: credentials.accessKeyId,
    AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
    AWS_SESSION_TOKEN: credentials.sessionToken,
    AWS_DEFAULT_REGION: "auto",
    AWS_EC2_METADATA_DISABLED: "true",
    R2_ENDPOINT: endpoint,
    R2_BUCKET: bucket,
  };
};

async function requireProcessSuccess(
  runner: BrokerProcessRunner,
  request: BrokerProcessRequest,
  message: string,
): Promise<BrokerProcessResult> {
  const result = await runner(request);
  if (result.exitCode !== 0) throw new Error(message);
  return result;
}

async function proveScope(
  runner: BrokerProcessRunner,
  helperCommand: string,
  endpoint: string,
  allowedBucket: string,
  deniedBucket: string,
  credentials: R2TemporaryCredentials,
): Promise<void> {
  const environment = s3Environment(endpoint, credentials);
  await requireProcessSuccess(
    runner,
    {
      command: helperCommand,
      arguments: ["head", allowedBucket],
      environment,
      inheritOutput: false,
    },
    "Temporary R2 credential could not access its declared bucket",
  );
  const denied = await runner({
    command: helperCommand,
    arguments: ["head", deniedBucket],
    environment,
    inheritOutput: false,
  });
  if (denied.exitCode === 0) {
    throw new Error("Temporary R2 credential accessed the out-of-scope probe bucket");
  }
  if (!/(?:403|AccessDenied|Forbidden)/i.test(`${denied.stdout}\n${denied.stderr}`)) {
    throw new Error("Out-of-scope R2 probe failed without an authorization denial");
  }
}

async function destroyBuckets(
  client: CloudflareR2AdminClient,
  runner: BrokerProcessRunner,
  helperCommand: string,
  endpoint: string,
  receipt: BrokerReceipt,
  parentCredentials: R2ParentCredentials,
): Promise<void> {
  const failures: string[] = [];
  for (const bucket of receipt.ownedBuckets) {
    const purged = await runner({
      command: helperCommand,
      arguments: ["purge", bucket],
      environment: s3Environment(endpoint, parentCredentials),
      inheritOutput: false,
    });
    if (purged.exitCode !== 0) {
      failures.push(`${bucket}: object cleanup failed`);
      continue;
    }
    try {
      await client.deleteBucket(bucket);
      if (await client.bucketExists(bucket)) {
        failures.push(`${bucket}: bucket still exists after deletion`);
      }
    } catch {
      failures.push(`${bucket}: bucket deletion failed`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`R2 broker cleanup failed; receipt retained (${failures.join(", ")})`);
  }
}

export async function runR2CredentialBroker(
  input: R2CredentialBrokerInput,
  dependencies: R2CredentialBrokerDependencies,
): Promise<{ bucket: string }> {
  validateInput(input);
  const fetchImplementation = dependencies.fetch ?? globalThis.fetch;
  const suffix = (dependencies.randomSuffix ?? (() => randomBytes(5).toString("hex")))();
  if (!/^[a-f0-9]{10}$/.test(suffix)) throw new Error("Broker suffix must be 10 lowercase hex characters");
  const allowedBucket = `${input.bucketPrefix}-${suffix}`;
  const deniedBucket = `${input.bucketPrefix}-${suffix}-scope`;
  let receipt: BrokerReceipt = {
    schemaVersion: 1,
    accountId: input.accountId,
    bucketPrefix: input.bucketPrefix,
    plannedBuckets: [allowedBucket, deniedBucket],
    ownedBuckets: [],
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
  try {
    await client.createBucket(allowedBucket);
    receipt = { ...receipt, ownedBuckets: [allowedBucket] };
    await replaceReceipt(input.receiptPath, receipt);
    await client.createBucket(deniedBucket);
    receipt = { ...receipt, ownedBuckets: [allowedBucket, deniedBucket] };
    await replaceReceipt(input.receiptPath, receipt);
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
    if (consumer.exitCode !== 0) {
      throw new Error(`R2 broker consumer failed with exit code ${consumer.exitCode}`);
    }
  } catch (error) {
    operationFailure = error;
  }
  let cleanupFailure: unknown;
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
  if (cleanupFailure) throw cleanupFailure;
  if (operationFailure) throw operationFailure;
  return { bucket: allowedBucket };
}

export async function recoverR2CredentialBroker(
  input: Pick<
    R2CredentialBrokerInput,
    "accountId" | "helperCommand" | "parentCredentials" | "receiptPath"
  >,
  dependencies: Pick<R2CredentialBrokerDependencies, "fetch" | "runProcess">,
): Promise<void> {
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
}
