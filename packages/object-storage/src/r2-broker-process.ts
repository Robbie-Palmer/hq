import type {
  BrokerProcessRequest,
  BrokerProcessResult,
  BrokerProcessRunner,
  R2ParentCredentials,
  R2TemporaryCredentials,
} from "./r2-broker-types.js";
import type { BrokerReceipt } from "./r2-broker-receipt.js";
import type { CloudflareR2AdminClient } from "./r2-cloudflare-admin.js";

export const unsafeExternalCleanupExitCode = 75;

const inheritedEnvironmentNames = [
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
] as const;

function inheritedEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const name of inheritedEnvironmentNames) {
    const value = source[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

function s3Environment(
  endpoint: string,
  credentials: R2TemporaryCredentials | R2ParentCredentials,
): Record<string, string> {
  return {
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
  };
}

export function safeConsumerEnvironment(
  source: Readonly<Record<string, string | undefined>>,
  endpoint: string,
  bucket: string,
  credentials: R2TemporaryCredentials,
): Record<string, string> {
  return {
    ...inheritedEnvironment(source),
    AWS_ACCESS_KEY_ID: credentials.accessKeyId,
    AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
    AWS_SESSION_TOKEN: credentials.sessionToken,
    AWS_DEFAULT_REGION: "auto",
    AWS_EC2_METADATA_DISABLED: "true",
    R2_ENDPOINT: endpoint,
    R2_BUCKET: bucket,
  };
}

export function safeGuardEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  return inheritedEnvironment(source);
}

async function requireProcessSuccess(
  runner: BrokerProcessRunner,
  request: BrokerProcessRequest,
  message: string,
): Promise<BrokerProcessResult> {
  const result = await runner(request);
  if (result.exitCode !== 0) throw new Error(message);
  return result;
}

export async function proveScope(
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
  if (
    !/^An error occurred \((?:403|AccessDenied|Forbidden)\) when calling the HeadBucket operation:/m.test(
      `${denied.stdout}\n${denied.stderr}`,
    )
  ) {
    throw new Error("Out-of-scope R2 probe failed without an authorization denial");
  }
}

export async function destroyBuckets(
  client: CloudflareR2AdminClient,
  runner: BrokerProcessRunner,
  helperCommand: string,
  endpoint: string,
  receipt: BrokerReceipt,
  parentCredentials: R2ParentCredentials,
): Promise<void> {
  const failures = receipt.pendingBuckets.map(
    (bucket) => `${bucket}: creation outcome is unresolved`,
  );
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
