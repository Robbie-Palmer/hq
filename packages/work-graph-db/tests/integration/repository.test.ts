import {
  getDirectChildren,
  projectWorkItemStage,
  WorkGraphError,
  type WorkItemDependency,
} from "work-graph-domain";
import { eq, sql } from "drizzle-orm";
import {
  closeDb,
  createDb,
  schema,
  WorkGraphRepository,
} from "../../src/index";

const databaseURL = process.env.DATABASE_URL;
if (!databaseURL) {
  throw new Error("DATABASE_URL is required for integration tests.");
}

const db = createDb(databaseURL);
const repository = new WorkGraphRepository(db);

const recordId = (suffix: number): string =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;

const completionEvidence = {
  mergeEvidence: "https://github.com/example/work-graph/pull/1",
  deploymentEvidence: "https://work-graph.example.test/health",
} as const;

const dependency = (
  dependentWorkItemId: string,
  blockerWorkItemId: string,
): WorkItemDependency => ({ dependentWorkItemId, blockerWorkItemId });

const expectWorkGraphError = (
  result: PromiseSettledResult<unknown>,
  code: WorkGraphError["code"],
): void => {
  expect(result.status).toBe("rejected");
  if (result.status !== "rejected") return;
  expect(result.reason).toEqual(
    expect.objectContaining<Partial<WorkGraphError>>({ code }),
  );
};

type DatabaseError = Error & {
  code?: string;
  constraint_name?: string;
};

const getDatabaseError = (error: unknown): DatabaseError | undefined => {
  if (!(error instanceof Error)) return undefined;
  if ("code" in error && typeof error.code === "string") {
    return error as DatabaseError;
  }
  return "cause" in error ? getDatabaseError(error.cause) : undefined;
};

const rejectedDatabaseError = async (
  operation: Promise<unknown>,
): Promise<DatabaseError | undefined> => {
  try {
    await operation;
    return undefined;
  } catch (error) {
    return getDatabaseError(error);
  }
};

const waitForDatabaseLock = async (): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [result] = await db.execute<{ waiting: boolean }>(sql`
      select exists (
        select 1
        from pg_stat_activity
        where datname = current_database()
          and pid <> pg_backend_pid()
          and wait_event_type = 'Lock'
      ) as waiting
    `);
    if (result?.waiting === true) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for a PostgreSQL lock waiter.");
};

beforeAll(async () => {
  const [migrationCount] = await db.execute<{ count: number }>(sql`
    select count(*)::integer as count
    from drizzle.__drizzle_migrations
  `);
  const tables = await db.execute<{ table_name: string }>(sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
    order by table_name
  `);
  const locks = await db
    .select({ id: schema.graphMutationLock.id })
    .from(schema.graphMutationLock)
    .orderBy(schema.graphMutationLock.id);
  const lifecycleValues = await db.execute<{ enumlabel: string }>(sql`
    select enumlabel
    from pg_enum
    join pg_type on pg_type.oid = pg_enum.enumtypid
    where pg_type.typname = 'work_item_lifecycle'
    order by enumsortorder
  `);
  const leaseOutcomeValues = await db.execute<{ enumlabel: string }>(sql`
    select enumlabel
    from pg_enum
    join pg_type on pg_type.oid = pg_enum.enumtypid
    where pg_type.typname = 'lease_outcome'
    order by enumsortorder
  `);
  const knowledgeScopeKindValues = await db.execute<{ enumlabel: string }>(sql`
    select enumlabel
    from pg_enum
    join pg_type on pg_type.oid = pg_enum.enumtypid
    where pg_type.typname = 'knowledge_scope_kind'
    order by enumsortorder
  `);
  const contextKindValues = await db.execute<{ enumlabel: string }>(sql`
    select enumlabel
    from pg_enum
    join pg_type on pg_type.oid = pg_enum.enumtypid
    where pg_type.typname = 'work_item_context_kind'
    order by enumsortorder
  `);
  const architectureDecisionRoleValues = await db.execute<{
    enumlabel: string;
  }>(sql`
    select enumlabel
    from pg_enum
    join pg_type on pg_type.oid = pg_enum.enumtypid
    where pg_type.typname = 'architecture_decision_role'
    order by enumsortorder
  `);

  expect(migrationCount?.count).toBe(13);
  expect(tables.map(({ table_name }) => table_name)).toEqual([
    "attention_requests",
    "attention_resolutions",
    "events",
    "graph_mutation_locks",
    "idempotency_keys",
    "knowledge_scope_relationships",
    "knowledge_scopes",
    "leases",
    "notes",
    "pull_requests",
    "work_item_architecture_decisions",
    "work_item_contexts",
    "work_item_dependencies",
    "work_item_hierarchy",
    "work_item_priority_contexts",
    "work_item_pull_requests",
    "work_item_references",
    "work_items",
  ]);
  expect(locks).toEqual([{ id: "event-sequence" }, { id: "global" }]);
  expect(lifecycleValues.map(({ enumlabel }) => enumlabel)).toEqual([
    "open",
    "released",
    "cancelled",
  ]);
  expect(leaseOutcomeValues.map(({ enumlabel }) => enumlabel)).toEqual([
    "released",
    "cancelled",
    "decomposed",
    "attention_requested",
    "expired",
  ]);
  expect(knowledgeScopeKindValues.map(({ enumlabel }) => enumlabel)).toEqual([
    "initiative",
    "project",
  ]);
  expect(contextKindValues.map(({ enumlabel }) => enumlabel)).toEqual([
    "brief",
    "acceptance_criteria",
  ]);
  expect(
    architectureDecisionRoleValues.map(({ enumlabel }) => enumlabel),
  ).toEqual(["governing", "background"]);
});

describe("transactional decomposition", () => {
  const claimParent = async (leaseId: string) => {
    await repository.createWorkItem({ id: "parent", title: "Parent context" });
    const claimed = await repository.claimWorkItem({
      leaseId,
      workerId: "worker-a",
      leaseDurationSeconds: 300,
      workItemId: "parent",
    });
    if (!claimed) throw new Error("Expected the parent claim to succeed.");
    return claimed;
  };

  it("creates ranked children, ends the parent lease, and claims a ready child atomically", async () => {
    const parentLease = await claimParent(recordId(201));
    await repository.createNote({
      id: recordId(211),
      workItemId: "parent",
      leaseId: parentLease.id,
      epoch: parentLease.epoch,
      content: "Discovery context retained on the parent.",
    });
    const result = await repository.decomposeClaimedWorkItem({
      leaseId: parentLease.id,
      epoch: parentLease.epoch,
      workItemId: "parent",
      children: [
        { id: "second", title: "Second child", rank: 20 },
        { id: "first", title: "First child", rank: 10 },
      ],
      dependencies: [dependency("second", "first")],
      claim: {
        workItemId: "first",
        leaseId: recordId(202),
        leaseDurationSeconds: 120,
      },
    });

    expect(result.children).toEqual([
      {
        rank: 10,
        workItem: {
          id: "first",
          title: "First child",
          lifecycle: "open",
          parentId: "parent",
          rank: 10,
          priorityRank: null,
          schedulingInitiativeId: null,
          schedulingProjectId: null,
          expedited: false,
          expediteReason: null,
        },
      },
      {
        rank: 20,
        workItem: {
          id: "second",
          title: "Second child",
          lifecycle: "open",
          parentId: "parent",
          rank: 20,
          priorityRank: null,
          schedulingInitiativeId: null,
          schedulingProjectId: null,
          expedited: false,
          expediteReason: null,
        },
      },
    ]);
    expect(result.endedLease).toEqual(
      expect.objectContaining({
        id: parentLease.id,
        endedAt: expect.any(Date),
        outcome: "decomposed",
      }),
    );
    expect(result.claimedLease).toEqual(
      expect.objectContaining({
        id: recordId(202),
        workItemId: "first",
        workerId: "worker-a",
        epoch: 1,
      }),
    );

    const graph = await repository.load();
    expect(
      graph.workItems
        .filter(({ parentId }) => parentId === "parent")
        .map(({ id }) => id),
    ).toEqual(["first", "second"]);
    expect(graph.dependencies).toEqual([dependency("second", "first")]);
    await expect(repository.getWorkItem("parent")).resolves.toEqual(
      expect.objectContaining({ lifecycle: "open", stage: "blocked" }),
    );
    await expect(repository.getWorkItem("first")).resolves.toEqual(
      expect.objectContaining({ parentId: "parent", stage: "in_progress" }),
    );
    await expect(repository.getWorkItem("second")).resolves.toEqual(
      expect.objectContaining({ parentId: "parent", stage: "blocked" }),
    );
    await expect(repository.listNotes("parent")).resolves.toEqual([
      expect.objectContaining({
        id: recordId(211),
        content: "Discovery context retained on the parent.",
      }),
    ]);
    expect(
      await db
        .select({
          childWorkItemId: schema.workItemHierarchy.childWorkItemId,
          rank: schema.workItemHierarchy.rank,
        })
        .from(schema.workItemHierarchy)
        .orderBy(schema.workItemHierarchy.rank),
    ).toEqual([
      { childWorkItemId: "first", rank: 10 },
      { childWorkItemId: "second", rank: 20 },
    ]);
  });

  it("rolls back children, edges, the receipt, and lease ending when the combined graph cycles", async () => {
    const parentLease = await claimParent(recordId(203));
    const idempotencyKey = recordId(204);

    await expect(
      repository.decomposeClaimedWorkItem(
        {
          leaseId: parentLease.id,
          epoch: parentLease.epoch,
          workItemId: "parent",
          children: [{ id: "child", title: "Child", rank: 1 }],
          dependencies: [dependency("child", "parent")],
        },
        { idempotencyKey },
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({ code: "graph_cycle" }),
    );

    expect((await repository.load()).workItems.map(({ id }) => id)).toEqual([
      "parent",
    ]);
    expect((await repository.load()).dependencies).toEqual([]);
    await expect(repository.getCurrentLease("parent")).resolves.toEqual(
      expect.objectContaining({ id: parentLease.id, endedAt: null }),
    );
    expect(await db.select().from(schema.idempotencyKey)).toEqual([]);
  });

  it("rolls back the decomposition when the requested child is not ready", async () => {
    const parentLease = await claimParent(recordId(212));

    await expect(
      repository.decomposeClaimedWorkItem({
        leaseId: parentLease.id,
        epoch: parentLease.epoch,
        workItemId: "parent",
        children: [
          { id: "blocker", title: "Blocker", rank: 1 },
          { id: "blocked", title: "Blocked", rank: 2 },
        ],
        dependencies: [dependency("blocked", "blocker")],
        claim: {
          workItemId: "blocked",
          leaseId: recordId(213),
          leaseDurationSeconds: 120,
        },
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "decomposition_child_not_claimable",
      }),
    );

    expect((await repository.load()).workItems.map(({ id }) => id)).toEqual([
      "parent",
    ]);
    await expect(repository.getCurrentLease("parent")).resolves.toEqual(
      expect.objectContaining({ id: parentLease.id, endedAt: null }),
    );
    await expect(repository.getCurrentLease("blocked")).resolves.toBeNull();
  });

  it("lets only one competing decomposition consume the fenced parent lease", async () => {
    const parentLease = await claimParent(recordId(205));
    const attempt = (suffix: number) =>
      repository.decomposeClaimedWorkItem(
        {
          leaseId: parentLease.id,
          epoch: parentLease.epoch,
          workItemId: "parent",
          children: [
            { id: `child-${suffix}`, title: `Child ${suffix}`, rank: 1 },
          ],
        },
        { idempotencyKey: recordId(205 + suffix) },
      );

    const results = await Promise.allSettled([attempt(1), attempt(2)]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    const [rejected] = results.filter(({ status }) => status === "rejected");
    if (!rejected) throw new Error("Expected one decomposition to lose.");
    expectWorkGraphError(rejected, "lease_not_current");
    expect(
      (await repository.load()).workItems.filter(
        ({ parentId }) => parentId === "parent",
      ),
    ).toHaveLength(1);
    expect(await db.select().from(schema.idempotencyKey)).toHaveLength(1);
  });

  it("serializes competing decompositions that would form a combined cycle", async () => {
    await repository.createWorkItem({ id: "a", title: "A" });
    await repository.createWorkItem({ id: "b", title: "B" });
    const [leaseA, leaseB] = await Promise.all([
      repository.claimWorkItem({
        leaseId: recordId(214),
        workerId: "worker-a",
        leaseDurationSeconds: 300,
        workItemId: "a",
      }),
      repository.claimWorkItem({
        leaseId: recordId(215),
        workerId: "worker-b",
        leaseDurationSeconds: 300,
        workItemId: "b",
      }),
    ]);
    if (!leaseA || !leaseB) throw new Error("Expected both claims to succeed.");

    const results = await Promise.allSettled([
      repository.decomposeClaimedWorkItem({
        leaseId: leaseA.id,
        epoch: leaseA.epoch,
        workItemId: "a",
        children: [{ id: "a-child", title: "A child", rank: 1 }],
        dependencies: [dependency("a-child", "b")],
      }),
      repository.decomposeClaimedWorkItem({
        leaseId: leaseB.id,
        epoch: leaseB.epoch,
        workItemId: "b",
        children: [{ id: "b-child", title: "B child", rank: 1 }],
        dependencies: [dependency("b-child", "a")],
      }),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    const [rejected] = results.filter(({ status }) => status === "rejected");
    if (!rejected) throw new Error("Expected one cyclic decomposition to fail.");
    expectWorkGraphError(rejected, "graph_cycle");
    const graph = await repository.load();
    expect(graph.workItems).toHaveLength(3);
    expect(graph.dependencies).toHaveLength(1);
    expect(() => projectWorkItemStage(graph, "a")).not.toThrow();
    expect(() => projectWorkItemStage(graph, "b")).not.toThrow();
    expect(
      [
        await repository.getCurrentLease("a"),
        await repository.getCurrentLease("b"),
      ].filter((currentLease) => currentLease !== null),
    ).toHaveLength(1);
  });

  it("replays a concurrent retry with the original children and child lease", async () => {
    const parentLease = await claimParent(recordId(208));
    const request = {
      leaseId: parentLease.id,
      epoch: parentLease.epoch,
      workItemId: "parent",
      children: [{ id: "child", title: "Child", rank: 1 }],
      claim: {
        workItemId: "child",
        leaseId: recordId(209),
        leaseDurationSeconds: 120,
      },
    } as const;
    const options = { idempotencyKey: recordId(210) };

    const [first, replay] = await Promise.all([
      repository.decomposeClaimedWorkItem(request, options),
      repository.decomposeClaimedWorkItem(request, options),
    ]);

    expect(replay).toEqual(first);
    expect((await repository.load()).workItems).toHaveLength(2);
    expect(await repository.listLeases("parent")).toHaveLength(1);
    expect(await repository.listLeases("child")).toHaveLength(1);
    expect(await db.select().from(schema.idempotencyKey)).toHaveLength(1);
  });

  it("rejects invalid child sets before changing the graph", async () => {
    const parentLease = await claimParent(recordId(216));
    const base = {
      leaseId: parentLease.id,
      epoch: parentLease.epoch,
      workItemId: "parent",
    } as const;

    await expect(
      repository.decomposeClaimedWorkItem({ ...base, children: [] }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "invalid_decomposition",
      }),
    );
    await expect(
      repository.decomposeClaimedWorkItem({
        ...base,
        children: [{ id: "child", title: "Child", rank: 0 }],
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "invalid_child_rank",
      }),
    );
    await expect(
      repository.decomposeClaimedWorkItem({
        ...base,
        children: [
          { id: "child", title: "Child", rank: 1 },
          { id: "child", title: "Duplicate", rank: 2 },
        ],
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "duplicate_work_item",
      }),
    );
    await expect(
      repository.decomposeClaimedWorkItem({
        ...base,
        children: [
          { id: "first", title: "First", rank: 1 },
          { id: "second", title: "Second", rank: 1 },
        ],
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "invalid_child_rank",
      }),
    );
    await expect(
      repository.decomposeClaimedWorkItem({
        ...base,
        children: [{ id: "child", title: "Child", rank: 1 }],
        claim: {
          workItemId: "other",
          leaseId: recordId(217),
          leaseDurationSeconds: 60,
        },
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "invalid_decomposition",
      }),
    );

    expect((await repository.load()).workItems).toHaveLength(1);
    await expect(repository.getCurrentLease("parent")).resolves.toEqual(
      expect.objectContaining({ id: parentLease.id, endedAt: null }),
    );
  });

  it("translates PostgreSQL conflicts and rolls back every partial change", async () => {
    const parentLease = await claimParent(recordId(218));
    await repository.createWorkItem({ id: "existing", title: "Existing" });

    await expect(
      repository.decomposeClaimedWorkItem({
        leaseId: parentLease.id,
        epoch: parentLease.epoch,
        workItemId: "parent",
        children: [{ id: "existing", title: "Collision", rank: 1 }],
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "duplicate_work_item",
      }),
    );
    await expect(
      repository.decomposeClaimedWorkItem({
        leaseId: parentLease.id,
        epoch: parentLease.epoch,
        workItemId: "parent",
        children: [{ id: "child", title: "Child", rank: 1 }],
        dependencies: [
          dependency("child", "existing"),
          dependency("child", "existing"),
        ],
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "dependency_already_exists",
      }),
    );
    await expect(
      repository.decomposeClaimedWorkItem({
        leaseId: parentLease.id,
        epoch: parentLease.epoch,
        workItemId: "parent",
        children: [{ id: "child", title: "Child", rank: 1 }],
        dependencies: [dependency("child", "child")],
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "self_dependency",
      }),
    );

    expect((await repository.load()).workItems.map(({ id }) => id)).toEqual([
      "parent",
      "existing",
    ]);
    expect((await repository.load()).dependencies).toEqual([]);
    await expect(repository.getCurrentLease("parent")).resolves.toEqual(
      expect.objectContaining({ id: parentLease.id, endedAt: null }),
    );
  });

  it("rolls back when the optional child lease ID already exists", async () => {
    const parentLease = await claimParent(recordId(219));
    await repository.createWorkItem({ id: "other", title: "Other" });
    const duplicateLeaseId = recordId(220);
    await repository.claimWorkItem({
      leaseId: duplicateLeaseId,
      workerId: "worker-b",
      leaseDurationSeconds: 300,
      workItemId: "other",
    });

    await expect(
      repository.decomposeClaimedWorkItem({
        leaseId: parentLease.id,
        epoch: parentLease.epoch,
        workItemId: "parent",
        children: [{ id: "child", title: "Child", rank: 1 }],
        claim: {
          workItemId: "child",
          leaseId: duplicateLeaseId,
          leaseDurationSeconds: 60,
        },
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "duplicate_lease_id",
      }),
    );

    expect((await repository.load()).workItems.map(({ id }) => id)).toEqual([
      "parent",
      "other",
    ]);
    await expect(repository.getCurrentLease("parent")).resolves.toEqual(
      expect.objectContaining({ id: parentLease.id, endedAt: null }),
    );
  });

  it("reconstructs sibling rank and rejects a rank used earlier", async () => {
    const firstLease = await claimParent(recordId(223));
    await repository.decomposeClaimedWorkItem({
      leaseId: firstLease.id,
      epoch: firstLease.epoch,
      workItemId: "parent",
      children: [{ id: "later", title: "Later", rank: 20 }],
    });
    await repository.releaseWorkItem("later", completionEvidence);
    const secondLease = await repository.claimWorkItem({
      leaseId: recordId(224),
      workerId: "worker-a",
      leaseDurationSeconds: 300,
      workItemId: "parent",
    });
    if (!secondLease) throw new Error("Expected the parent reclaim to succeed.");

    await expect(
      repository.decomposeClaimedWorkItem({
        leaseId: secondLease.id,
        epoch: secondLease.epoch,
        workItemId: "parent",
        children: [{ id: "first", title: "First", rank: 10 }],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        children: [
          expect.objectContaining({
            rank: 10,
            workItem: expect.objectContaining({ id: "first", rank: 10 }),
          }),
        ],
      }),
    );

    const reconstructed = await repository.load();
    expect(
      getDirectChildren(reconstructed, "parent").map(({ id, rank }) => ({
        id,
        rank,
      })),
    ).toEqual([
      { id: "first", rank: 10 },
      { id: "later", rank: 20 },
    ]);
    await repository.reparentWorkItem("first", "parent");
    await expect(repository.getWorkItem("first")).resolves.toEqual(
      expect.objectContaining({ rank: 10 }),
    );

    await repository.releaseWorkItem("first", completionEvidence);
    const thirdLease = await repository.claimWorkItem({
      leaseId: recordId(225),
      workerId: "worker-a",
      leaseDurationSeconds: 300,
      workItemId: "parent",
    });
    if (!thirdLease) throw new Error("Expected the parent reclaim to succeed.");
    await expect(
      repository.decomposeClaimedWorkItem({
        leaseId: thirdLease.id,
        epoch: thirdLease.epoch,
        workItemId: "parent",
        children: [{ id: "duplicate", title: "Duplicate", rank: 20 }],
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "invalid_child_rank",
      }),
    );

    expect((await repository.load()).workItems.map(({ id }) => id)).toEqual([
      "parent",
      "later",
      "first",
    ]);
    await expect(repository.getCurrentLease("parent")).resolves.toEqual(
      expect.objectContaining({ id: thirdLease.id, endedAt: null }),
    );
  });

  it("replays a decomposition without an optional child claim", async () => {
    const parentLease = await claimParent(recordId(221));
    const request = {
      leaseId: parentLease.id,
      epoch: parentLease.epoch,
      workItemId: "parent",
      children: [{ id: "child", title: "Child", rank: 1 }],
    } as const;
    const options = { idempotencyKey: recordId(222) };

    const first = await repository.decomposeClaimedWorkItem(request, options);
    const replay = await repository.decomposeClaimedWorkItem(request, options);

    expect(replay).toEqual(first);
    expect(replay.claimedLease).toBeNull();
    expect(await repository.listLeases("child")).toEqual([]);
  });
});

beforeEach(async () => {
  await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`alter table ${schema.event} disable trigger events_immutable_truncate`,
    );
    await transaction.execute(
      sql`truncate table ${schema.event} restart identity`,
    );
    await transaction.execute(
      sql`alter table ${schema.event} enable trigger events_immutable_truncate`,
    );
  });
  await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`alter table ${schema.note} disable trigger notes_immutable`,
    );
    await transaction.delete(schema.attentionResolution);
    await transaction.delete(schema.attentionRequest);
    await transaction.delete(schema.note);
    await transaction.execute(
      sql`alter table ${schema.note} enable trigger notes_immutable`,
    );
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

describe("work-item context persistence", () => {
  it("upserts typed records and resolves inherited context in claim order", async () => {
    await repository.putKnowledgeScope({
      id: "initiative",
      kind: "initiative",
      title: "Initiative",
      canonicalUrl: "https://example.test/initiatives/one",
      markdownUrl: "https://example.test/initiatives/one.md",
    });
    await repository.putKnowledgeScope({
      id: "project",
      kind: "project",
      title: "Project",
      canonicalUrl: "https://example.test/projects/one",
      markdownUrl: "https://example.test/projects/one.md",
    });
    await repository.addKnowledgeScopeRelationship({
      parentKnowledgeScopeId: "initiative",
      childKnowledgeScopeId: "project",
    });
    await repository.createWorkItem({
      id: "parent",
      title: "Parent",
      schedulingInitiativeId: "initiative",
      schedulingProjectId: "project",
    });
    await repository.createWorkItem({
      id: "child",
      title: "Child",
      parentId: "parent",
    });

    await repository.putWorkItemContext({
      workItemId: "parent",
      kind: "brief",
      content: "Parent brief.",
    });
    await repository.putWorkItemContext({
      workItemId: "parent",
      kind: "acceptance_criteria",
      content: "The context is ordered.",
    });
    await repository.putWorkItemContext(
      {
        workItemId: "child",
        kind: "brief",
        content: "Child brief.",
      },
      { idempotencyKey: recordId(301) },
    );
    await repository.putWorkItemContext(
      {
        workItemId: "child",
        kind: "brief",
        content: "Child brief.",
      },
      { idempotencyKey: recordId(301) },
    );
    await repository.putWorkItemArchitectureDecision({
      workItemId: "parent",
      title: "Governing decision",
      url: "https://example.test/adrs/governing",
      role: "governing",
    });
    await repository.putWorkItemArchitectureDecision({
      workItemId: "child",
      title: "Background decision",
      url: "https://example.test/adrs/background",
      role: "background",
    });
    await repository.putWorkItemReference({
      workItemId: "parent",
      title: "Parent reference",
      url: "https://example.test/references/parent",
    });
    await repository.putWorkItemReference({
      workItemId: "child",
      title: "Child reference",
      url: "https://example.test/references/child",
    });

    const graph = await repository.load();
    expect(graph.contexts).toHaveLength(3);
    expect(graph.architectureDecisions).toHaveLength(2);
    expect(graph.references).toHaveLength(2);
    expect(
      (await repository.resolveWorkItemContext("child")).map((record) =>
        record.kind === "architecture_decision"
          ? `${record.kind}:${record.role}:${record.sourceWorkItemId}`
          : `${record.kind}:${record.sourceWorkItemId}`,
      ),
    ).toEqual([
      "brief:child",
      "acceptance_criteria:parent",
      "architecture_decision:background:child",
      "architecture_decision:governing:parent",
      "project:parent",
      "initiative:parent",
      "reference:child",
      "reference:parent",
    ]);
  });

  it("refreshes one PR snapshot independently from its many work-item links", async () => {
    await repository.createWorkItem({ id: "first", title: "First" });
    await repository.createWorkItem({ id: "second", title: "Second" });
    await expect(
      repository.putWorkItemPullRequest({
        workItemId: "first",
        repository: "example/missing",
        number: 1,
        role: "related",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "pull_request_not_found",
      }),
    );
    const snapshot = {
      repository: "Example/Work-Graph",
      number: 42,
      url: "https://github.com/example/work-graph/pull/42",
      headSha: "0123456789abcdef0123456789abcdef01234567",
      state: "open" as const,
      draft: true,
      mergeability: "unknown" as const,
      reviewDecision: null,
      checkSummary: "pending" as const,
      observedAt: "2026-09-20T10:00:00.000Z",
    };
    await repository.refreshPullRequest(snapshot, {
      idempotencyKey: recordId(302),
    });
    await repository.refreshPullRequest(snapshot, {
      idempotencyKey: recordId(302),
    });
    const firstLink = {
      workItemId: "first",
      repository: "example/work-graph",
      number: 42,
      role: "implementation" as const,
    };
    await repository.putWorkItemPullRequest(firstLink, {
      idempotencyKey: recordId(303),
    });
    await repository.putWorkItemPullRequest(firstLink, {
      idempotencyKey: recordId(303),
    });
    await repository.putWorkItemPullRequest({
      workItemId: "second",
      repository: "example/work-graph",
      number: 42,
      role: "evidence",
    });
    await repository.refreshPullRequest({
      ...snapshot,
      repository: "example/work-graph",
      headSha: "abcdef0123456789abcdef0123456789abcdef01",
      draft: false,
      mergeability: "mergeable",
      reviewDecision: "approved",
      checkSummary: "success",
      observedAt: "2026-09-20T11:00:00.000Z",
    });
    await repository.refreshPullRequest(snapshot);

    const graph = await repository.load();
    expect(graph.pullRequests).toEqual([
      expect.objectContaining({
        repository: "example/work-graph",
        number: 42,
        draft: false,
        checkSummary: "success",
        observedAt: "2026-09-20T11:00:00.000Z",
      }),
    ]);
    expect(graph.workItemPullRequests).toHaveLength(2);
    expect(await repository.resolveWorkItemContext("first")).toContainEqual(
      expect.objectContaining({
        kind: "pull_request",
        role: "implementation",
        pullRequest: expect.objectContaining({ headSha: "abcdef0123456789abcdef0123456789abcdef01" }),
      }),
    );
    expect((await repository.getWorkItem("second")).stage).toBe("ready");
  });
});

describe("knowledge scope persistence", () => {
  const putInitiative = () =>
    repository.putKnowledgeScope({
      id: "semi-autonomous-development",
      kind: "initiative",
      title: "Semi-autonomous software development",
      canonicalUrl:
        "https://example.test/initiatives/semi-autonomous-development",
      markdownUrl:
        "https://example.test/initiatives/semi-autonomous-development.md",
      sourceRevision: "abc123",
    });

  const putProject = () =>
    repository.putKnowledgeScope({
      id: "work-graph",
      kind: "project",
      title: "Work Graph",
      canonicalUrl: "https://example.test/projects/work-graph",
      markdownUrl: "https://example.test/projects/work-graph.md",
    });

  it("upserts mirrors and lists them by stable source key", async () => {
    await putProject();
    await putInitiative();
    await repository.putKnowledgeScope({
      id: "work-graph",
      kind: "project",
      title: "Work Graph coordination service",
      canonicalUrl: "https://example.test/projects/work-graph",
      markdownUrl: "https://example.test/projects/work-graph.md",
      sourceRevision: "def456",
    });

    await expect(repository.getKnowledgeScope("work-graph")).resolves.toEqual({
      id: "work-graph",
      kind: "project",
      title: "Work Graph coordination service",
      canonicalUrl: "https://example.test/projects/work-graph",
      markdownUrl: "https://example.test/projects/work-graph.md",
      sourceRevision: "def456",
      rank: 1024,
    });
    await expect(
      repository.listKnowledgeScopes({ kind: "project" }),
    ).resolves.toEqual([
      expect.objectContaining({ id: "work-graph", kind: "project" }),
    ]);
    await expect(
      repository.listKnowledgeScopes({ cursor: "semi-autonomous-development" }),
    ).resolves.toEqual([
      expect.objectContaining({ id: "work-graph" }),
    ]);
  });

  it("inserts scopes at the median and moves them beside relative anchors", async () => {
    const put = (id: string) =>
      repository.putKnowledgeScope({
        id,
        kind: "project",
        title: id,
        canonicalUrl: `https://example.test/projects/${id}`,
        markdownUrl: `https://example.test/projects/${id}.md`,
      });
    await put("alpha");
    await put("bravo");
    await put("charlie");
    await put("delta");

    const before = await Promise.all(
      ["alpha", "bravo", "charlie", "delta"].map((id) =>
        repository.getKnowledgeScope(id),
      ),
    );
    expect(
      [...before]
        .sort((left, right) => left.rank! - right.rank!)
        .map(({ id }) => id),
    ).toEqual(["alpha", "charlie", "delta", "bravo"]);

    await repository.moveKnowledgeScopePriority("bravo", {
      higherThanId: "delta",
    });
    const afterAbove = await Promise.all(
      ["alpha", "bravo", "charlie", "delta"].map((id) =>
        repository.getKnowledgeScope(id),
      ),
    );
    expect(
      [...afterAbove]
        .sort((left, right) => left.rank! - right.rank!)
        .map(({ id }) => id),
    ).toEqual(["alpha", "charlie", "bravo", "delta"]);

    await repository.moveKnowledgeScopePriority("alpha", {
      lowerThanId: "charlie",
    });
    const afterBelow = await Promise.all(
      ["alpha", "bravo", "charlie", "delta"].map((id) =>
        repository.getKnowledgeScope(id),
      ),
    );
    expect(
      [...afterBelow]
        .sort((left, right) => left.rank! - right.rank!)
        .map(({ id }) => id),
    ).toEqual(["charlie", "alpha", "bravo", "delta"]);
  });

  it("replays a scope upsert without accepting different input", async () => {
    const options = { idempotencyKey: recordId(301) };
    const input = {
      id: "work-graph",
      kind: "project" as const,
      title: "Work Graph",
      canonicalUrl: "https://example.test/projects/work-graph",
      markdownUrl: "https://example.test/projects/work-graph.md",
    };

    const first = await repository.putKnowledgeScope(input, options);
    await expect(repository.putKnowledgeScope(input, options)).resolves.toEqual(
      first,
    );
    await expect(
      repository.putKnowledgeScope({ ...input, title: "Changed" }, options),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "idempotency_key_reused",
      }),
    );
  });

  it("adds, removes, and rejects cyclic scope relationships", async () => {
    await putInitiative();
    await putProject();
    const relationship = {
      parentKnowledgeScopeId: "semi-autonomous-development",
      childKnowledgeScopeId: "work-graph",
    };
    const addOptions = { idempotencyKey: recordId(302) };
    const removeOptions = { idempotencyKey: recordId(303) };

    await repository.addKnowledgeScopeRelationship(relationship, addOptions);
    await repository.addKnowledgeScopeRelationship(relationship, addOptions);
    await expect(repository.listKnowledgeScopeRelationships()).resolves.toEqual([
      relationship,
    ]);
    await expect(
      repository.addKnowledgeScopeRelationship({
        parentKnowledgeScopeId: "work-graph",
        childKnowledgeScopeId: "semi-autonomous-development",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "knowledge_scope_cycle",
      }),
    );

    await repository.removeKnowledgeScopeRelationship(
      relationship,
      removeOptions,
    );
    await repository.removeKnowledgeScopeRelationship(
      relationship,
      removeOptions,
    );
    await expect(repository.listKnowledgeScopeRelationships()).resolves.toEqual(
      [],
    );
  });

  it("keeps the relationship selected by a ticket scheduling context", async () => {
    await putInitiative();
    await putProject();
    const relationship = {
      parentKnowledgeScopeId: "semi-autonomous-development",
      childKnowledgeScopeId: "work-graph",
    };
    await repository.addKnowledgeScopeRelationship(relationship);
    await repository.createWorkItem({
      id: "ticket",
      title: "Ticket",
      schedulingProjectId: "work-graph",
    });

    await expect(
      repository.removeKnowledgeScopeRelationship(relationship),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "invalid_scheduling_scope",
      }),
    );
    await expect(repository.listKnowledgeScopeRelationships()).resolves.toEqual([
      relationship,
    ]);
  });

  it("pages scope relationships by parent and child ID", async () => {
    await putInitiative();
    for (const id of ["project-a", "project-b"]) {
      await repository.putKnowledgeScope({
        id,
        kind: "project",
        title: id,
        canonicalUrl: `https://example.test/projects/${id}`,
        markdownUrl: `https://example.test/projects/${id}.md`,
      });
      await repository.addKnowledgeScopeRelationship({
        parentKnowledgeScopeId: "semi-autonomous-development",
        childKnowledgeScopeId: id,
      });
    }

    const first = {
      parentKnowledgeScopeId: "semi-autonomous-development",
      childKnowledgeScopeId: "project-a",
    };
    const second = {
      parentKnowledgeScopeId: "semi-autonomous-development",
      childKnowledgeScopeId: "project-b",
    };
    await expect(
      repository.listKnowledgeScopeRelationships({ limit: 1 }),
    ).resolves.toEqual([first]);
    await expect(
      repository.listKnowledgeScopeRelationships({ cursor: first, limit: 1 }),
    ).resolves.toEqual([second]);
  });

  it("rejects relationships with missing scopes", async () => {
    await putProject();
    await expect(
      repository.addKnowledgeScopeRelationship({
        parentKnowledgeScopeId: "missing",
        childKnowledgeScopeId: "work-graph",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "knowledge_scope_not_found",
      }),
    );
    await expect(repository.getKnowledgeScope("missing")).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "knowledge_scope_not_found",
      }),
    );
  });
});

afterAll(async () => {
  await closeDb(db);
});

describe("lease-backed claiming", () => {
  const leaseId = (suffix: number): string =>
    `00000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;

  it("creates a lease only for work whose readiness predicates pass", async () => {
    await repository.createWorkItem({ id: "parent", title: "Parent" });
    await repository.createWorkItem({
      id: "child",
      title: "Child",
      parentId: "parent",
    });
    await repository.createWorkItem({ id: "dependent", title: "Dependent" });
    await repository.createWorkItem({ id: "blocker", title: "Blocker" });
    await repository.addDependency(dependency("dependent", "blocker"));

    await expect(
      repository.claimWorkItem({
        leaseId: leaseId(1),
        workerId: "worker-a",
        leaseDurationSeconds: 300,
        workItemId: "parent",
      }),
    ).resolves.toBeNull();
    await expect(
      repository.claimWorkItem({
        leaseId: leaseId(2),
        workerId: "worker-a",
        leaseDurationSeconds: 300,
        workItemId: "dependent",
      }),
    ).resolves.toBeNull();

    await repository.releaseWorkItem("child", completionEvidence);
    await repository.cancelWorkItem("blocker");

    const parentLease = await repository.claimWorkItem({
      leaseId: leaseId(3),
      workerId: "worker-a",
      leaseDurationSeconds: 300,
      workItemId: "parent",
    });
    const dependentLease = await repository.claimWorkItem({
      leaseId: leaseId(4),
      workerId: "worker-b",
      leaseDurationSeconds: 300,
      workItemId: "dependent",
    });

    expect(parentLease).toEqual(
      expect.objectContaining({
        id: leaseId(3),
        workItemId: "parent",
        workerId: "worker-a",
        epoch: 1,
        endedAt: null,
        outcome: null,
      }),
    );
    expect(dependentLease?.workItemId).toBe("dependent");
    if (!parentLease) throw new Error("Expected the parent claim to succeed.");
    await expect(repository.getCurrentLease("parent")).resolves.toEqual(
      parentLease,
    );
    await expect(repository.getWorkItem("parent")).resolves.toEqual(
      expect.objectContaining({
        stage: "in_progress",
        currentLease: parentLease,
      }),
    );
  });

  it("inherits dependency readiness from parent work", async () => {
    await repository.createWorkItem({ id: "parent", title: "Parent" });
    await repository.createWorkItem({
      id: "child",
      title: "Child",
      parentId: "parent",
    });
    await repository.createWorkItem({ id: "blocker", title: "Blocker" });
    await repository.addDependency(dependency("parent", "blocker"));

    await expect(
      repository.claimWorkItem({
        leaseId: leaseId(5),
        workerId: "worker-a",
        leaseDurationSeconds: 300,
        workItemId: "child",
      }),
    ).resolves.toBeNull();

    await repository.releaseWorkItem("blocker", completionEvidence);
    await expect(
      repository.claimWorkItem({
        leaseId: leaseId(6),
        workerId: "worker-a",
        leaseDurationSeconds: 300,
        workItemId: "child",
      }),
    ).resolves.toEqual(
      expect.objectContaining({ workItemId: "child", epoch: 1 }),
    );
  });

  it("lets exactly one worker win a race for a specified item", async () => {
    await repository.createWorkItem({ id: "work", title: "Contended work" });

    const claims = await Promise.all([
      repository.claimWorkItem({
        leaseId: leaseId(10),
        workerId: "worker-a",
        leaseDurationSeconds: 300,
        workItemId: "work",
      }),
      repository.claimWorkItem({
        leaseId: leaseId(11),
        workerId: "worker-b",
        leaseDurationSeconds: 300,
        workItemId: "work",
      }),
    ]);

    expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
    expect(claims.filter((claim) => claim === null)).toHaveLength(1);
    expect(await repository.listLeases("work")).toHaveLength(1);
  });

  it("starts the lease duration after graph-lock waiting ends", async () => {
    await repository.createWorkItem({ id: "work", title: "Delayed claim" });

    let announceLock: (() => void) | undefined;
    const graphLocked = new Promise<void>((resolve) => {
      announceLock = resolve;
    });
    let releaseLock: (() => void) | undefined;
    const holdLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const lockTransaction = db.transaction(async (transaction) => {
      await transaction
        .select({ id: schema.graphMutationLock.id })
        .from(schema.graphMutationLock)
        .for("update");
      announceLock?.();
      await holdLock;
    });
    await graphLocked;

    const claim = repository.claimWorkItem({
      leaseId: leaseId(12),
      workerId: "worker-a",
      leaseDurationSeconds: 1,
      workItemId: "work",
    });
    try {
      await waitForDatabaseLock();
      await db.execute(sql`select pg_sleep(1.1)`);
    } finally {
      releaseLock?.();
      await lockTransaction;
    }

    const claimed = await claim;
    if (!claimed) throw new Error("Expected the delayed claim to succeed.");
    const [clock] = await db.execute<{ currentTime: string }>(sql`
      select clock_timestamp() as "currentTime"
    `);
    expect(claimed.expiresAt.getTime()).toBeGreaterThan(
      clock ? new Date(clock.currentTime).getTime() : Number.POSITIVE_INFINITY,
    );
  });

  it("uses SKIP LOCKED to claim other work while a candidate is held", async () => {
    await repository.createWorkItem({ id: "a", title: "First" });
    await repository.createWorkItem({ id: "b", title: "Second" });

    let announceLock: (() => void) | undefined;
    const itemLocked = new Promise<void>((resolve) => {
      announceLock = resolve;
    });
    let releaseLock: (() => void) | undefined;
    const holdLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const lockTransaction = db.transaction(async (transaction) => {
      await transaction
        .select({ id: schema.workItem.id })
        .from(schema.workItem)
        .where(eq(schema.workItem.id, "a"))
        .for("update");
      announceLock?.();
      await holdLock;
    });
    await itemLocked;

    try {
      await expect(
        repository.claimWorkItem({
          leaseId: leaseId(20),
          workerId: "worker-b",
          leaseDurationSeconds: 300,
        }),
      ).resolves.toEqual(expect.objectContaining({ workItemId: "b" }));
    } finally {
      releaseLock?.();
      await lockTransaction;
    }
  });

  it("uses the same fixture-driven order for queue reads and scheduler claims", async () => {
    await repository.createWorkItem({
      id: "routine",
      title: "Routine maintenance",
    });
    await repository.createWorkItem({
      id: "release",
      title: "Release",
    });
    await repository.moveWorkItemPriority("release", {
      higherThanId: "routine",
    });
    await repository.createWorkItem({ id: "database", title: "Database" });
    const releaseLease = await repository.claimWorkItem({
      leaseId: leaseId(21),
      workerId: "planner",
      leaseDurationSeconds: 300,
      workItemId: "release",
    });
    if (!releaseLease) throw new Error("Expected the release claim to succeed.");
    await repository.decomposeClaimedWorkItem({
      leaseId: releaseLease.id,
      epoch: releaseLease.epoch,
      workItemId: "release",
      children: [
        { id: "release-api", title: "Release API", rank: 1 },
        { id: "release-ui", title: "Release UI", rank: 2 },
      ],
      dependencies: [dependency("release-api", "database")],
    });

    expect((await repository.listWorkItems()).map(({ id }) => id)).toEqual([
      "release",
      "release-api",
      "database",
      "release-ui",
      "routine",
    ]);
    await expect(
      repository.claimWorkItem({
        leaseId: leaseId(22),
        workerId: "worker-a",
        leaseDurationSeconds: 300,
      }),
    ).resolves.toEqual(expect.objectContaining({ workItemId: "database" }));
  });

  it("filters ordered queue reads and scheduler claims by inherited scopes", async () => {
    await repository.putKnowledgeScope({
      id: "initiative",
      kind: "initiative",
      title: "Initiative",
      canonicalUrl: "https://example.test/initiatives/initiative",
      markdownUrl: "https://example.test/initiatives/initiative.md",
    });
    await repository.putKnowledgeScope({
      id: "work-graph",
      kind: "project",
      title: "Work Graph",
      canonicalUrl: "https://example.test/projects/work-graph",
      markdownUrl: "https://example.test/projects/work-graph.md",
    });
    await repository.addKnowledgeScopeRelationship({
      parentKnowledgeScopeId: "initiative",
      childKnowledgeScopeId: "work-graph",
    });
    await repository.createWorkItem({ id: "unscoped", title: "Unscoped" });
    await repository.createWorkItem({ id: "plan", title: "Plan" });
    await repository.setWorkItemSchedulingScope("plan", {
      schedulingInitiativeId: null,
      schedulingProjectId: "work-graph",
    });
    await expect(repository.getWorkItem("plan")).resolves.toEqual(
      expect.objectContaining({
        schedulingInitiativeId: "initiative",
        schedulingProjectId: "work-graph",
      }),
    );
    await expect(
      repository.listEvents({ workItemId: "plan" }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "work_item.scheduling_scope_changed",
          data: expect.objectContaining({
            schedulingInitiativeId: "initiative",
            schedulingProjectId: "work-graph",
          }),
        }),
      ]),
    );
    const eventCount = (
      await repository.listEvents({ workItemId: "plan" })
    ).length;
    await repository.setWorkItemSchedulingScope("plan", {
      schedulingInitiativeId: "initiative",
      schedulingProjectId: "work-graph",
    });
    expect(
      await repository.listEvents({ workItemId: "plan" }),
    ).toHaveLength(eventCount);
    await repository.createWorkItem({
      id: "child-a",
      title: "First child",
      parentId: "plan",
    });
    await repository.createWorkItem({
      id: "child-b",
      title: "Second child",
      parentId: "plan",
    });

    const allIds = (await repository.listWorkItems()).map(({ id }) => id);
    const projectIds = (
      await repository.listWorkItems({ projectId: "work-graph" })
    ).map(({ id }) => id);
    expect(projectIds).toEqual(
      allIds.filter((id) => ["plan", "child-a", "child-b"].includes(id)),
    );
    await expect(
      repository.listWorkItems({ initiativeId: "initiative" }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "plan" }),
        expect.objectContaining({ id: "child-a" }),
        expect.objectContaining({ id: "child-b" }),
      ]),
    );
    await expect(
      repository.listWorkItems({ parentId: "plan" }),
    ).resolves.toEqual([
      expect.objectContaining({ id: "child-a" }),
      expect.objectContaining({ id: "child-b" }),
    ]);

    await expect(
      repository.claimWorkItem({
        leaseId: leaseId(24),
        workerId: "worker-a",
        leaseDurationSeconds: 300,
        projectId: "work-graph",
      }),
    ).resolves.toEqual(expect.objectContaining({ workItemId: "child-a" }));
    await expect(
      repository.claimWorkItem({
        leaseId: leaseId(25),
        workerId: "worker-b",
        leaseDurationSeconds: 300,
        parentId: "plan",
      }),
    ).resolves.toEqual(expect.objectContaining({ workItemId: "child-b" }));
    await expect(
      repository.claimWorkItem({
        leaseId: leaseId(26),
        workerId: "worker-c",
        leaseDurationSeconds: 300,
        workItemId: "unscoped",
        projectId: "work-graph",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "invalid_claim_scope",
      }),
    );
  });

  it("clears an occupied rank before moving a root into a project queue", async () => {
    await repository.putKnowledgeScope({
      id: "initiative",
      kind: "initiative",
      title: "Initiative",
      canonicalUrl: "https://example.test/initiatives/initiative",
      markdownUrl: "https://example.test/initiatives/initiative.md",
    });
    await repository.putKnowledgeScope({
      id: "work-graph",
      kind: "project",
      title: "Work Graph",
      canonicalUrl: "https://example.test/projects/work-graph",
      markdownUrl: "https://example.test/projects/work-graph.md",
    });
    await repository.addKnowledgeScopeRelationship({
      parentKnowledgeScopeId: "initiative",
      childKnowledgeScopeId: "work-graph",
    });
    await repository.createWorkItem({
      id: "project-ticket",
      title: "Existing project ticket",
      schedulingProjectId: "work-graph",
    });
    await repository.createWorkItem({ id: "plan", title: "Plan" });

    const existing = await repository.getWorkItem("project-ticket");
    const plan = await repository.getWorkItem("plan");
    expect(existing.priorityRank).toBe(plan.priorityRank);

    await expect(
      repository.setWorkItemSchedulingScope("plan", {
        schedulingInitiativeId: "initiative",
        schedulingProjectId: "work-graph",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: "plan",
        schedulingInitiativeId: "initiative",
        schedulingProjectId: "work-graph",
      }),
    );
    expect(
      (await repository.listWorkItems({ projectId: "work-graph" })).map(
        ({ id }) => id,
      ),
    ).toEqual(["project-ticket", "plan"]);

    await repository.putKnowledgeScope({
      id: "other-initiative",
      kind: "initiative",
      title: "Other initiative",
      canonicalUrl: "https://example.test/initiatives/other",
      markdownUrl: "https://example.test/initiatives/other.md",
    });
    await repository.addKnowledgeScopeRelationship({
      parentKnowledgeScopeId: "other-initiative",
      childKnowledgeScopeId: "work-graph",
    });
    const assigned = await repository.getWorkItem("plan");

    await expect(
      repository.setWorkItemSchedulingScope("plan", {
        schedulingInitiativeId: "other-initiative",
        schedulingProjectId: "work-graph",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        schedulingInitiativeId: "other-initiative",
        priorityRank: assigned.priorityRank,
      }),
    );
  });

  it("donates an explicit expedite to unresolved blockers", async () => {
    await repository.createWorkItem({ id: "normal", title: "Normal work" });
    await repository.createWorkItem({ id: "shared", title: "Shared blocker" });
    await repository.createWorkItem({ id: "urgent", title: "Urgent work" });
    await repository.addDependency(dependency("urgent", "shared"));
    await repository.expediteWorkItem(
      "urgent",
      "Restore production authentication.",
    );

    const ordered = await repository.listWorkItems();
    expect(ordered.map(({ id }) => id)).toEqual([
      "urgent",
      "shared",
      "normal",
    ]);
    expect(ordered.find(({ id }) => id === "shared")?.priority).toEqual(
      expect.objectContaining({
        expedited: false,
        effectiveExpedited: true,
        donatedFromWorkItemId: "urgent",
      }),
    );
    await expect(
      repository.claimWorkItem({
        leaseId: leaseId(23),
        workerId: "worker-a",
        leaseDurationSeconds: 300,
      }),
    ).resolves.toEqual(expect.objectContaining({ workItemId: "shared" }));

    await repository.unexpediteWorkItem("urgent");
    expect((await repository.getWorkItem("urgent")).expedited).toBe(false);
    expect((await repository.listWorkItems()).map(({ id }) => id)).toEqual([
      "normal",
      "urgent",
      "shared",
    ]);
  });

  it("reclaims stale work with a higher epoch and expires the old lease", async () => {
    await repository.createWorkItem({ id: "work", title: "Stale work" });
    const firstLease = await repository.claimWorkItem({
      leaseId: leaseId(30),
      workerId: "worker-a",
      leaseDurationSeconds: 300,
      workItemId: "work",
    });
    if (!firstLease) throw new Error("Expected the first claim to succeed.");

    await db
      .update(schema.lease)
      .set({
        acquiredAt: new Date("2000-01-01T00:00:00Z"),
        expiresAt: new Date("2000-01-01T00:01:00Z"),
      })
      .where(eq(schema.lease.id, firstLease.id));

    expect((await repository.getWorkItem("work")).stage).toBe("stale");

    const reclaimed = await repository.claimWorkItem({
      leaseId: leaseId(31),
      workerId: "worker-b",
      leaseDurationSeconds: 300,
      workItemId: "work",
    });
    expect(reclaimed).toEqual(
      expect.objectContaining({
        id: leaseId(31),
        workItemId: "work",
        workerId: "worker-b",
        epoch: 2,
      }),
    );

    const history = await repository.listLeases("work");
    expect(history[0]).toEqual(
      expect.objectContaining({
        id: firstLease.id,
        epoch: 1,
        outcome: "expired",
      }),
    );
    expect(history[0]?.endedAt).toBeInstanceOf(Date);
    expect(history[1]).toEqual(reclaimed);

    await expect(
      repository.renewLease({
        leaseId: firstLease.id,
        epoch: firstLease.epoch,
        leaseDurationSeconds: 300,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "lease_not_current",
      }),
    );
    await expect(
      repository.terminateClaimedWorkItem({
        leaseId: firstLease.id,
        epoch: firstLease.epoch,
        workItemId: "work",
        outcome: "released",
        ...completionEvidence,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "lease_not_current",
      }),
    );
  });

  it("renews only the active lease at the current epoch", async () => {
    await repository.createWorkItem({ id: "work", title: "Renewable work" });
    const claimed = await repository.claimWorkItem({
      leaseId: leaseId(40),
      workerId: "worker-a",
      leaseDurationSeconds: 60,
      workItemId: "work",
    });
    if (!claimed) throw new Error("Expected the claim to succeed.");

    await expect(
      repository.renewLease({
        leaseId: claimed.id,
        epoch: claimed.epoch + 1,
        leaseDurationSeconds: 600,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "lease_not_current",
      }),
    );

    const renewed = await repository.renewLease({
      leaseId: claimed.id,
      epoch: claimed.epoch,
      leaseDurationSeconds: 600,
    });
    expect(renewed.expiresAt.getTime()).toBeGreaterThan(
      claimed.expiresAt.getTime(),
    );
    expect(renewed.acquiredAt).toEqual(claimed.acquiredAt);
  });

  it("rejects renewal when a lease expires while waiting for its item lock", async () => {
    await repository.createWorkItem({ id: "work", title: "Expiring work" });
    const claimed = await repository.claimWorkItem({
      leaseId: leaseId(41),
      workerId: "worker-a",
      leaseDurationSeconds: 300,
      workItemId: "work",
    });
    if (!claimed) throw new Error("Expected the claim to succeed.");
    await db
      .update(schema.lease)
      .set({ expiresAt: sql`clock_timestamp() + interval '1 second'` })
      .where(eq(schema.lease.id, claimed.id));

    let announceLock: (() => void) | undefined;
    const itemLocked = new Promise<void>((resolve) => {
      announceLock = resolve;
    });
    let releaseLock: (() => void) | undefined;
    const holdLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const lockTransaction = db.transaction(async (transaction) => {
      await transaction
        .select({ id: schema.workItem.id })
        .from(schema.workItem)
        .where(eq(schema.workItem.id, "work"))
        .for("update");
      announceLock?.();
      await holdLock;
    });
    await itemLocked;

    const renewalResult = Promise.allSettled([
      repository.renewLease({
        leaseId: claimed.id,
        epoch: claimed.epoch,
        leaseDurationSeconds: 300,
      }),
    ]);
    try {
      await waitForDatabaseLock();
      await db.execute(sql`select pg_sleep(1.1)`);
    } finally {
      releaseLock?.();
      await lockTransaction;
    }

    const [renewal] = await renewalResult;
    if (!renewal) throw new Error("Expected one renewal result.");
    expectWorkGraphError(renewal, "lease_not_current");
  });

  it("terminates claimed work and retains the lease outcome", async () => {
    await repository.createWorkItem({ id: "work", title: "Claimed work" });
    const claimed = await repository.claimWorkItem({
      leaseId: leaseId(50),
      workerId: "worker-a",
      leaseDurationSeconds: 300,
      workItemId: "work",
    });
    if (!claimed) throw new Error("Expected the claim to succeed.");

    await expect(
      repository.releaseWorkItem("work", completionEvidence),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "work_item_has_current_lease",
      }),
    );

    const completed = await repository.terminateClaimedWorkItem({
      leaseId: claimed.id,
      epoch: claimed.epoch,
      workItemId: "work",
      outcome: "released",
      ...completionEvidence,
    });

    expect(completed.outcome).toBe("released");
    expect(completed.endedAt).toBeInstanceOf(Date);
    expect(projectWorkItemStage(await repository.load(), "work")).toBe(
      "released",
    );
    await expect(
      repository.claimWorkItem({
        leaseId: leaseId(51),
        workerId: "worker-b",
        leaseDurationSeconds: 300,
        workItemId: "work",
      }),
    ).resolves.toBeNull();
    await expect(
      repository.terminateClaimedWorkItem({
        leaseId: claimed.id,
        epoch: claimed.epoch,
        workItemId: "work",
        outcome: "cancelled",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "lease_not_current",
      }),
    );
  });

  it("rejects direct termination when a claim commits during its lock wait", async () => {
    await repository.createWorkItem({ id: "work", title: "Contended work" });

    let announceLock: (() => void) | undefined;
    const itemLocked = new Promise<void>((resolve) => {
      announceLock = resolve;
    });
    let finishClaim: (() => void) | undefined;
    const holdClaim = new Promise<void>((resolve) => {
      finishClaim = resolve;
    });
    const claimTransaction = db.transaction(async (transaction) => {
      await transaction
        .select({ id: schema.workItem.id })
        .from(schema.workItem)
        .where(eq(schema.workItem.id, "work"))
        .for("update");
      announceLock?.();
      await holdClaim;
      await transaction.insert(schema.lease).values({
        id: leaseId(52),
        workItemId: "work",
        workerId: "worker-a",
        epoch: 1,
        expiresAt: sql`clock_timestamp() + interval '5 minutes'`,
      });
    });
    await itemLocked;

    const terminationResult = Promise.allSettled([
      repository.releaseWorkItem("work", completionEvidence),
    ]);
    try {
      await waitForDatabaseLock();
    } finally {
      finishClaim?.();
    }
    await claimTransaction;

    const [termination] = await terminationResult;
    if (!termination) throw new Error("Expected one termination result.");
    expectWorkGraphError(termination, "work_item_has_current_lease");
    expect(
      (await repository.load()).workItems.find(({ id }) => id === "work")
        ?.lifecycle,
    ).toBe("open");
    expect(await repository.getCurrentLease("work")).toEqual(
      expect.objectContaining({ id: leaseId(52), epoch: 1 }),
    );
  });

  it("expires a stale lease before direct termination", async () => {
    await repository.createWorkItem({ id: "work", title: "Abandoned work" });
    await db.insert(schema.lease).values({
      id: leaseId(53),
      workItemId: "work",
      workerId: "worker-a",
      epoch: 1,
      acquiredAt: new Date(Date.now() - 120_000),
      expiresAt: new Date(Date.now() - 60_000),
    });

    await repository.cancelWorkItem("work");

    expect(
      (await repository.load()).workItems.find(({ id }) => id === "work")
        ?.lifecycle,
    ).toBe("cancelled");
    expect(await repository.getCurrentLease("work")).toBeNull();
    expect(await repository.listLeases("work")).toEqual([
      expect.objectContaining({
        id: leaseId(53),
        epoch: 1,
        outcome: "expired",
        endedAt: expect.any(Date),
      }),
    ]);
  });

  it("fails closed when claim coordination cannot lock the graph", async () => {
    await repository.createWorkItem({ id: "work", title: "Unclaimable work" });
    await db
      .delete(schema.graphMutationLock)
      .where(eq(schema.graphMutationLock.id, "global"));

    try {
      await expect(
        repository.claimWorkItem({
          leaseId: leaseId(60),
          workerId: "worker-a",
          leaseDurationSeconds: 300,
        }),
      ).rejects.toThrow("The global graph mutation lock row is missing.");
      expect(await repository.listLeases("work")).toEqual([]);
    } finally {
      await db.insert(schema.graphMutationLock).values({ id: "global" });
    }
  });

  it("rejects malformed lease commands before reaching PostgreSQL", async () => {
    await repository.createWorkItem({ id: "work", title: "Valid work" });

    await expect(
      repository.releaseWorkItem("work", {
        mergeEvidence: " ",
        deploymentEvidence: completionEvidence.deploymentEvidence,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "invalid_completion_evidence",
      }),
    );

    await expect(
      repository.claimWorkItem({
        leaseId: "not-a-uuid",
        workerId: "worker-a",
        leaseDurationSeconds: 300,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "invalid_lease_id",
      }),
    );
    await expect(
      repository.claimWorkItem({
        leaseId: leaseId(70),
        workerId: " ",
        leaseDurationSeconds: 300,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "invalid_worker_id",
      }),
    );
    await expect(
      repository.claimWorkItem({
        leaseId: leaseId(71),
        workerId: "worker-a",
        leaseDurationSeconds: 0,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "invalid_lease_duration",
      }),
    );
    await expect(
      repository.terminateClaimedWorkItem({
        leaseId: leaseId(72),
        epoch: 1,
        workItemId: "work",
        outcome: "released",
        ...completionEvidence,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "lease_not_current",
      }),
    );

    await repository.createWorkItem({ id: "other", title: "Other work" });
    await repository.claimWorkItem({
      leaseId: leaseId(73),
      workerId: "worker-a",
      leaseDurationSeconds: 300,
      workItemId: "work",
    });
    await expect(
      repository.claimWorkItem({
        leaseId: leaseId(73),
        workerId: "worker-b",
        leaseDurationSeconds: 300,
        workItemId: "other",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "duplicate_lease_id",
      }),
    );
  });
});

describe("lease-fenced notes and attention", () => {
  it("rejects audit records whose lease belongs to another work item", async () => {
    await repository.createWorkItem({ id: "work", title: "Work" });
    await repository.createWorkItem({ id: "other", title: "Other" });
    const claimed = await repository.claimWorkItem({
      leaseId: recordId(230),
      workerId: "worker-a",
      leaseDurationSeconds: 300,
      workItemId: "work",
    });
    if (!claimed) throw new Error("Expected work to be claimed.");

    expect(
      await rejectedDatabaseError(
        db.insert(schema.note).values({
          id: recordId(231),
          workItemId: "other",
          leaseId: claimed.id,
          author: "worker-a",
          content: "Mismatched provenance",
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        code: "23503",
        constraint_name: "notes_lease_work_item_fk",
      }),
    );
    expect(
      await rejectedDatabaseError(
        db.insert(schema.attentionRequest).values({
          id: recordId(232),
          workItemId: "other",
          requestingLeaseId: claimed.id,
          kind: "review",
          question: "Can this mismatched lease be recorded?",
          blocking: false,
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        code: "23503",
        constraint_name: "attention_requests_lease_work_item_fk",
      }),
    );
    expect(await db.select().from(schema.note)).toHaveLength(0);
    expect(await db.select().from(schema.attentionRequest)).toHaveLength(0);
  });

  it("filters and bounds attention requests in PostgreSQL", async () => {
    const work = [
      { id: "first", leaseId: recordId(240) },
      { id: "resolved", leaseId: recordId(241) },
      { id: "last", leaseId: recordId(242) },
    ] as const;
    for (const item of work) {
      await repository.createWorkItem({ id: item.id, title: item.id });
      const claimed = await repository.claimWorkItem({
        leaseId: item.leaseId,
        workerId: "worker-a",
        leaseDurationSeconds: 300,
        workItemId: item.id,
      });
      if (!claimed) throw new Error(`Expected ${item.id} to be claimed.`);
    }

    const first = await repository.createAttentionRequest({
      id: recordId(243),
      workItemId: "first",
      leaseId: work[0].leaseId,
      epoch: 1,
      kind: "decision",
      question: "First question",
      blocking: true,
    });
    const resolved = await repository.createAttentionRequest({
      id: recordId(244),
      workItemId: "resolved",
      leaseId: work[1].leaseId,
      epoch: 1,
      kind: "review",
      question: "Resolved question",
      blocking: false,
    });
    const resolution = await repository.resolveAttentionRequest({
      id: recordId(245),
      attentionRequestId: resolved.attentionRequest.id,
      resolution: "Resolved answer",
    });
    const last = await repository.createAttentionRequest({
      id: recordId(246),
      workItemId: "last",
      leaseId: work[2].leaseId,
      epoch: 1,
      kind: "decision",
      question: "Last question",
      blocking: true,
    });

    expect(
      await repository.listAttentionRequests({
        state: "unresolved",
        blocking: true,
        limit: 1,
      }),
    ).toEqual([{ ...first.attentionRequest, resolution: null }]);
    expect(
      await repository.listAttentionRequests({
        state: "unresolved",
        blocking: true,
        cursor: first.attentionRequest.id,
        limit: 1,
      }),
    ).toEqual([{ ...last.attentionRequest, resolution: null }]);
    expect(
      await repository.listAttentionRequests({
        workItemId: "resolved",
        state: "resolved",
        blocking: false,
        limit: 1,
      }),
    ).toEqual([
      {
        ...resolved.attentionRequest,
        resolution: resolution.resolution,
      },
    ]);
  });

  it("records an idempotent note only for the current lease epoch", async () => {
    await repository.createWorkItem({ id: "work", title: "Work" });
    const claimed = await repository.claimWorkItem({
      leaseId: recordId(201),
      workerId: "worker-a",
      leaseDurationSeconds: 300,
      workItemId: "work",
    });
    if (!claimed) throw new Error("Expected work to be claimed.");
    const input = {
      id: recordId(202),
      workItemId: "work",
      leaseId: claimed.id,
      epoch: claimed.epoch,
      content: "The API contract is generated from the route registry.",
    };
    const options = { idempotencyKey: recordId(203) };

    const first = await repository.createNote(input, options);
    const replay = await repository.createNote(input, options);

    expect(replay).toEqual(first);
    expect(await repository.listNotes("work")).toEqual([first]);
    const second = await repository.createNote({
      ...input,
      id: recordId(206),
      content: "The CLI exposes this second note through a cursor.",
    });
    expect(
      await repository.listNotes({ workItemId: "work", limit: 1 }),
    ).toEqual([first]);
    expect(
      await repository.listNotes({
        workItemId: "work",
        cursor: first.id,
        limit: 1,
      }),
    ).toEqual([second]);
    await expect(
      repository.createNote(
        { ...input, id: recordId(204), epoch: claimed.epoch + 1 },
        { idempotencyKey: recordId(205) },
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "lease_not_current",
      }),
    );
  });

  it("appends one immutable attributed note without changing released history", async () => {
    await repository.createWorkItem({ id: "work", title: "Work" });
    const claimed = await repository.claimWorkItem({
      leaseId: recordId(250),
      workerId: "worker-a",
      leaseDurationSeconds: 300,
      workItemId: "work",
    });
    if (!claimed) throw new Error("Expected work to be claimed.");
    const workingNote = await repository.createNote({
      id: recordId(251),
      workItemId: "work",
      leaseId: claimed.id,
      epoch: claimed.epoch,
      content: "Working history",
    });
    await repository.terminateClaimedWorkItem({
      workItemId: "work",
      leaseId: claimed.id,
      epoch: claimed.epoch,
      outcome: "released",
      ...completionEvidence,
    });

    const [workItemBefore] = await db
      .select()
      .from(schema.workItem)
      .where(eq(schema.workItem.id, "work"));
    const leasesBefore = await repository.listLeases("work");
    const releaseEventsBefore = await repository.listEvents({
      workItemId: "work",
      type: "work_item.lifecycle_changed",
      lifecycle: "released",
    });
    const input = {
      id: recordId(252),
      workItemId: "work",
      author: "reviewer-a",
      content: "Production exposed a follow-up.",
    };
    const options = { idempotencyKey: recordId(253) };

    const first = await repository.createPostReleaseNote(input, options);
    const replay = await repository.createPostReleaseNote(input, options);

    expect(replay).toEqual(first);
    expect(first).toEqual(
      expect.objectContaining({
        leaseId: null,
        author: "reviewer-a",
        content: "Production exposed a follow-up.",
        createdAt: expect.any(Date),
      }),
    );
    expect(await repository.listNotes("work")).toEqual([workingNote, first]);
    expect(await db.select().from(schema.workItem)).toContainEqual(
      workItemBefore,
    );
    expect(await repository.listLeases("work")).toEqual(leasesBefore);
    expect(
      await repository.listEvents({
        workItemId: "work",
        type: "work_item.lifecycle_changed",
        lifecycle: "released",
      }),
    ).toEqual(releaseEventsBefore);

    expect(
      await rejectedDatabaseError(
        db
          .update(schema.note)
          .set({ content: "Edited history" })
          .where(eq(schema.note.id, workingNote.id)),
      ),
    ).toEqual(expect.objectContaining({ code: "55000" }));
    expect(
      await rejectedDatabaseError(
        db.delete(schema.note).where(eq(schema.note.id, first.id)),
      ),
    ).toEqual(expect.objectContaining({ code: "55000" }));
  });

  it("rejects post-release discussion on open and cancelled work", async () => {
    await repository.createWorkItem({ id: "open", title: "Open" });
    await repository.createWorkItem({ id: "cancelled", title: "Cancelled" });
    await repository.cancelWorkItem("cancelled");

    for (const [index, workItemId] of ["open", "cancelled"].entries()) {
      await expect(
        repository.createPostReleaseNote({
          id: recordId(260 + index),
          workItemId,
          author: "reviewer-a",
          content: "Should not be recorded.",
        }),
      ).rejects.toEqual(
        expect.objectContaining<Partial<WorkGraphError>>({
          code: "work_item_not_released",
        }),
      );
    }
  });

  it("ends a lease for blocking attention and allows another worker after resolution", async () => {
    await repository.createWorkItem({ id: "work", title: "Work" });
    const claimed = await repository.claimWorkItem({
      leaseId: recordId(206),
      workerId: "worker-a",
      leaseDurationSeconds: 300,
      workItemId: "work",
    });
    if (!claimed) throw new Error("Expected work to be claimed.");
    const requestInput = {
      id: recordId(207),
      workItemId: "work",
      leaseId: claimed.id,
      epoch: claimed.epoch,
      kind: "decision",
      question: "Should this endpoint accept non-blocking requests?",
      note: "The schema can represent either choice.",
      blocking: true,
    };
    const requestOptions = { idempotencyKey: recordId(208) };

    const opened = await repository.createAttentionRequest(
      requestInput,
      requestOptions,
    );
    const replay = await repository.createAttentionRequest(
      requestInput,
      requestOptions,
    );

    expect(replay).toEqual(opened);
    expect(opened.attentionRequest).toEqual(
      expect.objectContaining({
        requestingLeaseId: claimed.id,
        kind: "decision",
        question: "Should this endpoint accept non-blocking requests?",
        note: "The schema can represent either choice.",
        blocking: true,
      }),
    );
    expect(opened.endedLease).toEqual(
      expect.objectContaining({
        workerId: "worker-a",
        outcome: "attention_requested",
      }),
    );
    expect((await repository.getWorkItem("work")).stage).toBe(
      "needs_attention",
    );
    expect(await repository.listAttentionRequests()).toEqual([
      { ...opened.attentionRequest, resolution: null },
    ]);
    await expect(
      repository.claimWorkItem({
        leaseId: recordId(209),
        workerId: "worker-b",
        leaseDurationSeconds: 300,
        workItemId: "work",
      }),
    ).resolves.toBeNull();

    const resolutionInput = {
      id: recordId(210),
      attentionRequestId: opened.attentionRequest.id,
      resolution: "Keep both forms and let blocking control the lease.",
    };
    const resolutionOptions = { idempotencyKey: recordId(211) };
    const resolution = await repository.resolveAttentionRequest(
      resolutionInput,
      resolutionOptions,
    );
    const resolutionReplay = await repository.resolveAttentionRequest(
      resolutionInput,
      resolutionOptions,
    );

    expect(resolutionReplay).toEqual(resolution);
    expect(await repository.listAttentionRequests()).toEqual([
      {
        ...opened.attentionRequest,
        resolution: resolution.resolution,
      },
    ]);
    expect((await repository.getWorkItem("work")).stage).toBe("ready");
    const resumed = await repository.claimWorkItem({
      leaseId: recordId(212),
      workerId: "worker-b",
      leaseDurationSeconds: 300,
      workItemId: "work",
    });
    expect(resumed).toEqual(
      expect.objectContaining({ workerId: "worker-b", epoch: 2 }),
    );
  });

  it("recomputes other blockers after resolving attention", async () => {
    await repository.createWorkItem({ id: "work", title: "Work" });
    await repository.createWorkItem({ id: "blocker", title: "Blocker" });
    const claimed = await repository.claimWorkItem({
      leaseId: recordId(213),
      workerId: "worker-a",
      leaseDurationSeconds: 300,
      workItemId: "work",
    });
    if (!claimed) throw new Error("Expected work to be claimed.");
    const opened = await repository.createAttentionRequest({
      id: recordId(214),
      workItemId: "work",
      leaseId: claimed.id,
      epoch: claimed.epoch,
      kind: "input",
      question: "Which prerequisite applies?",
      blocking: true,
    });
    await repository.addDependency(dependency("work", "blocker"));

    await repository.resolveAttentionRequest({
      id: recordId(215),
      attentionRequestId: opened.attentionRequest.id,
      resolution: "The blocker must finish first.",
    });

    expect((await repository.getWorkItem("work")).stage).toBe("blocked");
  });

  it("keeps a lease active for non-blocking attention", async () => {
    await repository.createWorkItem({ id: "work", title: "Work" });
    const claimed = await repository.claimWorkItem({
      leaseId: recordId(216),
      workerId: "worker-a",
      leaseDurationSeconds: 300,
      workItemId: "work",
    });
    if (!claimed) throw new Error("Expected work to be claimed.");

    const opened = await repository.createAttentionRequest({
      id: recordId(217),
      workItemId: "work",
      leaseId: claimed.id,
      epoch: claimed.epoch,
      kind: "review",
      question: "Can someone check the wording while implementation continues?",
      blocking: false,
    });

    expect(opened.endedLease).toBeNull();
    expect((await repository.getWorkItem("work")).stage).toBe("in_progress");
    expect(await repository.getCurrentLease("work")).toEqual(claimed);
  });

  it("accepts exactly one of two concurrent resolutions", async () => {
    await repository.createWorkItem({ id: "work", title: "Work" });
    const claimed = await repository.claimWorkItem({
      leaseId: recordId(218),
      workerId: "worker-a",
      leaseDurationSeconds: 300,
      workItemId: "work",
    });
    if (!claimed) throw new Error("Expected work to be claimed.");
    const opened = await repository.createAttentionRequest({
      id: recordId(219),
      workItemId: "work",
      leaseId: claimed.id,
      epoch: claimed.epoch,
      kind: "decision",
      question: "Choose one answer.",
      blocking: true,
    });

    const results = await Promise.allSettled([
      repository.resolveAttentionRequest({
        id: recordId(220),
        attentionRequestId: opened.attentionRequest.id,
        resolution: "First answer.",
      }),
      repository.resolveAttentionRequest({
        id: recordId(221),
        attentionRequestId: opened.attentionRequest.id,
        resolution: "Second answer.",
      }),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    const [rejected] = results.filter(({ status }) => status === "rejected");
    if (!rejected) throw new Error("Expected one resolution to be rejected.");
    expectWorkGraphError(rejected, "attention_request_already_resolved");
  });
});

describe("Work Graph PostgreSQL persistence", () => {
  it("persists a sparse work item without fixed task or readiness fields", async () => {
    await repository.createWorkItem({
      id: "sparse",
      title: "Sparse work item",
    });

    expect(await repository.load()).toEqual({
      workItems: [
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
      ],
      dependencies: [],
      contexts: [],
      architectureDecisions: [],
      references: [],
      pullRequests: [],
      workItemPullRequests: [],
    });

    const columns = await db.execute<{ column_name: string }>(sql`
      select column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = 'work_items'
      order by ordinal_position
    `);
    expect(columns.map(({ column_name }) => column_name)).toEqual([
      "id",
      "title",
      "lifecycle",
      "created_at",
      "updated_at",
      "expedited",
      "expedite_reason",
    ]);
  });

  it("rejects scheduling scopes on work that inherits parent priority", async () => {
    await repository.createWorkItem({ id: "parent", title: "Parent" });

    await expect(
      repository.createWorkItem({
        id: "child",
        title: "Child",
        parentId: "parent",
        schedulingInitiativeId: "initiative",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "invalid_scheduling_scope",
      }),
    );

    await repository.createWorkItem({
      id: "valid-child",
      title: "Valid child",
      parentId: "parent",
    });
    await expect(
      repository.setWorkItemSchedulingScope("valid-child", {
        schedulingInitiativeId: null,
        schedulingProjectId: null,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "invalid_priority_move",
      }),
    );
  });

  it("serializes concurrent retries of one sparse work-item creation", async () => {
    const key = "00000000-0000-4000-8000-000000000081";
    const request = () =>
      repository.createWorkItem(
        { id: "retried", title: "Created once" },
        { idempotencyKey: key },
      );

    const [first, retry] = await Promise.all([request(), request()]);

    expect(first).toEqual(retry);
    expect((await repository.load()).workItems).toEqual([
      {
        id: "retried",
        title: "Created once",
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
    await expect(
      repository.createWorkItem(
        { id: "different", title: "Different input" },
        { idempotencyKey: key },
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "idempotency_key_reused",
      }),
    );
    expect(await db.select().from(schema.idempotencyKey)).toHaveLength(1);
  });

  it("includes expedite state in work-item creation idempotency", async () => {
    const key = "00000000-0000-4000-8000-000000000082";
    const options = { idempotencyKey: key };
    await repository.createWorkItem(
      {
        id: "urgent",
        title: "Urgent work",
        expedited: true,
        expediteReason: "Restore production.",
      },
      options,
    );

    await expect(
      repository.createWorkItem(
        { id: "urgent", title: "Urgent work" },
        options,
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "idempotency_key_reused",
      }),
    );
  });

  it("derives readiness from persisted hierarchy, dependencies, and lifecycle", async () => {
    await repository.createWorkItem({ id: "parent", title: "Parent" });
    await repository.createWorkItem({
      id: "child",
      title: "Child",
      parentId: "parent",
    });
    await repository.createWorkItem({ id: "blocker", title: "Blocker" });
    await repository.addDependency(dependency("parent", "blocker"));

    const blocked = await repository.listWorkItems();
    expect(blocked.find(({ id }) => id === "parent")?.stage).toBe("blocked");
    expect(blocked.find(({ id }) => id === "child")?.stage).toBe("blocked");

    await repository.releaseWorkItem("child", completionEvidence);
    await repository.cancelWorkItem("blocker");

    const ready = await repository.getWorkItem("parent");
    expect(ready).toEqual(
      expect.objectContaining({
        id: "parent",
        lifecycle: "open",
        stage: "ready",
        currentLease: null,
      }),
    );
    expect((await repository.load()).dependencies).toEqual([
      dependency("parent", "blocker"),
    ]);
  });

  it("records explicit terminal changes once", async () => {
    await repository.createWorkItem({ id: "released", title: "Released" });
    await repository.createWorkItem({ id: "cancelled", title: "Cancelled" });

    await repository.releaseWorkItem("released", completionEvidence);
    await repository.cancelWorkItem("cancelled");

    const graph = await repository.load();
    expect(projectWorkItemStage(graph, "released")).toBe("released");
    expect(projectWorkItemStage(graph, "cancelled")).toBe("cancelled");
    await expect(repository.cancelWorkItem("released")).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "work_item_already_terminal",
      }),
    );
  });

  it("reparents work without replacing its identity or lifecycle", async () => {
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
    await repository.releaseWorkItem("work", completionEvidence);

    await repository.reparentWorkItem("work", "new-parent");

    expect(
      (await repository.load()).workItems.find(({ id }) => id === "work"),
    ).toEqual({
      id: "work",
      title: "Stable work",
      lifecycle: "released",
      parentId: "new-parent",
      rank: null,
      priorityRank: null,
      schedulingInitiativeId: null,
      schedulingProjectId: null,
      expedited: false,
      expediteReason: null,
    });
  });

  it("rolls back a work item whose parent does not exist", async () => {
    await expect(
      repository.createWorkItem({
        id: "orphan",
        title: "Orphan",
        parentId: "missing",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "work_item_not_found",
      }),
    );

    expect((await repository.load()).workItems).toEqual([]);
  });

  it("preserves domain errors across database transactions", async () => {
    await repository.createWorkItem({ id: "existing", title: "Existing" });

    await expect(
      repository.createWorkItem({ id: "existing", title: "Duplicate" }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "duplicate_work_item",
      }),
    );
    await expect(
      repository.createWorkItem(
        { id: "invalid-key", title: "Invalid key" },
        { idempotencyKey: "not-a-uuid" },
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "invalid_idempotency_key",
      }),
    );
    await expect(repository.reparentWorkItem("", null)).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "invalid_work_item_id",
      }),
    );
    await expect(
      repository.reparentWorkItem("existing", ""),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "invalid_parent_id",
      }),
    );
    await expect(
      repository.releaseWorkItem("missing", completionEvidence),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "work_item_not_found",
      }),
    );
    await expect(repository.getWorkItem("missing")).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "work_item_not_found",
      }),
    );
    await expect(
      repository.addDependency(dependency("existing", "missing")),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "work_item_not_found",
      }),
    );
  });
});

describe("atomic graph mutations", () => {
  const createThreeItems = async (): Promise<void> => {
    await repository.createWorkItem({ id: "a", title: "A" });
    await repository.createWorkItem({ id: "b", title: "B" });
    await repository.createWorkItem({ id: "c", title: "C" });
  };

  it("rejects hierarchy cycles and leaves the previous parent intact", async () => {
    await repository.createWorkItem({ id: "parent", title: "Parent" });
    await repository.createWorkItem({
      id: "child",
      title: "Child",
      parentId: "parent",
    });

    await expect(
      repository.reparentWorkItem("parent", "child"),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({ code: "graph_cycle" }),
    );

    const graph = await repository.load();
    expect(graph.workItems.find(({ id }) => id === "parent")?.parentId).toBe(
      null,
    );
    expect(graph.workItems.find(({ id }) => id === "child")?.parentId).toBe(
      "parent",
    );
  });

  it("rejects direct constraint violations with domain errors", async () => {
    await repository.createWorkItem({ id: "a", title: "A" });
    await repository.createWorkItem({ id: "b", title: "B" });

    await expect(repository.reparentWorkItem("a", "a")).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({ code: "graph_cycle" }),
    );
    await expect(
      repository.addDependency(dependency("a", "a")),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "self_dependency",
      }),
    );

    const edge = dependency("a", "b");
    await repository.addDependency(edge);
    await expect(repository.addDependency(edge)).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "dependency_already_exists",
      }),
    );
  });

  it("can move a child back to the graph root", async () => {
    await repository.createWorkItem({ id: "parent", title: "Parent" });
    await repository.createWorkItem({
      id: "child",
      title: "Child",
      parentId: "parent",
    });

    await repository.reparentWorkItem("child", null);

    expect(
      (await repository.load()).workItems.find(({ id }) => id === "child")
        ?.parentId,
    ).toBeNull();
  });

  it("replays reparenting with the same mutation key", async () => {
    await repository.createWorkItem({ id: "parent", title: "Parent" });
    await repository.createWorkItem({ id: "child", title: "Child" });
    const options = {
      idempotencyKey: "00000000-0000-4000-8000-000000000084",
    };

    await repository.reparentWorkItem("child", "parent", options);
    await repository.reparentWorkItem("child", "parent", options);

    expect(
      (await repository.load()).workItems.find(({ id }) => id === "child")
        ?.parentId,
    ).toBe("parent");
    expect(
      (await repository.listEvents({ workItemId: "child" })).filter(
        ({ type }) => type === "work_item.reparented",
      ),
    ).toHaveLength(1);
  });

  it("rejects reusing a reparent mutation key for a different parent", async () => {
    await repository.createWorkItem({ id: "first", title: "First" });
    await repository.createWorkItem({ id: "second", title: "Second" });
    await repository.createWorkItem({ id: "child", title: "Child" });
    const options = {
      idempotencyKey: "00000000-0000-4000-8000-000000000085",
    };

    await repository.reparentWorkItem("child", "first", options);
    await expect(
      repository.reparentWorkItem("child", "second", options),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "idempotency_key_reused",
      }),
    );
  });

  it("fails closed when the graph-mutation lock is missing", async () => {
    await repository.createWorkItem({ id: "a", title: "A" });
    await repository.createWorkItem({ id: "b", title: "B" });
    await db
      .delete(schema.graphMutationLock)
      .where(eq(schema.graphMutationLock.id, "global"));

    try {
      await expect(
        repository.addDependency(dependency("a", "b")),
      ).rejects.toThrow("The global graph mutation lock row is missing.");
      expect((await repository.load()).dependencies).toEqual([]);
    } finally {
      await db.insert(schema.graphMutationLock).values({ id: "global" });
    }
  });

  it("rejects direct and transitive dependency cycles atomically", async () => {
    await createThreeItems();
    await repository.addDependency(dependency("a", "b"));
    await repository.addDependency(dependency("b", "c"));

    await expect(
      repository.addDependency(dependency("c", "a")),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({ code: "graph_cycle" }),
    );

    expect((await repository.load()).dependencies).toEqual([
      dependency("a", "b"),
      dependency("b", "c"),
    ]);
  });

  it("replays dependency additions and removals with separate mutation keys", async () => {
    await repository.createWorkItem({ id: "a", title: "A" });
    await repository.createWorkItem({ id: "b", title: "B" });
    const edge = dependency("a", "b");
    const addOptions = {
      idempotencyKey: "00000000-0000-4000-8000-000000000082",
    };
    const removeOptions = {
      idempotencyKey: "00000000-0000-4000-8000-000000000083",
    };

    await repository.addDependency(edge, addOptions);
    await repository.addDependency(edge, addOptions);
    expect((await repository.load()).dependencies).toEqual([edge]);

    await expect(
      repository.removeDependency(edge, addOptions),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "idempotency_key_reused",
      }),
    );
    await repository.removeDependency(edge, removeOptions);
    await repository.removeDependency(edge, removeOptions);

    expect((await repository.load()).dependencies).toEqual([]);
    expect(await db.select().from(schema.idempotencyKey)).toHaveLength(2);
  });

  it.each([
    ["child depending on its parent", "child", "parent"],
    ["parent depending on its descendant", "parent", "child"],
  ])("rejects a %s in the combined waits-for graph", async (_name, from, to) => {
    await repository.createWorkItem({ id: "parent", title: "Parent" });
    await repository.createWorkItem({
      id: "child",
      title: "Child",
      parentId: "parent",
    });

    await expect(
      repository.addDependency(dependency(from, to)),
    ).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({ code: "graph_cycle" }),
    );
    expect((await repository.load()).dependencies).toEqual([]);
  });

  it("serializes concurrent hierarchy and dependency edits", async () => {
    await repository.createWorkItem({ id: "parent", title: "Parent" });
    await repository.createWorkItem({ id: "child", title: "Child" });

    const results = await Promise.allSettled([
      repository.reparentWorkItem("child", "parent"),
      repository.addDependency(dependency("child", "parent")),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    const [rejection] = results.filter(({ status }) => status === "rejected");
    if (!rejection) throw new Error("Expected one graph mutation to fail.");
    expectWorkGraphError(rejection, "graph_cycle");

    const graph = await repository.load();
    expect(() => projectWorkItemStage(graph, "parent")).not.toThrow();
    expect(
      graph.dependencies.length +
        graph.workItems.filter(({ parentId }) => parentId !== null).length,
    ).toBe(1);
  });

  it("removes dependencies without merging them into hierarchy", async () => {
    await createThreeItems();
    const edge = dependency("a", "b");
    await repository.addDependency(edge);
    await repository.reparentWorkItem("c", "a");

    await repository.removeDependency(edge);

    const graph = await repository.load();
    expect(graph.dependencies).toEqual([]);
    expect(graph.workItems.find(({ id }) => id === "c")?.parentId).toBe("a");
    await expect(repository.removeDependency(edge)).rejects.toEqual(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "dependency_not_found",
      }),
    );
  });
});

describe("immutable event history", () => {
  it("records graph changes once and lists them by work item and sequence", async () => {
    const createOptions = { idempotencyKey: recordId(901) };
    await repository.createWorkItem(
      { id: "parent", title: "Parent" },
      createOptions,
    );
    await repository.createWorkItem(
      { id: "parent", title: "Parent" },
      createOptions,
    );
    await repository.createWorkItem({
      id: "child",
      title: "Child",
      parentId: "parent",
    });
    await repository.reparentWorkItem("child", null);
    await repository.addDependency(dependency("child", "parent"));
    await repository.removeDependency(dependency("child", "parent"));

    const childEvents = await repository.listEvents({ workItemId: "child" });
    expect(childEvents.map(({ type }) => type)).toEqual([
      "work_item.created",
      "work_item.reparented",
      "dependency.added",
      "dependency.removed",
    ]);
    expect(childEvents[0]?.data).toEqual({
      title: "Child",
      parentId: "parent",
      rank: null,
      priorityRank: null,
      schedulingInitiativeId: null,
      schedulingProjectId: null,
    });

    const afterFirst = await repository.listEvents({
      afterSequence: childEvents[0]?.sequence,
      limit: 2,
    });
    expect(afterFirst).toHaveLength(2);
    expect(
      afterFirst.every(
        ({ sequence }) => sequence > (childEvents[0]?.sequence ?? 0),
      ),
    ).toBe(true);
    expect(
      (await repository.listEvents()).filter(
        ({ type, workItemId }) =>
          type === "work_item.created" && workItemId === "parent",
      ),
    ).toHaveLength(1);
  });

  it("keeps sequence cursors stable across concurrent transaction commits", async () => {
    const concurrentDb = createDb(databaseURL);
    let markFirstInsertComplete: () => void = () => undefined;
    const firstInsertComplete = new Promise<void>((resolve) => {
      markFirstInsertComplete = resolve;
    });
    let allowFirstCommit: () => void = () => undefined;
    const firstMayCommit = new Promise<void>((resolve) => {
      allowFirstCommit = resolve;
    });

    const firstTransaction = db.transaction(async (transaction) => {
      await transaction
        .insert(schema.event)
        .values({ type: "test.first", data: {} });
      markFirstInsertComplete();
      await firstMayCommit;
    });
    await firstInsertComplete;

    const secondTransaction = concurrentDb.transaction(async (transaction) => {
      await transaction
        .insert(schema.event)
        .values({ type: "test.second", data: {} });
    });

    try {
      await waitForDatabaseLock();
      await expect(repository.listEvents()).resolves.toEqual([]);
    } finally {
      allowFirstCommit();
      await Promise.all([firstTransaction, secondTransaction]);
      await closeDb(concurrentDb);
    }

    const storedEvents = await repository.listEvents();
    expect(storedEvents.map(({ type }) => type)).toEqual([
      "test.first",
      "test.second",
    ]);
    await expect(
      repository.listEvents({ afterSequence: storedEvents[0]?.sequence }),
    ).resolves.toEqual([storedEvents[1]]);
  });

  it("records lease, attention, and lifecycle changes", async () => {
    await repository.createWorkItem({ id: "work", title: "Work" });
    const firstLease = await repository.claimWorkItem({
      leaseId: recordId(910),
      workerId: "worker-a",
      leaseDurationSeconds: 300,
      workItemId: "work",
    });
    if (!firstLease) throw new Error("Expected the first claim to succeed.");
    await repository.renewLease({
      leaseId: firstLease.id,
      epoch: firstLease.epoch,
      leaseDurationSeconds: 600,
    });
    await repository.createAttentionRequest({
      id: recordId(911),
      workItemId: "work",
      leaseId: firstLease.id,
      epoch: firstLease.epoch,
      kind: "context",
      question: "Where is the brief?",
      blocking: false,
    });
    await repository.createAttentionRequest({
      id: recordId(912),
      workItemId: "work",
      leaseId: firstLease.id,
      epoch: firstLease.epoch,
      kind: "decision",
      question: "Ship this change?",
      blocking: true,
    });
    await repository.resolveAttentionRequest({
      id: recordId(913),
      attentionRequestId: recordId(912),
      resolution: "Ship it.",
    });
    const secondLease = await repository.claimWorkItem({
      leaseId: recordId(914),
      workerId: "worker-b",
      leaseDurationSeconds: 300,
      workItemId: "work",
    });
    if (!secondLease) throw new Error("Expected the second claim to succeed.");
    await repository.terminateClaimedWorkItem({
      leaseId: secondLease.id,
      epoch: secondLease.epoch,
      workItemId: "work",
      outcome: "released",
      ...completionEvidence,
    });

    const events = await repository.listEvents({ workItemId: "work" });
    expect(events.map(({ type }) => type)).toEqual([
      "work_item.created",
      "lease.claimed",
      "lease.renewed",
      "attention.requested",
      "attention.requested",
      "lease.ended",
      "attention.resolved",
      "lease.claimed",
      "lease.ended",
      "work_item.lifecycle_changed",
    ]);
    expect(events.at(-1)?.data).toEqual({
      from: "open",
      to: "released",
      ...completionEvidence,
    });
    expect(
      await repository.listEvents({
        workItemId: "work",
        type: "work_item.lifecycle_changed",
        lifecycle: "released",
        limit: 1,
      }),
    ).toEqual([events.at(-1)]);
    expect(
      await repository.listLeases({
        workItemId: "work",
        afterEpoch: firstLease.epoch,
        limit: 1,
      }),
    ).toEqual([expect.objectContaining({ id: secondLease.id, epoch: 2 })]);
  });

  it("records decomposition graph and lease changes in the same transaction", async () => {
    await repository.createWorkItem({ id: "parent", title: "Parent" });
    const parentLease = await repository.claimWorkItem({
      leaseId: recordId(920),
      workerId: "worker-a",
      leaseDurationSeconds: 300,
      workItemId: "parent",
    });
    if (!parentLease) throw new Error("Expected the parent claim to succeed.");
    await repository.decomposeClaimedWorkItem({
      leaseId: parentLease.id,
      epoch: parentLease.epoch,
      workItemId: "parent",
      children: [
        { id: "first", title: "First", rank: 1 },
        { id: "second", title: "Second", rank: 2 },
      ],
      dependencies: [dependency("second", "first")],
      claim: {
        workItemId: "first",
        leaseId: recordId(921),
        leaseDurationSeconds: 300,
      },
    });

    expect((await repository.listEvents()).map(({ type }) => type)).toEqual([
      "work_item.created",
      "lease.claimed",
      "work_item.created",
      "work_item.created",
      "dependency.added",
      "work_item.decomposed",
      "lease.ended",
      "lease.claimed",
    ]);
    expect(
      await repository.listDependencies({
        workItemId: "first",
        limit: 1,
      }),
    ).toEqual([dependency("second", "first")]);
  });

  it("rejects updates, deletes, and truncation at the database boundary", async () => {
    await repository.createWorkItem({ id: "work", title: "Work" });
    const [storedEvent] = await repository.listEvents();
    if (!storedEvent) throw new Error("Expected a creation event.");

    expect(
      (
        await rejectedDatabaseError(
          db
            .update(schema.event)
            .set({ type: "work_item.reparented" })
            .where(eq(schema.event.sequence, storedEvent.sequence)),
        )
      )?.code,
    ).toBe("55000");
    expect(
      (
        await rejectedDatabaseError(
          db
            .delete(schema.event)
            .where(eq(schema.event.sequence, storedEvent.sequence)),
        )
      )?.code,
    ).toBe("55000");
    expect(
      (
        await rejectedDatabaseError(
          db.execute(sql`truncate table ${schema.event}`),
        )
      )?.code,
    ).toBe("55000");
    await expect(repository.listEvents()).resolves.toEqual([storedEvent]);
  });
});
