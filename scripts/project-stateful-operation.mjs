import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const ACTIONS = new Set([
  "preview-up",
  "preview-cleanup",
  "production-plan",
  "production-apply",
  "production-rollback",
  "backup",
  "restore",
  "alert-smoke",
]);
const OPERATIONS_ROOT_PATTERN = /^[a-z0-9][a-z0-9./-]*$/;
const SECRET_REFERENCE_PATTERN =
  /^doppler:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:_[a-z0-9]+)*$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function requiredEnvironment(environment, name) {
  const value = environment[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function requestFromEnvironment(environment) {
  return {
    action: requiredEnvironment(environment, "ACTION"),
    operationsRoot: requiredEnvironment(environment, "OPERATIONS_ROOT"),
    githubEnvironment: requiredEnvironment(
      environment,
      "OPERATIONS_GITHUB_ENVIRONMENT",
    ),
    secretConfigReference: requiredEnvironment(
      environment,
      "OPERATIONS_SECRET_CONFIG_REF",
    ),
    subject: environment.SUBJECT ?? "",
    expectedPlanSha256: environment.EXPECTED_PLAN_SHA256 ?? "",
  };
}

function validateOperationsRoot(operationsRoot) {
  if (
    !OPERATIONS_ROOT_PATTERN.test(operationsRoot) ||
    path.posix.isAbsolute(operationsRoot) ||
    operationsRoot
      .split("/")
      .some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("OPERATIONS_ROOT must be a normalized repository-relative path");
  }
}

function validateSubject(action, subject) {
  switch (action) {
    case "preview-up":
    case "preview-cleanup":
      if (!/^[1-9]\d*$/.test(subject)) {
        throw new Error(`${action} requires a pull-request number`);
      }
      return;
    case "production-rollback":
      if (!/^[0-9a-f]{40}$/.test(subject)) {
        throw new Error("production-rollback requires a full Git revision");
      }
      return;
    case "restore":
      if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(subject)) {
        throw new Error("restore requires a lowercase restore drill ID");
      }
      return;
    default:
      if (subject !== "") {
        throw new Error(`${action} does not accept a subject`);
      }
  }
}

function validatePlanDigest(action, expectedPlanSha256) {
  if (action === "production-apply") {
    if (!SHA256_PATTERN.test(expectedPlanSha256)) {
      throw new Error("production-apply requires a SHA-256 plan digest");
    }
    return;
  }
  if (expectedPlanSha256 !== "") {
    throw new Error(`${action} does not accept a plan digest`);
  }
}

export function validateRequest(request) {
  if (!ACTIONS.has(request.action)) {
    throw new Error(`Unsupported stateful operation '${request.action}'`);
  }
  validateOperationsRoot(request.operationsRoot);
  if (!SECRET_REFERENCE_PATTERN.test(request.secretConfigReference)) {
    throw new Error(
      "OPERATIONS_SECRET_CONFIG_REF must be a redacted doppler://project/config reference",
    );
  }
  if (request.githubEnvironment.trim().length === 0) {
    throw new Error("OPERATIONS_GITHUB_ENVIRONMENT must not be blank");
  }
  validateSubject(request.action, request.subject);
  validatePlanDigest(request.action, request.expectedPlanSha256);
  return request;
}

export function operationInvocation(request) {
  validateRequest(request);
  let mutationToken = "";
  switch (request.action) {
    case "preview-up":
      mutationToken = `preview:${request.subject}`;
      break;
    case "preview-cleanup":
      mutationToken = `preview-cleanup:${request.subject}`;
      break;
    case "production-apply":
      mutationToken = `production:${request.expectedPlanSha256}`;
      break;
    case "production-rollback":
      mutationToken = `rollback:${request.subject}`;
      break;
    case "backup":
      mutationToken = "backup";
      break;
    case "restore":
      mutationToken = `restore:${request.subject}`;
      break;
    case "alert-smoke":
      mutationToken = "alert-smoke";
      break;
  }

  const operationArguments = [request.action];
  if (request.subject) operationArguments.push(request.subject);
  return {
    command: "doppler",
    arguments: [
      "run",
      "--",
      "bash",
      path.posix.join(request.operationsRoot, "operations/operate.sh"),
      ...operationArguments,
    ],
    environment: {
      EXPECTED_PLAN_SHA256: request.expectedPlanSha256,
      OPERATIONS_GITHUB_ENVIRONMENT: request.githubEnvironment,
      OPERATIONS_MUTATION_TOKEN: mutationToken,
      OPERATIONS_SECRET_CONFIG_REF: request.secretConfigReference,
      RESTORE_TARGET_CLASS: request.action === "restore" ? "scratch" : "",
    },
  };
}

export async function runOperation(request, environment = process.env) {
  const invocation = operationInvocation(request);
  await new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.arguments, {
      env: { ...environment, ...invocation.environment },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(undefined);
      else reject(new Error(`Stateful operation exited with status ${code ?? 1}`));
    });
  });
}

export async function recordPlanDigest(
  request,
  githubOutput,
  read = readFile,
  append = appendFile,
) {
  validateRequest(request);
  if (request.action !== "production-plan") {
    throw new Error("Only production-plan records a plan digest");
  }
  if (!githubOutput) {
    throw new Error("Missing required environment variable: GITHUB_OUTPUT");
  }
  const checksumPath = path.join(
    request.operationsRoot,
    "operations/evidence/production.tfplan.sha256",
  );
  const checksum = (await read(checksumPath, "utf8")).trim().split(/\s+/, 1)[0];
  if (!checksum || !SHA256_PATTERN.test(checksum)) {
    throw new Error("Saved Terraform plan checksum is not a SHA-256 digest");
  }
  await append(githubOutput, `plan_sha256=${checksum}\n`, "utf8");
  return checksum;
}

export async function main(arguments_, environment = process.env) {
  const [command] = arguments_;
  const request = requestFromEnvironment(environment);
  switch (command) {
    case "validate":
      validateRequest(request);
      return;
    case "run":
      await runOperation(request, environment);
      return;
    case "record-plan-digest":
      await recordPlanDigest(request, environment.GITHUB_OUTPUT);
      return;
    default:
      throw new Error(
        "Usage: project-stateful-operation.mjs <validate|run|record-plan-digest>",
      );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`project-stateful-operation: ${message}`);
    process.exitCode = 1;
  }
}
