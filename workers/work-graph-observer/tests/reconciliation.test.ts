import {
  generateKeyPairSync,
  verify,
} from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { GitHubDelivery } from "work-graph-domain";
import {
  createGitHubAppJwt,
  GitHubReconciler,
} from "../src/reconciliation";

const repository = "example/site";
const headSha = "a".repeat(40);
const mergeSha = "b".repeat(40);
const now = new Date("2026-10-17T09:00:00.000Z");
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

function json(value: unknown): Response {
  return Response.json(value);
}

type FetchHandler = (url: URL, init?: RequestInit) => Response;

function expectInstallationToken(init?: RequestInit): void {
  expect(new Headers(init?.headers).get("authorization")).toBe(
    "Bearer installation-token",
  );
}

const githubHandlers = new Map<string, FetchHandler>([
  [
    "/repos/example/site/installation",
    (_url, init) => {
      expect(new Headers(init?.headers).get("authorization")).toMatch(
        /^Bearer [^.]+\.[^.]+\.[^.]+$/,
      );
      return json({ id: 42 });
    },
  ],
  [
    "/app/installations/42/access_tokens",
    (_url, init) => {
      expect(init?.method).toBe("POST");
      return json({ token: "installation-token" });
    },
  ],
  [
    "/repos/example/site/pulls/7",
    (_url, init) => {
      expectInstallationToken(init);
      return json({
        number: 7,
        head: { sha: headSha },
        merge_commit_sha: mergeSha,
        state: "closed",
        merged: true,
        merged_at: "2026-10-17T08:30:00Z",
        draft: false,
        mergeable: true,
        html_url: "https://github.com/example/site/pull/7",
        updated_at: "2026-10-17T08:30:00Z",
      });
    },
  ],
  [
    "/repos/example/site/actions/runs",
    (url, init) => {
      expectInstallationToken(init);
      return json({
        workflow_runs:
          url.searchParams.get("head_sha") === headSha
            ? [
                {
                  id: 10,
                  run_attempt: 2,
                  status: "completed",
                  conclusion: "success",
                  head_sha: headSha,
                  name: "CI",
                  html_url: "https://github.com/example/site/actions/runs/10",
                  updated_at: "2026-10-17T08:40:00Z",
                },
              ]
            : [],
      });
    },
  ],
  [
    "/repos/example/site/deployments",
    (url, init) => {
      expectInstallationToken(init);
      return json(
        url.searchParams.get("sha") === mergeSha
          ? [{ id: 20, sha: mergeSha, environment: "production" }]
          : [],
      );
    },
  ],
  [
    "/repos/example/site/deployments/20/statuses",
    (_url, init) => {
      expectInstallationToken(init);
      return json([
        {
          id: 22,
          state: "success",
          environment: "production",
          created_at: "2026-10-17T08:50:00Z",
          url: "https://api.github.com/repos/example/site/deployments/20/statuses/22",
        },
        {
          id: 21,
          state: "waiting",
          environment: "production",
          created_at: "2026-10-17T08:45:00Z",
          url: "https://api.github.com/repos/example/site/deployments/20/statuses/21",
        },
      ]);
    },
  ],
]);

function githubFetch(): typeof fetch {
  return vi.fn(async (input, init) => {
    const url = new URL(String(input));
    return (
      githubHandlers.get(url.pathname)?.(url, init) ??
      new Response(null, { status: 404 })
    );
  }) as typeof fetch;
}

describe("GitHub reconciliation", () => {
  it("signs an app JWT with bounded claims", () => {
    const token = createGitHubAppJwt("123", privateKeyPem, now);
    const [header, claims, signature] = token.split(".");
    expect(JSON.parse(Buffer.from(header ?? "", "base64url").toString())).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    expect(JSON.parse(Buffer.from(claims ?? "", "base64url").toString())).toEqual({
      iat: 1_792_227_540,
      exp: 1_792_228_140,
      iss: "123",
    });
    expect(
      verify(
        "RSA-SHA256",
        Buffer.from(`${header}.${claims}`),
        publicKey,
        Buffer.from(signature ?? "", "base64url"),
      ),
    ).toBe(true);
  });

  it("backfills current PR, CI, and deployment facts idempotently", async () => {
    const deliveries: GitHubDelivery[] = [];
    const consume = vi.fn(async (delivery: GitHubDelivery) => {
      deliveries.push(delivery);
      return "processed" as const;
    });
    const reconciler = new GitHubReconciler(
      {
        appId: "123",
        privateKey: privateKeyPem,
        allowedInstallationIds: new Set([42]),
        allowedRepositories: new Set([repository]),
      },
      { consume },
      { fetch: githubFetch(), now: () => now },
    );

    await expect(
      reconciler.reconcile([{ repository, number: 7 }]),
    ).resolves.toEqual({
      targets: 1,
      deliveries: 4,
      processed: 4,
      ignored: 0,
      unmatched: 0,
    });
    const firstIds = deliveries.map((delivery) => delivery.deliveryId);
    expect(new Set(firstIds).size).toBe(4);
    expect(firstIds).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
      ]),
    );
    expect(
      deliveries
        .filter((delivery) => delivery.event === "deployment_status")
        .map(
          (delivery) =>
            (delivery.payload.deployment_status as { state: string }).state,
        ),
    ).toEqual(["success", "waiting"]);

    deliveries.length = 0;
    await reconciler.reconcile([{ repository, number: 7 }]);
    expect(deliveries.map((delivery) => delivery.deliveryId)).toEqual(firstIds);
  });

  it("rejects targets outside the configured repository policy", async () => {
    const reconciler = new GitHubReconciler(
      {
        appId: "123",
        privateKey: privateKeyPem,
        allowedInstallationIds: new Set([42]),
        allowedRepositories: new Set([repository]),
      },
      { consume: vi.fn() },
      { fetch: githubFetch(), now: () => now },
    );

    await expect(
      reconciler.reconcile([{ repository: "other/site", number: 1 }]),
    ).rejects.toThrow("outside observer policy");
  });
});
