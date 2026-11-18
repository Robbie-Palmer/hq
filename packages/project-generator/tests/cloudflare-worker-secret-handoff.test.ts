import { describe, expect, it, vi } from "vitest";
import {
  conformCloudflareWorkerSecretHandoff,
  proveCloudflareWorkerSecretHandoff,
} from "../src/cloudflare-worker-secret-handoff.js";
import {
  secretBootstrapPlanSchema,
  type CredentialFetch,
} from "../src/secret-bootstrap.js";

const ACCOUNT_TOKEN_WRITE_ID = "a".repeat(32);
const WORKERS_SCRIPTS_WRITE_ID = "e086da7e2179491d91ee5f35b3ca210a";

function plan() {
  return secretBootstrapPlanSchema.parse({
    schema_version: 1,
    project_id: "cloudflare-worker-secret-handoff",
    provider_origins: {
      doppler: "https://api.doppler.com",
      github: "https://api.github.com",
      cloudflare: "https://api.cloudflare.com",
    },
    identities: {
      doppler: {
        project: "cloudflare-token-bootstrap",
        configs: [{ name: "ops_provisioner", token_env: "DOPPLER_BOOTSTRAP_TOKEN" }],
      },
      github: {
        token_env: "GH_BOOTSTRAP_TOKEN",
        repository: "Robbie-Palmer/hq",
        environments: ["production-cloudflare-token-bootstrap"],
      },
      cloudflare: {
        token_env: "CLOUDFLARE_BOOTSTRAP_TOKEN",
        account_id_env: "CLOUDFLARE_ACCOUNT_ID",
        workers: ["hq-worker-secret-handoff-proof"],
      },
      cloudflare_token_provisioner: {
        token_env: "CLOUDFLARE_TOKEN_PROVISIONER_TOKEN",
        account_id_env: "CLOUDFLARE_ACCOUNT_ID",
      },
    },
    checkpoints: [],
    secrets: [
      {
        id: "cloudflare-worker-secret-handoff",
        name: "CLOUDFLARE_BOOTSTRAP_TOKEN",
        sensitive: true,
        system_of_record: {
          kind: "doppler",
          config: "ops_provisioner",
          name: "CLOUDFLARE_BOOTSTRAP_TOKEN",
        },
        consumers: [
          {
            kind: "github-environment",
            environment: "production-cloudflare-token-bootstrap",
            name: "CLOUDFLARE_BOOTSTRAP_TOKEN",
          },
        ],
        rotation_owner: "platform-operations",
        creation: {
          mode: "extension",
          extension: "cloudflare-account-token",
          token_name: "hq-worker-secret-handoff",
          permission_groups: [
            {
              id: WORKERS_SCRIPTS_WRITE_ID,
              name: "Workers Scripts Write",
            },
          ],
        },
      },
    ],
  });
}

const environment = {
  CLOUDFLARE_BOOTSTRAP_TOKEN: "handoff-credential",
  CLOUDFLARE_TOKEN_PROVISIONER_TOKEN: "provisioner-credential",
  CLOUDFLARE_ACCOUNT_ID: "account-id",
};

function jsonResponse(result: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ result }),
  };
}

function conformantFetch() {
  const requests: { url: URL; init: RequestInit }[] = [];
  const fetchCredential: CredentialFetch = async (url, init) => {
    requests.push({ url, init });
    const authorization = new Headers(init.headers).get("Authorization");
    if (url.pathname.endsWith("/permission_groups")) {
      return jsonResponse([
        {
          id: ACCOUNT_TOKEN_WRITE_ID,
          name: "Account API Tokens Write",
          is_selectable: true,
          scopes: ["com.cloudflare.api.account"],
        },
        {
          id: WORKERS_SCRIPTS_WRITE_ID,
          name: "Workers Scripts Write",
          is_selectable: true,
          scopes: ["com.cloudflare.api.account"],
        },
      ]);
    }
    if (url.pathname.endsWith("/tokens/verify")) {
      return jsonResponse({
        id:
          authorization === "Bearer handoff-credential"
            ? "handoff-id"
            : "provisioner-id",
        status: "active",
      });
    }
    if (url.pathname.endsWith("/tokens/provisioner-id")) {
      return jsonResponse({
        policies: [
          {
            effect: "allow",
            permission_groups: [{ id: ACCOUNT_TOKEN_WRITE_ID }],
            resources: { "com.cloudflare.api.account.account-id": "*" },
          },
        ],
      });
    }
    if (url.pathname.endsWith("/tokens/handoff-id")) {
      return jsonResponse({
        policies: [
          {
            effect: "allow",
            permission_groups: [{ id: WORKERS_SCRIPTS_WRITE_ID }],
            resources: { "com.cloudflare.api.account.account-id": "*" },
          },
        ],
      });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  };
  return { fetchCredential, requests };
}

type MockResponse = Awaited<ReturnType<CredentialFetch>>;
type ExpectedRequest = {
  readonly method: string;
  readonly pathSuffix: string;
  readonly response: MockResponse | ((init: RequestInit) => MockResponse);
};

function sequenceFetch(
  expectedRequests: readonly ExpectedRequest[],
  requests: { url: URL; init: RequestInit }[] = [],
): CredentialFetch {
  let index = 0;
  return async (url, init) => {
    requests.push({ url, init });
    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer handoff-credential",
    );
    const expected = expectedRequests[index];
    index += 1;
    if (!expected) throw new Error(`Unexpected request: ${url.pathname}`);
    expect(init.method ?? "GET").toBe(expected.method);
    expect(url.pathname.endsWith(expected.pathSuffix)).toBe(true);
    return typeof expected.response === "function"
      ? expected.response(init)
      : expected.response;
  };
}

describe("Cloudflare Worker secret handoff", () => {
  it("checks exact policy with separate credentials and returns no credential data", async () => {
    const { fetchCredential, requests } = conformantFetch();
    const result = await conformCloudflareWorkerSecretHandoff({
      plan: plan(),
      environment,
      fetch: fetchCredential,
    });

    expect(result).toEqual({
      provider: "cloudflare",
      ownership: "account",
      accountIdEnvironment: "CLOUDFLARE_ACCOUNT_ID",
      permission: "Workers Scripts Write",
      status: "conformant",
    });
    expect(JSON.stringify(result)).not.toMatch(/handoff-credential|provisioner-credential/);
    expect(requests).toHaveLength(5);
    const handoffInspection = requests.find(({ url }) =>
      url.pathname.endsWith("/tokens/handoff-id"),
    );
    expect(new Headers(handoffInspection?.init.headers).get("Authorization")).toBe(
      "Bearer provisioner-credential",
    );
  });

  it("rejects shared identities, extra privilege, and the wrong account", async () => {
    await expect(
      conformCloudflareWorkerSecretHandoff({
        plan: plan(),
        environment: {
          ...environment,
          CLOUDFLARE_BOOTSTRAP_TOKEN: "provisioner-credential",
        },
        fetch: conformantFetch().fetchCredential,
      }),
    ).rejects.toThrow(/must be distinct/);

    const extraPrivilege: CredentialFetch = async (url, init) => {
      const base = conformantFetch().fetchCredential;
      if (url.pathname.endsWith("/tokens/handoff-id")) {
        return jsonResponse({
          policies: [
            {
              effect: "allow",
              permission_groups: [
                { id: WORKERS_SCRIPTS_WRITE_ID },
                { id: ACCOUNT_TOKEN_WRITE_ID },
              ],
              resources: { "com.cloudflare.api.account.account-id": "*" },
            },
          ],
        });
      }
      return base(url, init);
    };
    await expect(
      conformCloudflareWorkerSecretHandoff({
        plan: plan(),
        environment,
        fetch: extraPrivilege,
      }),
    ).rejects.toThrow(/grant only/);

    const wrongAccount: CredentialFetch = async (url, init) => {
      const base = conformantFetch().fetchCredential;
      if (url.pathname.endsWith("/tokens/handoff-id")) {
        return jsonResponse({
          policies: [
            {
              effect: "allow",
              permission_groups: [{ id: WORKERS_SCRIPTS_WRITE_ID }],
              resources: { "com.cloudflare.api.account.other": "*" },
            },
          ],
        });
      }
      return base(url, init);
    };
    await expect(
      conformCloudflareWorkerSecretHandoff({
        plan: plan(),
        environment,
        fetch: wrongAccount,
      }),
    ).rejects.toThrow(/declared account/);
  });

  it("does not read provider bodies after a failed conformance request", async () => {
    const sensitiveBody = vi.fn(async () => ({ secret: "must-not-be-read" }));
    await expect(
      conformCloudflareWorkerSecretHandoff({
        plan: plan(),
        environment,
        fetch: async () => ({ ok: false, status: 403, json: sensitiveBody }),
      }),
    ).rejects.toThrow("failed with status 403");
    expect(sensitiveBody).not.toHaveBeenCalled();
  });

  it("proves a secret write with only the handoff credential and removes the Worker", async () => {
    const requests: { url: URL; init: RequestInit }[] = [];
    const workerPath = "/hq-worker-secret-handoff-proof";
    const fetchCredential = sequenceFetch([
      { method: "GET", pathSuffix: workerPath, response: { ok: false, status: 404 } },
      {
        method: "PUT",
        pathSuffix: workerPath,
        response: (init) => {
          expect(init.body).toBeInstanceOf(FormData);
          return { ok: true, status: 200 };
        },
      },
      {
        method: "PUT",
        pathSuffix: "/secrets",
        response: (init) => {
          const body = JSON.parse(String(init.body));
          expect(body).toMatchObject({
            name: "HANDOFF_PROOF",
            type: "secret_text",
          });
          expect(body.text).toMatch(/^[A-Za-z0-9_-]{43}$/);
          return { ok: true, status: 200 };
        },
      },
      {
        method: "GET",
        pathSuffix: "/secrets/HANDOFF_PROOF",
        response: jsonResponse({ name: "HANDOFF_PROOF", type: "secret_text" }),
      },
      { method: "DELETE", pathSuffix: workerPath, response: { ok: true, status: 200 } },
      { method: "GET", pathSuffix: workerPath, response: { ok: false, status: 404 } },
    ], requests);

    const result = await proveCloudflareWorkerSecretHandoff({
      plan: plan(),
      environment,
      fetch: fetchCredential,
    });

    expect(result).toEqual({
      provider: "cloudflare",
      worker: "hq-worker-secret-handoff-proof",
      secret: "HANDOFF_PROOF",
      cleanup: "complete",
      status: "proven",
    });
    expect(JSON.stringify(result)).not.toContain("handoff-credential");
    expect(requests.map(({ init }) => init.method ?? "GET")).toEqual([
      "GET",
      "PUT",
      "PUT",
      "GET",
      "DELETE",
      "GET",
    ]);
  });

  it("refuses an existing proof Worker before mutation", async () => {
    const fetchCredential = vi.fn<CredentialFetch>(async () => ({
      ok: true,
      status: 200,
    }));
    await expect(
      proveCloudflareWorkerSecretHandoff({
        plan: plan(),
        environment,
        fetch: fetchCredential,
      }),
    ).rejects.toThrow(/Refusing to replace/);
    expect(fetchCredential).toHaveBeenCalledTimes(1);
  });

  it("cleans up after a failed secret handoff and reports cleanup failure", async () => {
    const workerPath = "/hq-worker-secret-handoff-proof";
    const fetchCredential = sequenceFetch([
      { method: "GET", pathSuffix: workerPath, response: { ok: false, status: 404 } },
      { method: "PUT", pathSuffix: workerPath, response: { ok: true, status: 200 } },
      { method: "PUT", pathSuffix: "/secrets", response: { ok: false, status: 403 } },
      { method: "DELETE", pathSuffix: workerPath, response: { ok: false, status: 500 } },
    ]);

    await expect(
      proveCloudflareWorkerSecretHandoff({
        plan: plan(),
        environment,
        fetch: fetchCredential,
      }),
    ).rejects.toThrow(/secret handoff failed with status 403.*cleanup failed with status 500/);
  });
});
