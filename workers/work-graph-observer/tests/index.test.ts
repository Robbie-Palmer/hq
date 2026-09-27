import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker, {
  handleWebhook,
  type GitHubDelivery,
  type ObserverBindings,
} from "../src/index";

const secret = "a-secure-webhook-secret-that-is-long-enough";
const deliveryId = "0d0f26d6-2636-4f85-a91e-fc77bd52092d";
const repository = "Robbie-Palmer/hq";
const installationId = 42;
const queue = { send: vi.fn() };
const env: ObserverBindings = {
  DELIVERIES: queue as unknown as Queue<GitHubDelivery>,
  GITHUB_ALLOWED_INSTALLATION_IDS: JSON.stringify([installationId]),
  GITHUB_ALLOWED_REPOSITORIES: JSON.stringify([repository]),
  GITHUB_WEBHOOK_SECRET: secret,
};

const payloads = {
  pull_request: {
    action: "closed",
    installation: { id: installationId },
    pull_request: { number: 1521 },
    repository: { full_name: repository },
  },
  workflow_run: {
    action: "completed",
    installation: { id: installationId },
    repository: { full_name: repository },
    workflow_run: { head_sha: "a".repeat(40), id: 99 },
  },
  deployment_status: {
    action: "created",
    deployment: { id: 100, sha: "b".repeat(40) },
    deployment_status: { id: 101, state: "success" },
    installation: { id: installationId },
    repository: { full_name: repository },
  },
} as const;

function request(
  event: keyof typeof payloads = "pull_request",
  payload: unknown = payloads[event],
  overrides: {
    body?: string;
    delivery?: string;
    method?: string;
    path?: string;
    signature?: string;
  } = {},
): Request {
  const body = overrides.body ?? JSON.stringify(payload);
  const signature =
    overrides.signature ?? createHmac("sha256", secret).update(body).digest("hex");
  return new Request(
    `https://observer.example${overrides.path ?? "/webhooks/github"}`,
    {
      method: overrides.method ?? "POST",
      body: overrides.method === "GET" ? undefined : body,
      headers: {
        "x-github-delivery": overrides.delivery ?? deliveryId,
        "x-github-event": event,
        "x-hub-signature-256": `sha256=${signature}`,
      },
    },
  );
}

describe("Work Graph GitHub observer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T06:00:00.000Z"));
  });

  it.each(Object.keys(payloads) as (keyof typeof payloads)[])(
    "queues a valid %s delivery",
    async (event) => {
      const response = await handleWebhook(request(event), env);

      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toEqual({ accepted: true, deliveryId });
      expect(queue.send).toHaveBeenCalledOnce();
      expect(queue.send).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId,
          event,
          installationId,
          payload: payloads[event],
          payloadDigest: expect.stringMatching(/^[\da-f]{64}$/),
          receivedAt: "2026-09-27T06:00:00.000Z",
          repository: repository.toLowerCase(),
        }),
      );
    },
  );

  it("rejects requests outside the single ingress route", async () => {
    const response = await handleWebhook(
      request("pull_request", undefined, { path: "/api/work-items" }),
      env,
    );

    expect(response.status).toBe(404);
    expect(queue.send).not.toHaveBeenCalled();
  });

  it("rejects methods other than POST", async () => {
    const response = await handleWebhook(
      request("pull_request", undefined, { method: "GET" }),
      env,
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("rejects an invalid signature before parsing JSON", async () => {
    const response = await handleWebhook(
      request("pull_request", undefined, {
        body: "not-json",
        signature: "0".repeat(64),
      }),
      env,
    );

    expect(response.status).toBe(401);
    expect(queue.send).not.toHaveBeenCalled();
  });

  it("rejects oversized payloads before signature work", async () => {
    const response = await handleWebhook(
      new Request("https://observer.example/webhooks/github", {
        method: "POST",
        body: "{}",
        headers: { "content-length": "1048577" },
      }),
      env,
    );

    expect(response.status).toBe(413);
  });

  it("rejects malformed supported payloads", async () => {
    const response = await handleWebhook(
      request("workflow_run", {
        action: "completed",
        installation: { id: installationId },
        repository: { full_name: repository },
        workflow_run: { id: 99 },
      }),
      env,
    );

    expect(response.status).toBe(400);
    expect(queue.send).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "installation",
      changedEnv: { GITHUB_ALLOWED_INSTALLATION_IDS: "[99]" },
    },
    {
      name: "repository",
      changedEnv: { GITHUB_ALLOWED_REPOSITORIES: '["someone/else"]' },
    },
  ])("rejects an unknown $name", async ({ changedEnv }) => {
    const response = await handleWebhook(request(), { ...env, ...changedEnv });

    expect(response.status).toBe(403);
    expect(queue.send).not.toHaveBeenCalled();
  });

  it("fails closed when an allowlist is invalid", async () => {
    const response = await handleWebhook(request(), {
      ...env,
      GITHUB_ALLOWED_REPOSITORIES: "[]",
    });

    expect(response.status).toBe(503);
    expect(queue.send).not.toHaveBeenCalled();
  });

  it("retries consumer batches until Cloudflare moves them to the DLQ", () => {
    const retryAll = vi.fn();

    worker.queue?.(
      { retryAll } as unknown as MessageBatch<GitHubDelivery>,
    );

    expect(retryAll).toHaveBeenCalledOnce();
  });

  it("keeps the GitHub App private and read-only", async () => {
    const manifest = JSON.parse(
      await readFile("github-app-manifest.json", "utf8"),
    ) as {
      default_events: string[];
      default_permissions: Record<string, string>;
      public: boolean;
    };

    expect(manifest.public).toBe(false);
    expect(manifest.default_events).toEqual([
      "deployment_status",
      "pull_request",
      "workflow_run",
    ]);
    expect(manifest.default_permissions).toEqual({
      actions: "read",
      deployments: "read",
      metadata: "read",
      pull_requests: "read",
    });
  });
});
