import { describe, expect, it, vi } from "vitest";
import {
  conformCloudflareAccountTokenAuthority,
  createCloudflareAccountToken,
} from "../src/cloudflare-account-token.js";
import {
  secretBootstrapPlanSchema,
  type CredentialFetch,
} from "../src/secret-bootstrap.js";

const BOOTSTRAP_PERMISSION_ID = "b".repeat(32);
const DOWNSTREAM_PERMISSION_ID = "d".repeat(32);

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
        token_env: "DOPPLER_BOOTSTRAP_TOKEN",
        project: "sample-service",
        configs: ["prd"],
      },
      github: {
        token_env: "GITHUB_BOOTSTRAP_TOKEN",
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
      return jsonResponse({ value: createdValue });
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
});
