import { describe, expect, it, vi } from "vitest";
import type { Fetch } from "../src/client.js";
import { EXIT_CODES } from "../src/errors.js";
import type { PullRequestInspector } from "../src/github.js";
import { runCli } from "../src/main.js";

interface CapturedRequest {
  body: unknown;
  headers: Headers;
  method: string;
  url: URL;
}

const API_URL = "https://work.example.test/root";
const UUID = "00000000-0000-4000-8000-000000000001";
const MERGE_EVIDENCE = "https://github.com/example/work-graph/pull/1";
const DEPLOYMENT_EVIDENCE = "https://work-graph.example.test/health";
const pullRequestSnapshot = {
  repository: "example/work-graph",
  number: 42,
  url: "https://github.com/example/work-graph/pull/42",
  headSha: "0123456789abcdef0123456789abcdef01234567",
  state: "open" as const,
  draft: false,
  mergeability: "mergeable" as const,
  reviewDecision: "approved" as const,
  checkSummary: "success" as const,
  observedAt: "2026-09-20T10:00:00.000Z",
};

const activeWorkItem = (workerId = "agent-a") => ({
  id: "item-1",
  title: "Test the short agent workflow",
  lifecycle: "open",
  parentId: null,
  rank: null,
  priorityRank: 1,
  schedulingInitiativeId: null,
  schedulingProjectId: null,
  expedited: false,
  expediteReason: null,
  priority: {
    initiativeRank: 1,
    projectRank: 1,
    ticketRank: 1,
    expedited: false,
    effectiveExpedited: false,
    donatedFromWorkItemId: null,
  },
  stage: "in_progress",
  currentLease: {
    id: UUID,
    workItemId: "item-1",
    workerId,
    epoch: 3,
    acquiredAt: "2026-09-19T10:00:00.000Z",
    expiresAt: "2026-09-19T10:15:00.000Z",
    endedAt: null,
    outcome: null,
  },
});

const criticalPathProjection = () => ({
  targetOutcomeIds: ["outcome"],
  nodes: [
    {
      item: {
        id: "outcome",
        title: "Ship the outcome",
        lifecycle: "open",
        parentId: null,
        rank: null,
        priorityRank: 1,
        schedulingInitiativeId: "initiative",
        schedulingProjectId: "project",
        expedited: false,
        expediteReason: null,
      },
      stage: "ready",
      claimable: true,
      priority: {
        initiativeRank: 1,
        projectRank: 1,
        ticketRank: 1,
        expedited: false,
        effectiveExpedited: false,
        donatedFromWorkItemId: null,
      },
      inclusionReasons: [{ kind: "target_outcome" }],
    },
  ],
  edges: [],
  blockingPaths: [["outcome"]],
  readyLeafIds: ["outcome"],
  blockingAttentionIds: [],
  parallelBranches: [
    {
      workItemId: "outcome",
      stage: "ready",
      claimable: true,
      targetWorkItemIds: ["outcome"],
      paths: [["outcome"]],
    },
  ],
});

const response = (body: unknown = { ok: true }, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const harness = (
  responseFactory: (request: CapturedRequest) => Response = () => response(),
  environment: NodeJS.ProcessEnv = { WORK_GRAPH_API_URL: API_URL },
  makeUuid: () => string = () => UUID,
  selfUpdate = vi.fn((sourceDirectory: string) => ({
    sourceDirectory,
    status: "updated" as const,
  })),
  inspectPullRequest: PullRequestInspector = vi.fn(async () =>
    Promise.resolve(pullRequestSnapshot),
  ),
) => {
  const requests: CapturedRequest[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  const fetch: Fetch = vi.fn(async (input, init) => {
    const request =
      input instanceof Request ? input : new Request(input, init);
    const text =
      request.method === "GET" || request.method === "HEAD"
        ? ""
        : await request.clone().text();
    const captured = {
      body: text === "" ? undefined : JSON.parse(text),
      headers: request.headers,
      method: request.method,
      url: new URL(request.url),
    };
    requests.push(captured);
    return responseFactory(captured);
  });
  const run = (args: string[]) =>
    runCli(args, {
      environment,
      fetch,
      inspectPullRequest,
      makeUuid,
      selfUpdate,
      workingDirectory: "/workspace/hq",
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    });
  return {
    fetch,
    inspectPullRequest,
    requests,
    run,
    selfUpdate,
    stderr,
    stdout,
  };
};

describe("Given agent-facing Work Graph commands", () => {
  it("prints the short workflow without API configuration", async () => {
    const test = harness(undefined, {});

    expect(await test.run(["prime"])).toBe(EXIT_CODES.success);
    expect(test.requests).toEqual([]);
    expect(JSON.parse(test.stdout[0] ?? "null")).toMatchObject({
      workerId: null,
      auth: expect.stringContaining("automatically"),
      workflow: [
        "work-graph ready",
        "work-graph claim [ticket]",
        expect.stringContaining("work-graph note"),
        expect.stringContaining("work-graph release"),
      ],
    });
  });

  it("updates from the current checkout without API configuration", async () => {
    const test = harness(undefined, {});

    expect(await test.run(["self-update"])).toBe(EXIT_CODES.success);
    expect(test.selfUpdate).toHaveBeenCalledWith("/workspace/hq");
    expect(test.requests).toEqual([]);
    expect(JSON.parse(test.stdout[0] ?? "null")).toEqual({
      sourceDirectory: "/workspace/hq",
      status: "updated",
    });
  });

  it("updates from an explicitly selected checkout", async () => {
    const test = harness(undefined, {});

    expect(
      await test.run([
        "self-update",
        "--source-directory",
        "/workspace/other-hq",
      ]),
    ).toBe(EXIT_CODES.success);
    expect(test.selfUpdate).toHaveBeenCalledWith("/workspace/other-hq");
  });

  it.each([
    ["global", [], ""],
    [
      "initiative",
      ["--initiative-id", "initiative"],
      "initiativeId=initiative",
    ],
    ["project", ["--project-id", "project"], "projectId=project"],
    ["root", ["--root-work-item-id", "outcome"], "rootWorkItemId=outcome"],
  ])(
    "requests and renders the %s critical path",
    async (_name, args, search) => {
      const test = harness(() => response(criticalPathProjection()));

      expect(await test.run(["critical-path", ...args])).toBe(
        EXIT_CODES.success,
      );
      expect(test.requests[0]?.method).toBe("GET");
      expect(test.requests[0]?.url.pathname).toBe("/root/api/critical-path");
      expect(test.requests[0]?.url.searchParams.toString()).toBe(search);
      expect(test.stdout.join("")).toContain("Priority outcomes:");
      expect(test.stdout.join("")).toContain("Parallel branches:");
    },
  );

  it("prints the complete critical-path API contract as JSON", async () => {
    const projection = criticalPathProjection();
    const test = harness(() => response(projection));

    expect(await test.run(["critical-path", "--json"])).toBe(
      EXIT_CODES.success,
    );
    expect(JSON.parse(test.stdout.join(""))).toEqual(projection);
  });

  it("renders an empty critical path", async () => {
    const test = harness(() =>
      response({
        targetOutcomeIds: [],
        nodes: [],
        edges: [],
        blockingPaths: [],
        readyLeafIds: [],
        blockingAttentionIds: [],
        parallelBranches: [],
      }),
    );

    expect(await test.run(["critical-path"])).toBe(EXIT_CODES.success);
    expect(test.stdout.join("")).toContain(
      "No open priority outcomes in this scope.",
    );
  });

  it("rejects a root critical path combined with scope filters", async () => {
    const test = harness(() => response(criticalPathProjection()));

    expect(
      await test.run([
        "critical-path",
        "--root-work-item-id",
        "outcome",
        "--project-id",
        "project",
      ]),
    ).toBe(EXIT_CODES.usage);
    expect(test.requests).toEqual([]);
  });

  it("reports critical-path API errors through the shared error contract", async () => {
    const test = harness(() =>
      response(
        {
          error: {
            code: "knowledge_scope_not_found",
            message: "Knowledge scope missing does not exist.",
          },
        },
        404,
      ),
    );

    expect(
      await test.run(["critical-path", "--project-id", "missing"]),
    ).toBe(EXIT_CODES.notFound);
    expect(JSON.parse(test.stderr.join(""))).toMatchObject({
      error: { code: "knowledge_scope_not_found" },
    });
  });

  it("sends production Access headers with a critical-path request", async () => {
    const test = harness(() => response(criticalPathProjection()), {
      WORK_GRAPH_API_URL: API_URL,
      WORK_GRAPH_CF_ACCESS_ALLOWED_ORIGINS: "https://work.example.test",
      WORK_GRAPH_CF_ACCESS_CLIENT_ID: "client-id",
      WORK_GRAPH_CF_ACCESS_CLIENT_SECRET: "client-secret",
    });

    expect(await test.run(["critical-path"])).toBe(EXIT_CODES.success);
    expect(test.requests[0]?.headers.get("CF-Access-Client-Id")).toBe(
      "client-id",
    );
    expect(test.requests[0]?.headers.get("CF-Access-Client-Secret")).toBe(
      "client-secret",
    );
  });

  it("adds and removes dependency edges", async () => {
    const add = harness();
    const remove = harness();

    expect(
      await add.run([
        "dependency",
        "add",
        "dependent",
        "blocker",
        "--idempotency-key",
        UUID,
      ]),
    ).toBe(EXIT_CODES.success);
    expect(
      await remove.run([
        "dependency",
        "remove",
        "dependent",
        "blocker",
        "--idempotency-key",
        UUID,
      ]),
    ).toBe(EXIT_CODES.success);

    expect(add.requests[0]).toMatchObject({
      method: "POST",
      body: {
        dependentWorkItemId: "dependent",
        blockerWorkItemId: "blocker",
      },
    });
    expect(remove.requests[0]).toMatchObject({
      method: "DELETE",
      body: {
        dependentWorkItemId: "dependent",
        blockerWorkItemId: "blocker",
      },
    });
    expect(add.requests[0]?.url.href).toBe(
      "https://work.example.test/root/api/dependencies",
    );
    expect(remove.requests[0]?.url.href).toBe(
      "https://work.example.test/root/api/dependencies",
    );
    expect(add.requests[0]?.headers.get("Idempotency-Key")).toBe(UUID);
    expect(remove.requests[0]?.headers.get("Idempotency-Key")).toBe(UUID);
  });

  it("manages knowledge-scope mirrors and relationships", async () => {
    const list = harness();
    const allList = harness();
    const show = harness();
    const put = harness();
    const archive = harness();
    const restore = harness();
    const links = harness();
    const allLinks = harness();
    const link = harness();
    const unlink = harness();

    await list.run([
      "scope",
      "list",
      "--kind",
      "project",
      "--limit",
      "10",
      "--cursor",
      "first",
    ]);
    await allList.run(["scope", "list", "--all"]);
    await show.run(["scope", "show", "work/a b"]);
    await put.run([
      "scope",
      "put",
      "work-graph",
      "--kind",
      "project",
      "--title",
      "Work Graph",
      "--canonical-url",
      "https://example.test/projects/work-graph",
      "--markdown-url",
      "https://example.test/projects/work-graph.md",
      "--source-revision",
      "abc123",
      "--idempotency-key",
      UUID,
    ]);
    await archive.run([
      "scope",
      "archive",
      "work-graph",
      "--reason",
      "Completed project",
      "--idempotency-key",
      UUID,
    ]);
    await restore.run([
      "scope",
      "restore",
      "work-graph",
      "--idempotency-key",
      UUID,
    ]);
    await links.run([
      "scope",
      "links",
      "--limit",
      "10",
      "--cursor",
      '["initiative","work-graph"]',
    ]);
    await allLinks.run(["scope", "links", "--all"]);
    await link.run([
      "scope",
      "link",
      "initiative",
      "work-graph",
      "--idempotency-key",
      UUID,
    ]);
    await unlink.run([
      "scope",
      "unlink",
      "initiative",
      "work-graph",
      "--idempotency-key",
      UUID,
    ]);

    expect(list.requests[0]?.url.href).toBe(
      "https://work.example.test/root/api/knowledge-scopes?kind=project&limit=10&cursor=first",
    );
    expect(allList.requests[0]?.url.href).toBe(
      "https://work.example.test/root/api/knowledge-scopes?includeArchived=true",
    );
    expect(show.requests[0]?.url.pathname).toBe(
      "/root/api/knowledge-scopes/work%2Fa%20b",
    );
    expect(put.requests[0]).toMatchObject({
      method: "PUT",
      body: {
        kind: "project",
        title: "Work Graph",
        canonicalUrl: "https://example.test/projects/work-graph",
        markdownUrl: "https://example.test/projects/work-graph.md",
        sourceRevision: "abc123",
      },
    });
    expect(put.requests[0]?.headers.get("Idempotency-Key")).toBe(UUID);
    expect(archive.requests[0]).toMatchObject({
      method: "POST",
      body: { reason: "Completed project" },
    });
    expect(archive.requests[0]?.url.pathname).toBe(
      "/root/api/knowledge-scopes/work-graph/archival",
    );
    expect(restore.requests[0]?.method).toBe("DELETE");
    expect(restore.requests[0]?.url.pathname).toBe(
      "/root/api/knowledge-scopes/work-graph/archival",
    );
    expect(links.requests[0]?.url.href).toBe(
      "https://work.example.test/root/api/knowledge-scope-relationships?limit=10&cursor=%5B%22initiative%22%2C%22work-graph%22%5D",
    );
    expect(allLinks.requests[0]?.url.href).toBe(
      "https://work.example.test/root/api/knowledge-scope-relationships?includeArchived=true",
    );
    expect(link.requests[0]).toMatchObject({
      method: "POST",
      body: {
        parentKnowledgeScopeId: "initiative",
        childKnowledgeScopeId: "work-graph",
      },
    });
    expect(unlink.requests[0]).toMatchObject({
      method: "DELETE",
      body: {
        parentKnowledgeScopeId: "initiative",
        childKnowledgeScopeId: "work-graph",
      },
    });
  });

  it("creates a work item and forwards its idempotency key", async () => {
    const test = harness();
    expect(
      await test.run([
        "create",
        "cli-8",
        "--title",
        "Build the CLI",
        "--scheduling-initiative-id",
        "initiative-a",
        "--scheduling-project-id",
        "project-a",
        "--idempotency-key",
        UUID,
      ]),
    ).toBe(EXIT_CODES.success);
    expect(test.requests[0]).toMatchObject({
      body: {
        id: "cli-8",
        title: "Build the CLI",
        schedulingInitiativeId: "initiative-a",
        schedulingProjectId: "project-a",
      },
      method: "POST",
    });
    expect(test.requests[0]?.url.href).toBe(
      "https://work.example.test/root/api/work-items",
    );
    expect(test.requests[0]?.headers.get("Idempotency-Key")).toBe(UUID);
    expect(test.stdout).toEqual(['{"ok":true}\n']);
    expect(test.stderr).toEqual([]);
  });

  it("writes and reads typed work-item context", async () => {
    const brief = harness();
    const decision = harness();
    const reference = harness();
    const resolvedPullRequest = {
      kind: "pull_request",
      role: "evidence",
      pullRequest: pullRequestSnapshot,
      sourceWorkItemId: "parent",
      inheritanceDepth: 1,
    };
    const show = harness(() => response({ items: [resolvedPullRequest] }));
    const full = harness(() => response({ items: [resolvedPullRequest] }));

    await brief.run([
      "context",
      "put",
      "work/a b",
      "--kind",
      "brief",
      "--content",
      "Implement ordered context.",
      "--idempotency-key",
      UUID,
    ]);
    await decision.run([
      "context",
      "adr",
      "work/a b",
      "--title",
      "Context ordering",
      "--url",
      "https://example.test/adrs/context-ordering",
      "--role",
      "governing",
    ]);
    await reference.run([
      "reference",
      "put",
      "work/a b",
      "--title",
      "Design notes",
      "--url",
      "https://example.test/design-notes",
    ]);
    await show.run(["context", "show", "work/a b"]);
    await full.run([
      "context",
      "show",
      "work/a b",
      "--full-pr-context",
    ]);

    expect(brief.requests[0]).toMatchObject({
      method: "PUT",
      body: { kind: "brief", content: "Implement ordered context." },
    });
    expect(brief.requests[0]?.headers.get("Idempotency-Key")).toBe(UUID);
    expect(decision.requests[0]).toMatchObject({
      method: "PUT",
      body: {
        kind: "architecture_decision",
        title: "Context ordering",
        url: "https://example.test/adrs/context-ordering",
        role: "governing",
      },
    });
    expect(reference.requests[0]).toMatchObject({
      method: "PUT",
      body: {
        title: "Design notes",
        url: "https://example.test/design-notes",
      },
    });
    expect(brief.requests[0]?.url.pathname).toBe(
      "/root/api/work-items/work%2Fa%20b/contexts",
    );
    expect(decision.requests[0]?.url.pathname).toBe(
      "/root/api/work-items/work%2Fa%20b/contexts",
    );
    expect(reference.requests[0]?.url.pathname).toBe(
      "/root/api/work-items/work%2Fa%20b/references",
    );
    expect(show.requests[0]).toMatchObject({ method: "GET" });
    expect(show.requests[0]?.url.pathname).toBe(
      "/root/api/work-items/work%2Fa%20b/contexts",
    );
    expect(JSON.parse(show.stdout[0] ?? "null")).toEqual({
      items: [
        {
          kind: "pull_request",
          role: "evidence",
          ref: "example/work-graph#42",
          url: pullRequestSnapshot.url,
          status: "open, checks success, approved",
          observedAt: pullRequestSnapshot.observedAt,
          inheritedFrom: "parent",
        },
      ],
    });
    expect(JSON.parse(full.stdout[0] ?? "null")).toEqual({
      items: [resolvedPullRequest],
    });
  });

  it("refreshes, links, and lists pull requests", async () => {
    const refresh = harness();
    const draftRefresh = harness();
    const link = harness();
    const show = harness(() =>
      response({
        items: [
          {
            kind: "pull_request",
            role: "implementation",
            pullRequest: pullRequestSnapshot,
            sourceWorkItemId: "work/a b",
            inheritanceDepth: 0,
          },
        ],
      }),
    );
    const full = harness(() =>
      response({
        items: [
          {
            kind: "pull_request",
            role: "implementation",
            pullRequest: pullRequestSnapshot,
            sourceWorkItemId: "work/a b",
            inheritanceDepth: 0,
          },
        ],
      }),
    );

    await refresh.run([
      "pr",
      "refresh",
      "--repository",
      "example/work-graph",
      "--number",
      "42",
      "--url",
      "https://github.com/example/work-graph/pull/42",
      "--head-sha",
      "0123456789abcdef0123456789abcdef01234567",
      "--state",
      "open",
      "--mergeability",
      "mergeable",
      "--review-decision",
      "approved",
      "--check-summary",
      "success",
      "--observed-at",
      "2026-09-20T10:00:00.000Z",
    ]);
    await draftRefresh.run([
      "pr",
      "refresh",
      "--repository",
      "example/work-graph",
      "--number",
      "43",
      "--url",
      "https://github.com/example/work-graph/pull/43",
      "--head-sha",
      "abcdef0123456789abcdef0123456789abcdef01",
      "--state",
      "open",
      "--draft",
      "--mergeability",
      "unknown",
      "--check-summary",
      "pending",
    ]);
    await link.run([
      "pr",
      "link",
      "work/a b",
      "--repository",
      "example/work-graph",
      "--number",
      "42",
      "--role",
      "implementation",
      "--idempotency-key",
      UUID,
    ]);
    await show.run(["pr", "show", "work/a b"]);
    await full.run(["pr", "show", "work/a b", "--full"]);

    expect(refresh.requests[0]).toMatchObject({
      method: "PUT",
      body: {
        repository: "example/work-graph",
        number: 42,
        url: "https://github.com/example/work-graph/pull/42",
        headSha: "0123456789abcdef0123456789abcdef01234567",
        state: "open",
        draft: false,
        mergeability: "mergeable",
        reviewDecision: "approved",
        checkSummary: "success",
        observedAt: "2026-09-20T10:00:00.000Z",
      },
    });
    expect(refresh.requests[0]?.url.pathname).toBe("/root/api/pull-requests");
    expect(draftRefresh.requests[0]).toMatchObject({
      method: "PUT",
      body: {
        repository: "example/work-graph",
        number: 43,
        draft: true,
        reviewDecision: null,
        observedAt: expect.any(String),
      },
    });
    expect(link.requests[0]).toMatchObject({
      method: "PUT",
      body: {
        repository: "example/work-graph",
        number: 42,
        role: "implementation",
      },
    });
    expect(link.requests[0]?.headers.get("Idempotency-Key")).toBe(UUID);
    expect(link.requests[0]?.url.pathname).toBe(
      "/root/api/work-items/work%2Fa%20b/pull-requests",
    );
    expect(show.requests[0]?.url.pathname).toBe(
      "/root/api/work-items/work%2Fa%20b/pull-requests",
    );
    expect(JSON.parse(show.stdout[0] ?? "null")).toEqual({
      items: [
        {
          kind: "pull_request",
          role: "implementation",
          ref: "example/work-graph#42",
          url: pullRequestSnapshot.url,
          status: "open, checks success, approved",
          observedAt: pullRequestSnapshot.observedAt,
        },
      ],
    });
    expect(JSON.parse(full.stdout[0] ?? "null")).toEqual({
      items: [
        {
          kind: "pull_request",
          role: "implementation",
          pullRequest: pullRequestSnapshot,
          sourceWorkItemId: "work/a b",
          inheritanceDepth: 0,
        },
      ],
    });
  });

  it("attaches a GitHub pull request from its URL", async () => {
    const inspectPullRequest = vi.fn(async () =>
      Promise.resolve(pullRequestSnapshot),
    );
    const refreshedSnapshot = {
      ...pullRequestSnapshot,
      state: "merged" as const,
      reviewDecision: null,
      observedAt: "2026-09-20T10:01:00.000Z",
    };
    const test = harness(
      (request) =>
        request.url.pathname === "/root/api/pull-requests"
          ? response(refreshedSnapshot)
          : response(),
      { WORK_GRAPH_API_URL: API_URL },
      () => UUID,
      undefined,
      inspectPullRequest,
    );

    expect(
      await test.run([
        "pr",
        "attach",
        "work/a b",
        pullRequestSnapshot.url,
        "--role",
        "implementation",
        "--idempotency-key",
        UUID,
      ]),
    ).toBe(EXIT_CODES.success);

    expect(inspectPullRequest).toHaveBeenCalledWith(pullRequestSnapshot.url);
    expect(test.requests).toHaveLength(2);
    expect(test.requests[0]).toMatchObject({
      method: "PUT",
      body: pullRequestSnapshot,
    });
    expect(test.requests[0]?.url.pathname).toBe("/root/api/pull-requests");
    expect(test.requests[1]).toMatchObject({
      method: "PUT",
      body: {
        repository: "example/work-graph",
        number: 42,
        role: "implementation",
      },
    });
    expect(test.requests[1]?.url.pathname).toBe(
      "/root/api/work-items/work%2Fa%20b/pull-requests",
    );
    expect(test.requests[0]?.headers.get("Idempotency-Key")).toMatch(
      /^[0-9a-f-]{36}$/u,
    );
    expect(test.requests[1]?.headers.get("Idempotency-Key")).toMatch(
      /^[0-9a-f-]{36}$/u,
    );
    expect(test.requests[0]?.headers.get("Idempotency-Key")).not.toBe(
      test.requests[1]?.headers.get("Idempotency-Key"),
    );
    expect(JSON.parse(test.stdout[0] ?? "null")).toEqual({
      workItemId: "work/a b",
      kind: "pull_request",
      role: "implementation",
      ref: "example/work-graph#42",
      url: pullRequestSnapshot.url,
      status: "merged, checks success",
      observedAt: refreshedSnapshot.observedAt,
    });
  });

  it("moves contextual priority and manages an expedite", async () => {
    const ticketMove = harness();
    const scopeMove = harness();
    const scopeAssign = harness();
    const expedite = harness();
    const unexpedite = harness();

    await ticketMove.run([
      "priority",
      "move",
      "ticket-a",
      "--above",
      "ticket-b",
      "--idempotency-key",
      UUID,
    ]);
    await scopeMove.run([
      "scope",
      "move",
      "project-a",
      "--below",
      "project-b",
    ]);
    await scopeAssign.run([
      "scope",
      "assign",
      "ticket-a",
      "--initiative-id",
      "initiative-a",
      "--project-id",
      "project-a",
    ]);
    await expedite.run([
      "expedite",
      "ticket-a",
      "--reason",
      "Production release blocker",
    ]);
    await unexpedite.run(["unexpedite", "ticket-a"]);

    expect(ticketMove.requests[0]).toMatchObject({
      method: "POST",
      body: { higherThanId: "ticket-b" },
    });
    expect(ticketMove.requests[0]?.url.pathname).toBe(
      "/root/api/work-items/ticket-a/priority-moves",
    );
    expect(scopeMove.requests[0]).toMatchObject({
      method: "POST",
      body: { lowerThanId: "project-b" },
    });
    expect(scopeMove.requests[0]?.url.pathname).toBe(
      "/root/api/knowledge-scopes/project-a/priority-moves",
    );
    expect(scopeAssign.requests[0]).toMatchObject({
      method: "PUT",
      body: {
        schedulingInitiativeId: "initiative-a",
        schedulingProjectId: "project-a",
      },
    });
    expect(scopeAssign.requests[0]?.url.pathname).toBe(
      "/root/api/work-items/ticket-a/scheduling-scope",
    );
    expect(expedite.requests[0]).toMatchObject({
      method: "POST",
      body: { reason: "Production release blocker" },
    });
    expect(unexpedite.requests[0]?.method).toBe("DELETE");
  });

  it("reparents and detaches a ticket", async () => {
    const reparent = harness();
    const detach = harness();

    await reparent.run([
      "reparent",
      "child/a",
      "parent b",
      "--idempotency-key",
      UUID,
    ]);
    await detach.run(["detach", "child/a"]);

    expect(reparent.requests[0]).toMatchObject({
      method: "PUT",
      body: { parentId: "parent b" },
    });
    expect(reparent.requests[0]?.url.pathname).toBe(
      "/root/api/work-items/child%2Fa/parent",
    );
    expect(reparent.requests[0]?.headers.get("Idempotency-Key")).toBe(UUID);
    expect(detach.requests[0]).toMatchObject({
      method: "PUT",
      body: { parentId: null },
    });
    expect(detach.requests[0]?.url.pathname).toBe(
      "/root/api/work-items/child%2Fa/parent",
    );
  });

  it("lists the ready queue by default and supports an unfiltered page", async () => {
    const ready = harness();
    const familiarReady = harness();
    const all = harness();
    await ready.run(["queue", "--limit", "7", "--cursor", "item-1"]);
    await familiarReady.run([
      "ready",
      "--limit",
      "7",
      "--cursor",
      "item-1",
      "--initiative-id",
      "initiative-a",
      "--project-id",
      "project-a",
      "--parent-id",
      "parent-a",
    ]);
    await all.run(["queue", "--all"]);
    expect(ready.requests[0]?.url.href).toBe(
      "https://work.example.test/root/api/work-items?stage=ready&limit=7&cursor=item-1",
    );
    expect(all.requests[0]?.url.href).toBe(
      "https://work.example.test/root/api/work-items",
    );
    expect(familiarReady.requests[0]?.url.href).toBe(
      "https://work.example.test/root/api/work-items?stage=ready&limit=7&cursor=item-1&initiativeId=initiative-a&projectId=project-a&parentId=parent-a",
    );
  });

  it("reads every work-item metadata family as paginated JSON", async () => {
    const notes = harness(() => response({ items: [], nextCursor: null }));
    const events = harness(() => response({ items: [], nextCursor: null }));
    const dependencies = harness(() =>
      response({ items: [], nextCursor: null }),
    );
    const decompositions = harness(() =>
      response({ items: [], nextCursor: null }),
    );
    const leases = harness(() => response({ items: [], nextCursor: null }));
    const attention = harness(() =>
      response({ items: [], nextCursor: null }),
    );
    const cancellations = harness(() =>
      response({ items: [], nextCursor: null }),
    );
    const releases = harness(() => response({ items: [], nextCursor: null }));

    await notes.run([
      "metadata",
      "notes",
      "work/a b",
      "--limit",
      "10",
      "--cursor",
      UUID,
    ]);
    await events.run([
      "metadata",
      "events",
      "work/a b",
      "--type",
      "dependency.added",
      "--limit",
      "10",
      "--after-sequence",
      "20",
    ]);
    await dependencies.run([
      "metadata",
      "dependencies",
      "work/a b",
      "--limit",
      "10",
      "--cursor",
      '["dependent","blocker"]',
    ]);
    await decompositions.run([
      "metadata",
      "decompositions",
      "work/a b",
      "--after-sequence",
      "20",
    ]);
    await leases.run([
      "metadata",
      "leases",
      "work/a b",
      "--limit",
      "10",
      "--after-epoch",
      "2",
    ]);
    await attention.run([
      "metadata",
      "attention",
      "work/a b",
      "--limit",
      "10",
      "--cursor",
      UUID,
    ]);
    await cancellations.run([
      "metadata",
      "cancellations",
      "work/a b",
      "--after-sequence",
      "20",
    ]);
    await releases.run([
      "metadata",
      "releases",
      "work/a b",
      "--after-sequence",
      "20",
    ]);

    expect(notes.requests[0]?.url.href).toBe(
      `https://work.example.test/root/api/work-items/work%2Fa%20b/notes?limit=10&cursor=${UUID}`,
    );
    expect(events.requests[0]?.url.href).toBe(
      "https://work.example.test/root/api/work-items/work%2Fa%20b/events?type=dependency.added&limit=10&afterSequence=20",
    );
    expect(dependencies.requests[0]?.url.href).toBe(
      "https://work.example.test/root/api/work-items/work%2Fa%20b/dependencies?limit=10&cursor=%5B%22dependent%22%2C%22blocker%22%5D",
    );
    expect(decompositions.requests[0]?.url.href).toBe(
      "https://work.example.test/root/api/work-items/work%2Fa%20b/events?type=work_item.decomposed&afterSequence=20",
    );
    expect(leases.requests[0]?.url.href).toBe(
      "https://work.example.test/root/api/work-items/work%2Fa%20b/leases?limit=10&afterEpoch=2",
    );
    expect(attention.requests[0]?.url.href).toBe(
      `https://work.example.test/root/api/attention-requests?workItemId=work%2Fa%20b&state=all&limit=10&cursor=${UUID}`,
    );
    expect(cancellations.requests[0]?.url.href).toBe(
      "https://work.example.test/root/api/work-items/work%2Fa%20b/events?type=work_item.lifecycle_changed&lifecycle=cancelled&afterSequence=20",
    );
    expect(releases.requests[0]?.url.href).toBe(
      "https://work.example.test/root/api/work-items/work%2Fa%20b/events?type=work_item.lifecycle_changed&lifecycle=released&afterSequence=20",
    );
    expect(releases.stdout).toEqual(['{"items":[],"nextCursor":null}\n']);
  });

  it("claims the next item or a specified item", async () => {
    const claimResponse = {
      context: [
        {
          kind: "brief",
          content: "Start here.",
          sourceWorkItemId: "item-1",
          inheritanceDepth: 0,
        },
        {
          kind: "pull_request",
          role: "implementation",
          pullRequest: pullRequestSnapshot,
          sourceWorkItemId: "parent",
          inheritanceDepth: 1,
        },
      ],
    };
    const next = harness(() => response(claimResponse));
    const full = harness(() => response(claimResponse));
    const specified = harness();
    const scoped = harness(() => response(claimResponse));
    const codex = harness(undefined, {
      WORK_GRAPH_API_URL: API_URL,
      CODEX_THREAD_ID: "thread-123",
    });
    await next.run(["claim", "--worker-id", "agent-a"]);
    await specified.run([
      "claim",
      "work/a b",
      "--worker-id",
      "agent-a",
      "--lease-duration-seconds",
      "120",
    ]);
    await codex.run(["claim"]);
    await scoped.run([
      "claim",
      "--worker-id",
      "agent-a",
      "--initiative-id",
      "initiative-a",
      "--project-id",
      "project-a",
      "--parent-id",
      "parent-a",
    ]);
    await full.run([
      "claim",
      "--worker-id",
      "agent-a",
      "--full-pr-context",
    ]);
    expect(next.requests[0]?.body).toEqual({
      workerId: "agent-a",
      leaseDurationSeconds: 900,
    });
    expect(specified.requests[0]?.body).toEqual({
      workerId: "agent-a",
      leaseDurationSeconds: 120,
      workItemId: "work/a b",
    });
    expect(codex.requests[0]?.body).toEqual({
      workerId: "codex:thread-123",
      leaseDurationSeconds: 900,
    });
    expect(scoped.requests[0]?.body).toEqual({
      workerId: "agent-a",
      leaseDurationSeconds: 900,
      initiativeId: "initiative-a",
      projectId: "project-a",
      parentId: "parent-a",
    });
    expect(JSON.parse(next.stdout[0] ?? "null")).toEqual({
      context: [
        {
          kind: "brief",
          content: "Start here.",
          sourceWorkItemId: "item-1",
          inheritanceDepth: 0,
        },
        {
          kind: "pull_request",
          role: "implementation",
          ref: "example/work-graph#42",
          url: pullRequestSnapshot.url,
          status: "open, checks success, approved",
          observedAt: pullRequestSnapshot.observedAt,
          inheritedFrom: "parent",
        },
      ],
    });
    expect(JSON.parse(full.stdout[0] ?? "null")).toEqual(claimResponse);
  });

  it("shows a work item with an encoded path identifier", async () => {
    const test = harness();
    await test.run(["show", "work/a b"]);
    expect(test.requests[0]?.url.pathname).toBe("/root/api/work-items/work%2Fa%20b");
    expect(test.requests[0]?.method).toBe("GET");
  });

  it("records a fenced note with a generated ID", async () => {
    const test = harness();
    await test.run([
      "note",
      "item-1",
      "--lease-id",
      UUID,
      "--epoch",
      "2",
      "--content",
      "Tests pass",
    ]);
    expect(test.requests[0]).toMatchObject({
      body: {
        id: UUID,
        leaseId: UUID,
        epoch: 2,
        content: "Tests pass",
      },
      method: "POST",
    });
    expect(test.requests[0]?.url.pathname).toBe(
      "/root/api/work-items/item-1/notes",
    );
  });

  it("finds the active lease when recording a note", async () => {
    const test = harness((request) =>
      request.method === "GET" ? response(activeWorkItem()) : response(),
      {
        WORK_GRAPH_API_URL: API_URL,
        WORK_GRAPH_WORKER_ID: "agent-a",
      },
    );

    await test.run(["note", "item-1", "--content", "Tests pass"]);

    expect(test.requests).toHaveLength(2);
    expect(test.requests[0]?.url.pathname).toBe("/root/api/work-items/item-1");
    expect(test.requests[1]?.body).toMatchObject({
      leaseId: UUID,
      epoch: 3,
      content: "Tests pass",
    });
  });

  it("does not infer another worker's lease", async () => {
    const test = harness(() => response(activeWorkItem("agent-b")), {
      WORK_GRAPH_API_URL: API_URL,
      WORK_GRAPH_WORKER_ID: "agent-a",
    });

    expect(
      await test.run(["note", "item-1", "--content", "Tests pass"]),
    ).toBe(EXIT_CODES.usage);
    expect(test.requests).toHaveLength(1);
    expect(test.stderr.join(" ")).toContain(
      "Ticket item-1 is claimed by agent-b, not agent-a.",
    );
  });

  it("requires a worker identity before inferring an active lease", async () => {
    const test = harness();

    expect(
      await test.run(["note", "item-1", "--content", "Tests pass"]),
    ).toBe(EXIT_CODES.usage);
    expect(test.requests).toEqual([]);
    expect(test.stderr.join(" ")).toContain(
      "Set WORK_GRAPH_WORKER_ID or use a supported agent identity",
    );
  });

  it("requires explicit lease fields as a pair", async () => {
    const test = harness();

    expect(
      await test.run([
        "note",
        "item-1",
        "--lease-id",
        UUID,
        "--content",
        "Tests pass",
      ]),
    ).toBe(EXIT_CODES.usage);
    expect(test.requests).toEqual([]);
    expect(test.stderr.join(" ")).toContain(
      "Pass --lease-id and --epoch together",
    );
  });

  it("appends attributed post-release discussion", async () => {
    const test = harness();
    await test.run([
      "comment",
      "item-1",
      "--author",
      "agent-a",
      "--content",
      "Production exposed a follow-up.",
      "--idempotency-key",
      UUID,
    ]);
    expect(test.requests[0]).toMatchObject({
      body: {
        id: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
        author: "agent-a",
        content: "Production exposed a follow-up.",
      },
      method: "POST",
    });
    expect(test.requests[0]?.url.pathname).toBe(
      "/root/api/work-items/item-1/comments",
    );
    expect(test.requests[0]?.headers.get("Idempotency-Key")).toBe(UUID);
  });

  it("uses the worker identity as comment provenance", async () => {
    const test = harness(undefined, {
      WORK_GRAPH_API_URL: API_URL,
      WORK_GRAPH_WORKER_ID: "agent-a",
    });
    await test.run([
      "comment",
      "item-1",
      "--content",
      "Production exposed a follow-up.",
    ]);
    expect(test.requests[0]?.body).toEqual({
      id: UUID,
      author: "agent-a",
      content: "Production exposed a follow-up.",
    });
  });

  it("renews a fenced lease", async () => {
    const test = harness();
    await test.run(["renew", UUID, "--epoch", "4"]);
    expect(test.requests[0]).toMatchObject({
      body: { epoch: 4, leaseDurationSeconds: 900 },
      method: "POST",
    });
    expect(test.requests[0]?.url.pathname).toBe(
      `/root/api/leases/${UUID}/renewals`,
    );
  });

  it("renews a ticket without copying its lease fields", async () => {
    const test = harness((request) =>
      request.method === "GET" ? response(activeWorkItem()) : response(),
      {
        WORK_GRAPH_API_URL: API_URL,
        WORK_GRAPH_WORKER_ID: "agent-a",
      },
    );

    await test.run(["touch", "item-1", "--lease-duration-seconds", "600"]);

    expect(test.requests[1]).toMatchObject({
      body: { epoch: 3, leaseDurationSeconds: 600 },
      method: "POST",
    });
    expect(test.requests[1]?.url.pathname).toBe(`/root/api/leases/${UUID}/renewals`);
  });

  it("decomposes work and can claim one child in the same request", async () => {
    const test = harness();
    const children = [{ id: "child-1", title: "First", rank: 1 }];
    const dependencies = [
      { dependentWorkItemId: "child-1", blockerWorkItemId: "blocker-1" },
    ];
    await test.run([
      "decompose",
      "parent-1",
      "--lease-id",
      UUID,
      "--epoch",
      "3",
      "--children-json",
      JSON.stringify(children),
      "--dependencies-json",
      JSON.stringify(dependencies),
      "--claim-work-item-id",
      "child-1",
      "--claim-lease-duration-seconds",
      "300",
    ]);
    expect(test.requests[0]?.body).toEqual({
      leaseId: UUID,
      epoch: 3,
      children,
      dependencies,
      claim: {
        workItemId: "child-1",
        leaseId: UUID,
        leaseDurationSeconds: 300,
      },
    });
    expect(test.requests[0]?.url.pathname).toBe(
      "/root/api/work-items/parent-1/decompositions",
    );
  });

  it("lists, creates, and resolves attention requests", async () => {
    const list = harness();
    const request = harness();
    const resolve = harness();
    await list.run([
      "attention",
      "list",
      "--state",
      "resolved",
      "--blocking",
      "false",
    ]);
    await request.run([
      "attention",
      "request",
      "item-1",
      "--lease-id",
      UUID,
      "--epoch",
      "5",
      "--kind",
      "decision",
      "--question",
      "Which host?",
      "--non-blocking",
    ]);
    await resolve.run([
      "attention",
      "resolve",
      UUID,
      "--resolution",
      "Use the Worker",
    ]);
    expect(list.requests[0]?.url.search).toBe(
      "?state=resolved&blocking=false",
    );
    expect(request.requests[0]?.body).toEqual({
      id: UUID,
      workItemId: "item-1",
      leaseId: UUID,
      epoch: 5,
      kind: "decision",
      question: "Which host?",
      blocking: false,
    });
    expect(resolve.requests[0]?.body).toEqual({
      id: UUID,
      resolution: "Use the Worker",
    });
    expect(resolve.requests[0]?.url.pathname).toBe(
      `/root/api/attention-requests/${UUID}/resolutions`,
    );
  });

  it("keeps generated mutation IDs stable across idempotent retries", async () => {
    const makeUuid = vi.fn(() => "00000000-0000-4000-8000-000000000002");
    const test = harness(undefined, { WORK_GRAPH_API_URL: API_URL }, makeUuid);
    const retryBodies = async (
      args: string[],
    ): Promise<[Record<string, unknown>, Record<string, unknown>]> => {
      const offset = test.requests.length;
      await test.run(args);
      await test.run(args);
      return [
        test.requests[offset]?.body as Record<string, unknown>,
        test.requests[offset + 1]?.body as Record<string, unknown>,
      ];
    };

    const [firstNote, retriedNote] = await retryBodies([
      "note",
      "item-1",
      "--lease-id",
      UUID,
      "--epoch",
      "1",
      "--content",
      "Stable retry",
      "--idempotency-key",
      UUID,
    ]);
    const [firstRequest, retriedRequest] = await retryBodies([
      "attention",
      "request",
      "item-1",
      "--lease-id",
      UUID,
      "--epoch",
      "1",
      "--kind",
      "decision",
      "--question",
      "Which host?",
      "--idempotency-key",
      UUID,
    ]);
    const [firstResolution, retriedResolution] = await retryBodies([
      "attention",
      "resolve",
      UUID,
      "--resolution",
      "Use the Worker",
      "--idempotency-key",
      UUID,
    ]);
    const [firstDecomposition, retriedDecomposition] = await retryBodies([
      "decompose",
      "parent-1",
      "--lease-id",
      UUID,
      "--epoch",
      "1",
      "--children-json",
      '[{"id":"child-1","title":"First","rank":1}]',
      "--claim-work-item-id",
      "child-1",
      "--idempotency-key",
      UUID,
    ]);

    expect(retriedNote.id).toBe(firstNote.id);
    expect(retriedRequest.id).toBe(firstRequest.id);
    expect(retriedResolution.id).toBe(firstResolution.id);
    expect(
      (retriedDecomposition.claim as Record<string, unknown>).leaseId,
    ).toBe((firstDecomposition.claim as Record<string, unknown>).leaseId);
    expect(firstNote.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(makeUuid).not.toHaveBeenCalled();
  });

  it("completes merged and deployed claimed work", async () => {
    const test = harness();
    await test.run([
      "release",
      "item-1",
      "--lease-id",
      UUID,
      "--epoch",
      "6",
      "--merge-evidence",
      MERGE_EVIDENCE,
      "--deployment-evidence",
      DEPLOYMENT_EVIDENCE,
    ]);
    expect(test.requests[0]).toMatchObject({
      body: {
        leaseId: UUID,
        epoch: 6,
        mergeEvidence: MERGE_EVIDENCE,
        deploymentEvidence: DEPLOYMENT_EVIDENCE,
      },
      method: "POST",
    });
    expect(test.requests[0]?.url.pathname).toBe(
      "/root/api/work-items/item-1/releases",
    );
  });

  it("refuses to release work without merge and deployment evidence", async () => {
    const test = harness();
    expect(
      await test.run([
        "release",
        "item-1",
        "--lease-id",
        UUID,
        "--epoch",
        "6",
      ]),
    ).toBe(EXIT_CODES.usage);
    expect(test.requests).toEqual([]);
  });

  it("refuses whitespace-only release evidence before making a request", async () => {
    const test = harness();
    expect(
      await test.run([
        "release",
        "item-1",
        "--lease-id",
        UUID,
        "--epoch",
        "6",
        "--merge-evidence",
        " ",
        "--deployment-evidence",
        DEPLOYMENT_EVIDENCE,
      ]),
    ).toBe(EXIT_CODES.usage);
    expect(test.requests).toEqual([]);
  });

  it("cancels claimed work", async () => {
    const test = harness();
    await test.run([
      "cancel",
      "item-1",
      "--lease-id",
      UUID,
      "--epoch",
      "6",
    ]);
    expect(test.requests[0]).toMatchObject({
      body: { leaseId: UUID, epoch: 6 },
      method: "POST",
    });
    expect(test.requests[0]?.url.pathname).toBe(
      "/root/api/work-items/item-1/cancellations",
    );
  });
});

describe("Given Cloudflare Access service-token credentials", () => {
  it("sends both headers only to an explicitly trusted API origin", async () => {
    const test = harness(undefined, {
      WORK_GRAPH_API_URL: API_URL,
      WORK_GRAPH_CF_ACCESS_ALLOWED_ORIGINS: "https://work.example.test",
      CF_ACCESS_CLIENT_ID: "client-id.secret",
      CF_ACCESS_CLIENT_SECRET: "client-secret",
    });
    expect(await test.run(["show", "item-1"])).toBe(EXIT_CODES.success);
    expect(test.requests[0]?.headers.get("CF-Access-Client-Id")).toBe(
      "client-id.secret",
    );
    expect(test.requests[0]?.headers.get("CF-Access-Client-Secret")).toBe(
      "client-secret",
    );
  });

  it("refuses an untrusted API origin before making a request or printing secrets", async () => {
    const test = harness(undefined, {
      WORK_GRAPH_API_URL: "https://attacker.example.test",
      WORK_GRAPH_CF_ACCESS_ALLOWED_ORIGINS: "https://work.example.test",
      CF_ACCESS_CLIENT_ID: "sensitive-client-id",
      CF_ACCESS_CLIENT_SECRET: "sensitive-client-secret",
    });
    expect(await test.run(["show", "item-1"])).toBe(EXIT_CODES.usage);
    expect(test.fetch).not.toHaveBeenCalled();
    expect(test.stderr.join("")).toContain("UNTRUSTED_ACCESS_ORIGIN");
    expect(test.stderr.join("")).not.toContain("sensitive-client");
  });

  it("does not follow redirects carrying custom Access headers", async () => {
    const test = harness(
      () =>
        new Response(null, {
          status: 302,
          headers: { Location: "https://attacker.example.test/collect" },
        }),
      {
        WORK_GRAPH_API_URL: API_URL,
        WORK_GRAPH_CF_ACCESS_ALLOWED_ORIGINS: "https://work.example.test",
        CF_ACCESS_CLIENT_ID: "client-id.secret",
        CF_ACCESS_CLIENT_SECRET: "client-secret",
      },
    );
    expect(await test.run(["show", "item-1"])).toBe(EXIT_CODES.transport);
    expect(test.fetch).toHaveBeenCalledTimes(1);
    const request = vi.mocked(test.fetch).mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(Request);
    expect((request as Request).redirect).toBe("manual");
    expect(JSON.parse(test.stderr[0] ?? "null")).toEqual({
      error: {
        code: "REDIRECT_REFUSED",
        message:
          "The Work Graph API returned a redirect. Refusing to forward Access credentials.",
        status: 302,
      },
    });
  });

  it("accepts an API URL and trusted origin as global options", async () => {
    const test = harness(undefined, {
      CF_ACCESS_CLIENT_ID: "client-id.secret",
      CF_ACCESS_CLIENT_SECRET: "client-secret",
    });
    expect(
      await test.run([
        "--api-url",
        API_URL,
        "--cf-access-allowed-origin",
        "https://work.example.test",
        "show",
        "item-1",
      ]),
    ).toBe(EXIT_CODES.success);
    expect(test.requests[0]?.url.origin).toBe("https://work.example.test");
    expect(test.requests[0]?.headers.get("CF-Access-Client-Secret")).toBe(
      "client-secret",
    );
  });
});

describe("Given CLI and HTTP failures", () => {
  it("preserves the server request ID in diagnostics", async () => {
    const test = harness(() =>
      response(
        {
          error: {
            code: "API_PROBLEM",
            message: "Request failed",
            requestId: "request-123",
          },
        },
        409,
      ),
    );

    expect(await test.run(["show", "item-1"])).toBe(EXIT_CODES.conflict);
    expect(JSON.parse(test.stderr[0] ?? "null")).toEqual({
      error: {
        code: "API_PROBLEM",
        message: "Request failed",
        requestId: "request-123",
        status: 409,
      },
    });
  });

  it.each([
    [400, EXIT_CODES.validation],
    [401, EXIT_CODES.authentication],
    [403, EXIT_CODES.authentication],
    [404, EXIT_CODES.notFound],
    [409, EXIT_CODES.conflict],
    [422, EXIT_CODES.validation],
    [500, EXIT_CODES.server],
    [418, EXIT_CODES.transport],
  ])("maps HTTP %i to exit code %i and preserves API error JSON", async (status, exitCode) => {
    const test = harness(() =>
      response(
        {
          error: {
            code: "API_PROBLEM",
            message: "Request failed",
            details: [{ path: ["body"], message: "Bad value" }],
          },
        },
        status,
      ),
    );
    expect(await test.run(["show", "item-1"])).toBe(exitCode);
    expect(JSON.parse(test.stderr[0] ?? "null")).toEqual({
      error: {
        code: "API_PROBLEM",
        message: "Request failed",
        status,
        details: [{ path: ["body"], message: "Bad value" }],
      },
    });
    expect(test.stdout).toEqual([]);
  });

  it("returns structured usage errors without making an HTTP request", async () => {
    const test = harness();
    expect(await test.run(["renew", UUID, "--epoch", "zero"])).toBe(
      EXIT_CODES.usage,
    );
    expect(test.fetch).not.toHaveBeenCalled();
    expect(JSON.parse(test.stderr[0] ?? "null")).toEqual({
      error: {
        code: "CLI_USAGE",
        message: "✖ Invalid input: expected number, received string → at epoch",
      },
    });
  });

  it("requires provenance before sending a post-release comment", async () => {
    const test = harness();
    expect(
      await test.run([
        "comment",
        "item-1",
        "--content",
        "Production exposed a follow-up.",
      ]),
    ).toBe(EXIT_CODES.usage);
    expect(test.fetch).not.toHaveBeenCalled();
    expect(test.stderr.join("")).toContain(
      "Set WORK_GRAPH_WORKER_ID or pass --author for provenance.",
    );
  });

  it("enforces generated OpenAPI constraints before making a request", async () => {
    const test = harness();
    expect(
      await test.run(["create", "item-1", "--title", "x".repeat(10_001)]),
    ).toBe(EXIT_CODES.usage);
    expect(test.fetch).not.toHaveBeenCalled();
    expect(test.stderr.join("")).toContain("title");
    expect(test.stderr.join("")).toContain("10000");
  });

  it.each(["ftp://example.test/projects/work-graph", "https://"])(
    "rejects a scope URL outside the generated HTTP contract: %s",
    async (canonicalUrl) => {
      const test = harness();
      expect(
        await test.run([
          "scope",
          "put",
          "work-graph",
          "--kind",
          "project",
          "--title",
          "Work Graph",
          "--canonical-url",
          canonicalUrl,
          "--markdown-url",
          "https://example.test/projects/work-graph.md",
        ]),
      ).toBe(EXIT_CODES.usage);
      expect(test.fetch).not.toHaveBeenCalled();
      expect(test.stderr.join("")).toContain("canonicalUrl");
    },
  );

  it("accepts complete command input as JSON for agents", async () => {
    const test = harness();
    expect(
      await test.run([
        "create",
        "--json",
        JSON.stringify({ id: "item-1", title: "From JSON" }),
      ]),
    ).toBe(EXIT_CODES.success);
    expect(test.requests[0]?.body).toEqual({
      id: "item-1",
      title: "From JSON",
    });
  });

  it("reports non-JSON and network failures as transport errors", async () => {
    const invalid = harness(() => new Response("Access login", { status: 200 }));
    const offline = harness();
    vi.mocked(offline.fetch).mockRejectedValueOnce(new Error("offline"));
    expect(await invalid.run(["show", "item-1"])).toBe(EXIT_CODES.transport);
    expect(await offline.run(["show", "item-1"])).toBe(EXIT_CODES.transport);
    expect(invalid.stderr.join("")).toContain("INVALID_API_RESPONSE");
    expect(offline.stderr.join("")).toContain("TRANSPORT_ERROR");
  });

  it("maps a non-JSON Cloudflare rejection to the authentication exit code", async () => {
    const test = harness(() => new Response("Access denied", { status: 403 }));
    expect(await test.run(["show", "item-1"])).toBe(
      EXIT_CODES.authentication,
    );
    expect(JSON.parse(test.stderr[0] ?? "null")).toEqual({
      error: {
        code: "HTTP_403",
        message: "The Work Graph API returned HTTP 403.",
        status: 403,
      },
    });
  });

  it("reports Access denial for a post-release comment", async () => {
    const test = harness(() => new Response("Access denied", { status: 401 }));
    expect(
      await test.run([
        "comment",
        "item-1",
        "--author",
        "agent-a",
        "--content",
        "Production exposed a follow-up.",
      ]),
    ).toBe(EXIT_CODES.authentication);
    expect(JSON.parse(test.stderr[0] ?? "null")).toEqual({
      error: {
        code: "HTTP_401",
        message: "The Work Graph API returned HTTP 401.",
        status: 401,
      },
    });
  });

  it("shows help without requiring API configuration", async () => {
    const test = harness(undefined, {});
    expect(await test.run(["--help"])).toBe(EXIT_CODES.success);
    expect(test.stdout.join("")).toContain("Usage: work-graph");
    expect(test.stdout.join("")).toContain("create");
    expect(test.stdout.join("")).toContain("Create a ticket");
    expect(test.fetch).not.toHaveBeenCalled();
  });

  it("derives command help from Zod field descriptions", async () => {
    const test = harness(undefined, {});
    expect(await test.run(["create", "--help"])).toBe(EXIT_CODES.success);
    expect(test.stdout.join("")).toContain("Create a ticket");
    expect(test.stdout.join("")).toContain("Ticket ID");
    expect(test.stdout.join("")).toContain("--title <string>");
    expect(test.stdout.join("")).toContain("Ticket title");
    expect(test.fetch).not.toHaveBeenCalled();
  });

  it("keeps schema validation details out of agent help", async () => {
    const test = harness(undefined, {});

    expect(await test.run(["note", "--help"])).toBe(EXIT_CODES.success);
    const help = test.stdout.join(" ").replace(/\s+/gu, " ");
    expect(help).toContain(
      "Lease UUID; omit with --epoch to use the ticket's active lease",
    );
    expect(help).not.toContain("Pattern:");
    expect(help).not.toContain("Max length:");
    expect(test.fetch).not.toHaveBeenCalled();
  });

  it("describes release as completion after merge and deployment", async () => {
    const test = harness(undefined, {});
    expect(await test.run(["release", "--help"])).toBe(EXIT_CODES.success);
    const help = test.stdout.join("");
    expect(help).toContain(
      "Complete claimed work after it is merged and deployed",
    );
    expect(help).toContain("--merge-evidence <string>");
    expect(help).toContain("--deployment-evidence <string>");
    expect(help).not.toContain("back to the queue");
    expect(test.fetch).not.toHaveBeenCalled();
  });
});
