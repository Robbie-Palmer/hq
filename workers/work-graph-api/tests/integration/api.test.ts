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
  await db.transaction(async (transaction) => {
    await transaction.delete(schema.lease);
    await transaction.delete(schema.idempotencyKey);
    await transaction.delete(schema.workItemArchitectureDecision);
    await transaction.delete(schema.workItemContext);
    await transaction.delete(schema.workItemReference);
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
    await requestJson("/api/work-items/child/references", "PUT", {
      title: "Design notes",
      url: "https://example.test/context-design",
    });

    const contextResponse = await app.request(
      "/api/work-items/child/contexts",
    );
    const context = (await contextResponse.json()) as { items: unknown[] };
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
      "reference:child",
    ]);
    expect(claim.context).toEqual(context.items);
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
