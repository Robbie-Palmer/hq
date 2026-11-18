import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  conformCloudflareAccountTokenAuthority,
  createCloudflareAccountToken,
  createCloudflareR2ParentCredentials,
  handoffCloudflareAccountTokenAuthority,
} from "../src/cloudflare-account-token.js";
import {
  secretBootstrapPlanSchema,
  type CredentialFetch,
} from "../src/secret-bootstrap.js";

const BOOTSTRAP_PERMISSION_ID = "b".repeat(32);
const DOWNSTREAM_PERMISSION_ID = "d".repeat(32);
const R2_PERMISSION_ID = "e".repeat(32);

function plan() {
  return secretBootstrapPlanSchema.parse({
    schema_version: 1,
    project_id: "sample-service",
    provider_origins: {
      doppler: "https://api.doppler.com",
      github: "https://api.github.com",
      cloudflare: "https://api.cloudflare.com",
    },
    identities: {
      doppler: {
        project: "sample-service",
        configs: [
          {
            name: "prd",
            token_env: "DOPPLER_BOOTSTRAP_TOKEN_PRD",
          },
        ],
      },
      github: {
        token_env: "GH_BOOTSTRAP_TOKEN",
        repository: "example/sample-service",
        environments: ["production-sample-service"],
      },
      cloudflare: {
        token_env: "CLOUDFLARE_BOOTSTRAP_TOKEN",
        account_id_env: "CLOUDFLARE_ACCOUNT_ID",
        workers: ["sample-service"],
      },
      cloudflare_token_provisioner: {
        token_env: "CLOUDFLARE_TOKEN_PROVISIONER_TOKEN",
        account_id_env: "CLOUDFLARE_ACCOUNT_ID",
      },
    },
    checkpoints: [],
    secrets: [
      {
        id: "cloudflare-deploy-token",
        name: "CLOUDFLARE_API_TOKEN",
        sensitive: true,
        system_of_record: {
          kind: "doppler",
          config: "prd",
          name: "CLOUDFLARE_API_TOKEN",
        },
        consumers: [
          {
            kind: "github-environment",
            environment: "production-sample-service",
            name: "CLOUDFLARE_API_TOKEN",
          },
        ],
        rotation_owner: "platform-operations",
        creation: {
          mode: "extension",
          extension: "cloudflare-account-token",
          token_name: "sample-service-production-deploy",
          permission_groups: [
            { id: DOWNSTREAM_PERMISSION_ID, name: "Workers Scripts Write" },
          ],
        },
      },
    ],
  });
}

function r2Plan(expiresOn?: string) {
  const base = plan();
  return secretBootstrapPlanSchema.parse({
    ...base,
    project_id: "r2-parent",
    secrets: [
      {
        ...base.secrets[0],
        id: "r2-parent-credentials",
        name: "CLOUDFLARE_R2_PARENT_CREDENTIALS",
        system_of_record: {
          kind: "doppler",
          config: "prd",
          name: "CLOUDFLARE_R2_PARENT_CREDENTIALS",
        },
        consumers: [
          {
            kind: "github-environment",
            environment: "production-sample-service",
            name: "CLOUDFLARE_R2_PARENT_CREDENTIALS",
          },
        ],
        creation: {
          mode: "extension",
          extension: "cloudflare-r2-parent-credentials",
          token_name: "sample-r2-parent",
          permission_group: {
            id: R2_PERMISSION_ID,
            name: "Workers R2 Storage Write",
          },
          ...(expiresOn ? { expires_on: expiresOn } : {}),
        },
      },
    ],
  });
}

const environment = {
  CLOUDFLARE_TOKEN_PROVISIONER_TOKEN: "bootstrap-secret",
  CLOUDFLARE_ACCOUNT_ID: "account-123",
};

function jsonResponse(result: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ result }),
  };
}

function conformantFetch(createdValue = "generated-secret") {
  const requests: { url: URL; init: RequestInit }[] = [];
  const fetchCredential: CredentialFetch = async (url, init) => {
    requests.push({ url, init });
    if (url.pathname.endsWith("/permission_groups")) {
      return jsonResponse([
        {
          id: BOOTSTRAP_PERMISSION_ID,
          name: "Account API Tokens Write",
          is_selectable: true,
          scopes: ["com.cloudflare.api.account"],
        },
        {
          id: DOWNSTREAM_PERMISSION_ID,
          name: "Workers Scripts Write",
          is_selectable: true,
          scopes: ["com.cloudflare.api.account"],
        },
        {
          id: R2_PERMISSION_ID,
          name: "Workers R2 Storage Write",
          is_selectable: true,
          scopes: ["com.cloudflare.api.account"],
        },
      ]);
    }
    if (url.pathname.endsWith("/tokens/verify")) {
      return jsonResponse({ id: "token-id", status: "active" });
    }
    if (url.pathname.endsWith("/tokens/token-id")) {
      return jsonResponse({
        policies: [
          {
            effect: "allow",
            permission_groups: [{ id: BOOTSTRAP_PERMISSION_ID }],
            resources: { "com.cloudflare.api.account.account-123": "*" },
          },
        ],
      });
    }
    if (url.pathname.endsWith("/tokens") && init.method === "POST") {
      return jsonResponse({ id: "created-token-id", value: createdValue });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  };
  return { fetchCredential, requests };
}

describe("Cloudflare account-token provisioner", () => {
  it("checks exact bootstrap authority without returning credentials", async () => {
    const { fetchCredential, requests } = conformantFetch();
    const result = await conformCloudflareAccountTokenAuthority({
      plan: plan(),
      environment,
      fetch: fetchCredential,
    });

    expect(result).toEqual({
      provider: "cloudflare",
      ownership: "account",
      accountIdEnvironment: "CLOUDFLARE_ACCOUNT_ID",
      bootstrapPermission: "Account API Tokens Write",
      downstreamPermissionGroups: 1,
      status: "conformant",
    });
    expect(JSON.stringify(result)).not.toContain("bootstrap-secret");
    expect(requests).toHaveLength(3);
    expect(requests.every(({ url }) => url.origin === "https://api.cloudflare.com")).toBe(true);
  });

  it("creates one account-scoped token and returns only its one-time value", async () => {
    const currentPlan = plan();
    const secret = currentPlan.secrets[0];
    if (!secret) throw new Error("missing test secret");
    const { fetchCredential, requests } = conformantFetch();
    const value = await createCloudflareAccountToken({
      plan: currentPlan,
      secret,
      environment,
      fetch: fetchCredential,
    });

    expect(value).toBe("generated-secret");
    const creation = requests.find(({ init }) => init.method === "POST");
    expect(creation?.url.pathname).toBe(
      "/client/v4/accounts/account-123/tokens",
    );
    expect(JSON.parse(String(creation?.init.body))).toEqual({
      name: "sample-service-production-deploy",
      policies: [
        {
          effect: "allow",
          permission_groups: [{ id: DOWNSTREAM_PERMISSION_ID }],
          resources: { "com.cloudflare.api.account.account-123": "*" },
        },
      ],
    });
    expect(JSON.stringify(creation?.init)).not.toContain("generated-secret");
  });

  it("creates and verifies one R2 parent credential bundle", async () => {
    const currentPlan = r2Plan("2027-01-01T00:00:00Z");
    const secret = currentPlan.secrets[0];
    if (!secret) throw new Error("missing R2 parent test secret");
    const base = conformantFetch();
    const fetchCredential: CredentialFetch = async (url, init) => {
      if (url.pathname.endsWith("/tokens/created-token-id")) {
        return jsonResponse({
          policies: [
            {
              effect: "allow",
              permission_groups: [{ id: R2_PERMISSION_ID }],
              resources: {
                "com.cloudflare.api.account.account-123": {
                  "com.cloudflare.edge.r2.bucket.*": "*",
                },
              },
            },
          ],
        });
      }
      if (
        url.pathname.endsWith("/tokens/verify") &&
        (init.headers as Record<string, string>).Authorization ===
          "Bearer generated-secret"
      ) {
        return jsonResponse({ id: "created-token-id", status: "active" });
      }
      return base.fetchCredential(url, init);
    };

    const serialized = await createCloudflareR2ParentCredentials({
      plan: currentPlan,
      secret,
      environment,
      fetch: fetchCredential,
    });

    expect(JSON.parse(serialized)).toEqual({
      schemaVersion: 1,
      apiToken: "generated-secret",
      accessKeyId: "created-token-id",
      secretAccessKey: createHash("sha256")
        .update("generated-secret")
        .digest("hex"),
    });
    const creation = base.requests.find(({ init }) => init.method === "POST");
    expect(JSON.parse(String(creation?.init.body))).toEqual({
      name: "sample-r2-parent",
      policies: [
        {
          effect: "allow",
          permission_groups: [{ id: R2_PERMISSION_ID }],
          resources: {
            "com.cloudflare.api.account.account-123": {
              "com.cloudflare.edge.r2.bucket.*": "*",
            },
          },
        },
      ],
      expires_on: "2027-01-01T00:00:00Z",
    });
  });

  it("rejects an incompatible secret for R2 parent provisioning", async () => {
    const currentPlan = plan();
    const secret = currentPlan.secrets[0];
    if (!secret) throw new Error("missing test secret");

    await expect(
      createCloudflareR2ParentCredentials({
        plan: currentPlan,
        secret,
        environment,
        fetch: vi.fn(),
      }),
    ).rejects.toThrow(/incompatible secret/);
  });

  it("rejects a created R2 parent token with the wrong identity or policy", async () => {
    const currentPlan = r2Plan();
    const secret = currentPlan.secrets[0];
    if (!secret) throw new Error("missing R2 parent test secret");
    const cases: readonly {
      readonly verifyId: string;
      readonly policies: readonly Record<string, unknown>[];
      readonly expected: RegExp;
    }[] = [
      {
        verifyId: "other-token-id",
        policies: [
          {
            effect: "allow",
            permission_groups: [{ id: R2_PERMISSION_ID }],
            resources: {
              "com.cloudflare.api.account.account-123": {
                "com.cloudflare.edge.r2.bucket.*": "*",
              },
            },
          },
        ],
        expected: /wrong token/,
      },
      {
        verifyId: "created-token-id",
        policies: [],
        expected: /exactly one policy/,
      },
      {
        verifyId: "created-token-id",
        policies: [
          {
            effect: "allow",
            permission_groups: [{ id: DOWNSTREAM_PERMISSION_ID }],
            resources: {
              "com.cloudflare.api.account.account-123": {
                "com.cloudflare.edge.r2.bucket.*": "*",
              },
            },
          },
        ],
        expected: /grant only/,
      },
      {
        verifyId: "created-token-id",
        policies: [
          {
            effect: "allow",
            permission_groups: [{ id: R2_PERMISSION_ID }],
            resources: { "com.cloudflare.api.account.account-123": "*" },
          },
        ],
        expected: /all R2 buckets/,
      },
    ];
    for (const testCase of cases) {
      const base = conformantFetch();
      const fetchCredential: CredentialFetch = async (url, init) => {
        if (
          url.pathname.endsWith("/tokens/verify") &&
          (init.headers as Record<string, string>).Authorization ===
            "Bearer generated-secret"
        ) {
          return jsonResponse({ id: testCase.verifyId, status: "active" });
        }
        if (url.pathname.endsWith("/tokens/created-token-id")) {
          return jsonResponse({ policies: testCase.policies });
        }
        return base.fetchCredential(url, init);
      };
      await expect(
        createCloudflareR2ParentCredentials({
          plan: currentPlan,
          secret,
          environment,
          fetch: fetchCredential,
        }),
      ).rejects.toThrow(testCase.expected);
    }
  });

  it("validates a manually created replacement authority before handoff", async () => {
    const base = plan();
    const authorityPlan = secretBootstrapPlanSchema.parse({
      ...base,
      checkpoints: [
        {
          id: "rotate-token-authority",
          provider: "cloudflare",
          instructions: "Create the replacement in the owner dashboard.",
        },
      ],
      secrets: [
        {
          ...base.secrets[0],
          creation: {
            mode: "extension",
            extension: "cloudflare-account-token-authority",
            checkpoint: "rotate-token-authority",
            value_env: "NEW_CLOUDFLARE_TOKEN_PROVISIONER_TOKEN",
          },
        },
      ],
    });
    const secret = authorityPlan.secrets[0];
    if (!secret) throw new Error("missing authority test secret");
    const { fetchCredential, requests } = conformantFetch();

    await expect(
      handoffCloudflareAccountTokenAuthority({
        plan: authorityPlan,
        secret,
        environment: {
          ...environment,
          NEW_CLOUDFLARE_TOKEN_PROVISIONER_TOKEN: "replacement-authority",
        },
        fetch: fetchCredential,
      }),
    ).resolves.toBe("replacement-authority");
    expect(requests).toHaveLength(3);
    expect(requests.every(({ init }) => init.method !== "POST")).toBe(true);
    expect(requests[0]?.init.headers).toMatchObject({
      Authorization: "Bearer replacement-authority",
    });
  });

  it("rejects extra bootstrap privilege, wrong account scope, and renamed permissions", async () => {
    const currentPlan = plan();
    const cases = [
      {
        policies: [
          {
            effect: "allow",
            permission_groups: [
              { id: BOOTSTRAP_PERMISSION_ID },
              { id: DOWNSTREAM_PERMISSION_ID },
            ],
            resources: { "com.cloudflare.api.account.account-123": "*" },
          },
        ],
        expected: /grant only/,
      },
      {
        policies: [
          {
            effect: "allow",
            permission_groups: [{ id: BOOTSTRAP_PERMISSION_ID }],
            resources: { "com.cloudflare.api.account.other": "*" },
          },
        ],
        expected: /declared account/,
      },
    ];
    for (const testCase of cases) {
      const { fetchCredential } = conformantFetch();
      const fetchWithPolicy: CredentialFetch = async (url, init) =>
        url.pathname.endsWith("/tokens/token-id")
          ? jsonResponse({ policies: testCase.policies })
          : fetchCredential(url, init);
      await expect(
        conformCloudflareAccountTokenAuthority({
          plan: currentPlan,
          environment,
          fetch: fetchWithPolicy,
        }),
      ).rejects.toThrow(testCase.expected);
    }

    const { fetchCredential } = conformantFetch();
    const renamedFetch: CredentialFetch = async (url, init) => {
      if (url.pathname.endsWith("/permission_groups")) {
        return jsonResponse([
          {
            id: BOOTSTRAP_PERMISSION_ID,
            name: "Account API Tokens Write",
            scopes: ["com.cloudflare.api.account"],
          },
          {
            id: DOWNSTREAM_PERMISSION_ID,
            name: "Renamed permission",
            is_selectable: true,
            scopes: ["com.cloudflare.api.account"],
          },
        ]);
      }
      return fetchCredential(url, init);
    };
    await expect(
      conformCloudflareAccountTokenAuthority({
        plan: currentPlan,
        environment,
        fetch: renamedFetch,
      }),
    ).rejects.toThrow(/renamed/);
  });

  it("does not include Cloudflare response bodies in failures", async () => {
    const sensitiveBody = vi.fn(async () => ({ secret: "do-not-log" }));
    await expect(
      conformCloudflareAccountTokenAuthority({
        plan: plan(),
        environment,
        fetch: async () => ({ ok: false, status: 403, json: sensitiveBody }),
      }),
    ).rejects.toThrow("failed with status 403");
    expect(sensitiveBody).not.toHaveBeenCalled();
  });

  it("requires the dedicated identity and approved Cloudflare origin", async () => {
    const currentPlan = plan();
    const { cloudflare_token_provisioner: _provisioner, ...identities } =
      currentPlan.identities;
    await expect(
      conformCloudflareAccountTokenAuthority({
        plan: { ...currentPlan, identities },
        environment,
        fetch: conformantFetch().fetchCredential,
      }),
    ).rejects.toThrow(/separate token-provisioner identity/);

    await expect(
      conformCloudflareAccountTokenAuthority({
        plan: {
          ...currentPlan,
          provider_origins: {
            ...currentPlan.provider_origins,
            cloudflare: "https://example.com",
          },
        },
        environment,
        fetch: conformantFetch().fetchCredential,
      }),
    ).rejects.toThrow(/approved API origin/);
  });

  it("rejects missing, invalid, and malformed Cloudflare responses", async () => {
    const responses = [
      {
        response: { ok: true, status: 200 },
        expected: /no JSON response/,
      },
      {
        response: {
          ok: true,
          status: 200,
          json: async () => {
            throw new Error("sensitive parse failure");
          },
        },
        expected: /invalid JSON/,
      },
      {
        response: { ok: true, status: 200, json: async () => ({ result: null }) },
        expected: /unexpected response/,
      },
    ];

    for (const testCase of responses) {
      await expect(
        conformCloudflareAccountTokenAuthority({
          plan: plan(),
          environment,
          fetch: async () => testCase.response,
        }),
      ).rejects.toThrow(testCase.expected);
    }
  });

  it("requires the bootstrap permission and exactly one bootstrap policy", async () => {
    const currentPlan = plan();
    const { fetchCredential } = conformantFetch();
    const withoutBootstrapPermission: CredentialFetch = async (url, init) =>
      url.pathname.endsWith("/permission_groups")
        ? jsonResponse([
            {
              id: DOWNSTREAM_PERMISSION_ID,
              name: "Workers Scripts Write",
              is_selectable: true,
              scopes: ["com.cloudflare.api.account"],
            },
          ])
        : fetchCredential(url, init);
    await expect(
      conformCloudflareAccountTokenAuthority({
        plan: currentPlan,
        environment,
        fetch: withoutBootstrapPermission,
      }),
    ).rejects.toThrow(/did not expose/);

    const withoutPolicy: CredentialFetch = async (url, init) =>
      url.pathname.endsWith("/tokens/token-id")
        ? jsonResponse({ policies: [] })
        : fetchCredential(url, init);
    await expect(
      conformCloudflareAccountTokenAuthority({
        plan: currentPlan,
        environment,
        fetch: withoutPolicy,
      }),
    ).rejects.toThrow(/exactly one policy/);
  });
});
