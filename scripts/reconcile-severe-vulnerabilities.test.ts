import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  VulnerabilityControllerPolicySchema,
  type ControllerAuthorizer,
  type VulnerabilityCorrelationDecision,
} from "agent-coordinator-domain";
import type { GithubClient } from "github-client";
import type { WorkGraphClient } from "../packages/work-graph-cli/src/client.js";

import {
  buildVulnerabilityWorkerPrompt,
  loadPolicy,
  reconcileSevereVulnerabilities,
  t3WorkerLauncher,
  type T3ControllerClient,
  vulnerabilityWorkerIdentity,
  vulnerabilityWorkerThreadId,
  workerRequired,
} from "./reconcile-severe-vulnerabilities.js";
import type { startTurnWithProviderRecovery } from "./launch-work-graph-agent.js";

const NOW = "2026-11-18T19:00:00.000Z";
const LEASE_ID = "10000000-4000-4000-8000-000000000001";

const policy = VulnerabilityControllerPolicySchema.parse(
  JSON.parse(
    readFileSync(
      new URL(
        "../homelab/k3s/overlays/vector-development/workspaces/operator/agent-coordinator/controller-policy.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ),
);

const authorizer: ControllerAuthorizer = {
  authorize: () => ({ decision: "allow", determiningPolicies: ["test-policy"] }),
};

function githubWithoutRenovate(alertNumbers: readonly number[]): GithubClient {
  return {
    paginateByPageNumber: vi.fn(async (path: string) => {
      if (path.endsWith("/dependabot/alerts")) {
        return {
          complete: true,
          items: alertNumbers.map((number) => ({
            number,
            state: "open",
            security_advisory: { severity: "critical" },
          })),
        };
      }
      if (path.endsWith("/pulls")) return { complete: true, items: [] };
      throw new Error(`Unexpected pagination path ${path}`);
    }),
    request: vi.fn(async (_method: string, path: string) => {
      if (path === "/repos/Robbie-Palmer/hq") {
        return {
          id: 123,
          node_id: "R_123",
          name: "hq",
          full_name: "Robbie-Palmer/hq",
          owner: { login: "Robbie-Palmer" },
        };
      }
      const match = /\/dependabot\/alerts\/(\d+)$/u.exec(path);
      if (match === null) throw new Error(`Unexpected request path ${path}`);
      return {
        number: Number(match[1]),
        state: "open",
        dependency: {
          package: { ecosystem: "npm", name: "undici" },
          manifest_path: "pnpm-lock.yaml",
          vulnerable_requirements: "<6.21.1",
        },
        security_advisory: { severity: "critical" },
        security_vulnerability: {
          vulnerable_version_range: "<6.21.1",
          first_patched_version: { identifier: "6.21.1" },
        },
      };
    }),
  } as unknown as GithubClient;
}

function workItem(id: string, currentLease: unknown = null) {
  return {
    id,
    title: "Vulnerability incident",
    lifecycle: "open",
    parentId: null,
    rank: null,
    priorityRank: null,
    schedulingInitiativeId: null,
    schedulingProjectId: "agent-coordinator",
    expedited: false,
    expediteReason: null,
    stage: currentLease === null ? "ready" : "in_progress",
    currentLease,
    priority: {
      initiativeRank: 1,
      projectRank: 1,
      ticketRank: 1,
      expedited: false,
      effectiveExpedited: false,
      donatedFromWorkItemId: null,
    },
  };
}

function workGraph(initialItems: unknown[] = [], initialNotes: unknown[] = []) {
  let item = initialItems[0] as ReturnType<typeof workItem> | undefined;
  const notes = [...initialNotes];
  const claims: Array<{ workerId: string }> = [];
  const created: string[] = [];
  const client = {
    listWorkItems: vi.fn(async () => ({
      items: initialItems,
      nextCursor: null,
    })),
    createWorkItem: vi.fn(async (body: { id: string }) => {
      if (item?.id === body.id) return item;
      item = workItem(body.id);
      created.push(body.id);
      return item;
    }),
    putWorkItemContext: vi.fn(async () => ({})),
    putWorkItemPullRequest: vi.fn(async () => ({})),
    getWorkItem: vi.fn(async () => item),
    claim: vi.fn(async (body: { workerId: string; workItemId: string }) => {
      const lease = {
        id: LEASE_ID,
        workItemId: body.workItemId,
        workerId: body.workerId,
        epoch: 1,
        acquiredAt: NOW,
        expiresAt: "2026-11-18T19:15:00.000Z",
        endedAt: null,
        outcome: null,
      };
      item = workItem(body.workItemId, lease);
      claims.push(body);
      return { lease, workItem: item, context: [] };
    }),
    createNote: vi.fn(
      async (
        workItemId: string,
        body: { id: string; leaseId: string; content: string },
      ) => {
        const note = {
          id: body.id,
          workItemId,
          kind: "work",
          leaseId: body.leaseId,
          author: "controller:severe-vulnerability",
          content: body.content,
          createdAt: NOW,
        };
        notes.push(note);
        return note;
      },
    ),
    listWorkItemNotes: vi.fn(async (workItemId: string) => ({
      items: notes.filter((note) => {
        const noteWorkItemId = (note as { workItemId?: unknown }).workItemId;
        return noteWorkItemId === undefined || noteWorkItemId === workItemId;
      }),
      nextCursor: null,
    })),
    listWorkItemLeases: vi.fn(async () => ({ items: [], nextCursor: null })),
    listWorkItemEvidence: vi.fn(async () => ({ items: [], nextCursor: null })),
    requestAttention: vi.fn(async () => ({})),
  };
  return {
    claims,
    client: client as unknown as WorkGraphClient,
    created,
    notes,
  };
}

function decision(
  outcome: VulnerabilityCorrelationDecision["decision"]["outcome"],
  reason: VulnerabilityCorrelationDecision["decision"]["reason"],
  selectedPullRequest: VulnerabilityCorrelationDecision["decision"]["selectedPullRequest"] = null,
): VulnerabilityCorrelationDecision {
  return {
    schemaVersion: 1,
    recordType: "vulnerability-correlation-decision",
    incidentId: "github:repository:123:dependabot-alert:7",
    observedAt: "2026-11-18T19:00:00.000Z",
    validUntil: "2026-11-18T19:05:00.000Z",
    repository: {
      id: 123,
      nodeId: "R_123",
      owner: "Robbie-Palmer",
      name: "hq",
      fullName: "Robbie-Palmer/hq",
    },
    alert: {
      number: 7,
      state: "open",
      package: { ecosystem: "npm", name: "undici" },
      manifestPath: "pnpm-lock.yaml",
      vulnerableRequirements: "<6.21.1",
      vulnerableVersionRange: "<6.21.1",
      severity: "critical",
      firstPatchedVersion: "6.21.1",
      fixAvailable: true,
    },
    decision: { outcome, reason, selectedPullRequest },
    evidence: {
      providerDataComplete: true,
      fixAvailable: true,
      pullRequests: [],
    },
  };
}

function readyProvider() {
  return {
    instanceId: "codex",
    driver: "codex",
    enabled: true,
    installed: true,
    status: "ready",
    auth: { status: "authenticated" },
    models: [
      {
        slug: "gpt-5.6-sol",
        capabilities: {
          optionDescriptors: [
            {
              type: "select",
              id: "reasoningEffort",
              options: [{ id: "high" }],
            },
            {
              type: "select",
              id: "serviceTier",
              options: [{ id: "priority" }],
            },
          ],
        },
      },
    ],
  };
}

function transitionNote(
  incidentId: string,
  transition: "admitted" | "worker-linked",
) {
  return {
    workItemId: incidentId,
    content: JSON.stringify({
      recordType: "vulnerability-incident-event",
      incidentId,
      transition,
    }),
  };
}

describe("severe vulnerability reconciliation", () => {
  it.each([
    ["use", "usable-renovate-proposal", false],
    ["decline", "renovate-proposal-not-ready", false],
    ["repair", "broken-renovate-proposal", true],
    ["replace", "no-renovate-proposal", true],
    ["decline", "no-fix-available", true],
  ] as const)(
    "routes %s/%s to worker=%s",
    (outcome, reason, expected) => {
      expect(workerRequired(decision(outcome, reason))).toBe(expected);
    },
  );

  it("gives the implementation worker one incident and the production contract", () => {
    const prompt = buildVulnerabilityWorkerPrompt(
      decision("repair", "broken-renovate-proposal", {
        number: 42,
        url: "https://github.com/Robbie-Palmer/hq/pull/42",
        headSha: "1".repeat(40),
      }),
    );

    expect(prompt).toContain("github:repository:123:dependabot-alert:7");
    expect(prompt).toContain("Repair Renovate pull request #42");
    expect(prompt).toContain("agent-coordinator-hq-delivery.md");
    expect(prompt).toContain("merge, deployment, production proof");
    expect(prompt.length).toBeLessThan(1_000);
  });

  it("preallocates the incident lease to the stable Codex worker identity", () => {
    const incidentId = "github:repository:123:dependabot-alert:7";
    const threadId = vulnerabilityWorkerThreadId(incidentId);

    expect(threadId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(vulnerabilityWorkerIdentity(incidentId)).toBe(`codex:${threadId}`);
    expect(vulnerabilityWorkerThreadId(incidentId)).toBe(threadId);
  });

  it("admits and launches only the first worker-required alert", async () => {
    const graph = workGraph();
    const launchWorker = vi.fn(async (correlation: VulnerabilityCorrelationDecision) => ({
      threadId: vulnerabilityWorkerThreadId(correlation.incidentId),
      url: "https://t3.example/environment/thread",
    }));

    const result = await reconcileSevereVulnerabilities({
      authorizer,
      github: githubWithoutRenovate([7, 8]),
      launchWorker,
      now: () => new Date(NOW),
      policy,
      workGraph: graph.client,
    });

    const incidentId = "github:repository:123:dependabot-alert:7";
    expect(result).toEqual({
      admitted: [incidentId],
      launched: [incidentId],
      observed: 1,
    });
    expect(graph.created).toEqual([incidentId]);
    expect(graph.claims).toEqual([
      {
        workerId: vulnerabilityWorkerIdentity(incidentId),
        workItemId: incidentId,
        leaseDurationSeconds: 900,
      },
    ]);
    expect(launchWorker).toHaveBeenCalledOnce();
    expect(
      graph.notes.map(
        (note) =>
          JSON.parse(String((note as { content: string }).content)).transition,
      ),
    ).toEqual(["admitted", "worker-linked"]);
  });

  it("reuses an incident that already has a linked worker", async () => {
    const incidentId = "github:repository:123:dependabot-alert:7";
    const graph = workGraph(
      [
        {
          id: incidentId,
          stage: "in_progress",
          currentLease: {
            workerId: vulnerabilityWorkerIdentity(incidentId),
            expiresAt: "2026-11-18T19:15:00.000Z",
            endedAt: null,
          },
        },
      ],
      [
        transitionNote(incidentId, "admitted"),
        transitionNote(incidentId, "worker-linked"),
      ],
    );
    const launchWorker = vi.fn();

    const result = await reconcileSevereVulnerabilities({
      authorizer,
      github: githubWithoutRenovate([7, 8]),
      launchWorker,
      now: () => new Date(NOW),
      policy,
      workGraph: graph.client,
    });

    expect(result).toEqual({ admitted: [], launched: [], observed: 1 });
    expect(graph.created).toEqual([]);
    expect(launchWorker).not.toHaveBeenCalled();
  });

  it("continues past an incident waiting for attention", async () => {
    const waitingId = "github:repository:123:dependabot-alert:7";
    const graph = workGraph(
      [
        {
          id: waitingId,
          stage: "needs_attention",
          currentLease: null,
        },
      ],
      [
        transitionNote(waitingId, "admitted"),
        transitionNote(waitingId, "worker-linked"),
      ],
    );
    const launchWorker = vi.fn(async (correlation: VulnerabilityCorrelationDecision) => ({
      threadId: vulnerabilityWorkerThreadId(correlation.incidentId),
      url: "https://t3.example/environment/thread",
    }));

    const result = await reconcileSevereVulnerabilities({
      authorizer,
      github: githubWithoutRenovate([7, 8]),
      launchWorker,
      now: () => new Date(NOW),
      policy,
      workGraph: graph.client,
    });

    const launchedId = "github:repository:123:dependabot-alert:8";
    expect(result).toEqual({
      admitted: [launchedId],
      launched: [launchedId],
      observed: 2,
    });
    expect(launchWorker).toHaveBeenCalledOnce();
  });

  it("counts a live lease while an incident is waiting for attention", async () => {
    const waitingId = "github:repository:123:dependabot-alert:7";
    const graph = workGraph(
      [
        {
          ...workItem(waitingId, {
            expiresAt: "2026-11-18T19:15:00.000Z",
            endedAt: null,
          }),
          stage: "needs_attention",
        },
      ],
      [
        transitionNote(waitingId, "admitted"),
        transitionNote(waitingId, "worker-linked"),
      ],
    );
    const launchWorker = vi.fn();

    const result = await reconcileSevereVulnerabilities({
      authorizer,
      github: githubWithoutRenovate([7, 8]),
      launchWorker,
      now: () => new Date(NOW),
      policy,
      workGraph: graph.client,
    });

    expect(result).toEqual({ admitted: [], launched: [], observed: 2 });
    expect(launchWorker).not.toHaveBeenCalled();
  });

  it("does not rewrite a saved worker link when retrying a stale incident", async () => {
    const incidentId = "github:repository:123:dependabot-alert:7";
    const graph = workGraph(
      [
        {
          ...workItem(incidentId, {
            expiresAt: "2026-11-18T18:59:59.000Z",
            endedAt: null,
          }),
          stage: "stale",
        },
      ],
      [
        transitionNote(incidentId, "admitted"),
        transitionNote(incidentId, "worker-linked"),
      ],
    );
    const launchWorker = vi.fn(async () => ({
      threadId: vulnerabilityWorkerThreadId(incidentId),
      url: "https://t3.example/environment/thread",
    }));

    const result = await reconcileSevereVulnerabilities({
      authorizer,
      github: githubWithoutRenovate([7]),
      launchWorker,
      now: () => new Date(NOW),
      policy,
      workGraph: graph.client,
    });

    expect(result).toEqual({ admitted: [], launched: [incidentId], observed: 1 });
    expect(launchWorker).toHaveBeenCalledOnce();
    expect(graph.notes).toHaveLength(2);
  });

  it("does not count an expired lease against worker concurrency", async () => {
    const staleId = "github:repository:123:dependabot-alert:7";
    const stale = {
      ...workItem(staleId, {
        expiresAt: "2026-11-18T18:59:59.000Z",
        endedAt: null,
      }),
      stage: "stale",
    };
    const graph = workGraph([stale]);
    const launchWorker = vi.fn(async (correlation: VulnerabilityCorrelationDecision) => ({
      threadId: vulnerabilityWorkerThreadId(correlation.incidentId),
      url: "https://t3.example/environment/thread",
    }));

    const result = await reconcileSevereVulnerabilities({
      authorizer,
      github: githubWithoutRenovate([8]),
      launchWorker,
      now: () => new Date(NOW),
      policy,
      workGraph: graph.client,
    });

    expect(result.launched).toEqual([
      "github:repository:123:dependabot-alert:8",
    ]);
  });

  it("repairs an incomplete admission before launching", async () => {
    const incidentId = "github:repository:123:dependabot-alert:7";
    const graph = workGraph([workItem(incidentId)]);
    const launchWorker = vi.fn(async () => ({
      threadId: vulnerabilityWorkerThreadId(incidentId),
      url: "https://t3.example/environment/thread",
    }));

    const result = await reconcileSevereVulnerabilities({
      authorizer,
      github: githubWithoutRenovate([7]),
      launchWorker,
      now: () => new Date(NOW),
      policy,
      workGraph: graph.client,
    });

    expect(result.admitted).toEqual([incidentId]);
    expect(vi.mocked(graph.client.putWorkItemContext)).toHaveBeenCalledTimes(2);
    expect(
      graph.notes.map(
        (note) =>
          JSON.parse(String((note as { content: string }).content)).transition,
      ),
    ).toEqual(["admitted", "worker-linked"]);
  });

  it("rejects provider state that expires during the GitHub query", async () => {
    const graph = workGraph();
    const now = vi
      .fn<() => Date>()
      .mockReturnValueOnce(new Date(NOW))
      .mockReturnValue(new Date("2026-11-18T19:06:00.000Z"));
    const launchWorker = vi.fn();

    const result = await reconcileSevereVulnerabilities({
      authorizer,
      github: githubWithoutRenovate([7]),
      launchWorker,
      now,
      policy,
      workGraph: graph.client,
    });

    expect(result).toEqual({ admitted: [], launched: [], observed: 1 });
    expect(launchWorker).not.toHaveBeenCalled();
  });

  it("fails closed when the Work Graph incident page is incomplete", async () => {
    const graph = workGraph();
    vi.mocked(graph.client.listWorkItems).mockResolvedValueOnce({
      items: [],
      nextCursor: "more-incidents",
    } as never);

    await expect(
      reconcileSevereVulnerabilities({
        authorizer,
        github: githubWithoutRenovate([7]),
        launchWorker: vi.fn(),
        now: () => new Date(NOW),
        policy,
        workGraph: graph.client,
      }),
    ).rejects.toThrow("exceed the reconciliation page limit");
  });

  it("reports an empty reconciliation when no severe alert is open", async () => {
    const graph = workGraph();

    await expect(
      reconcileSevereVulnerabilities({
        authorizer,
        github: githubWithoutRenovate([]),
        launchWorker: vi.fn(),
        now: () => new Date(NOW),
        policy,
        workGraph: graph.client,
      }),
    ).resolves.toEqual({ admitted: [], launched: [], observed: 0 });
  });

  it("loads and verifies the checked-in Cedar policy bundle", () => {
    const loaded = loadPolicy(
      new URL(
        "../homelab/k3s/overlays/vector-development/workspaces/operator/agent-coordinator",
        import.meta.url,
      ).pathname,
    );

    expect(loaded.policy).toEqual(policy);
  });

  it("reuses the deterministic T3 thread when it already exists", async () => {
    const client = {
      server: { environment: vi.fn(async () => ({ environmentId: "vector" })) },
      threads: {
        get: vi.fn(async () => ({
          id: "existing",
          latestTurn: { state: "completed" },
        })),
      },
    } as unknown as T3ControllerClient;
    const launcher = t3WorkerLauncher({
      accessToken: "test-token",
      baseBranch: "main",
      client,
      origin: "https://t3.example",
      projectRoot: "/work/hq",
    });

    await expect(
      launcher.launch(decision("replace", "no-renovate-proposal")),
    ).resolves.toEqual({
      threadId: vulnerabilityWorkerThreadId(
        "github:repository:123:dependabot-alert:7",
      ),
      url: `https://t3.example/vector/${vulnerabilityWorkerThreadId(
        "github:repository:123:dependabot-alert:7",
      )}`,
    });
  });

  it("restarts a failed turn on the existing deterministic thread", async () => {
    const client = {
      server: {
        environment: vi.fn(async () => ({ environmentId: "vector" })),
        refreshProviders: vi.fn(async () => ({ providers: [readyProvider()] })),
      },
      threads: {
        get: vi.fn(async () => ({
          latestTurn: { state: "error" },
          worktreePath: "/worktrees/incident",
        })),
      },
      projects: {
        findByWorkspaceRoot: vi.fn(async () => ({
          id: "project-hq",
          workspaceRoot: "/work/hq",
        })),
      },
    } as unknown as T3ControllerClient;
    const startTurn = vi.fn(
      async (
        input: Parameters<typeof startTurnWithProviderRecovery>[0],
      ): Promise<Awaited<ReturnType<typeof startTurnWithProviderRecovery>>> => {
        const attempt = input.attempts[0];
        if (attempt === undefined) throw new Error("missing provider attempt");
        expect(input.buildTurnInput(attempt, 0).bootstrap).toBeUndefined();
        return {} as Awaited<ReturnType<typeof startTurnWithProviderRecovery>>;
      },
    );
    const launcher = t3WorkerLauncher({
      accessToken: "test-token",
      baseBranch: "main",
      client,
      origin: "https://t3.example",
      projectRoot: "/work/hq",
      startTurn,
    });

    await launcher.launch(decision("replace", "no-renovate-proposal"));

    expect(startTurn).toHaveBeenCalledOnce();
  });

  it("fails before launch when the T3 project is missing", async () => {
    const client = {
      server: { environment: vi.fn(async () => ({ environmentId: "vector" })) },
      threads: { get: vi.fn(async () => undefined) },
      projects: { findByWorkspaceRoot: vi.fn(async () => undefined) },
    } as unknown as T3ControllerClient;
    const launcher = t3WorkerLauncher({
      accessToken: "test-token",
      baseBranch: "main",
      client,
      origin: "https://t3.example",
      projectRoot: "/work/hq",
    });

    await expect(
      launcher.launch(decision("replace", "no-renovate-proposal")),
    ).rejects.toThrow("T3 Code has no project for /work/hq");
  });

  it("starts a T3 worker through the direct client with a managed worktree", async () => {
    const client = {
      server: {
        environment: vi.fn(async () => ({ environmentId: "vector" })),
        refreshProviders: vi.fn(async () => ({
          providers: [readyProvider()],
        })),
      },
      threads: { get: vi.fn(async () => undefined) },
      projects: {
        findByWorkspaceRoot: vi.fn(async () => ({
          id: "project-hq",
          workspaceRoot: "/work/hq",
        })),
      },
    } as unknown as T3ControllerClient;
    const startTurn = vi.fn(
      async (
        input: Parameters<typeof startTurnWithProviderRecovery>[0],
      ): Promise<Awaited<ReturnType<typeof startTurnWithProviderRecovery>>> => {
        const attempt = input.attempts[0];
        if (attempt === undefined) throw new Error("missing provider attempt");
        const first = input.buildTurnInput(attempt, 0);
        const retry = input.buildTurnInput(attempt, 1);
        expect(first.text).toContain("Resolve Work Graph incident");
        expect(first.bootstrap?.prepareWorktree).toMatchObject({
          projectCwd: "/work/hq",
          baseBranch: "main",
          startFromOrigin: true,
          requireWorktree: true,
        });
        expect(retry.bootstrap).toBeUndefined();
        expect(retry.text).toContain("previous approved provider failed");
        return {} as Awaited<ReturnType<typeof startTurnWithProviderRecovery>>;
      },
    );
    const launcher = t3WorkerLauncher({
      accessToken: "test-token",
      baseBranch: "main",
      client,
      origin: "https://t3.example",
      projectRoot: "/work/hq",
      startTurn,
    });

    await expect(
      launcher.launch(decision("replace", "no-renovate-proposal")),
    ).resolves.toMatchObject({
      threadId: vulnerabilityWorkerThreadId(
        "github:repository:123:dependabot-alert:7",
      ),
    });
    expect(startTurn).toHaveBeenCalledOnce();
  });
});
