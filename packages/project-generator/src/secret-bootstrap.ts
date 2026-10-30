import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const configNameSchema = z.string().regex(/^[a-z0-9]+(?:[_-][a-z0-9]+)*$/);
const environmentNameSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/);
const secretNameSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/);
const originSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === "" &&
    url.username === "" &&
    url.password === ""
  );
}, {
  message: "must be an origin without credentials, a path, query, or fragment",
});

export const APPROVED_PROVIDER_ORIGINS = {
  cloudflare: "https://api.cloudflare.com",
  doppler: "https://api.doppler.com",
  github: "https://api.github.com",
} as const;

const checkpointSchema = z
  .object({
    id: slugSchema,
    provider: slugSchema,
    instructions: z.string().min(1),
  })
  .strict();

const sourceSchema = z.union([
  z
    .object({
      mode: z.literal("manual"),
      value_env: environmentNameSchema,
      checkpoint: slugSchema,
    })
    .strict(),
  z
    .object({
      mode: z.literal("generated"),
      bytes: z.number().int().min(16).max(128),
    })
    .strict(),
  z
    .object({
      mode: z.literal("extension"),
      extension: z.literal("cloudflare-account-token"),
      checkpoint: slugSchema.optional(),
      token_name: z.string().min(1).max(120),
      permission_groups: z
        .array(
          z
            .object({
              id: z.string().regex(/^[0-9a-f]{32}$/),
              name: z.string().min(1),
            })
            .strict(),
        )
        .min(1),
      expires_on: z.iso.datetime().optional(),
    })
    .strict(),
  z
    .object({
      mode: z.literal("extension"),
      extension: slugSchema.refine(
        (value) => value !== "cloudflare-account-token",
        "cloudflare-account-token requires its token policy fields",
      ),
      checkpoint: slugSchema.optional(),
    })
    .strict(),
]);

const consumerSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("github-environment"),
      environment: z.string().min(1),
      name: secretNameSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("cloudflare-worker"),
      worker: slugSchema,
      name: secretNameSchema,
    })
    .strict(),
]);

const identitiesSchema = z
  .object({
    doppler: z
      .object({
        token_env: environmentNameSchema,
        project: slugSchema,
        configs: z.array(configNameSchema).min(1),
      })
      .strict(),
    github: z
      .object({
        token_env: environmentNameSchema,
        repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
        environments: z.array(z.string().min(1)).min(1),
      })
      .strict(),
    cloudflare: z
      .object({
        token_env: environmentNameSchema,
        account_id_env: environmentNameSchema,
        workers: z.array(slugSchema).min(1),
      })
      .strict()
      .optional(),
    cloudflare_token_provisioner: z
      .object({
        token_env: environmentNameSchema,
        account_id_env: environmentNameSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

const bootstrapSecretSchema = z
  .object({
    id: slugSchema,
    name: secretNameSchema,
    sensitive: z.boolean(),
    system_of_record: z
      .object({
        kind: z.literal("doppler"),
        config: configNameSchema,
        name: secretNameSchema,
      })
      .strict(),
    consumers: z.array(consumerSchema).min(1),
    rotation_owner: z.string().min(1),
    creation: sourceSchema,
  })
  .strict();

type BootstrapPlanShape = {
  readonly provider_origins: { readonly cloudflare?: string };
  readonly identities: z.infer<typeof identitiesSchema>;
  readonly checkpoints: readonly z.infer<typeof checkpointSchema>[];
  readonly secrets: readonly z.infer<typeof bootstrapSecretSchema>[];
};

function validateConsumerScope(
  consumer: z.infer<typeof consumerSchema>,
  path: readonly (string | number)[],
  githubEnvironments: ReadonlySet<string>,
  cloudflareWorkers: ReadonlySet<string>,
  context: z.RefinementCtx,
): void {
  if (
    consumer.kind === "github-environment" &&
    !githubEnvironments.has(consumer.environment)
  ) {
    context.addIssue({
      code: "custom",
      path: [...path, "environment"],
      message: "must use a GitHub environment allowed by the GitHub identity",
    });
  }
  if (
    consumer.kind === "cloudflare-worker" &&
    !cloudflareWorkers.has(consumer.worker)
  ) {
    context.addIssue({
      code: "custom",
      path: [...path, "worker"],
      message: "must use a Worker allowed by the Cloudflare identity",
    });
  }
}

function validateSecretScopes(
  plan: BootstrapPlanShape,
  context: z.RefinementCtx,
): void {
  const checkpoints = new Set(plan.checkpoints.map(({ id }) => id));
  const configs = new Set(plan.identities.doppler.configs);
  const githubEnvironments = new Set(plan.identities.github.environments);
  const cloudflareWorkers = new Set(plan.identities.cloudflare?.workers ?? []);
  for (const [index, secret] of plan.secrets.entries()) {
    validateCloudflareTokenSource(plan, secret, index, context);
    addDuplicateIssues(
      secret.consumers.map((consumer) =>
        consumer.kind === "github-environment"
          ? `github:${consumer.environment}/${consumer.name}`
          : `cloudflare:${consumer.worker}/${consumer.name}`,
      ),
      `consumers for secret '${secret.id}'`,
      context,
    );
    if (!configs.has(secret.system_of_record.config)) {
      context.addIssue({
        code: "custom",
        path: ["secrets", index, "system_of_record", "config"],
        message: "must use a Doppler config allowed by the Doppler identity",
      });
    }
    const checkpoint =
      "checkpoint" in secret.creation ? secret.creation.checkpoint : undefined;
    if (checkpoint !== undefined && !checkpoints.has(checkpoint)) {
      context.addIssue({
        code: "custom",
        path: ["secrets", index, "creation", "checkpoint"],
        message: "must reference a declared manual checkpoint",
      });
    }
    for (const [consumerIndex, consumer] of secret.consumers.entries()) {
      validateConsumerScope(
        consumer,
        ["secrets", index, "consumers", consumerIndex],
        githubEnvironments,
        cloudflareWorkers,
        context,
      );
    }
  }
}

function validateCloudflareTokenSource(
  plan: BootstrapPlanShape,
  secret: BootstrapPlanShape["secrets"][number],
  index: number,
  context: z.RefinementCtx,
): void {
  if (
    secret.creation.mode !== "extension" ||
    secret.creation.extension !== "cloudflare-account-token" ||
    !("permission_groups" in secret.creation)
  ) {
    return;
  }
  if (!plan.identities.cloudflare_token_provisioner) {
    context.addIssue({
      code: "custom",
      path: ["secrets", index, "creation"],
      message: "requires a separate Cloudflare token-provisioner identity",
    });
  }
  if (!secret.sensitive) {
    context.addIssue({
      code: "custom",
      path: ["secrets", index, "sensitive"],
      message: "must be true for a generated Cloudflare API token",
    });
  }
  addDuplicateIssues(
    secret.creation.permission_groups.map(({ id }) => id),
    `Cloudflare permission-group ids for secret '${secret.id}'`,
    context,
  );
}

export const secretBootstrapPlanSchema = z
  .object({
    schema_version: z.literal(1),
    project_id: slugSchema,
    provider_origins: z
      .object({
        doppler: originSchema,
        github: originSchema,
        cloudflare: originSchema.optional(),
      })
      .strict(),
    identities: identitiesSchema,
    checkpoints: z.array(checkpointSchema).default([]),
    secrets: z.array(bootstrapSecretSchema).min(1),
  })
  .strict()
  .superRefine((plan, context) => {
    addDuplicateIssues(plan.identities.doppler.configs, "Doppler configs", context);
    addDuplicateIssues(
      plan.identities.github.environments,
      "GitHub environments",
      context,
    );
    addDuplicateIssues(
      plan.checkpoints.map(({ id }) => id),
      "checkpoint ids",
      context,
    );
    addDuplicateIssues(
      plan.secrets.map(({ id }) => id),
      "secret ids",
      context,
    );
    addDuplicateIssues(
      plan.secrets.map(
        (secret) =>
          `${secret.system_of_record.config}/${secret.system_of_record.name}`,
      ),
      "Doppler secret destinations",
      context,
    );
    validateSecretScopes(plan, context);
    if (
      (plan.identities.cloudflare ||
        plan.identities.cloudflare_token_provisioner) &&
      !plan.provider_origins.cloudflare
    ) {
      context.addIssue({
        code: "custom",
        path: ["provider_origins", "cloudflare"],
        message: "is required when a Cloudflare identity is declared",
      });
    }
  });

export type SecretBootstrapPlan = z.infer<typeof secretBootstrapPlanSchema>;
export type BootstrapSecret = SecretBootstrapPlan["secrets"][number];

export const secretBootstrapStateSchema = z
  .object({
    schema_version: z.literal(1),
    project_id: slugSchema,
    plan_digest: z.string().regex(/^[0-9a-f]{64}$/),
    acknowledged_checkpoints: z.array(slugSchema),
    completed_secrets: z.array(slugSchema),
  })
  .strict();

export type SecretBootstrapState = z.infer<typeof secretBootstrapStateSchema>;

export interface SafeBootstrapPlan {
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly planDigest: string;
  readonly checkpoints: readonly {
    readonly id: string;
    readonly provider: string;
    readonly instructions: string;
    readonly status: "acknowledged" | "waiting";
  }[];
  readonly secrets: readonly {
    readonly id: string;
    readonly name: string;
    readonly sensitive: boolean;
    readonly systemOfRecord: string;
    readonly consumers: readonly string[];
    readonly rotationOwner: string;
    readonly creation: "manual" | "generated" | "extension";
    readonly sourceDetails?: {
      readonly provider: "cloudflare";
      readonly ownership: "account";
      readonly tokenName: string;
      readonly accountIdEnvironment: string;
      readonly permissionGroups: readonly {
        readonly id: string;
        readonly name: string;
      }[];
      readonly expiresOn?: string;
    };
    readonly status: "complete" | "ready" | "waiting";
  }[];
}

export interface BootstrapCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly stdin: string;
  readonly environment: Readonly<Record<string, string>>;
}

export type BootstrapCommandRunner = (command: BootstrapCommand) => Promise<void>;
export type CredentialFetch = (
  url: URL,
  init: RequestInit,
) => Promise<Pick<Response, "ok" | "status"> & { json?: () => Promise<unknown> }>;
export type SecretSourceExtension = (input: {
  readonly plan: SecretBootstrapPlan;
  readonly secret: BootstrapSecret;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly fetch: CredentialFetch;
}) => Promise<string>;

export interface ExecuteSecretBootstrapInput {
  readonly plan: SecretBootstrapPlan;
  readonly state?: SecretBootstrapState;
  readonly acknowledge?: readonly string[];
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly persist: (state: SecretBootstrapState) => Promise<void>;
  readonly runCommand?: BootstrapCommandRunner;
  readonly fetch?: CredentialFetch;
  readonly extensions?: Readonly<Record<string, SecretSourceExtension>>;
}

function addDuplicateIssues(
  values: readonly string[],
  label: string,
  context: z.RefinementCtx,
): void {
  const duplicate = values.find(
    (value, index) => values.indexOf(value) !== index,
  );
  if (duplicate) {
    context.addIssue({
      code: "custom",
      message: `duplicate ${label}: '${duplicate}'`,
    });
  }
}

export function parseSecretBootstrapPlan(source: string): SecretBootstrapPlan {
  return secretBootstrapPlanSchema.parse(parse(source));
}

export function secretBootstrapPlanDigest(plan: SecretBootstrapPlan): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

export function assertApprovedProviderOrigins(plan: SecretBootstrapPlan): void {
  for (const provider of ["doppler", "github", "cloudflare"] as const) {
    const configured = plan.provider_origins[provider];
    if (
      configured !== undefined &&
      configured !== APPROVED_PROVIDER_ORIGINS[provider]
    ) {
      throw new Error(
        `Refusing ${provider} credential transfer to unapproved origin '${configured}'`,
      );
    }
  }
}

function initialState(plan: SecretBootstrapPlan): SecretBootstrapState {
  return {
    schema_version: 1,
    project_id: plan.project_id,
    plan_digest: secretBootstrapPlanDigest(plan),
    acknowledged_checkpoints: [],
    completed_secrets: [],
  };
}

function validateState(
  plan: SecretBootstrapPlan,
  state: SecretBootstrapState | undefined,
): SecretBootstrapState {
  if (!state) return initialState(plan);
  const parsed = secretBootstrapStateSchema.parse(state);
  if (parsed.project_id !== plan.project_id) {
    throw new Error(
      `Bootstrap state is for project '${parsed.project_id}', not '${plan.project_id}'`,
    );
  }
  const digest = secretBootstrapPlanDigest(plan);
  if (parsed.plan_digest !== digest) {
    throw new Error("Bootstrap plan changed; review it and start a new state file");
  }
  const checkpointIds = new Set(plan.checkpoints.map(({ id }) => id));
  const secretIds = new Set(plan.secrets.map(({ id }) => id));
  const hasInvalidCheckpoint = parsed.acknowledged_checkpoints.some(
    (id, index, values) => !checkpointIds.has(id) || values.indexOf(id) !== index,
  );
  const hasInvalidSecret = parsed.completed_secrets.some(
    (id, index, values) => !secretIds.has(id) || values.indexOf(id) !== index,
  );
  if (hasInvalidCheckpoint || hasInvalidSecret) {
    throw new Error("Bootstrap state contains an unknown or duplicate completion id");
  }
  return parsed;
}

function checkpointForSecret(secret: BootstrapSecret): string | undefined {
  return "checkpoint" in secret.creation
    ? secret.creation.checkpoint
    : undefined;
}

function consumerLabel(
  consumer: BootstrapSecret["consumers"][number],
): string {
  return consumer.kind === "github-environment"
    ? `github:${consumer.environment}/${consumer.name}`
    : `cloudflare-worker:${consumer.worker}/${consumer.name}`;
}

export function planSecretBootstrap(input: {
  readonly plan: SecretBootstrapPlan;
  readonly state?: SecretBootstrapState;
  readonly acknowledge?: readonly string[];
}): SafeBootstrapPlan {
  assertApprovedProviderOrigins(input.plan);
  const state = validateState(input.plan, input.state);
  const declared = new Set(input.plan.checkpoints.map(({ id }) => id));
  const acknowledged = new Set(state.acknowledged_checkpoints);
  for (const checkpoint of input.acknowledge ?? []) {
    if (!declared.has(checkpoint)) {
      throw new Error(`Unknown bootstrap checkpoint '${checkpoint}'`);
    }
    acknowledged.add(checkpoint);
  }
  const complete = new Set(state.completed_secrets);
  return {
    schemaVersion: 1,
    projectId: input.plan.project_id,
    planDigest: state.plan_digest,
    checkpoints: input.plan.checkpoints.map((checkpoint) => ({
      ...checkpoint,
      status: acknowledged.has(checkpoint.id) ? "acknowledged" : "waiting",
    })),
    secrets: input.plan.secrets.map((secret) => {
      const checkpoint = checkpointForSecret(secret);
      let status: "complete" | "waiting" | "ready" = "ready";
      if (complete.has(secret.id)) {
        status = "complete";
      } else if (checkpoint && !acknowledged.has(checkpoint)) {
        status = "waiting";
      }
      return {
        id: secret.id,
        name: secret.name,
        sensitive: secret.sensitive,
        systemOfRecord: `doppler:${input.plan.identities.doppler.project}/${secret.system_of_record.config}/${secret.system_of_record.name}`,
        consumers: secret.consumers.map(consumerLabel),
        rotationOwner: secret.rotation_owner,
        creation: secret.creation.mode,
        ...(secret.creation.mode === "extension" &&
        secret.creation.extension === "cloudflare-account-token" &&
        "permission_groups" in secret.creation
          ? {
              sourceDetails: {
                provider: "cloudflare" as const,
                ownership: "account" as const,
                tokenName: secret.creation.token_name,
                accountIdEnvironment:
                  input.plan.identities.cloudflare_token_provisioner
                    ?.account_id_env ?? "",
                permissionGroups: secret.creation.permission_groups,
                ...(secret.creation.expires_on
                  ? { expiresOn: secret.creation.expires_on }
                  : {}),
              },
            }
          : {}),
        status,
      };
    }),
  };
}

function requiredEnvironmentValue(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = environment[name];
  if (!value) throw new Error(`Required environment variable '${name}' is missing`);
  return value;
}

async function resolveSecretValue(
  plan: SecretBootstrapPlan,
  secret: BootstrapSecret,
  input: ExecuteSecretBootstrapInput,
): Promise<string> {
  if (secret.creation.mode === "manual") {
    return requiredEnvironmentValue(input.environment, secret.creation.value_env);
  }
  if (secret.creation.mode === "generated") {
    return randomBytes(secret.creation.bytes).toString("base64url");
  }
  const extension = input.extensions?.[secret.creation.extension];
  if (!extension) {
    throw new Error(
      `Secret '${secret.id}' requires unavailable source extension '${secret.creation.extension}'`,
    );
  }
  const value = await extension({
    plan,
    secret,
    environment: input.environment,
    fetch: input.fetch ?? fetch,
  });
  if (!value) throw new Error(`Source extension '${secret.creation.extension}' returned an empty value`);
  return value;
}

function providerEnvironment(
  tokenName: string,
  token: string,
): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    NO_COLOR: "1",
    [tokenName]: token,
  };
}

export const runBootstrapCommand: BootstrapCommandRunner = async (input) => {
  const privateTempDirectory = await mkdtemp(
    path.join(tmpdir(), "project-secret-bootstrap-"),
  );
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(input.command, [...input.args], {
        env: { ...input.environment, TMPDIR: privateTempDirectory },
        stdio: ["pipe", "ignore", "ignore"],
      });
      child.once("error", () => reject(new Error(`Failed to start '${input.command}'`)));
      child.once("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Provider command '${input.command}' failed with exit code ${code ?? "unknown"}`));
      });
      child.stdin.end(input.stdin);
    });
  } finally {
    await rm(privateTempDirectory, { recursive: true, force: true });
  }
};

async function writeDopplerSecret(
  plan: SecretBootstrapPlan,
  secret: BootstrapSecret,
  value: string,
  runCommand: BootstrapCommandRunner,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<void> {
  const identity = plan.identities.doppler;
  const token = requiredEnvironmentValue(environment, identity.token_env);
  await runCommand({
    command: "doppler",
    args: [
      "secrets",
      "set",
      secret.system_of_record.name,
      "--project",
      identity.project,
      "--config",
      secret.system_of_record.config,
      "--visibility",
      secret.sensitive ? "masked" : "unmasked",
      "--no-interactive",
      "--silent",
      "--api-host",
      plan.provider_origins.doppler,
    ],
    stdin: value,
    environment: providerEnvironment("DOPPLER_TOKEN", token),
  });
}

async function writeGithubSecret(
  plan: SecretBootstrapPlan,
  consumer: Extract<BootstrapSecret["consumers"][number], { kind: "github-environment" }>,
  value: string,
  runCommand: BootstrapCommandRunner,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<void> {
  const identity = plan.identities.github;
  const token = requiredEnvironmentValue(environment, identity.token_env);
  await runCommand({
    command: "gh",
    args: [
      "secret",
      "set",
      consumer.name,
      "--env",
      consumer.environment,
      "--repo",
      `github.com/${identity.repository}`,
    ],
    stdin: value,
    environment: {
      ...providerEnvironment("GH_TOKEN", token),
      GH_HOST: "github.com",
      GH_PROMPT_DISABLED: "1",
    },
  });
}

async function writeCloudflareWorkerSecret(
  plan: SecretBootstrapPlan,
  consumer: Extract<BootstrapSecret["consumers"][number], { kind: "cloudflare-worker" }>,
  value: string,
  fetchCredential: CredentialFetch,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<void> {
  const identity = plan.identities.cloudflare;
  const origin = plan.provider_origins.cloudflare;
  if (!identity || !origin) throw new Error("Cloudflare identity is not configured");
  const token = requiredEnvironmentValue(environment, identity.token_env);
  const accountId = requiredEnvironmentValue(environment, identity.account_id_env);
  const url = new URL(
    `/client/v4/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(consumer.worker)}/secrets`,
    origin,
  );
  if (url.origin !== APPROVED_PROVIDER_ORIGINS.cloudflare) {
    throw new Error(`Refusing Cloudflare credential transfer to '${url.origin}'`);
  }
  const response = await fetchCredential(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: consumer.name, text: value, type: "secret_text" }),
  });
  if (!response.ok) {
    throw new Error(`Cloudflare secret update failed with status ${response.status}`);
  }
}

async function distributeSecret(
  plan: SecretBootstrapPlan,
  secret: BootstrapSecret,
  value: string,
  input: ExecuteSecretBootstrapInput,
): Promise<void> {
  const runCommand = input.runCommand ?? runBootstrapCommand;
  const fetchCredential = input.fetch ?? fetch;
  await writeDopplerSecret(plan, secret, value, runCommand, input.environment);
  for (const consumer of secret.consumers) {
    if (consumer.kind === "github-environment") {
      await writeGithubSecret(
        plan,
        consumer,
        value,
        runCommand,
        input.environment,
      );
    } else {
      await writeCloudflareWorkerSecret(
        plan,
        consumer,
        value,
        fetchCredential,
        input.environment,
      );
    }
  }
}

export async function executeSecretBootstrap(
  input: ExecuteSecretBootstrapInput,
): Promise<{ readonly state: SecretBootstrapState; readonly plan: SafeBootstrapPlan }> {
  assertApprovedProviderOrigins(input.plan);
  const current = validateState(input.plan, input.state);
  const declared = new Set(input.plan.checkpoints.map(({ id }) => id));
  const acknowledged = new Set(current.acknowledged_checkpoints);
  for (const checkpoint of input.acknowledge ?? []) {
    if (!declared.has(checkpoint)) {
      throw new Error(`Unknown bootstrap checkpoint '${checkpoint}'`);
    }
    acknowledged.add(checkpoint);
  }
  let state: SecretBootstrapState = {
    ...current,
    acknowledged_checkpoints: [...acknowledged].toSorted((left, right) =>
      left.localeCompare(right),
    ),
  };
  await input.persist(state);
  const completed = new Set(state.completed_secrets);
  for (const secret of input.plan.secrets) {
    if (completed.has(secret.id)) continue;
    const checkpoint = checkpointForSecret(secret);
    if (checkpoint && !acknowledged.has(checkpoint)) continue;
    const value = await resolveSecretValue(input.plan, secret, input);
    await distributeSecret(input.plan, secret, value, input);
    completed.add(secret.id);
    state = {
      ...state,
      completed_secrets: [...completed].toSorted((left, right) =>
        left.localeCompare(right),
      ),
    };
    await input.persist(state);
  }
  return {
    state,
    plan: planSecretBootstrap({ plan: input.plan, state }),
  };
}
