import {
  WorkGraphError,
  type WorkItemLifecycle,
  type WorkStage,
} from "work-graph-domain";
import type {
  DecomposeClaimedWorkItemInput,
  StoredLease,
  WorkItemReadModel,
} from "work-graph-db";
import { describe, expect, it, vi } from "vitest";
import {
  createWorkGraphApp,
  type WorkGraphApiRepository,
} from "../src/index";

const acquiredAt = new Date("2026-09-14T10:00:00.000Z");
const expiresAt = new Date("2026-09-14T10:05:00.000Z");
const leaseId = "00000000-0000-4000-8000-000000000001";
const idempotencyKey = "00000000-0000-4000-8000-000000000002";
const removeIdempotencyKey = "00000000-0000-4000-8000-000000000003";
const noteId = "00000000-0000-4000-8000-000000000004";
const attentionRequestId = "00000000-0000-4000-8000-000000000005";
const attentionResolutionId = "00000000-0000-4000-8000-000000000006";
const secondAttentionRequestId = "00000000-0000-4000-8000-000000000007";
const childLeaseId = "00000000-0000-4000-8000-000000000008";
const completionEvidence = {
  mergeEvidence: "https://github.com/example/work-graph/pull/1",
  deploymentEvidence: "https://work-graph.example.test/health",
} as const;

const lease = (workItemId = "ready"): StoredLease => ({
  id: leaseId,
  workItemId,
  workerId: "worker-a",
  epoch: 1,
  acquiredAt,
  expiresAt,
  endedAt: null,
  outcome: null,
});

const item = (
  id: string,
  stage: WorkStage,
  lifecycle: WorkItemLifecycle = "open",
  currentLease: StoredLease | null = null,
): WorkItemReadModel => ({
  id,
  title: `${id} work`,
  lifecycle,
  parentId: null,
  rank: null,
  priorityRank: 1024,
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
  stage,
  currentLease,
});

const responseJson = async (response: Response): Promise<unknown> =>
  response.json();

const knowledgeScope = (id: string, kind: "initiative" | "project") => ({
  id,
  kind,
  title: `${id} scope`,
  canonicalUrl: `https://example.test/${id}`,
  markdownUrl: `https://example.test/${id}.md`,
  sourceRevision: null,
  lifecycle: "active" as const,
  archiveReason: null,
  rank: null,
});

const buildRepository = (): WorkGraphApiRepository => ({
  listKnowledgeScopes: vi.fn(async () => []),
  getKnowledgeScope: vi.fn(async (id) => ({
    id,
    kind: "project" as const,
    title: "Work Graph",
    canonicalUrl: "https://example.test/projects/work-graph",
    markdownUrl: "https://example.test/projects/work-graph.md",
    sourceRevision: null,
    lifecycle: "active" as const,
    archiveReason: null,
    rank: null,
  })),
  putKnowledgeScope: vi.fn(async (input) => ({
    ...input,
    sourceRevision: input.sourceRevision ?? null,
    lifecycle: "active" as const,
    archiveReason: null,
    rank: input.rank ?? null,
  })),
  archiveKnowledgeScope: vi.fn(async (id, input) => ({
    ...knowledgeScope(id, "project"),
    lifecycle: "archived" as const,
    archiveReason: input.reason,
  })),
  restoreKnowledgeScope: vi.fn(async (id) =>
    knowledgeScope(id, "project"),
  ),
  moveKnowledgeScopePriority: vi.fn(async (id) =>
    knowledgeScope(id, "project"),
  ),
  listKnowledgeScopeRelationships: vi.fn(async () => []),
  addKnowledgeScopeRelationship: vi.fn(async () => undefined),
  removeKnowledgeScopeRelationship: vi.fn(async () => undefined),
  listWorkItems: vi.fn(async () => []),
  getWorkItem: vi.fn(async (workItemId) => item(workItemId, "ready")),
  resolveWorkItemContext: vi.fn(async () => []),
  listNotes: vi.fn(async () => []),
  listEvents: vi.fn(async () => []),
  listDependencies: vi.fn(async () => []),
  listLeases: vi.fn(async () => []),
  listAttentionRequests: vi.fn(async () => []),
  createWorkItem: vi.fn(async (input) => ({
    ...input,
    lifecycle: "open" as const,
    parentId: input.parentId ?? null,
    rank: null,
    priorityRank: 1024,
    schedulingInitiativeId: input.schedulingInitiativeId ?? null,
    schedulingProjectId: input.schedulingProjectId ?? null,
    expedited: false,
    expediteReason: null,
  })),
  putWorkItemContext: vi.fn(async (input) => input),
  putWorkItemArchitectureDecision: vi.fn(async (input) => input),
  putWorkItemReference: vi.fn(async (input) => input),
  refreshPullRequest: vi.fn(async (input) => input),
  putWorkItemPullRequest: vi.fn(async (input) => input),
  moveWorkItemPriority: vi.fn(async (workItemId) => ({
    ...item(workItemId, "ready"),
  })),
  reparentWorkItem: vi.fn(async () => undefined),
  setWorkItemSchedulingScope: vi.fn(async (workItemId) => ({
    ...item(workItemId, "ready"),
  })),
  expediteWorkItem: vi.fn(async (workItemId, reason) => ({
    ...item(workItemId, "ready"),
    expedited: true,
    expediteReason: reason,
  })),
  unexpediteWorkItem: vi.fn(async (workItemId) => ({
    ...item(workItemId, "ready"),
  })),
  addDependency: vi.fn(async () => undefined),
  removeDependency: vi.fn(async () => undefined),
  createNote: vi.fn(async (input) => ({
    id: input.id,
    workItemId: input.workItemId,
    leaseId: input.leaseId,
    author: "worker-a",
    content: input.content,
    createdAt: acquiredAt,
  })),
  createPostReleaseNote: vi.fn(async (input) => ({
    id: input.id,
    workItemId: input.workItemId,
    leaseId: null,
    author: input.author,
    content: input.content,
    createdAt: acquiredAt,
  })),
  createAttentionRequest: vi.fn(async (input) => ({
    attentionRequest: {
      id: input.id,
      workItemId: input.workItemId,
      requestingLeaseId: input.leaseId,
      kind: input.kind,
      question: input.question,
      note: input.note ?? null,
      blocking: input.blocking,
      createdAt: acquiredAt,
    },
    endedLease: input.blocking
      ? {
          ...lease(input.workItemId),
          endedAt: acquiredAt,
          outcome: "attention_requested" as const,
        }
      : null,
  })),
  resolveAttentionRequest: vi.fn(async (input) => ({
    resolution: {
      id: input.id,
      attentionRequestId: input.attentionRequestId,
      resolution: input.resolution,
      createdAt: acquiredAt,
    },
    workItemId: "ready",
  })),
  claimWorkItem: vi.fn(async () => lease()),
  renewLease: vi.fn(async () => lease()),
  terminateClaimedWorkItem: vi.fn(async (input) => ({
    ...lease(input.workItemId),
    endedAt: expiresAt,
    outcome: input.outcome,
  })),
  decomposeClaimedWorkItem: vi.fn(async (input: DecomposeClaimedWorkItemInput) => ({
    children: input.children
      .map(({ rank, ...child }) => ({
        rank,
        workItem: {
          ...child,
          lifecycle: "open" as const,
          parentId: input.workItemId,
          rank,
          priorityRank: null,
          schedulingInitiativeId: null,
          schedulingProjectId: null,
          expedited: false,
          expediteReason: null,
        },
      }))
      .sort((left, right) => left.rank - right.rank),
    dependencies: input.dependencies ?? [],
    endedLease: {
      ...lease(input.workItemId),
      endedAt: acquiredAt,
      outcome: "decomposed" as const,
    },
    claimedLease: input.claim
      ? {
          ...lease(input.claim.workItemId),
          id: input.claim.leaseId,
          expiresAt,
        }
      : null,
  })),
});

describe("Given knowledge-scope mirrors", () => {
  it("lists one filtered page and reads one stable source key", async () => {
    const repository = buildRepository();
    vi.mocked(repository.listKnowledgeScopes).mockResolvedValue([
      knowledgeScope("initiative-a", "initiative"),
      knowledgeScope("initiative-b", "initiative"),
    ]);
    vi.mocked(repository.getKnowledgeScope).mockResolvedValue(
      knowledgeScope("initiative-a", "initiative"),
    );
    const app = createWorkGraphApp(repository);

    const list = await app.request(
      "/api/knowledge-scopes?kind=initiative&limit=1",
    );
    expect(list.status).toBe(200);
    expect(repository.listKnowledgeScopes).toHaveBeenCalledWith({
      kind: "initiative",
      limit: 2,
    });
    expect(await responseJson(list)).toEqual({
      items: [knowledgeScope("initiative-a", "initiative")],
      nextCursor: "initiative-a",
    });

    await app.request(
      "/api/knowledge-scopes?kind=initiative&includeArchived=true",
    );
    expect(repository.listKnowledgeScopes).toHaveBeenLastCalledWith({
      kind: "initiative",
      includeArchived: true,
      limit: 51,
    });

    const get = await app.request("/api/knowledge-scopes/initiative-a");
    expect(get.status).toBe(200);
    expect(await responseJson(get)).toEqual(
      knowledgeScope("initiative-a", "initiative"),
    );
  });

  it("creates or replaces a mirror at its stable source-key URL", async () => {
    const repository = buildRepository();
    const app = createWorkGraphApp(repository);
    const body = {
      kind: "project",
      title: "Work Graph",
      canonicalUrl: "https://example.test/projects/work-graph",
      markdownUrl: "https://example.test/projects/work-graph.md",
      sourceRevision: "abc123",
    };

    const response = await app.request("/api/knowledge-scopes/work-graph", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(body),
    });

    expect(response.status).toBe(200);
    expect(repository.putKnowledgeScope).toHaveBeenCalledWith(
      { id: "work-graph", ...body },
      { idempotencyKey },
    );
    expect(await responseJson(response)).toEqual({
      id: "work-graph",
      ...body,
      lifecycle: "active",
      archiveReason: null,
      rank: null,
    });
  });

  it("archives and restores a mirror without deleting its identity", async () => {
    const repository = buildRepository();
    const app = createWorkGraphApp(repository);

    const archived = await app.request(
      "/api/knowledge-scopes/work-graph/archival",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({ reason: "Completed project" }),
      },
    );
    expect(archived.status).toBe(200);
    expect(repository.archiveKnowledgeScope).toHaveBeenCalledWith(
      "work-graph",
      { reason: "Completed project" },
      { idempotencyKey },
    );
    expect(await responseJson(archived)).toEqual(
      expect.objectContaining({
        id: "work-graph",
        lifecycle: "archived",
        archiveReason: "Completed project",
      }),
    );

    const restored = await app.request(
      "/api/knowledge-scopes/work-graph/archival",
      {
        method: "DELETE",
        headers: { "idempotency-key": removeIdempotencyKey },
      },
    );
    expect(restored.status).toBe(200);
    expect(repository.restoreKnowledgeScope).toHaveBeenCalledWith(
      "work-graph",
      { idempotencyKey: removeIdempotencyKey },
    );
  });

  it("moves a scope with relative priority anchors", async () => {
    const repository = buildRepository();
    const app = createWorkGraphApp(repository);
    const response = await app.request(
      "/api/knowledge-scopes/project-a/priority-moves",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({
          higherThanId: "project-b",
          lowerThanId: "project-c",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(repository.moveKnowledgeScopePriority).toHaveBeenCalledWith(
      "project-a",
      { higherThanId: "project-b", lowerThanId: "project-c" },
      { idempotencyKey },
    );
  });

  it("rejects a priority move without a relative anchor", async () => {
    const repository = buildRepository();
    const app = createWorkGraphApp(repository);
    const response = await app.request(
      "/api/knowledge-scopes/project-a/priority-moves",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );

    expect(response.status).toBe(422);
    expect(repository.moveKnowledgeScopePriority).not.toHaveBeenCalled();
  });

  it.each([
    "ftp://example.test/projects/work-graph",
    "https://",
    "https://user:password@example.test/projects/work-graph",
  ])("rejects a scope URL outside the public HTTP contract: %s", async (canonicalUrl) => {
    const repository = buildRepository();
    const app = createWorkGraphApp(repository);

    const response = await app.request("/api/knowledge-scopes/work-graph", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "project",
        title: "Work Graph",
        canonicalUrl,
        markdownUrl: "https://example.test/projects/work-graph.md",
      }),
    });

    expect(response.status).toBe(422);
    expect(repository.putKnowledgeScope).not.toHaveBeenCalled();
  });

  it("adds, lists, and removes scope relationships", async () => {
    const relationship = {
      parentKnowledgeScopeId: "initiative",
      childKnowledgeScopeId: "project",
    };
    const repository = buildRepository();
    vi.mocked(repository.listKnowledgeScopeRelationships).mockResolvedValue([
      relationship,
    ]);
    const app = createWorkGraphApp(repository);

    const created = await app.request(
      "/api/knowledge-scope-relationships",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(relationship),
      },
    );
    expect(created.status).toBe(201);
    expect(repository.addKnowledgeScopeRelationship).toHaveBeenCalledWith(
      relationship,
      {},
    );

    const listed = await app.request("/api/knowledge-scope-relationships");
    expect(await responseJson(listed)).toEqual({
      items: [relationship],
      nextCursor: null,
    });
    expect(repository.listKnowledgeScopeRelationships).toHaveBeenCalledWith({
      limit: 51,
    });

    const removed = await app.request(
      "/api/knowledge-scope-relationships",
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(relationship),
      },
    );
    expect(removed.status).toBe(200);
    expect(repository.removeKnowledgeScopeRelationship).toHaveBeenCalledWith(
      relationship,
      {},
    );
  });

  it("paginates scope relationships with an opaque compound cursor", async () => {
    const first = {
      parentKnowledgeScopeId: "initiative",
      childKnowledgeScopeId: "first-project",
    };
    const second = {
      parentKnowledgeScopeId: "initiative",
      childKnowledgeScopeId: "second-project",
    };
    const repository = buildRepository();
    vi.mocked(repository.listKnowledgeScopeRelationships).mockResolvedValue([
      first,
      second,
    ]);
    const app = createWorkGraphApp(repository);
    const cursor = JSON.stringify(["earlier-initiative", "earlier-project"]);

    const response = await app.request(
      `/api/knowledge-scope-relationships?limit=1&cursor=${encodeURIComponent(cursor)}`,
    );

    expect(response.status).toBe(200);
    expect(repository.listKnowledgeScopeRelationships).toHaveBeenCalledWith({
      cursor: {
        parentKnowledgeScopeId: "earlier-initiative",
        childKnowledgeScopeId: "earlier-project",
      },
      limit: 2,
    });
    expect(await responseJson(response)).toEqual({
      items: [first],
      nextCursor: JSON.stringify([
        first.parentKnowledgeScopeId,
        first.childKnowledgeScopeId,
      ]),
    });
  });

  it("rejects malformed scope relationship cursors", async () => {
    const repository = buildRepository();
    const app = createWorkGraphApp(repository);

    const response = await app.request(
      "/api/knowledge-scope-relationships?cursor=not-json",
    );

    expect(response.status).toBe(400);
    expect(await responseJson(response)).toEqual({
      error: {
        code: "invalid_knowledge_scope_relationship_cursor",
        message: "The knowledge-scope relationship cursor is invalid.",
      },
    });
    expect(repository.listKnowledgeScopeRelationships).not.toHaveBeenCalled();
  });

  it("maps a missing scope to HTTP 404", async () => {
    const repository = buildRepository();
    vi.mocked(repository.getKnowledgeScope).mockRejectedValue(
      new WorkGraphError(
        "knowledge_scope_not_found",
        "Knowledge scope missing does not exist.",
      ),
    );
    const app = createWorkGraphApp(repository);

    const response = await app.request("/api/knowledge-scopes/missing");

    expect(response.status).toBe(404);
  });
});

describe("Given work items with derived readiness", () => {
  it("keeps repository priority order instead of sorting by ID", async () => {
    const repository = buildRepository();
    vi.mocked(repository.listWorkItems).mockResolvedValue([
      item("z-high", "ready"),
      item("a-low", "ready"),
    ]);
    const app = createWorkGraphApp(repository);

    const response = await app.request("/api/work-items?stage=ready");
    const body = (await responseJson(response)) as {
      items: Array<{ id: string }>;
    };

    expect(body.items.map(({ id }) => id)).toEqual(["z-high", "a-low"]);
  });

  it("passes initiative, project, and parent filters to the ordered read", async () => {
    const repository = buildRepository();
    const app = createWorkGraphApp(repository);

    const response = await app.request(
      "/api/work-items?stage=ready&initiativeId=initiative&projectId=project&parentId=parent",
    );

    expect(response.status).toBe(200);
    expect(repository.listWorkItems).toHaveBeenCalledWith({
      initiativeId: "initiative",
      projectId: "project",
      parentId: "parent",
    });
  });

  it("lists a stage with a cursor that survives readiness changes", async () => {
    const repository = buildRepository();
    vi.mocked(repository.listWorkItems)
      .mockResolvedValueOnce([
        item("blocked", "blocked"),
        item("a-ready", "ready"),
        item("b-ready", "ready"),
      ])
      .mockResolvedValueOnce([
        item("a-ready", "in_progress", "open", lease("a-ready")),
        item("b-ready", "ready"),
      ]);
    const app = createWorkGraphApp(repository);

    const response = await app.request("/api/work-items?stage=ready&limit=1");

    expect(response.status).toBe(200);
    expect(await responseJson(response)).toEqual({
      items: [item("a-ready", "ready")],
      nextCursor: "a-ready",
    });

    const nextResponse = await app.request(
      "/api/work-items?stage=ready&limit=1&cursor=a-ready",
    );
    expect(await responseJson(nextResponse)).toEqual({
      items: [item("b-ready", "ready")],
      nextCursor: null,
    });
  });

  it("reads one work item without storing its projected stage", async () => {
    const repository = buildRepository();
    vi.mocked(repository.getWorkItem).mockResolvedValue(
      item("leased", "in_progress", "open", lease("leased")),
    );
    const app = createWorkGraphApp(repository);

    const response = await app.request("/api/work-items/leased");

    expect(response.status).toBe(200);
    expect(await responseJson(response)).toEqual(
      expect.objectContaining({
        id: "leased",
        lifecycle: "open",
        stage: "in_progress",
        currentLease: expect.objectContaining({
          id: leaseId,
          acquiredAt: acquiredAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
        }),
      }),
    );
  });

  it("upserts typed context and returns resolved claim ordering", async () => {
    const repository = buildRepository();
    const resolved = [
      {
        kind: "brief" as const,
        content: "Implement ordered context.",
        sourceWorkItemId: "ticket",
        inheritanceDepth: 0,
      },
    ];
    vi.mocked(repository.resolveWorkItemContext).mockResolvedValue(resolved);
    const app = createWorkGraphApp(repository);

    const brief = await app.request("/api/work-items/ticket/contexts", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({
        kind: "brief",
        content: "Implement ordered context.",
      }),
    });
    const decision = await app.request("/api/work-items/ticket/contexts", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "architecture_decision",
        title: "Context ordering",
        url: "https://example.test/adrs/context-ordering",
        role: "governing",
      }),
    });
    const reference = await app.request("/api/work-items/ticket/references", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Design notes",
        url: "https://example.test/design-notes",
      }),
    });
    const listed = await app.request("/api/work-items/ticket/contexts");

    expect(brief.status).toBe(200);
    expect(decision.status).toBe(200);
    expect(reference.status).toBe(200);
    expect(repository.putWorkItemContext).toHaveBeenCalledWith(
      {
        workItemId: "ticket",
        kind: "brief",
        content: "Implement ordered context.",
      },
      { idempotencyKey },
    );
    expect(repository.putWorkItemArchitectureDecision).toHaveBeenCalledWith(
      {
        workItemId: "ticket",
        title: "Context ordering",
        url: "https://example.test/adrs/context-ordering",
        role: "governing",
      },
      {},
    );
    expect(repository.putWorkItemReference).toHaveBeenCalledWith(
      {
        workItemId: "ticket",
        title: "Design notes",
        url: "https://example.test/design-notes",
      },
      {},
    );
    expect(await responseJson(listed)).toEqual({ items: resolved });
  });

  it("refreshes and links pull requests outside claim operations", async () => {
    const repository = buildRepository();
    const snapshot = {
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
    vi.mocked(repository.resolveWorkItemContext).mockResolvedValue([
      {
        kind: "brief",
        content: "Implement it.",
        sourceWorkItemId: "ticket",
        inheritanceDepth: 0,
      },
      {
        kind: "pull_request",
        role: "implementation",
        pullRequest: snapshot,
        sourceWorkItemId: "ticket",
        inheritanceDepth: 0,
      },
    ]);
    const app = createWorkGraphApp(repository);

    const refreshed = await app.request("/api/pull-requests", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(snapshot),
    });
    const linked = await app.request("/api/work-items/ticket/pull-requests", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({
        repository: snapshot.repository,
        number: snapshot.number,
        role: "implementation",
      }),
    });
    const listed = await app.request(
      "/api/work-items/ticket/pull-requests",
    );

    expect(refreshed.status).toBe(200);
    expect(linked.status).toBe(200);
    expect(repository.refreshPullRequest).toHaveBeenCalledWith(snapshot, {});
    expect(repository.putWorkItemPullRequest).toHaveBeenCalledWith(
      {
        workItemId: "ticket",
        repository: snapshot.repository,
        number: snapshot.number,
        role: "implementation",
      },
      { idempotencyKey },
    );
    expect(await responseJson(listed)).toEqual({
      items: [
        expect.objectContaining({
          kind: "pull_request",
          role: "implementation",
        }),
      ],
    });
    expect(repository.claimWorkItem).not.toHaveBeenCalled();
  });
});

describe("Given idempotent graph mutation requests", () => {
  it("creates a sparse work item without accepting derived state", async () => {
    const repository = buildRepository();
    vi.mocked(repository.getWorkItem).mockResolvedValue({
      ...item("sparse", "ready"),
      title: "Sparse work item",
    });
    const app = createWorkGraphApp(repository);

    const response = await app.request("/api/work-items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "sparse", title: "Sparse work item" }),
    });

    expect(response.status).toBe(201);
    expect(repository.createWorkItem).toHaveBeenCalledWith(
      { id: "sparse", title: "Sparse work item" },
      {},
    );
    expect(await responseJson(response)).toEqual({
      ...item("sparse", "ready"),
      title: "Sparse work item",
    });

    const rejected = await app.request("/api/work-items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "fixed",
        title: "Fixed state",
        stage: "ready",
      }),
    });
    expect(rejected.status).toBe(422);
  });

  it("moves, expedites, and unexpedites a ticket", async () => {
    const repository = buildRepository();
    const app = createWorkGraphApp(repository);

    const moved = await app.request(
      "/api/work-items/ticket-a/priority-moves",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ higherThanId: "ticket-b" }),
      },
    );
    const expedited = await app.request("/api/work-items/ticket-a/expedites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "Restore production." }),
    });
    const unexpedited = await app.request(
      "/api/work-items/ticket-a/expedites",
      { method: "DELETE" },
    );

    expect(moved.status).toBe(200);
    expect(expedited.status).toBe(200);
    expect(unexpedited.status).toBe(200);
    expect(repository.moveWorkItemPriority).toHaveBeenCalledWith(
      "ticket-a",
      { higherThanId: "ticket-b" },
      {},
    );
    expect(repository.expediteWorkItem).toHaveBeenCalledWith(
      "ticket-a",
      "Restore production.",
      {},
    );
    expect(repository.unexpediteWorkItem).toHaveBeenCalledWith(
      "ticket-a",
      {},
    );
  });

  it("reparents and detaches a ticket without replacing it", async () => {
    const repository = buildRepository();
    vi.mocked(repository.getWorkItem)
      .mockResolvedValueOnce({
        ...item("ticket-a", "blocked"),
        parentId: "parent-a",
      })
      .mockResolvedValueOnce(item("ticket-a", "ready"));
    const app = createWorkGraphApp(repository);

    const reparented = await app.request(
      "/api/work-items/ticket-a/parent",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({ parentId: "parent-a" }),
      },
    );
    const detached = await app.request(
      "/api/work-items/ticket-a/parent",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parentId: null }),
      },
    );

    expect(reparented.status).toBe(200);
    expect(detached.status).toBe(200);
    expect(await responseJson(reparented)).toEqual(
      expect.objectContaining({ id: "ticket-a", parentId: "parent-a" }),
    );
    expect(await responseJson(detached)).toEqual(
      expect.objectContaining({ id: "ticket-a", parentId: null }),
    );
    expect(repository.reparentWorkItem).toHaveBeenNthCalledWith(
      1,
      "ticket-a",
      "parent-a",
      { idempotencyKey },
    );
    expect(repository.reparentWorkItem).toHaveBeenNthCalledWith(
      2,
      "ticket-a",
      null,
      {},
    );
  });

  it("assigns a root ticket to scheduling scopes", async () => {
    const repository = buildRepository();
    const app = createWorkGraphApp(repository);

    const response = await app.request(
      "/api/work-items/plan/scheduling-scope",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schedulingInitiativeId: "initiative",
          schedulingProjectId: "project",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(repository.setWorkItemSchedulingScope).toHaveBeenCalledWith(
      "plan",
      {
        schedulingInitiativeId: "initiative",
        schedulingProjectId: "project",
      },
      {},
    );
  });

  it("adds and removes one dependency with the caller's retry key", async () => {
    const repository = buildRepository();
    const app = createWorkGraphApp(repository);
    const dependency = {
      dependentWorkItemId: "dependent",
      blockerWorkItemId: "blocker",
    };
    const request = (method: "POST" | "DELETE") =>
      app.request("/api/dependencies", {
        method,
        headers: {
          "content-type": "application/json",
          "idempotency-key":
            method === "POST" ? idempotencyKey : removeIdempotencyKey,
        },
        body: JSON.stringify(dependency),
      });

    const added = await request("POST");
    const removed = await request("DELETE");

    expect(added.status).toBe(201);
    expect(removed.status).toBe(200);
    expect(await responseJson(added)).toEqual(dependency);
    expect(await responseJson(removed)).toEqual(dependency);
    expect(repository.addDependency).toHaveBeenCalledWith(dependency, {
      idempotencyKey,
    });
    expect(repository.removeDependency).toHaveBeenCalledWith(dependency, {
      idempotencyKey: removeIdempotencyKey,
    });
  });
});

describe("Given a worker recording progress and requesting attention", () => {
  it("lists unresolved attention by default and can select resolved requests", async () => {
    const repository = buildRepository();
    const firstUnresolved = {
      id: attentionRequestId,
      workItemId: "ready",
      requestingLeaseId: leaseId,
      kind: "decision",
      question: "Which contract is canonical?",
      note: null,
      blocking: true,
      createdAt: acquiredAt,
      resolution: null,
    } as const;
    const resolvedRequest = {
      id: attentionResolutionId,
      workItemId: "resolved",
      requestingLeaseId: leaseId,
      kind: "review",
      question: "Is the wording clear?",
      note: null,
      blocking: false,
      createdAt: acquiredAt,
      resolution: {
        id: noteId,
        attentionRequestId: attentionResolutionId,
        resolution: "Yes.",
        createdAt: expiresAt,
      },
    } as const;
    const secondUnresolved = {
      id: secondAttentionRequestId,
      workItemId: "other",
      requestingLeaseId: leaseId,
      kind: "input",
      question: "Which option applies?",
      note: null,
      blocking: true,
      createdAt: expiresAt,
      resolution: null,
    } as const;
    vi.mocked(repository.listAttentionRequests)
      .mockResolvedValueOnce([firstUnresolved, secondUnresolved])
      .mockResolvedValueOnce([secondUnresolved])
      .mockResolvedValueOnce([resolvedRequest]);
    const app = createWorkGraphApp(repository);

    const unresolved = await app.request(
      "/api/attention-requests?limit=1",
    );
    const nextUnresolved = await app.request(
      `/api/attention-requests?cursor=${attentionRequestId}`,
    );
    const resolved = await app.request(
      "/api/attention-requests?state=resolved&blocking=false",
    );

    expect(await responseJson(unresolved)).toEqual({
      items: [
        expect.objectContaining({
          id: attentionRequestId,
          resolution: null,
        }),
      ],
      nextCursor: attentionRequestId,
    });
    expect(await responseJson(nextUnresolved)).toEqual({
      items: [
        expect.objectContaining({
          id: secondAttentionRequestId,
          resolution: null,
        }),
      ],
      nextCursor: null,
    });
    expect(await responseJson(resolved)).toEqual({
      items: [
        expect.objectContaining({
          id: attentionResolutionId,
          resolution: expect.objectContaining({
            resolution: "Yes.",
            createdAt: expiresAt.toISOString(),
          }),
        }),
      ],
      nextCursor: null,
    });
    expect(repository.listAttentionRequests).toHaveBeenNthCalledWith(1, {
      state: "unresolved",
      limit: 2,
    });
    expect(repository.listAttentionRequests).toHaveBeenNthCalledWith(2, {
      state: "unresolved",
      cursor: attentionRequestId,
      limit: 51,
    });
    expect(repository.listAttentionRequests).toHaveBeenNthCalledWith(3, {
      state: "resolved",
      blocking: false,
      limit: 51,
    });
  });

  it("records a note only against the work item in the path", async () => {
    const repository = buildRepository();
    const app = createWorkGraphApp(repository);

    const response = await app.request("/api/work-items/ready/notes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({
        id: noteId,
        leaseId,
        epoch: 1,
        content: "Checked the generated contract.",
      }),
    });

    expect(response.status).toBe(201);
    expect(repository.createNote).toHaveBeenCalledWith(
      {
        id: noteId,
        workItemId: "ready",
        leaseId,
        epoch: 1,
        content: "Checked the generated contract.",
      },
      { idempotencyKey },
    );
    expect(await responseJson(response)).toEqual({
      id: noteId,
      workItemId: "ready",
      kind: "work",
      leaseId,
      author: "worker-a",
      content: "Checked the generated contract.",
      createdAt: acquiredAt.toISOString(),
    });
  });

  it("appends attributed discussion through the post-release route", async () => {
    const repository = buildRepository();
    const app = createWorkGraphApp(repository);

    const response = await app.request("/api/work-items/released/comments", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({
        id: noteId,
        author: "agent-a",
        content: "Production exposed a follow-up.",
      }),
    });

    expect(response.status).toBe(201);
    expect(repository.createPostReleaseNote).toHaveBeenCalledWith(
      {
        id: noteId,
        workItemId: "released",
        author: "agent-a",
        content: "Production exposed a follow-up.",
      },
      { idempotencyKey },
    );
    expect(await responseJson(response)).toEqual({
      id: noteId,
      workItemId: "released",
      kind: "post_release",
      leaseId: null,
      author: "agent-a",
      content: "Production exposed a follow-up.",
      createdAt: acquiredAt.toISOString(),
    });
  });

  it("exposes every stored work-item metadata family without database access", async () => {
    const repository = buildRepository();
    const secondId = "00000000-0000-4000-8000-000000000009";
    vi.mocked(repository.listNotes).mockResolvedValue([
      {
        id: noteId,
        workItemId: "ready",
        leaseId,
        author: "worker-a",
        content: "First note",
        createdAt: acquiredAt,
      },
      {
        id: secondId,
        workItemId: "ready",
        leaseId,
        author: "worker-a",
        content: "Second note",
        createdAt: expiresAt,
      },
    ]);
    vi.mocked(repository.listDependencies).mockResolvedValue([
      { dependentWorkItemId: "ready", blockerWorkItemId: "blocker-a" },
      { dependentWorkItemId: "downstream", blockerWorkItemId: "ready" },
    ]);
    vi.mocked(repository.listLeases).mockResolvedValue([
      {
        ...lease("ready"),
        id: secondId,
        epoch: 2,
        endedAt: expiresAt,
        outcome: "decomposed",
      },
      { ...lease("ready"), id: attentionResolutionId, epoch: 3 },
    ]);
    vi.mocked(repository.listEvents).mockImplementation(async (input = {}) => {
      const lifecycle = input.lifecycle ?? "released";
      const type = input.type ?? "dependency.added";
      return [
        {
          sequence: 21,
          type,
          workItemId: "ready",
          data:
            type === "work_item.lifecycle_changed"
              ? {
                  from: "open",
                  to: lifecycle,
                  ...(lifecycle === "released"
                    ? {
                        mergeEvidence: completionEvidence.mergeEvidence,
                        deploymentEvidence:
                          completionEvidence.deploymentEvidence,
                      }
                    : {}),
                }
              : type === "work_item.decomposed"
                ? { childWorkItemIds: ["child-a"] }
                : { blockerWorkItemId: "blocker-a" },
          occurredAt: acquiredAt,
        },
        {
          sequence: 22,
          type,
          workItemId: "ready",
          data: {},
          occurredAt: expiresAt,
        },
      ];
    });
    vi.mocked(repository.listAttentionRequests).mockResolvedValue([
      {
        id: attentionRequestId,
        workItemId: "ready",
        requestingLeaseId: leaseId,
        kind: "decision",
        question: "Which contract is canonical?",
        note: "Compare both options.",
        blocking: true,
        createdAt: acquiredAt,
        resolution: {
          id: attentionResolutionId,
          attentionRequestId,
          resolution: "Use the REST contract.",
          createdAt: expiresAt,
        },
      },
    ]);
    const app = createWorkGraphApp(repository);

    const notes = await app.request(
      "/api/work-items/ready/notes?limit=1",
    );
    const events = await app.request(
      "/api/work-items/ready/events?limit=1&afterSequence=20",
    );
    const dependencies = await app.request(
      "/api/work-items/ready/dependencies?limit=1",
    );
    const decompositions = await app.request(
      "/api/work-items/ready/events?type=work_item.decomposed&limit=1",
    );
    const leases = await app.request(
      "/api/work-items/ready/leases?limit=1&afterEpoch=1",
    );
    const attention = await app.request(
      "/api/attention-requests?workItemId=ready&state=all&limit=1",
    );
    const cancellations = await app.request(
      "/api/work-items/ready/events?type=work_item.lifecycle_changed&lifecycle=cancelled&limit=1",
    );
    const releases = await app.request(
      "/api/work-items/ready/events?type=work_item.lifecycle_changed&lifecycle=released&limit=1",
    );
    const scopeEvents = await app.request(
      "/api/work-items/ready/events?type=knowledge_scope.priority_moved",
    );

    expect(await responseJson(notes)).toEqual({
      items: [expect.objectContaining({ content: "First note" })],
      nextCursor: noteId,
    });
    expect(await responseJson(events)).toEqual({
      items: [expect.objectContaining({ sequence: 21 })],
      nextCursor: 21,
    });
    expect(scopeEvents.status).toBe(422);
    expect(await responseJson(dependencies)).toEqual({
      items: [
        { dependentWorkItemId: "ready", blockerWorkItemId: "blocker-a" },
      ],
      nextCursor: JSON.stringify(["ready", "blocker-a"]),
    });
    expect(await responseJson(decompositions)).toEqual({
      items: [
        expect.objectContaining({
          type: "work_item.decomposed",
          data: { childWorkItemIds: ["child-a"] },
        }),
      ],
      nextCursor: 21,
    });
    expect(await responseJson(leases)).toEqual({
      items: [expect.objectContaining({ epoch: 2, outcome: "decomposed" })],
      nextCursor: 2,
    });
    expect(await responseJson(attention)).toEqual({
      items: [
        expect.objectContaining({
          resolution: expect.objectContaining({
            resolution: "Use the REST contract.",
          }),
        }),
      ],
      nextCursor: null,
    });
    expect(await responseJson(cancellations)).toEqual({
      items: [
        expect.objectContaining({ data: { from: "open", to: "cancelled" } }),
      ],
      nextCursor: 21,
    });
    expect(await responseJson(releases)).toEqual({
      items: [
        expect.objectContaining({
          data: {
            from: "open",
            to: "released",
            ...completionEvidence,
          },
        }),
      ],
      nextCursor: 21,
    });
    expect(repository.listAttentionRequests).toHaveBeenCalledWith({
      workItemId: "ready",
      limit: 2,
    });
  });

  it("ends a lease for blocking attention and returns derived readiness after resolution", async () => {
    const repository = buildRepository();
    vi.mocked(repository.getWorkItem)
      .mockResolvedValueOnce(item("ready", "needs_attention"))
      .mockResolvedValueOnce(item("ready", "ready"));
    const app = createWorkGraphApp(repository);

    const opened = await app.request("/api/attention-requests", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify({
        id: attentionRequestId,
        workItemId: "ready",
        leaseId,
        epoch: 1,
        kind: "decision",
        question: "Which contract should remain canonical?",
      }),
    });
    const resolved = await app.request(
      `/api/attention-requests/${attentionRequestId}/resolutions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": removeIdempotencyKey,
        },
        body: JSON.stringify({
          id: attentionResolutionId,
          resolution: "Keep the generated OpenAPI document canonical.",
        }),
      },
    );

    expect(opened.status).toBe(201);
    expect(resolved.status).toBe(201);
    expect(repository.createAttentionRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        id: attentionRequestId,
        blocking: true,
      }),
      { idempotencyKey },
    );
    expect(repository.resolveAttentionRequest).toHaveBeenCalledWith(
      {
        id: attentionResolutionId,
        attentionRequestId,
        resolution: "Keep the generated OpenAPI document canonical.",
      },
      { idempotencyKey: removeIdempotencyKey },
    );
    expect(await responseJson(opened)).toEqual(
      expect.objectContaining({
        endedLease: expect.objectContaining({
          outcome: "attention_requested",
        }),
        workItem: expect.objectContaining({ stage: "needs_attention" }),
      }),
    );
    expect(await responseJson(resolved)).toEqual(
      expect.objectContaining({
        workItem: expect.objectContaining({ stage: "ready" }),
      }),
    );
  });
});

describe("Given a worker managing a lease", () => {
  it("passes scope filters to scheduler-selected claims", async () => {
    const repository = buildRepository();
    const app = createWorkGraphApp(repository, {
      createLeaseId: () => leaseId,
    });

    const response = await app.request("/api/leases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workerId: "worker-a",
        leaseDurationSeconds: 300,
        initiativeId: "initiative",
        projectId: "project",
        parentId: "parent",
      }),
    });

    expect(response.status).toBe(201);
    expect(repository.claimWorkItem).toHaveBeenCalledWith({
      leaseId,
      workerId: "worker-a",
      leaseDurationSeconds: 300,
      initiativeId: "initiative",
      projectId: "project",
      parentId: "parent",
    });
  });

  it("decomposes into ranked children and claims one for the same worker", async () => {
    const repository = buildRepository();
    vi.mocked(repository.listWorkItems).mockResolvedValue(
      ["parent", "first", "second"].map((workItemId) => ({
        ...item(
          workItemId,
          workItemId === "parent"
            ? "blocked"
            : workItemId === "first"
              ? "in_progress"
              : "blocked",
          "open",
          workItemId === "first"
            ? { ...lease("first"), id: childLeaseId }
            : null,
        ),
        parentId: workItemId === "parent" ? null : "parent",
        rank:
          workItemId === "first" ? 10 : workItemId === "second" ? 20 : null,
      })),
    );
    const app = createWorkGraphApp(repository);
    const body = {
      leaseId,
      epoch: 1,
      children: [
        { id: "second", title: "Second child", rank: 20 },
        { id: "first", title: "First child", rank: 10 },
      ],
      dependencies: [
        { dependentWorkItemId: "second", blockerWorkItemId: "first" },
      ],
      claim: {
        workItemId: "first",
        leaseId: childLeaseId,
        leaseDurationSeconds: 300,
      },
    };

    const response = await app.request(
      "/api/work-items/parent/decompositions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify(body),
      },
    );

    expect(response.status).toBe(201);
    expect(repository.decomposeClaimedWorkItem).toHaveBeenCalledWith(
      {
        ...body,
        workItemId: "parent",
        children: body.children,
      },
      { idempotencyKey },
    );
    expect(repository.listWorkItems).toHaveBeenCalledOnce();
    expect(repository.getWorkItem).not.toHaveBeenCalled();
    expect(await responseJson(response)).toEqual(
      expect.objectContaining({
        parent: expect.objectContaining({ id: "parent", stage: "blocked" }),
        children: [
          expect.objectContaining({
            rank: 10,
            workItem: expect.objectContaining({
              id: "first",
              parentId: "parent",
              stage: "in_progress",
            }),
          }),
          expect.objectContaining({
            rank: 20,
            workItem: expect.objectContaining({
              id: "second",
              stage: "blocked",
            }),
          }),
        ],
        endedLease: expect.objectContaining({ outcome: "decomposed" }),
        claimedLease: expect.objectContaining({
          id: childLeaseId,
          workItemId: "first",
          workerId: "worker-a",
        }),
      }),
    );
  });

  it("claims, renews, and releases through noun-based resources", async () => {
    const repository = buildRepository();
    const released = item("ready", "released", "released");
    vi.mocked(repository.getWorkItem)
      .mockResolvedValueOnce(
        item("ready", "in_progress", "open", lease("ready")),
      )
      .mockResolvedValueOnce(released);
    vi.mocked(repository.resolveWorkItemContext).mockResolvedValue([
      {
        kind: "brief",
        content: "Start here.",
        sourceWorkItemId: "ready",
        inheritanceDepth: 0,
      },
    ]);
    const app = createWorkGraphApp(repository, {
      createLeaseId: () => leaseId,
    });

    const claimResponse = await app.request("/api/leases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workItemId: "ready",
        workerId: "worker-a",
        leaseDurationSeconds: 300,
      }),
    });
    const renewResponse = await app.request(`/api/leases/${leaseId}/renewals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ epoch: 1, leaseDurationSeconds: 600 }),
    });
    const releaseWithoutEvidenceResponse = await app.request(
      "/api/work-items/ready/releases",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leaseId, epoch: 1 }),
      },
    );
    const releaseWithBlankEvidenceResponse = await app.request(
      "/api/work-items/ready/releases",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leaseId,
          epoch: 1,
          mergeEvidence: " ",
          deploymentEvidence: completionEvidence.deploymentEvidence,
        }),
      },
    );
    const releaseResponse = await app.request(
      "/api/work-items/ready/releases",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leaseId, epoch: 1, ...completionEvidence }),
      },
    );

    expect(claimResponse.status).toBe(201);
    expect(renewResponse.status).toBe(200);
    expect(releaseWithoutEvidenceResponse.status).toBe(422);
    expect(releaseWithBlankEvidenceResponse.status).toBe(422);
    expect(releaseResponse.status).toBe(201);
    expect(repository.claimWorkItem).toHaveBeenCalledWith({
      leaseId,
      workItemId: "ready",
      workerId: "worker-a",
      leaseDurationSeconds: 300,
    });
    expect(await responseJson(claimResponse)).toEqual(
      expect.objectContaining({
        context: [
          {
            kind: "brief",
            content: "Start here.",
            sourceWorkItemId: "ready",
            inheritanceDepth: 0,
          },
        ],
      }),
    );
    expect(repository.renewLease).toHaveBeenCalledWith({
      leaseId,
      epoch: 1,
      leaseDurationSeconds: 600,
    });
    expect(repository.terminateClaimedWorkItem).toHaveBeenCalledWith({
      leaseId,
      epoch: 1,
      workItemId: "ready",
      outcome: "released",
      ...completionEvidence,
    });
    expect(await responseJson(releaseResponse)).toEqual(
      expect.objectContaining({
        workItem: expect.objectContaining({
          lifecycle: "released",
          stage: "released",
        }),
      }),
    );
  });

  it("cancels only the work item named by the resource path", async () => {
    const repository = buildRepository();
    vi.mocked(repository.getWorkItem).mockResolvedValue(
      item("cancelled", "cancelled", "cancelled"),
    );
    const app = createWorkGraphApp(repository);

    const response = await app.request(
      "/api/work-items/cancelled/cancellations",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leaseId, epoch: 1 }),
      },
    );

    expect(response.status).toBe(201);
    expect(repository.terminateClaimedWorkItem).toHaveBeenCalledWith({
      leaseId,
      epoch: 1,
      workItemId: "cancelled",
      outcome: "cancelled",
    });
  });

  it("returns a conflict when no eligible claim candidate remains", async () => {
    const repository = buildRepository();
    vi.mocked(repository.claimWorkItem).mockResolvedValue(null);
    const app = createWorkGraphApp(repository);

    const response = await app.request("/api/leases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workerId: "worker-a",
        leaseDurationSeconds: 300,
      }),
    });

    expect(response.status).toBe(409);
    expect(await responseJson(response)).toEqual({
      error: {
        code: "work_item_not_claimable",
        message: "No work item is currently claimable.",
      },
    });
  });

  it("maps stale lease fencing and missing work into shared errors", async () => {
    const repository = buildRepository();
    vi.mocked(repository.renewLease).mockRejectedValue(
      new WorkGraphError("lease_not_current", "The lease is stale."),
    );
    vi.mocked(repository.getWorkItem).mockRejectedValue(
      new WorkGraphError("work_item_not_found", "The work item is missing."),
    );
    vi.mocked(repository.resolveAttentionRequest).mockRejectedValue(
      new WorkGraphError(
        "attention_request_not_found",
        "The attention request is missing.",
      ),
    );
    const app = createWorkGraphApp(repository);

    const renewResponse = await app.request(
      `/api/leases/${leaseId}/renewals`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ epoch: 1, leaseDurationSeconds: 300 }),
      },
    );
    const readResponse = await app.request("/api/work-items/missing");
    const resolutionResponse = await app.request(
      `/api/attention-requests/${attentionRequestId}/resolutions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: attentionResolutionId,
          resolution: "No answer is available.",
        }),
      },
    );

    expect(renewResponse.status).toBe(409);
    expect(await responseJson(renewResponse)).toEqual({
      error: { code: "lease_not_current", message: "The lease is stale." },
    });
    expect(readResponse.status).toBe(404);
    expect(resolutionResponse.status).toBe(404);
  });
});

describe("Given an invalid REST request", () => {
  it("rejects a specified work item combined with scheduler scope filters", async () => {
    const repository = buildRepository();
    const app = createWorkGraphApp(repository);

    const response = await app.request("/api/leases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workerId: "worker-a",
        leaseDurationSeconds: 300,
        workItemId: "ticket-a",
        projectId: "work-graph",
      }),
    });

    expect(response.status).toBe(422);
    expect(repository.claimWorkItem).not.toHaveBeenCalled();
  });

  it("rejects unknown fields and out-of-range lease durations", async () => {
    const app = createWorkGraphApp(buildRepository());

    const response = await app.request("/api/leases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workerId: "worker-a",
        leaseDurationSeconds: 86_401,
        executionMode: "action",
      }),
    });

    expect(response.status).toBe(422);
    expect(await responseJson(response)).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: "validation_failed" }),
      }),
    );
  });

  it("rejects a malformed idempotency key before mutation", async () => {
    const repository = buildRepository();
    const app = createWorkGraphApp(repository);

    const response = await app.request("/api/dependencies", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "not-a-uuid",
      },
      body: JSON.stringify({
        dependentWorkItemId: "dependent",
        blockerWorkItemId: "blocker",
      }),
    });

    expect(response.status).toBe(422);
    expect(repository.addDependency).not.toHaveBeenCalled();
  });
});
