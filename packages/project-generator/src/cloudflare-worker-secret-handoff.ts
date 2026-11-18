import { randomBytes } from "node:crypto";
import { z } from "zod";
import { conformCloudflareAccountTokenAuthority } from "./cloudflare-account-token.js";
import {
  APPROVED_PROVIDER_ORIGINS,
  type CredentialFetch,
  type SecretBootstrapPlan,
} from "./secret-bootstrap.js";

const WORKERS_SCRIPTS_WRITE_ID = "e086da7e2179491d91ee5f35b3ca210a";
const WORKERS_SCRIPTS_WRITE_NAME = "Workers Scripts Write";
const PROOF_WORKER = "hq-worker-secret-handoff-proof";
const PROOF_SECRET = "HANDOFF_PROOF";

const verifyResponseSchema = z.looseObject({
  result: z.looseObject({ id: z.string(), status: z.literal("active") }),
});
const tokenDetailsResponseSchema = z.looseObject({
  result: z.looseObject({
    policies: z.array(
      z.looseObject({
        effect: z.literal("allow"),
        permission_groups: z.array(z.looseObject({ id: z.string() })),
        resources: z.record(z.string(), z.unknown()),
      }),
    ),
  }),
});
const secretBindingResponseSchema = z.looseObject({
  result: z.looseObject({
    name: z.literal(PROOF_SECRET),
    type: z.literal("secret_text"),
  }),
});

function requiredEnvironmentValue(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = environment[name];
  if (!value) throw new Error(`Required environment variable '${name}' is missing`);
  return value;
}

function handoffIdentities(
  plan: SecretBootstrapPlan,
  environment: Readonly<Record<string, string | undefined>>,
) {
  const handoff = plan.identities.cloudflare;
  const provisioner = plan.identities.cloudflare_token_provisioner;
  if (!handoff || !provisioner) {
    throw new Error(
      "Worker secret handoff conformance requires separate handoff and token-provisioner identities",
    );
  }
  if (plan.provider_origins.cloudflare !== APPROVED_PROVIDER_ORIGINS.cloudflare) {
    throw new Error("Worker secret handoff requires the approved Cloudflare API origin");
  }
  const handoffToken = requiredEnvironmentValue(environment, handoff.token_env);
  const provisionerToken = requiredEnvironmentValue(environment, provisioner.token_env);
  if (handoffToken === provisionerToken) {
    throw new Error("Worker secret handoff and token-provisioner credentials must be distinct");
  }
  const accountId = requiredEnvironmentValue(environment, handoff.account_id_env);
  const provisionerAccountId = requiredEnvironmentValue(
    environment,
    provisioner.account_id_env,
  );
  if (accountId !== provisionerAccountId) {
    throw new Error("Worker secret handoff identities must use the same declared account");
  }
  return { handoff, handoffToken, provisionerToken, accountId };
}

function assertHandoffPlan(plan: SecretBootstrapPlan): void {
  const secret = plan.secrets.find(({ name }) => name === "CLOUDFLARE_BOOTSTRAP_TOKEN");
  if (
    secret?.creation.mode !== "extension" ||
    secret.creation.extension !== "cloudflare-account-token" ||
    !("permission_groups" in secret.creation) ||
    secret.creation.permission_groups.length !== 1 ||
    secret.creation.permission_groups[0]?.id !== WORKERS_SCRIPTS_WRITE_ID ||
    secret.creation.permission_groups[0]?.name !== WORKERS_SCRIPTS_WRITE_NAME
  ) {
    throw new Error(
      `Worker secret handoff plan must create CLOUDFLARE_BOOTSTRAP_TOKEN with only '${WORKERS_SCRIPTS_WRITE_NAME}'`,
    );
  }
}

async function cloudflareRequest(
  fetchCredential: CredentialFetch,
  path: string,
  token: string,
  operation: string,
  init: RequestInit = {},
) {
  const url = new URL(path, APPROVED_PROVIDER_ORIGINS.cloudflare);
  try {
    return await fetchCredential(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...init.headers,
      },
    });
  } catch {
    throw new Error(`${operation} request failed`);
  }
}

async function responseJson(
  response: Awaited<ReturnType<CredentialFetch>>,
  operation: string,
): Promise<unknown> {
  if (!response.ok) throw new Error(`${operation} failed with status ${response.status}`);
  if (!response.json) throw new Error(`${operation} returned no JSON response`);
  try {
    return await response.json();
  } catch {
    throw new Error(`${operation} returned invalid JSON`);
  }
}

function parseSafe<T>(schema: z.ZodType<T>, value: unknown, operation: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(`${operation} returned an unexpected response`);
  return result.data;
}

function assertHandoffPolicy(
  accountId: string,
  policies: z.infer<typeof tokenDetailsResponseSchema>["result"]["policies"],
): void {
  if (policies.length !== 1) {
    throw new Error("Worker secret handoff token must have exactly one policy");
  }
  const policy = policies[0];
  if (
    policy?.permission_groups.length !== 1 ||
    policy.permission_groups[0]?.id !== WORKERS_SCRIPTS_WRITE_ID
  ) {
    throw new Error(
      `Worker secret handoff token must grant only '${WORKERS_SCRIPTS_WRITE_NAME}'`,
    );
  }
  const resources = Object.entries(policy.resources);
  if (
    resources.length !== 1 ||
    resources[0]?.[0] !== `com.cloudflare.api.account.${accountId}` ||
    resources[0]?.[1] !== "*"
  ) {
    throw new Error("Worker secret handoff token must be scoped to the declared account");
  }
}

export async function conformCloudflareWorkerSecretHandoff(input: {
  readonly plan: SecretBootstrapPlan;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly fetch?: CredentialFetch;
}): Promise<{
  readonly provider: "cloudflare";
  readonly ownership: "account";
  readonly accountIdEnvironment: string;
  readonly permission: typeof WORKERS_SCRIPTS_WRITE_NAME;
  readonly status: "conformant";
}> {
  assertHandoffPlan(input.plan);
  const identities = handoffIdentities(input.plan, input.environment);
  const fetchCredential = input.fetch ?? fetch;
  await conformCloudflareAccountTokenAuthority({
    plan: input.plan,
    environment: input.environment,
    fetch: fetchCredential,
  });

  const verifyResponse = await cloudflareRequest(
    fetchCredential,
    `/client/v4/accounts/${encodeURIComponent(identities.accountId)}/tokens/verify`,
    identities.handoffToken,
    "Cloudflare worker secret handoff verification",
  );
  const verified = parseSafe(
    verifyResponseSchema,
    await responseJson(verifyResponse, "Cloudflare worker secret handoff verification"),
    "Cloudflare worker secret handoff verification",
  );
  const detailsResponse = await cloudflareRequest(
    fetchCredential,
    `/client/v4/accounts/${encodeURIComponent(identities.accountId)}/tokens/${encodeURIComponent(verified.result.id)}`,
    identities.provisionerToken,
    "Cloudflare worker secret handoff inspection",
  );
  const details = parseSafe(
    tokenDetailsResponseSchema,
    await responseJson(detailsResponse, "Cloudflare worker secret handoff inspection"),
    "Cloudflare worker secret handoff inspection",
  );
  assertHandoffPolicy(identities.accountId, details.result.policies);

  return {
    provider: "cloudflare",
    ownership: "account",
    accountIdEnvironment: identities.handoff.account_id_env,
    permission: WORKERS_SCRIPTS_WRITE_NAME,
    status: "conformant",
  };
}

function proofIdentity(
  plan: SecretBootstrapPlan,
  environment: Readonly<Record<string, string | undefined>>,
) {
  const identity = plan.identities.cloudflare;
  if (!identity) throw new Error("Worker secret handoff proof requires a handoff identity");
  if (identity.workers.length !== 1 || identity.workers[0] !== PROOF_WORKER) {
    throw new Error(`Worker secret handoff proof requires only '${PROOF_WORKER}'`);
  }
  if (plan.provider_origins.cloudflare !== APPROVED_PROVIDER_ORIGINS.cloudflare) {
    throw new Error("Worker secret handoff proof requires the approved Cloudflare API origin");
  }
  return {
    accountId: requiredEnvironmentValue(environment, identity.account_id_env),
    token: requiredEnvironmentValue(environment, identity.token_env),
  };
}

function workerPath(accountId: string): string {
  return `/client/v4/accounts/${encodeURIComponent(accountId)}/workers/scripts/${PROOF_WORKER}`;
}

function uploadBody(): FormData {
  const body = new FormData();
  body.append(
    "metadata",
    new Blob([JSON.stringify({ main_module: "index.js" })], {
      type: "application/json",
    }),
  );
  body.append(
    "index.js",
    new Blob(
      ["export default { fetch() { return new Response('handoff proof'); } };\n"],
      { type: "application/javascript+module" },
    ),
    "index.js",
  );
  return body;
}

async function expectSuccess(
  response: Awaited<ReturnType<CredentialFetch>>,
  operation: string,
): Promise<void> {
  if (!response.ok) throw new Error(`${operation} failed with status ${response.status}`);
}

async function assertProofWorkerAbsent(
  fetchCredential: CredentialFetch,
  path: string,
  token: string,
): Promise<void> {
  const existing = await cloudflareRequest(
    fetchCredential,
    path,
    token,
    "Cloudflare disposable Worker preflight",
  );
  if (existing.ok) {
    throw new Error(`Refusing to replace existing disposable Worker '${PROOF_WORKER}'`);
  }
  if (existing.status !== 404) {
    throw new Error(
      `Cloudflare disposable Worker preflight failed with status ${existing.status}`,
    );
  }
}

async function createProofWorker(
  fetchCredential: CredentialFetch,
  path: string,
  token: string,
): Promise<void> {
  const upload = await cloudflareRequest(
    fetchCredential,
    path,
    token,
    "Cloudflare disposable Worker creation",
    { method: "PUT", body: uploadBody() },
  );
  await expectSuccess(upload, "Cloudflare disposable Worker creation");
}

async function writeAndInspectProofSecret(
  fetchCredential: CredentialFetch,
  path: string,
  token: string,
): Promise<void> {
  const proofValue = randomBytes(32).toString("base64url");
  const write = await cloudflareRequest(
    fetchCredential,
    `${path}/secrets`,
    token,
    "Cloudflare disposable Worker secret handoff",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: PROOF_SECRET,
        text: proofValue,
        type: "secret_text",
      }),
    },
  );
  await expectSuccess(write, "Cloudflare disposable Worker secret handoff");

  const read = await cloudflareRequest(
    fetchCredential,
    `${path}/secrets/${PROOF_SECRET}`,
    token,
    "Cloudflare disposable Worker secret inspection",
  );
  const rawBinding = await responseJson(
    read,
    "Cloudflare disposable Worker secret inspection",
  );
  const binding = parseSafe(
    secretBindingResponseSchema,
    rawBinding,
    "Cloudflare disposable Worker secret inspection",
  );
  if ("text" in binding.result) {
    throw new Error("Cloudflare returned secret material during proof inspection");
  }
}

async function cleanupProofWorker(
  fetchCredential: CredentialFetch,
  path: string,
  token: string,
): Promise<void> {
  const cleanup = await cloudflareRequest(
    fetchCredential,
    path,
    token,
    "Cloudflare disposable Worker cleanup",
    { method: "DELETE" },
  );
  await expectSuccess(cleanup, "Cloudflare disposable Worker cleanup");
  const absent = await cloudflareRequest(
    fetchCredential,
    path,
    token,
    "Cloudflare disposable Worker cleanup verification",
  );
  if (absent.status !== 404) {
    throw new Error(
      `Cloudflare disposable Worker cleanup verification failed with status ${absent.status}`,
    );
  }
}

async function captureFailure(operation: () => Promise<void>): Promise<Error | undefined> {
  try {
    await operation();
    return undefined;
  } catch (error) {
    return error instanceof Error ? error : new Error("Cloudflare proof failed");
  }
}

function throwProofFailure(
  operationError: Error | undefined,
  cleanupError: Error | undefined,
): void {
  if (operationError && cleanupError) {
    throw new Error(`${operationError.message}; ${cleanupError.message}`);
  }
  if (cleanupError) throw cleanupError;
  if (operationError) throw operationError;
}

export async function proveCloudflareWorkerSecretHandoff(input: {
  readonly plan: SecretBootstrapPlan;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly fetch?: CredentialFetch;
}): Promise<{
  readonly provider: "cloudflare";
  readonly worker: typeof PROOF_WORKER;
  readonly secret: typeof PROOF_SECRET;
  readonly cleanup: "complete";
  readonly status: "proven";
}> {
  const identity = proofIdentity(input.plan, input.environment);
  const fetchCredential = input.fetch ?? fetch;
  const path = workerPath(identity.accountId);
  await assertProofWorkerAbsent(fetchCredential, path, identity.token);
  await createProofWorker(fetchCredential, path, identity.token);
  const operationError = await captureFailure(() =>
    writeAndInspectProofSecret(fetchCredential, path, identity.token),
  );
  const cleanupError = await captureFailure(() =>
    cleanupProofWorker(fetchCredential, path, identity.token),
  );
  throwProofFailure(operationError, cleanupError);

  return {
    provider: "cloudflare",
    worker: PROOF_WORKER,
    secret: PROOF_SECRET,
    cleanup: "complete",
    status: "proven",
  };
}
