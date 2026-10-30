import { z } from "zod";
import {
  APPROVED_PROVIDER_ORIGINS,
  type BootstrapSecret,
  type CredentialFetch,
  type SecretBootstrapPlan,
  type SecretSourceExtension,
} from "./secret-bootstrap.js";

const CLOUDFLARE_ACCOUNT_TOKEN_WRITE = "Account API Tokens Write";

const permissionGroupSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  is_selectable: z.boolean().optional(),
  scopes: z.array(z.string()).optional(),
});

const permissionGroupsResponseSchema = z.looseObject({
  result: z.array(permissionGroupSchema),
});
const verifyResponseSchema = z.looseObject({
  result: z.looseObject({ id: z.string(), status: z.literal("active") }),
});
const tokenPolicySchema = z.looseObject({
  effect: z.literal("allow"),
  permission_groups: z.array(z.looseObject({ id: z.string() })),
  resources: z.record(z.string(), z.unknown()),
});
const tokenDetailsResponseSchema = z.looseObject({
  result: z.looseObject({ policies: z.array(tokenPolicySchema) }),
});
const createTokenResponseSchema = z.looseObject({
  result: z.looseObject({ value: z.string().min(1) }),
});

type CloudflareTokenCreation = BootstrapSecret["creation"] & {
  readonly mode: "extension";
  readonly extension: "cloudflare-account-token";
  readonly token_name: string;
  readonly permission_groups: readonly { readonly id: string; readonly name: string }[];
  readonly expires_on?: string;
};

function isCloudflareTokenCreation(
  creation: BootstrapSecret["creation"],
): creation is CloudflareTokenCreation {
  return (
    creation.mode === "extension" &&
    creation.extension === "cloudflare-account-token" &&
    "permission_groups" in creation
  );
}

function requiredEnvironmentValue(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = environment[name];
  if (!value) throw new Error(`Required environment variable '${name}' is missing`);
  return value;
}

function cloudflareIdentity(plan: SecretBootstrapPlan) {
  const identity = plan.identities.cloudflare_token_provisioner;
  if (!identity) {
    throw new Error(
      "Cloudflare token provisioning requires a separate token-provisioner identity",
    );
  }
  if (plan.provider_origins.cloudflare !== APPROVED_PROVIDER_ORIGINS.cloudflare) {
    throw new Error("Cloudflare token provisioning requires the approved API origin");
  }
  return identity;
}

async function responseJson(
  response: Awaited<ReturnType<CredentialFetch>>,
  operation: string,
): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`${operation} failed with status ${response.status}`);
  }
  if (!response.json) {
    throw new Error(`${operation} returned no JSON response`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`${operation} returned invalid JSON`);
  }
}

async function cloudflareRequest(
  fetchCredential: CredentialFetch,
  path: string,
  token: string,
  init: RequestInit = {},
) {
  const url = new URL(path, APPROVED_PROVIDER_ORIGINS.cloudflare);
  if (url.origin !== APPROVED_PROVIDER_ORIGINS.cloudflare) {
    throw new Error(`Refusing Cloudflare request to '${url.origin}'`);
  }
  return fetchCredential(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
}

function parseSafe<T>(schema: z.ZodType<T>, value: unknown, operation: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(`${operation} returned an unexpected response`);
  return result.data;
}

function assertBootstrapPolicy(input: {
  accountId: string;
  bootstrapPermissionId: string;
  policies: readonly z.infer<typeof tokenPolicySchema>[];
}): void {
  const accountResource = `com.cloudflare.api.account.${input.accountId}`;
  if (input.policies.length !== 1) {
    throw new Error("Cloudflare bootstrap token must have exactly one policy");
  }
  const policy = input.policies[0];
  if (
    policy?.permission_groups.length !== 1 ||
    policy.permission_groups[0]?.id !== input.bootstrapPermissionId
  ) {
    throw new Error(
      `Cloudflare bootstrap token must grant only '${CLOUDFLARE_ACCOUNT_TOKEN_WRITE}'`,
    );
  }
  const resources = Object.entries(policy.resources);
  if (
    resources.length !== 1 ||
    resources[0]?.[0] !== accountResource ||
    resources[0]?.[1] !== "*"
  ) {
    throw new Error("Cloudflare bootstrap token must be scoped to the declared account");
  }
}

async function readPermissionGroups(input: {
  accountId: string;
  token: string;
  fetch: CredentialFetch;
}) {
  const response = await cloudflareRequest(
    input.fetch,
    `/client/v4/accounts/${encodeURIComponent(input.accountId)}/tokens/permission_groups`,
    input.token,
  );
  return parseSafe(
    permissionGroupsResponseSchema,
    await responseJson(response, "Cloudflare permission-group lookup"),
    "Cloudflare permission-group lookup",
  ).result;
}

export async function conformCloudflareAccountTokenAuthority(input: {
  readonly plan: SecretBootstrapPlan;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly fetch?: CredentialFetch;
}): Promise<{
  readonly provider: "cloudflare";
  readonly ownership: "account";
  readonly accountIdEnvironment: string;
  readonly bootstrapPermission: typeof CLOUDFLARE_ACCOUNT_TOKEN_WRITE;
  readonly downstreamPermissionGroups: number;
  readonly status: "conformant";
}> {
  const identity = cloudflareIdentity(input.plan);
  const token = requiredEnvironmentValue(input.environment, identity.token_env);
  const accountId = requiredEnvironmentValue(
    input.environment,
    identity.account_id_env,
  );
  const fetchCredential = input.fetch ?? fetch;
  const permissionGroups = await readPermissionGroups({
    accountId,
    token,
    fetch: fetchCredential,
  });
  const bootstrapPermission = permissionGroups.find(
    ({ name }) => name === CLOUDFLARE_ACCOUNT_TOKEN_WRITE,
  );
  if (!bootstrapPermission) {
    throw new Error(
      `Cloudflare did not expose '${CLOUDFLARE_ACCOUNT_TOKEN_WRITE}' for the declared account`,
    );
  }

  const verifyResponse = await cloudflareRequest(
    fetchCredential,
    `/client/v4/accounts/${encodeURIComponent(accountId)}/tokens/verify`,
    token,
  );
  const verified = parseSafe(
    verifyResponseSchema,
    await responseJson(verifyResponse, "Cloudflare bootstrap-token verification"),
    "Cloudflare bootstrap-token verification",
  );
  const detailsResponse = await cloudflareRequest(
    fetchCredential,
    `/client/v4/accounts/${encodeURIComponent(accountId)}/tokens/${encodeURIComponent(verified.result.id)}`,
    token,
  );
  const details = parseSafe(
    tokenDetailsResponseSchema,
    await responseJson(detailsResponse, "Cloudflare bootstrap-token inspection"),
    "Cloudflare bootstrap-token inspection",
  );
  assertBootstrapPolicy({
    accountId,
    bootstrapPermissionId: bootstrapPermission.id,
    policies: details.result.policies,
  });

  const requested = input.plan.secrets.flatMap((secret) =>
    isCloudflareTokenCreation(secret.creation)
      ? secret.creation.permission_groups
      : [],
  );
  for (const expected of requested) {
    const actual = permissionGroups.find(({ id }) => id === expected.id);
    if (
      actual?.name !== expected.name ||
      actual?.is_selectable !== true ||
      !actual.scopes?.includes("com.cloudflare.api.account")
    ) {
      throw new Error(
        `Cloudflare permission group '${expected.id}' is unavailable, renamed, unselectable, or not account-scoped`,
      );
    }
  }

  return {
    provider: "cloudflare",
    ownership: "account",
    accountIdEnvironment: identity.account_id_env,
    bootstrapPermission: CLOUDFLARE_ACCOUNT_TOKEN_WRITE,
    downstreamPermissionGroups: new Set(requested.map(({ id }) => id)).size,
    status: "conformant",
  };
}

export const createCloudflareAccountToken: SecretSourceExtension = async (input) => {
  if (
    !isCloudflareTokenCreation(input.secret.creation)
  ) {
    throw new Error("Cloudflare token provisioner received an incompatible secret");
  }
  const creation = input.secret.creation;
  await conformCloudflareAccountTokenAuthority({
    plan: input.plan,
    environment: input.environment,
    fetch: input.fetch,
  });
  const identity = cloudflareIdentity(input.plan);
  const token = requiredEnvironmentValue(input.environment, identity.token_env);
  const accountId = requiredEnvironmentValue(
    input.environment,
    identity.account_id_env,
  );
  const resources = { [`com.cloudflare.api.account.${accountId}`]: "*" };
  const response = await cloudflareRequest(
    input.fetch,
    `/client/v4/accounts/${encodeURIComponent(accountId)}/tokens`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        name: creation.token_name,
        policies: [
          {
            effect: "allow",
            permission_groups: creation.permission_groups.map(({ id }) => ({ id })),
            resources,
          },
        ],
        ...(creation.expires_on ? { expires_on: creation.expires_on } : {}),
      }),
    },
  );
  return parseSafe(
    createTokenResponseSchema,
    await responseJson(response, "Cloudflare account-token creation"),
    "Cloudflare account-token creation",
  ).result.value;
};

export const handoffCloudflareAccountTokenAuthority: SecretSourceExtension = async (
  input,
) => {
  const creation = input.secret.creation;
  if (
    creation.mode !== "extension" ||
    creation.extension !== "cloudflare-account-token-authority" ||
    !("value_env" in creation)
  ) {
    throw new Error(
      "Cloudflare token-authority handoff received an incompatible secret",
    );
  }
  const value = input.environment[creation.value_env];
  if (!value) {
    throw new Error(
      `Required environment variable '${creation.value_env}' is missing`,
    );
  }
  const identity = cloudflareIdentity(input.plan);
  await conformCloudflareAccountTokenAuthority({
    plan: input.plan,
    environment: {
      ...input.environment,
      [identity.token_env]: value,
    },
    fetch: input.fetch,
  });
  return value;
};
