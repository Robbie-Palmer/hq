import { describe, expect, it, vi } from "vitest";
import {
  rollbackProduction,
  smokeProductionSite,
} from "../../scripts/production-delivery";

const failedRevision = "a".repeat(40);
const targetRevision = "b".repeat(40);

function envelope(result: unknown): Response {
  return Response.json({ success: true, errors: [], result });
}

function deployment(revision: string, id = `deployment-${revision[0]}`) {
  return {
    id,
    project_name: "personal-site",
    environment: "production" as const,
    latest_stage: { status: "success" },
    source: { config: { branch: "main", commit_hash: revision } },
  };
}

describe("production site smoke test", () => {
  it("checks every fixed production probe without following redirects", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      const bodies: Record<string, string> = {
        "/": "<html><title>Robbie Palmer | ML expert & full-stack builder</title></html>",
        "/llms.txt": "# Robbie Palmer\n",
        "/projects/agent-coordinator.md": "# Agent Coordinator\n",
      };
      return new Response(bodies[path], { status: 200 });
    }) as typeof fetch;

    await smokeProductionSite(fetcher, 1, async () => undefined);

    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const call of vi.mocked(fetcher).mock.calls) {
      expect(call[1]).toMatchObject({ redirect: "error" });
    }
  });

  it("fails when production returns the wrong content", async () => {
    const fetcher = vi.fn(
      async () => new Response("wrong", { status: 200 }),
    ) as typeof fetch;

    await expect(
      smokeProductionSite(fetcher, 1, async () => undefined),
    ).rejects.toThrow("production probe / failed");
  });

  it("retries a transient response before checking the remaining probes", async () => {
    let attempt = 0;
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      attempt += 1;
      if (attempt === 1) return new Response("unavailable", { status: 503 });
      const path = new URL(String(input)).pathname;
      const bodies: Record<string, string> = {
        "/": "<title>Robbie Palmer</title>",
        "/llms.txt": "# Robbie Palmer",
        "/projects/agent-coordinator.md": "# Agent Coordinator",
      };
      return new Response(bodies[path], { status: 200 });
    }) as typeof fetch;

    await smokeProductionSite(fetcher, 2);

    expect(fetcher).toHaveBeenCalledTimes(4);
  });
});

describe("production rollback", () => {
  it("rolls back only from the stated live revision to one verified deployment", async () => {
    const projectBefore = {
      name: "personal-site",
      production_branch: "main",
      canonical_deployment: deployment(failedRevision),
    };
    const projectAfter = {
      ...projectBefore,
      canonical_deployment: deployment(targetRevision),
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(envelope(projectBefore))
      .mockResolvedValueOnce(envelope([deployment(targetRevision)]))
      .mockResolvedValueOnce(envelope(deployment(targetRevision)))
      .mockResolvedValueOnce(envelope(projectAfter));

    await expect(
      rollbackProduction(
        {
          accountId: "account-id",
          apiToken: "token",
          failedRevision,
          targetRevision,
        },
        fetcher,
        async () => undefined,
      ),
    ).resolves.toEqual({
      failedRevision,
      targetRevision,
      targetDeploymentId: "deployment-b",
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[2]?.[1]).toMatchObject({
      method: "POST",
      body: "{}",
    });
  });

  it("refuses a stale rollback after production has moved", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      envelope({
        name: "personal-site",
        production_branch: "main",
        canonical_deployment: deployment("c".repeat(40)),
      }),
    );

    await expect(
      rollbackProduction(
        {
          accountId: "account-id",
          apiToken: "token",
          failedRevision,
          targetRevision,
        },
        fetcher,
      ),
    ).rejects.toThrow("refusing stale rollback");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("rejects malformed or identical revisions before calling Cloudflare", async () => {
    const fetcher = vi.fn<typeof fetch>();

    await expect(
      rollbackProduction(
        {
          accountId: "account-id",
          apiToken: "token",
          failedRevision: "short",
          targetRevision,
        },
        fetcher,
      ),
    ).rejects.toThrow("failed revision must be a full lowercase Git revision");
    await expect(
      rollbackProduction(
        {
          accountId: "account-id",
          apiToken: "token",
          failedRevision,
          targetRevision: failedRevision,
        },
        fetcher,
      ),
    ).rejects.toThrow("target revision must differ");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reports Cloudflare API failures without attempting a rollback", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));

    await expect(
      rollbackProduction(
        {
          accountId: "account-id",
          apiToken: "token",
          failedRevision,
          targetRevision,
        },
        fetcher,
      ),
    ).rejects.toThrow("read Pages project failed with HTTP 503");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("reports a rejected Cloudflare envelope", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({
        success: false,
        errors: [{ code: 10_000, message: "authentication failed" }],
        result: null,
      }),
    );

    await expect(
      rollbackProduction(
        {
          accountId: "account-id",
          apiToken: "token",
          failedRevision,
          targetRevision,
        },
        fetcher,
      ),
    ).rejects.toThrow("read Pages project failed: authentication failed");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("rejects a target whose deployment metadata does not match the contract", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        envelope({
          name: "personal-site",
          production_branch: "main",
          canonical_deployment: deployment(failedRevision),
        }),
      )
      .mockResolvedValueOnce(
        envelope([
          {
            ...deployment(targetRevision),
            source: {
              config: { branch: "preview", commit_hash: targetRevision },
            },
          },
        ]),
      );

    await expect(
      rollbackProduction(
        {
          accountId: "account-id",
          apiToken: "token",
          failedRevision,
          targetRevision,
        },
        fetcher,
      ),
    ).rejects.toThrow("is not a successful main deployment");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("fails when Pages accepts rollback but never activates the target", async () => {
    const project = {
      name: "personal-site",
      production_branch: "main",
      canonical_deployment: deployment(failedRevision),
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(envelope(project))
      .mockResolvedValueOnce(envelope([deployment(targetRevision)]))
      .mockResolvedValueOnce(envelope(deployment(targetRevision)));
    for (let attempt = 0; attempt < 5; attempt += 1) {
      fetcher.mockResolvedValueOnce(envelope(project));
    }

    await expect(
      rollbackProduction(
        {
          accountId: "account-id",
          apiToken: "token",
          failedRevision,
          targetRevision,
        },
        fetcher,
        async () => undefined,
      ),
    ).rejects.toThrow("did not activate the target revision");
    expect(fetcher).toHaveBeenCalledTimes(8);
  });
});
