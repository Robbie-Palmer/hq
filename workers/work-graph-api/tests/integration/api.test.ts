import {
  closeDb,
  createDb,
  schema,
  WorkGraphRepository,
} from "work-graph-db";
import { createWorkGraphApp } from "../../src/index";

const databaseURL = process.env.DATABASE_URL;
if (!databaseURL) {
  throw new Error("DATABASE_URL is required for integration tests.");
}

const db = createDb(databaseURL);
const repository = new WorkGraphRepository(db);
const app = createWorkGraphApp(repository);

const recordId = (suffix: number): string =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;
const commitSha = (character: string): string => character.repeat(40);

const completionEvidence = {
  mergeEvidence: "https://github.com/example/work-graph/pull/1",
  deploymentEvidence: "https://work-graph.example.test/health",
} as const;

const requestJson = async (
  path: string,
  method: "POST" | "PUT" | "DELETE" = "POST",
  body?: unknown,
  idempotencyKey?: string,
): Promise<Response> =>
  app.request(path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(idempotencyKey === undefined
        ? {}
        : { "idempotency-key": idempotencyKey }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

beforeEach(async () => {
  await db.$client.begin(async (transaction) => {
    await transaction.unsafe(
      'alter table "events" disable trigger events_immutable_truncate',
    );
    await transaction.unsafe('truncate table "events" restart identity');
    await transaction.unsafe(
      'alter table "events" enable trigger events_immutable_truncate',
    );
  });
  await db.transaction(async (transaction) => {
    await transaction.delete(schema.attentionResolution);
    await transaction.delete(schema.attentionRequest);
  });
  await db.$client.begin(async (transaction) => {
    await transaction.unsafe(
      'alter table "notes" disable trigger notes_immutable',
    );
    await transaction.unsafe('delete from "notes"');
    await transaction.unsafe(
      'alter table "notes" enable trigger notes_immutable',
    );
  });
  await db.$client.begin(async (transaction) => {
    await transaction.unsafe('delete from "work_item_completion_candidates"');
    await transaction.unsafe('alter table "completion_candidate_evaluations" disable trigger completion_candidate_evaluations_immutable');
    await transaction.unsafe('delete from "completion_candidate_evaluations"');
    await transaction.unsafe('alter table "completion_candidate_evaluations" enable trigger completion_candidate_evaluations_immutable');
    await transaction.unsafe('delete from "work_item_completion_policies"');
    await transaction.unsafe('alter table "completion_policy_revisions" disable trigger completion_policy_revisions_immutable');
    await transaction.unsafe('delete from "completion_policy_revisions"');
    await transaction.unsafe('alter table "completion_policy_revisions" enable trigger completion_policy_revisions_immutable');
    await transaction.unsafe('delete from "current_delivery_evidence"');
    await transaction.unsafe('alter table "delivery_evidence_observations" disable trigger delivery_evidence_observations_immutable');
    await transaction.unsafe('delete from "delivery_evidence_observations"');
    await transaction.unsafe('alter table "delivery_evidence_observations" enable trigger delivery_evidence_observations_immutable');
    await transaction.unsafe('alter table "external_deliveries" disable trigger external_deliveries_immutable');
    await transaction.unsafe('delete from "external_deliveries"');
    await transaction.unsafe('alter table "external_deliveries" enable trigger external_deliveries_immutable');
  });
  await db.transaction(async (transaction) => {
    await transaction.delete(schema.lease);
    await transaction.delete(schema.idempotencyKey);
    await transaction.delete(schema.workItemArchitectureDecision);
    await transaction.delete(schema.workItemContext);
    await transaction.delete(schema.workItemReference);
    await transaction.delete(schema.workItemPullRequest);
    await transaction.delete(schema.pullRequest);
    await transaction.delete(schema.knowledgeScopeRelationship);
    await transaction.delete(schema.workItemPriorityContext);
    await transaction.delete(schema.knowledgeScope);
    await transaction.delete(schema.workItemDependency);
    await transaction.delete(schema.workItemHierarchy);
    await transaction.delete(schema.workItem);
  });
});

describe("Given knowledge scopes mirrored over HTTP", () => {
  it("upserts source snapshots and manages an acyclic relationship", async () => {
    const initiative = {
      kind: "initiative",
      title: "Semi-autonomous software development",
      canonicalUrl: "https://example.test/initiatives/semi-autonomous",
      markdownUrl: "https://example.test/initiatives/semi-autonomous.md",
      sourceRevision: "abc123",
    };
    const project = {
      kind: "project",
      title: "Work Graph",
      canonicalUrl: "https://example.test/projects/work-graph",
      markdownUrl: "https://example.test/projects/work-graph.md",
    };

    const initiativeResponse = await requestJson(
      "/api/knowledge-scopes/semi-autonomous",
      "PUT",
      initiative,
      recordId(401),
    );
    const projectResponse = await requestJson(
      "/api/knowledge-scopes/work-graph",
      "PUT",
      project,
      recordId(402),
    );
    expect(initiativeResponse.status).toBe(200);
    expect(projectResponse.status).toBe(200);

    const relationship = {
      parentKnowledgeScopeId: "semi-autonomous",
      childKnowledgeScopeId: "work-graph",
    };
    const linked = await requestJson(
      "/api/knowledge-scope-relationships",
      "POST",
      relationship,
      recordId(403),
    );
    expect(linked.status).toBe(201);

    const listResponse = await app.request(
      "/api/knowledge-scopes?kind=project",
    );
    expect(await listResponse.json()).toEqual({
      items: [
        {
          id: "work-graph",
          ...project,
          sourceRevision: null,
          lifecycle: "active",
          archiveReason: null,
          rank: 1024,
        },
      ],
      nextCursor: null,
    });
    const linksResponse = await app.request(
      "/api/knowledge-scope-relationships",
    );
    expect(await linksResponse.json()).toEqual({
      items: [relationship],
      nextCursor: null,
    });

    const cycle = await requestJson(
      "/api/knowledge-scope-relationships",
      "POST",
      {
        parentKnowledgeScopeId: "work-graph",
        childKnowledgeScopeId: "semi-autonomous",
      },
    );
    expect(cycle.status).toBe(409);
    expect(await cycle.json()).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: "knowledge_scope_cycle" }),
      }),
    );
  });

  it("archives scopes outside default listings and restores them", async () => {
    const project = {
      kind: "project",
      title: "Completed project",
      canonicalUrl: "https://example.test/projects/completed",
      markdownUrl: "https://example.test/projects/completed.md",
    };
    await requestJson(
      "/api/knowledge-scopes/completed",
      "PUT",
      project,
      recordId(404),
    );

    const archived = await requestJson(
      "/api/knowledge-scopes/completed/archival",
      "POST",
      { reason: "Completed project" },
      recordId(405),
    );
    expect(archived.status).toBe(200);
    expect(await archived.json()).toEqual(
      expect.objectContaining({
        id: "completed",
        lifecycle: "archived",
        archiveReason: "Completed project",
        rank: null,
      }),
    );
    expect(await (await app.request("/api/knowledge-scopes")).json()).toEqual({
      items: [],
      nextCursor: null,
    });
    expect(
      await (
        await app.request("/api/knowledge-scopes?includeArchived=true")
      ).json(),
    ).toEqual({
      items: [
        expect.objectContaining({ id: "completed", lifecycle: "archived" }),
      ],
      nextCursor: null,
    });

    const restored = await requestJson(
      "/api/knowledge-scopes/completed/archival",
      "DELETE",
      undefined,
      recordId(406),
    );
    expect(restored.status).toBe(200);
    expect(await restored.json()).toEqual(
      expect.objectContaining({
        id: "completed",
        lifecycle: "active",
        archiveReason: null,
        rank: 1024,
      }),
    );
  });
});

describe("Given a persisted delivery-critical path", () => {
  it("projects scoped blockers, stages, reasons, paths, and parallel work", async () => {
    for (const [id, kind] of [
      ["initiative", "initiative"],
      ["project-a", "project"],
      ["project-b", "project"],
    ] as const) {
      const response = await requestJson(
        `/api/knowledge-scopes/${id}`,
        "PUT",
        {
          kind,
          title: id,
          canonicalUrl: `https://example.test/${id}`,
          markdownUrl: `https://example.test/${id}.md`,
        },
      );
      expect(response.status).toBe(200);
    }
    for (const projectId of ["project-a", "project-b"]) {
      const response = await requestJson(
        "/api/knowledge-scope-relationships",
        "POST",
        {
          parentKnowledgeScopeId: "initiative",
          childKnowledgeScopeId: projectId,
        },
      );
      expect(response.status).toBe(201);
    }

    for (const body of [
      {
        id: "outcome",
        title: "Project outcome",
        schedulingInitiativeId: "initiative",
        schedulingProjectId: "project-a",
      },
      { id: "implementation", title: "Implementation", parentId: "outcome" },
      { id: "review", title: "Review", parentId: "outcome" },
      {
        id: "schema",
        title: "Schema blocker",
        schedulingInitiativeId: "initiative",
        schedulingProjectId: "project-b",
      },
      {
        id: "other-outcome",
        title: "Other outcome",
        schedulingInitiativeId: "initiative",
        schedulingProjectId: "project-b",
      },
    ]) {
      const response = await requestJson("/api/work-items", "POST", body);
      expect(response.status).toBe(201);
    }
    await requestJson("/api/dependencies", "POST", {
      dependentWorkItemId: "implementation",
      blockerWorkItemId: "schema",
    });
    const reviewClaim = await requestJson("/api/leases", "POST", {
      workItemId: "review",
      workerId: "review-worker",
      leaseDurationSeconds: 300,
    });
    const claimed = (await reviewClaim.json()) as {
      lease: { id: string; epoch: number };
    };
    await requestJson("/api/attention-requests", "POST", {
      id: recordId(501),
      workItemId: "review",
      leaseId: claimed.lease.id,
      epoch: claimed.lease.epoch,
      kind: "decision",
      question: "Approve the review?",
      blocking: true,
    });

    const response = await app.request(
      "/api/critical-path?initiativeId=initiative&projectId=project-a",
    );
    const projection = (await response.json()) as {
      targetOutcomeIds: string[];
      nodes: Array<{
        item: { id: string };
        stage: string;
        inclusionReasons: Array<{ kind: string }>;
      }>;
      edges: Array<{
        kind: string;
        fromWorkItemId: string;
        toWorkItemId: string;
      }>;
      blockingPaths: string[][];
      readyLeafIds: string[];
      blockingAttentionIds: string[];
      parallelBranches: Array<{ workItemId: string }>;
    };

    expect(response.status).toBe(200);
    expect(projection.targetOutcomeIds).toEqual(["outcome"]);
    expect(projection.nodes.map(({ item }) => item.id)).toEqual([
      "outcome",
      "implementation",
      "schema",
      "review",
    ]);
    expect(projection.edges).toEqual([
      {
        kind: "decomposition",
        fromWorkItemId: "outcome",
        toWorkItemId: "implementation",
      },
      {
        kind: "decomposition",
        fromWorkItemId: "outcome",
        toWorkItemId: "review",
      },
      {
        kind: "dependency",
        fromWorkItemId: "implementation",
        toWorkItemId: "schema",
        dependencyDeclaredByWorkItemId: "implementation",
      },
    ]);
    expect(projection.blockingPaths).toEqual([
      ["outcome", "implementation", "schema"],
      ["outcome", "review"],
    ]);
    expect(projection.readyLeafIds).toEqual(["schema"]);
    expect(projection.blockingAttentionIds).toEqual(["review"]);
    expect(
      projection.parallelBranches.map(({ workItemId }) => workItemId),
    ).toEqual(["schema"]);
    expect(
      projection.nodes.find(({ item }) => item.id === "schema")
        ?.inclusionReasons,
    ).toEqual([
      {
        kind: "dependency_blocker",
        fromWorkItemId: "implementation",
        dependencyDeclaredByWorkItemId: "implementation",
      },
    ]);

    const global = await app.request("/api/critical-path");
    expect(global.status).toBe(200);
    expect(
      ((await global.json()) as { targetOutcomeIds: string[] })
        .targetOutcomeIds,
    ).toEqual(["outcome", "schema", "other-outcome"]);

    const initiative = await app.request(
      "/api/critical-path?initiativeId=initiative",
    );
    expect(initiative.status).toBe(200);
    expect(
      ((await initiative.json()) as { targetOutcomeIds: string[] })
        .targetOutcomeIds,
    ).toEqual(["outcome", "schema", "other-outcome"]);

    const project = await app.request(
      "/api/critical-path?projectId=project-b",
    );
    expect(project.status).toBe(200);
    expect(
      ((await project.json()) as { targetOutcomeIds: string[] })
        .targetOutcomeIds,
    ).toEqual(["schema", "other-outcome"]);

    const rooted = await app.request(
      "/api/critical-path?rootWorkItemId=outcome",
    );
    expect(rooted.status).toBe(200);
    expect(
      ((await rooted.json()) as { targetOutcomeIds: string[] })
        .targetOutcomeIds,
    ).toEqual(["outcome"]);

    const missingRoot = await app.request(
      "/api/critical-path?rootWorkItemId=missing",
    );
    expect(missingRoot.status).toBe(404);
    expect(await missingRoot.json()).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: "work_item_not_found" }),
      }),
    );

    const missingScope = await app.request(
      "/api/critical-path?projectId=missing",
    );
    expect(missingScope.status).toBe(404);
    expect(await missingScope.json()).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: "knowledge_scope_not_found" }),
      }),
    );
  });
});

describe("Given inherited work-item context over HTTP", () => {
  it("returns the same stable context package from reads and claims", async () => {
    await requestJson("/api/work-items", "POST", {
      id: "parent",
      title: "Parent",
    });
    await requestJson("/api/work-items", "POST", {
      id: "child",
      title: "Child",
      parentId: "parent",
    });
    await requestJson(
      "/api/work-items/parent/contexts",
      "PUT",
      {
        kind: "acceptance_criteria",
        content: "The claim context is stable.",
      },
      recordId(451),
    );
    await requestJson("/api/work-items/child/contexts", "PUT", {
      kind: "brief",
      content: "Implement context delivery.",
    });
    await requestJson("/api/work-items/parent/contexts", "PUT", {
      kind: "architecture_decision",
      title: "Context ordering",
      url: "https://example.test/adrs/context-ordering",
      role: "governing",
    });
    await requestJson("/api/pull-requests", "PUT", {
      repository: "example/work-graph",
      number: 42,
      url: "https://github.com/example/work-graph/pull/42",
      headSha: "0123456789abcdef0123456789abcdef01234567",
      acceptedHeadSha: "0123456789abcdef0123456789abcdef01234567",
      mergeCommitSha: "abcdef0123456789abcdef0123456789abcdef01",
      state: "merged",
      draft: false,
      mergeability: "mergeable",
      reviewDecision: "approved",
      checkSummary: "success",
      observedAt: "2026-09-20T10:00:00.000Z",
    });
    await requestJson("/api/work-items/parent/pull-requests", "PUT", {
      repository: "example/work-graph",
      number: 42,
      role: "evidence",
    });
    await requestJson("/api/work-items/child/references", "PUT", {
      title: "Design notes",
      url: "https://example.test/context-design",
    });

    const contextResponse = await app.request(
      "/api/work-items/child/contexts",
    );
    const context = (await contextResponse.json()) as { items: unknown[] };
    const pullRequestsResponse = await app.request(
      "/api/work-items/child/pull-requests",
    );
    const claimResponse = await requestJson("/api/leases", "POST", {
      workItemId: "child",
      workerId: "worker-a",
      leaseDurationSeconds: 300,
    });
    const claim = (await claimResponse.json()) as { context: unknown[] };

    expect(contextResponse.status).toBe(200);
    expect(claimResponse.status).toBe(201);
    expect(
      context.items.map((record) => {
        const typed = record as {
          kind: string;
          sourceWorkItemId: string;
        };
        return `${typed.kind}:${typed.sourceWorkItemId}`;
      }),
    ).toEqual([
      "brief:child",
      "acceptance_criteria:parent",
      "architecture_decision:parent",
      "pull_request:parent",
      "reference:child",
    ]);
    expect(await pullRequestsResponse.json()).toEqual({
      items: [
        expect.objectContaining({
          kind: "pull_request",
          role: "evidence",
          sourceWorkItemId: "parent",
          inheritanceDepth: 1,
          pullRequest: expect.objectContaining({
            repository: "example/work-graph",
            number: 42,
            acceptedHeadSha: "0123456789abcdef0123456789abcdef01234567",
            mergeCommitSha: "abcdef0123456789abcdef0123456789abcdef01",
            observedAt: "2026-09-20T10:00:00.000Z",
          }),
        }),
      ],
    });
    expect(claim.context).toEqual(context.items);
  });

  it("keeps a completion candidate separate from lifecycle and lease state", async () => {
    await requestJson("/api/work-items", "POST", {
      id: "evidence-backed",
      title: "Evidence-backed delivery",
    });
    const headSha = commitSha("a");
    const mergeCommitSha = commitSha("b");
    await requestJson("/api/pull-requests", "PUT", {
      repository: "example/work-graph",
      number: 7,
      url: "https://github.com/example/work-graph/pull/7",
      headSha,
      acceptedHeadSha: headSha,
      mergeCommitSha,
      state: "merged",
      draft: false,
      mergeability: "unknown",
      reviewDecision: "approved",
      checkSummary: "success",
      observedAt: "2026-09-22T10:00:00.000Z",
    });
    await requestJson("/api/work-items/evidence-backed/pull-requests", "PUT", {
      repository: "example/work-graph",
      number: 7,
      role: "implementation",
    });
    const claimResponse = await requestJson("/api/leases", "POST", {
      workItemId: "evidence-backed",
      workerId: "worker-a",
      leaseDurationSeconds: 300,
    });
    const claim = (await claimResponse.json()) as { lease: { id: string } };

    await repository.putCompletionPolicyRevision({
      policyId: "default",
      revision: 1,
      requiredCiNames: ["verify"],
      productionEnvironments: ["production"],
      createdAt: "2026-09-22T09:00:00.000Z",
    });
    await repository.assignCompletionPolicy({
      workItemId: "evidence-backed",
      policyId: "default",
      policyRevision: 1,
      assignedAt: "2026-09-22T09:30:00.000Z",
    });
    const observations = [
      {
        externalId: "pull-request-7",
        kind: "pull_request" as const,
        commitSha: mergeCommitSha,
        name: null,
        environment: null,
        correlationKind: "pull_request_merge" as const,
      },
      {
        externalId: "verify-7",
        kind: "ci" as const,
        commitSha: headSha,
        name: "verify",
        environment: null,
        correlationKind: "pull_request_head" as const,
      },
      {
        externalId: "staging-7",
        kind: "deployment" as const,
        commitSha: mergeCommitSha,
        name: null,
        environment: "staging",
        correlationKind: "pull_request_merge" as const,
      },
      {
        externalId: "production-7",
        kind: "deployment" as const,
        commitSha: mergeCommitSha,
        name: null,
        environment: "production",
        correlationKind: "pull_request_merge" as const,
      },
    ];
    for (const [index, observation] of observations.entries()) {
      const suffix = 810 + index;
      const deliveryExternalId = `delivery-${suffix}`;
      await repository.recordExternalDelivery({
        provider: "github",
        externalId: deliveryExternalId,
        payloadDigest: suffix.toString(16).padStart(64, "0"),
        receivedAt: `2026-09-22T11:0${index}:00.000Z`,
        ingestedAt: `2026-09-22T11:0${index}:01.000Z`,
      });
      await repository.recordEvidenceObservation({
        id: recordId(suffix),
        deliveryProvider: "github",
        deliveryExternalId,
        provider: "github",
        repository: "example/work-graph",
        state: "success",
        sourceUrl: `https://github.com/example/work-graph/actions/runs/${suffix}`,
        providerObservedAt: `2026-09-22T11:0${index}:00.000Z`,
        ingestedAt: `2026-09-22T11:0${index}:01.000Z`,
        pullRequestRepository: "example/work-graph",
        pullRequestNumber: 7,
        ...observation,
      });
    }
    const eventsBeforeEvaluation = await repository.listEvents();
    const candidate = await repository.evaluateCompletionCandidate({
      id: recordId(820),
      workItemId: "evidence-backed",
      evaluatedAt: "2026-09-22T12:00:00.000Z",
    });
    const response = await app.request("/api/work-items/evidence-backed");
    const workItem = (await response.json()) as {
      lifecycle: string;
      stage: string;
      currentLease: { id: string } | null;
    };

    expect(candidate.candidate).toBe(true);
    expect(response.status).toBe(200);
    expect(workItem).toEqual(
      expect.objectContaining({
        lifecycle: "open",
        stage: "in_progress",
        currentLease: expect.objectContaining({ id: claim.lease.id }),
      }),
    );
    expect(await repository.listEvents()).toEqual(eventsBeforeEvaluation);
  });
});

describe("Given a claimed item that reveals more work", () => {
  it("replays one ranked decomposition with its same-worker child claim", async () => {
    await repository.createWorkItem({ id: "parent", title: "Parent context" });
    const claimResponse = await requestJson("/api/leases", "POST", {
      workItemId: "parent",
      workerId: "worker-a",
      leaseDurationSeconds: 300,
    });
    const parentClaim = (await claimResponse.json()) as {
      lease: { id: string; epoch: number };
    };
    const body = {
      leaseId: parentClaim.lease.id,
      epoch: parentClaim.lease.epoch,
      children: [
        { id: "later", title: "Later child", rank: 20 },
        { id: "first", title: "First child", rank: 10 },
      ],
      dependencies: [
        { dependentWorkItemId: "later", blockerWorkItemId: "first" },
      ],
      claim: {
        workItemId: "first",
        leaseId: recordId(301),
        leaseDurationSeconds: 120,
      },
    };
    const key = recordId(302);

    const first = await requestJson(
      "/api/work-items/parent/decompositions",
      "POST",
      body,
      key,
    );
    const replay = await requestJson(
      "/api/work-items/parent/decompositions",
      "POST",
      body,
      key,
    );
    const firstBody = (await first.json()) as Record<string, unknown>;

    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(firstBody);
    expect(firstBody).toEqual(
      expect.objectContaining({
        parent: expect.objectContaining({
          id: "parent",
          lifecycle: "open",
          stage: "blocked",
        }),
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
              id: "later",
              parentId: "parent",
              stage: "blocked",
            }),
          }),
        ],
        endedLease: expect.objectContaining({ outcome: "decomposed" }),
        claimedLease: expect.objectContaining({
          id: recordId(301),
          workItemId: "first",
          workerId: "worker-a",
        }),
      }),
    );
    expect(await db.select().from(schema.workItemHierarchy)).toHaveLength(2);
    expect(await db.select().from(schema.workItemDependency)).toHaveLength(1);
    expect(await db.select().from(schema.idempotencyKey)).toHaveLength(1);
  });
});

describe("Given persisted work-item metadata", () => {
  it("reads every metadata family through the paginated CLI", async () => {
    // Runtime loading keeps the CLI's Node types out of the Worker compilation.
    const cliModulePath = new URL(
      "../../../../packages/work-graph-cli/src/main.ts",
      import.meta.url,
    ).href;
    const { runCli } = (await import(cliModulePath)) as {
      runCli: (
        args: string[],
        dependencies: {
          environment: NodeJS.ProcessEnv;
          fetch: typeof fetch;
          stdout: (text: string) => void;
          stderr: (text: string) => void;
        },
      ) => Promise<number>;
    };
    const readMetadata = async (...args: string[]): Promise<unknown> => {
      const stdout: string[] = [];
      const stderr: string[] = [];
      const exitCode = await runCli(["metadata", ...args], {
        environment: {
          WORK_GRAPH_API_URL: "https://work-graph.example.test",
        },
        fetch: async (input, init) => {
          const request =
            input instanceof Request ? input : new Request(input, init);
          return app.fetch(request);
        },
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
      });
      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      return JSON.parse(stdout.join(""));
    };
    const createItem = async (id: string) => {
      const response = await requestJson("/api/work-items", "POST", {
        id,
        title: `${id} work`,
      });
      expect(response.status).toBe(201);
    };
    const claimItem = async (id: string) => {
      const response = await requestJson("/api/leases", "POST", {
        workItemId: id,
        workerId: "metadata-worker",
        leaseDurationSeconds: 300,
      });
      expect(response.status).toBe(201);
      return (await response.json()) as {
        lease: { id: string; epoch: number };
      };
    };

    for (const id of ["blocker", "work", "downstream", "parent", "cancelled"]) {
      await createItem(id);
    }

    const blockerClaim = await claimItem("blocker");
    await requestJson("/api/work-items/blocker/releases", "POST", {
      leaseId: blockerClaim.lease.id,
      epoch: blockerClaim.lease.epoch,
      ...completionEvidence,
    });
    await requestJson("/api/dependencies", "POST", {
      dependentWorkItemId: "work",
      blockerWorkItemId: "blocker",
    });
    await requestJson("/api/dependencies", "POST", {
      dependentWorkItemId: "downstream",
      blockerWorkItemId: "work",
    });

    const workClaim = await claimItem("work");
    for (const [id, content] of [
      [recordId(810), "First metadata note"],
      [recordId(811), "Second metadata note"],
    ] as const) {
      const response = await requestJson(
        "/api/work-items/work/notes",
        "POST",
        {
          id,
          leaseId: workClaim.lease.id,
          epoch: workClaim.lease.epoch,
          content,
        },
      );
      expect(response.status).toBe(201);
    }
    await requestJson("/api/attention-requests", "POST", {
      id: recordId(812),
      workItemId: "work",
      leaseId: workClaim.lease.id,
      epoch: workClaim.lease.epoch,
      kind: "review",
      question: "Does the metadata contract cover every stored record?",
      blocking: false,
    });
    await requestJson(
      `/api/attention-requests/${recordId(812)}/resolutions`,
      "POST",
      {
        id: recordId(813),
        resolution: "Yes, each record has a bounded JSON collection.",
      },
    );
    await requestJson("/api/work-items/work/releases", "POST", {
      leaseId: workClaim.lease.id,
      epoch: workClaim.lease.epoch,
      ...completionEvidence,
    });

    const parentClaim = await claimItem("parent");
    await requestJson("/api/work-items/parent/decompositions", "POST", {
      leaseId: parentClaim.lease.id,
      epoch: parentClaim.lease.epoch,
      children: [{ id: "child", title: "Child work", rank: 1 }],
    });
    const cancelledClaim = await claimItem("cancelled");
    await requestJson("/api/work-items/cancelled/cancellations", "POST", {
      leaseId: cancelledClaim.lease.id,
      epoch: cancelledClaim.lease.epoch,
    });

    const firstNotes = (await readMetadata(
      "notes",
      "work",
      "--limit",
      "1",
    )) as {
      items: Array<{ id: string; content: string }>;
      nextCursor: string | null;
    };
    const secondNotes = (await readMetadata(
      "notes",
      "work",
      "--limit",
      "1",
      "--cursor",
      firstNotes.nextCursor ?? "",
    )) as {
      items: Array<{ id: string; content: string }>;
      nextCursor: string | null;
    };
    const events = await readMetadata("events", "work", "--limit", "100");
    const dependencies = await readMetadata(
      "dependencies",
      "work",
      "--limit",
      "100",
    );
    const decompositions = await readMetadata(
      "decompositions",
      "parent",
      "--limit",
      "100",
    );
    const leases = await readMetadata("leases", "work", "--limit", "100");
    const attention = await readMetadata(
      "attention",
      "work",
      "--limit",
      "100",
    );
    const cancellations = await readMetadata(
      "cancellations",
      "cancelled",
      "--limit",
      "100",
    );
    const releases = await readMetadata(
      "releases",
      "work",
      "--limit",
      "100",
    );

    expect(firstNotes).toEqual({
      items: [
        expect.objectContaining({
          id: recordId(810),
          content: "First metadata note",
        }),
      ],
      nextCursor: recordId(810),
    });
    expect(secondNotes).toEqual({
      items: [
        expect.objectContaining({
          id: recordId(811),
          content: "Second metadata note",
        }),
      ],
      nextCursor: null,
    });
    expect(events).toEqual(
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({ type: "note.created" }),
          expect.objectContaining({ type: "attention.requested" }),
          expect.objectContaining({ type: "attention.resolved" }),
          expect.objectContaining({ type: "work_item.lifecycle_changed" }),
        ]),
      }),
    );
    expect(dependencies).toEqual({
      items: [
        { dependentWorkItemId: "downstream", blockerWorkItemId: "work" },
        { dependentWorkItemId: "work", blockerWorkItemId: "blocker" },
      ],
      nextCursor: null,
    });
    expect(decompositions).toEqual({
      items: [
        expect.objectContaining({
          type: "work_item.decomposed",
          data: { childWorkItemIds: ["child"] },
        }),
      ],
      nextCursor: null,
    });
    expect(leases).toEqual({
      items: [
        expect.objectContaining({
          workItemId: "work",
          workerId: "metadata-worker",
          outcome: "released",
        }),
      ],
      nextCursor: null,
    });
    expect(attention).toEqual({
      items: [
        expect.objectContaining({
          resolution: expect.objectContaining({
            resolution: "Yes, each record has a bounded JSON collection.",
          }),
        }),
      ],
      nextCursor: null,
    });
    expect(cancellations).toEqual({
      items: [
        expect.objectContaining({ data: { from: "open", to: "cancelled" } }),
      ],
      nextCursor: null,
    });
    expect(releases).toEqual({
      items: [
        expect.objectContaining({
          data: { from: "open", to: "released", ...completionEvidence },
        }),
      ],
      nextCursor: null,
    });
  });
});

afterAll(async () => {
  await closeDb(db);
});

describe("Given persisted work with blockers", () => {
  it("lists lifecycle separately from its derived operational stage", async () => {
    await repository.createWorkItem({ id: "parent", title: "Parent" });
    await repository.createWorkItem({
      id: "child",
      title: "Child",
      parentId: "parent",
    });
    await repository.createWorkItem({ id: "blocker", title: "Blocker" });
    await repository.addDependency({
      dependentWorkItemId: "parent",
      blockerWorkItemId: "blocker",
    });

    const allResponse = await app.request("/api/work-items");
    const all = (await allResponse.json()) as {
      items: Array<{ id: string; lifecycle: string; stage: string }>;
    };
    const readyResponse = await app.request("/api/work-items?stage=ready");
    const ready = (await readyResponse.json()) as {
      items: Array<{ id: string }>;
    };

    expect(allResponse.status).toBe(200);
    expect(
      Object.fromEntries(
        all.items.map(({ id, lifecycle, stage }) => [
          id,
          { lifecycle, stage },
        ]),
      ),
    ).toEqual({
      parent: { lifecycle: "open", stage: "blocked" },
      child: { lifecycle: "open", stage: "blocked" },
      blocker: { lifecycle: "open", stage: "ready" },
    });
    expect(ready.items.map(({ id }) => id)).toEqual(["blocker"]);
  });

  it("continues a ready-work page after an earlier item is claimed", async () => {
    await repository.createWorkItem({ id: "a-ready", title: "First" });
    await repository.createWorkItem({ id: "b-ready", title: "Second" });

    const firstResponse = await app.request(
      "/api/work-items?stage=ready&limit=1",
    );
    const first = (await firstResponse.json()) as {
      items: Array<{ id: string }>;
      nextCursor: string | null;
    };
    expect(first).toEqual({
      items: [expect.objectContaining({ id: "a-ready" })],
      nextCursor: "a-ready",
    });

    const claimResponse = await requestJson("/api/leases", "POST", {
      workItemId: "a-ready",
      workerId: "worker-a",
      leaseDurationSeconds: 300,
    });
    expect(claimResponse.status).toBe(201);

    const nextResponse = await app.request(
      `/api/work-items?stage=ready&limit=1&cursor=${first.nextCursor}`,
    );
    const next = (await nextResponse.json()) as {
      items: Array<{ id: string }>;
      nextCursor: string | null;
    };
    expect(next).toEqual({
      items: [expect.objectContaining({ id: "b-ready" })],
      nextCursor: null,
    });
  });
});

describe("Given graph mutations over HTTP", () => {
  it("replays concurrent sparse work-item creation without a duplicate row", async () => {
    const key = "00000000-0000-4000-8000-000000000091";
    const request = () =>
      requestJson(
        "/api/work-items",
        "POST",
        { id: "sparse", title: "Sparse work item" },
        key,
      );

    const [first, retry] = await Promise.all([request(), request()]);

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(await retry.json()).toEqual(await first.json());
    expect((await repository.load()).workItems).toEqual([
      {
        id: "sparse",
        title: "Sparse work item",
        lifecycle: "open",
        parentId: null,
        rank: null,
        priorityRank: 1024,
        schedulingInitiativeId: null,
        schedulingProjectId: null,
        expedited: false,
        expediteReason: null,
      },
    ]);
    expect(await db.select().from(schema.idempotencyKey)).toHaveLength(1);
  });

  it("does not retain an unreplayable receipt when the retry key is omitted", async () => {
    const response = await requestJson("/api/work-items", "POST", {
      id: "unkeyed",
      title: "Unkeyed work item",
    });

    expect(response.status).toBe(201);
    expect(await db.select().from(schema.idempotencyKey)).toHaveLength(0);
  });

  it("reparents and detaches one identity with its attached history", async () => {
    await repository.createWorkItem({
      id: "old-parent",
      title: "Old parent",
    });
    await repository.createWorkItem({
      id: "new-parent",
      title: "New parent",
    });
    await repository.createWorkItem({
      id: "work",
      title: "Stable work",
      parentId: "old-parent",
    });
    await repository.putWorkItemContext({
      workItemId: "work",
      kind: "brief",
      content: "Keep this context attached.",
    });
    const storedLease = await repository.claimWorkItem({
      leaseId: recordId(197),
      workerId: "worker-a",
      leaseDurationSeconds: 300,
      workItemId: "work",
    });
    if (!storedLease) throw new Error("Expected the work item to be claimable.");
    await repository.createNote({
      id: recordId(198),
      workItemId: "work",
      leaseId: storedLease.id,
      epoch: storedLease.epoch,
      content: "Keep this note attached.",
    });

    const moved = await requestJson(
      "/api/work-items/work/parent",
      "PUT",
      { parentId: "new-parent" },
      recordId(199),
    );
    const replayed = await requestJson(
      "/api/work-items/work/parent",
      "PUT",
      { parentId: "new-parent" },
      recordId(199),
    );
    const detached = await requestJson(
      "/api/work-items/work/parent",
      "PUT",
      { parentId: null },
      recordId(200),
    );

    expect(moved.status).toBe(200);
    expect(replayed.status).toBe(200);
    expect((await moved.json()) as { parentId: string | null }).toMatchObject({
      parentId: "new-parent",
    });
    expect(
      (await detached.json()) as { parentId: string | null },
    ).toMatchObject({ parentId: null });
    expect(await repository.resolveWorkItemContext("work")).toEqual([
      expect.objectContaining({
        kind: "brief",
        content: "Keep this context attached.",
      }),
    ]);
    expect(await repository.listNotes({ workItemId: "work" })).toEqual([
      expect.objectContaining({ content: "Keep this note attached." }),
    ]);
    expect(await repository.listLeases({ workItemId: "work" })).toEqual([
      expect.objectContaining({ id: storedLease.id }),
    ]);
    expect(
      (await repository.listEvents({ workItemId: "work" })).filter(
        ({ type }) => type === "work_item.reparented",
      ),
    ).toHaveLength(2);
  });

  it("rejects a combined waits-for cycle and keeps the previous parent", async () => {
    await repository.createWorkItem({ id: "parent", title: "Parent" });
    await repository.createWorkItem({ id: "child", title: "Child" });
    await repository.addDependency({
      dependentWorkItemId: "child",
      blockerWorkItemId: "parent",
    });

    const response = await requestJson(
      "/api/work-items/child/parent",
      "PUT",
      { parentId: "parent" },
      recordId(201),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "graph_cycle",
        message: "The change creates a waits-for cycle.",
      },
    });
    expect((await repository.getWorkItem("child")).parentId).toBeNull();
  });

  it("adds and removes a dependency idempotently while readiness stays derived", async () => {
    await repository.createWorkItem({ id: "dependent", title: "Dependent" });
    await repository.createWorkItem({ id: "blocker", title: "Blocker" });
    const edge = {
      dependentWorkItemId: "dependent",
      blockerWorkItemId: "blocker",
    };
    const addKey = "00000000-0000-4000-8000-000000000092";
    const removeKey = "00000000-0000-4000-8000-000000000093";

    const added = await requestJson(
      "/api/dependencies",
      "POST",
      edge,
      addKey,
    );
    const addRetry = await requestJson(
      "/api/dependencies",
      "POST",
      edge,
      addKey,
    );
    expect(added.status).toBe(201);
    expect(addRetry.status).toBe(201);
    expect((await repository.getWorkItem("dependent")).stage).toBe("blocked");

    const removed = await requestJson(
      "/api/dependencies",
      "DELETE",
      edge,
      removeKey,
    );
    const removeRetry = await requestJson(
      "/api/dependencies",
      "DELETE",
      edge,
      removeKey,
    );
    expect(removed.status).toBe(200);
    expect(removeRetry.status).toBe(200);
    expect((await repository.getWorkItem("dependent")).stage).toBe("ready");
    expect((await repository.load()).dependencies).toEqual([]);
  });

  it("rejects reuse of one idempotency key for different input", async () => {
    const key = "00000000-0000-4000-8000-000000000094";
    const first = await requestJson(
      "/api/work-items",
      "POST",
      { id: "first", title: "First" },
      key,
    );
    const conflict = await requestJson(
      "/api/work-items",
      "POST",
      { id: "second", title: "Second" },
      key,
    );

    expect(first.status).toBe(201);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({
      error: {
        code: "idempotency_key_reused",
        message: `Idempotency key ${key} was already used for a different mutation.`,
      },
    });
    expect((await repository.load()).workItems.map(({ id }) => id)).toEqual([
      "first",
    ]);
  });

  it("serializes concurrent dependency writes against the combined waits-for graph", async () => {
    await repository.createWorkItem({ id: "parent", title: "Parent" });
    await repository.createWorkItem({
      id: "child",
      title: "Child",
      parentId: "parent",
    });
    await repository.createWorkItem({ id: "middle", title: "Middle" });

    const responses = await Promise.all([
      requestJson(
        "/api/dependencies",
        "POST",
        {
          dependentWorkItemId: "child",
          blockerWorkItemId: "middle",
        },
        "00000000-0000-4000-8000-000000000095",
      ),
      requestJson(
        "/api/dependencies",
        "POST",
        {
          dependentWorkItemId: "middle",
          blockerWorkItemId: "parent",
        },
        "00000000-0000-4000-8000-000000000096",
      ),
    ]);

    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
    const conflict = responses.find(({ status }) => status === 409);
    expect(await conflict?.json()).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: "graph_cycle" }),
      }),
    );
    expect((await repository.load()).dependencies).toHaveLength(1);
  });
});

describe("Given claimed work that needs notes or attention", () => {
  it("records a note, pauses for a decision, and becomes claimable after resolution", async () => {
    await repository.createWorkItem({ id: "work", title: "Work" });
    const claimResponse = await requestJson("/api/leases", "POST", {
      workItemId: "work",
      workerId: "worker-a",
      leaseDurationSeconds: 300,
    });
    const claim = (await claimResponse.json()) as {
      lease: { id: string; epoch: number };
    };
    const noteRequest = () =>
      requestJson(
        "/api/work-items/work/notes",
        "POST",
        {
          id: recordId(301),
          leaseId: claim.lease.id,
          epoch: claim.lease.epoch,
          content: "The dependency contract is complete.",
        },
        recordId(302),
      );

    const noteResponse = await noteRequest();
    const noteReplay = await noteRequest();
    expect(noteResponse.status).toBe(201);
    expect(noteReplay.status).toBe(201);
    expect(await noteReplay.json()).toEqual(await noteResponse.json());
    expect(await repository.listNotes("work")).toHaveLength(1);

    const attentionBody = {
      id: recordId(303),
      workItemId: "work",
      leaseId: claim.lease.id,
      epoch: claim.lease.epoch,
      kind: "decision",
      question: "Should the next slice include attention resolution?",
      note: "The worker can resume once this is answered.",
    };
    const attentionResponse = await requestJson(
      "/api/attention-requests",
      "POST",
      attentionBody,
      recordId(304),
    );
    const attention = (await attentionResponse.json()) as {
      attentionRequest: { id: string; requestingLeaseId: string };
      endedLease: { workerId: string; outcome: string };
      workItem: { stage: string; currentLease: unknown };
    };

    expect(attentionResponse.status).toBe(201);
    expect(attention.attentionRequest).toEqual(
      expect.objectContaining({
        id: recordId(303),
        requestingLeaseId: claim.lease.id,
      }),
    );
    expect(attention.endedLease).toEqual(
      expect.objectContaining({
        workerId: "worker-a",
        outcome: "attention_requested",
      }),
    );
    expect(attention.workItem).toEqual(
      expect.objectContaining({
        stage: "needs_attention",
        currentLease: null,
      }),
    );
    const pendingResponse = await app.request("/api/attention-requests");
    const pendingAttention = (await pendingResponse.json()) as {
      items: Array<{ id: string }>;
    };
    expect(pendingAttention.items.map(({ id }) => id)).toEqual([
      recordId(303),
    ]);

    const blockedClaim = await requestJson("/api/leases", "POST", {
      workItemId: "work",
      workerId: "worker-b",
      leaseDurationSeconds: 300,
    });
    expect(blockedClaim.status).toBe(409);

    const resolutionBody = {
      id: recordId(305),
      resolution: "Yes. Resolution completes the pause-and-resume loop.",
    };
    const resolveRequest = () =>
      requestJson(
        `/api/attention-requests/${recordId(303)}/resolutions`,
        "POST",
        resolutionBody,
        recordId(306),
      );
    const resolutionResponse = await resolveRequest();
    const resolutionReplay = await resolveRequest();
    const resolution = (await resolutionResponse.json()) as {
      workItem: { stage: string };
    };

    expect(resolutionResponse.status).toBe(201);
    expect(resolutionReplay.status).toBe(201);
    expect(resolution.workItem.stage).toBe("ready");
    const noPendingResponse = await app.request("/api/attention-requests");
    const noPendingAttention = (await noPendingResponse.json()) as {
      items: unknown[];
    };
    expect(noPendingAttention.items).toEqual([]);
    const resolvedResponse = await app.request(
      "/api/attention-requests?state=resolved",
    );
    const resolvedAttention = (await resolvedResponse.json()) as {
      items: Array<{ id: string }>;
    };
    expect(resolvedAttention.items.map(({ id }) => id)).toEqual([
      recordId(303),
    ]);
    const resumed = await requestJson("/api/leases", "POST", {
      workItemId: "work",
      workerId: "worker-b",
      leaseDurationSeconds: 300,
    });
    const resumedBody = (await resumed.json()) as {
      lease: { workerId: string; epoch: number };
    };
    expect(resumed.status).toBe(201);
    expect(resumedBody.lease).toEqual(
      expect.objectContaining({ workerId: "worker-b", epoch: 2 }),
    );
  });

  it("returns blocked after resolution when a dependency was added during the pause", async () => {
    await repository.createWorkItem({ id: "work", title: "Work" });
    await repository.createWorkItem({ id: "blocker", title: "Blocker" });
    const claimed = await repository.claimWorkItem({
      leaseId: recordId(307),
      workerId: "worker-a",
      leaseDurationSeconds: 300,
      workItemId: "work",
    });
    if (!claimed) throw new Error("Expected work to be claimed.");
    await requestJson(
      "/api/attention-requests",
      "POST",
      {
        id: recordId(308),
        workItemId: "work",
        leaseId: claimed.id,
        epoch: claimed.epoch,
        kind: "input",
        question: "Which prerequisite applies?",
      },
      recordId(309),
    );
    await repository.addDependency({
      dependentWorkItemId: "work",
      blockerWorkItemId: "blocker",
    });

    const response = await requestJson(
      `/api/attention-requests/${recordId(308)}/resolutions`,
      "POST",
      {
        id: recordId(310),
        resolution: "The blocker must finish first.",
      },
      recordId(311),
    );
    const body = (await response.json()) as { workItem: { stage: string } };

    expect(response.status).toBe(201);
    expect(body.workItem.stage).toBe("blocked");
  });
});

describe("Given lease-backed work over HTTP", () => {
  it("returns and claims ready work in priority order", async () => {
    await requestJson("/api/work-items", "POST", {
      id: "a-low",
      title: "Low priority",
    });
    await requestJson("/api/work-items", "POST", {
      id: "z-high",
      title: "High priority",
    });
    const moved = await requestJson(
      "/api/work-items/z-high/priority-moves",
      "POST",
      { higherThanId: "a-low" },
      recordId(490),
    );
    expect(moved.status).toBe(200);

    const queueResponse = await app.request("/api/work-items?stage=ready");
    const queue = (await queueResponse.json()) as {
      items: Array<{ id: string; priorityRank: number }>;
    };
    const claimResponse = await requestJson("/api/leases", "POST", {
      workerId: "worker-a",
      leaseDurationSeconds: 300,
    });
    const claim = (await claimResponse.json()) as {
      workItem: { id: string };
    };

    expect(queue.items).toEqual([
      expect.objectContaining({ id: "z-high", priorityRank: 1024 }),
      expect.objectContaining({ id: "a-low", priorityRank: 2048 }),
    ]);
    expect(claim.workItem.id).toBe("z-high");
  });

  it("assigns an existing plan and claims within its project scope", async () => {
    await requestJson(
      "/api/knowledge-scopes/initiative",
      "PUT",
      {
        kind: "initiative",
        title: "Initiative",
        canonicalUrl: "https://example.test/initiatives/initiative",
        markdownUrl: "https://example.test/initiatives/initiative.md",
      },
      recordId(491),
    );
    await requestJson(
      "/api/knowledge-scopes/work-graph",
      "PUT",
      {
        kind: "project",
        title: "Work Graph",
        canonicalUrl: "https://example.test/projects/work-graph",
        markdownUrl: "https://example.test/projects/work-graph.md",
      },
      recordId(492),
    );
    await requestJson(
      "/api/knowledge-scope-relationships",
      "POST",
      {
        parentKnowledgeScopeId: "initiative",
        childKnowledgeScopeId: "work-graph",
      },
      recordId(493),
    );
    await requestJson("/api/work-items", "POST", {
      id: "unscoped",
      title: "Unscoped",
    });
    await requestJson("/api/work-items", "POST", {
      id: "plan",
      title: "Plan",
    });
    const assigned = await requestJson(
      "/api/work-items/plan/scheduling-scope",
      "PUT",
      {
        schedulingInitiativeId: null,
        schedulingProjectId: "work-graph",
      },
      recordId(494),
    );
    expect(assigned.status).toBe(200);
    await requestJson("/api/work-items", "POST", {
      id: "child",
      title: "Child",
      parentId: "plan",
    });

    const queueResponse = await app.request(
      "/api/work-items?stage=ready&projectId=work-graph",
    );
    const queue = (await queueResponse.json()) as {
      items: Array<{ id: string }>;
    };
    const claimResponse = await requestJson("/api/leases", "POST", {
      workerId: "worker-a",
      leaseDurationSeconds: 300,
      projectId: "work-graph",
      parentId: "plan",
    });
    const claim = (await claimResponse.json()) as {
      workItem: { id: string };
    };

    expect(queue.items.map(({ id }) => id)).toEqual(["child"]);
    expect(claim.workItem.id).toBe("child");
  });

  it("distinguishes a missing specified item from ineligible work", async () => {
    const response = await requestJson("/api/leases", "POST", {
      workItemId: "missing",
      workerId: "worker-a",
      leaseDurationSeconds: 300,
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        code: "work_item_not_found",
        message: "Work item missing does not exist.",
      },
    });
  });

  it("claims, renews, and releases one specified work item", async () => {
    await repository.createWorkItem({ id: "work", title: "Release me" });

    const claimResponse = await requestJson("/api/leases", "POST", {
      workItemId: "work",
      workerId: "worker-a",
      leaseDurationSeconds: 60,
    });
    const claim = (await claimResponse.json()) as {
      lease: { id: string; epoch: number; expiresAt: string };
      workItem: { lifecycle: string; stage: string };
    };
    const renewResponse = await requestJson(
      `/api/leases/${claim.lease.id}/renewals`,
      "POST",
      { epoch: claim.lease.epoch, leaseDurationSeconds: 600 },
    );
    const renewal = (await renewResponse.json()) as {
      lease: { expiresAt: string };
    };
    const releaseResponse = await requestJson(
      "/api/work-items/work/releases",
      "POST",
      {
        leaseId: claim.lease.id,
        epoch: claim.lease.epoch,
        ...completionEvidence,
      },
    );
    const released = (await releaseResponse.json()) as {
      lease: { outcome: string; endedAt: string | null };
      workItem: { lifecycle: string; stage: string; currentLease: unknown };
    };

    expect(claimResponse.status).toBe(201);
    expect(claim.workItem).toEqual(
      expect.objectContaining({ lifecycle: "open", stage: "in_progress" }),
    );
    expect(renewResponse.status).toBe(200);
    expect(new Date(renewal.lease.expiresAt).getTime()).toBeGreaterThan(
      new Date(claim.lease.expiresAt).getTime(),
    );
    expect(releaseResponse.status).toBe(201);
    expect(released.lease.outcome).toBe("released");
    expect(released.lease.endedAt).not.toBeNull();
    expect(released.workItem).toEqual(
      expect.objectContaining({
        id: "work",
        title: "Release me",
        lifecycle: "released",
        parentId: null,
        priorityRank: 1024,
        rank: null,
        stage: "released",
        currentLease: null,
      }),
    );

    const commentRequest = () =>
      requestJson(
        "/api/work-items/work/comments",
        "POST",
        {
          id: recordId(320),
          author: "reviewer-a",
          content: "Production exposed a follow-up.",
        },
        recordId(321),
      );
    const commentResponse = await commentRequest();
    const commentReplay = await commentRequest();
    const comment = await commentResponse.json();
    expect(commentResponse.status).toBe(201);
    expect(await commentReplay.json()).toEqual(comment);
    expect(comment).toEqual(
      expect.objectContaining({
        kind: "post_release",
        leaseId: null,
        author: "reviewer-a",
        createdAt: expect.any(String),
      }),
    );
    expect(await repository.listNotes("work")).toHaveLength(1);
    expect(await repository.getWorkItem("work")).toEqual(released.workItem);

    await repository.createWorkItem({ id: "open", title: "Open" });
    const openComment = await requestJson(
      "/api/work-items/open/comments",
      "POST",
      {
        id: recordId(322),
        author: "reviewer-a",
        content: "Too early.",
      },
    );
    expect(openComment.status).toBe(409);
  });

  it("scheduler-selects an eligible item and can cancel it", async () => {
    await repository.createWorkItem({ id: "first", title: "First" });
    await repository.createWorkItem({ id: "second", title: "Second" });

    const claimResponse = await requestJson("/api/leases", "POST", {
      workerId: "worker-a",
      leaseDurationSeconds: 300,
    });
    const claim = (await claimResponse.json()) as {
      lease: { id: string; epoch: number; workItemId: string };
    };
    const cancelResponse = await requestJson(
      `/api/work-items/${claim.lease.workItemId}/cancellations`,
      "POST",
      {
        leaseId: claim.lease.id,
        epoch: claim.lease.epoch,
      },
    );
    const cancelled = (await cancelResponse.json()) as {
      workItem: { lifecycle: string; stage: string };
    };

    expect(claimResponse.status).toBe(201);
    expect(claim.lease.workItemId).toBe("first");
    expect(cancelResponse.status).toBe(201);
    expect(cancelled.workItem).toEqual(
      expect.objectContaining({ lifecycle: "cancelled", stage: "cancelled" }),
    );
  });

  it("rejects a lease used against another work-item path", async () => {
    await repository.createWorkItem({ id: "claimed", title: "Claimed" });
    await repository.createWorkItem({ id: "other", title: "Other" });
    const claimResponse = await requestJson("/api/leases", "POST", {
      workItemId: "claimed",
      workerId: "worker-a",
      leaseDurationSeconds: 300,
    });
    const claim = (await claimResponse.json()) as {
      lease: { id: string; epoch: number };
    };

    const response = await requestJson(
      "/api/work-items/other/releases",
      "POST",
      {
        leaseId: claim.lease.id,
        epoch: claim.lease.epoch,
        ...completionEvidence,
      },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: "lease_not_current" }),
      }),
    );
    expect((await repository.getWorkItem("claimed")).stage).toBe("in_progress");
    expect((await repository.getWorkItem("other")).stage).toBe("ready");

  });
});
