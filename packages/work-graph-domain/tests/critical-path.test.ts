import {
  createKnowledgeScope,
  createWorkGraph,
  projectCriticalPath,
  type WorkGraph,
  WorkGraphError,
} from "../src/index";

const NOW = 10_000;

describe("delivery-critical path projection", () => {
  it("projects a ready root as its own outcome, path, leaf, and branch", () => {
    const graph = createWorkGraph({
      workItems: [{ id: "outcome", title: "Ship the outcome" }],
    });

    expect(projectCriticalPath(graph, { now: NOW })).toEqual({
      targetOutcomeIds: ["outcome"],
      nodes: [
        expect.objectContaining({
          item: expect.objectContaining({ id: "outcome" }),
          stage: "ready",
          claimable: true,
          inclusionReasons: [{ kind: "target_outcome" }],
        }),
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
  });

  it("walks nested decomposition and exposes independent ready branches", () => {
    const graph = createWorkGraph({
      workItems: [
        { id: "outcome", title: "Outcome", priorityRank: 1_024 },
        {
          id: "service",
          title: "Service",
          parentId: "outcome",
          rank: 1,
        },
        {
          id: "schema",
          title: "Schema",
          parentId: "service",
          rank: 1,
        },
        {
          id: "interface",
          title: "Interface",
          parentId: "outcome",
          rank: 2,
        },
      ],
    });

    const projection = projectCriticalPath(graph, { now: NOW });

    expect(projection.edges).toEqual([
      {
        kind: "decomposition",
        fromWorkItemId: "outcome",
        toWorkItemId: "service",
      },
      {
        kind: "decomposition",
        fromWorkItemId: "outcome",
        toWorkItemId: "interface",
      },
      {
        kind: "decomposition",
        fromWorkItemId: "service",
        toWorkItemId: "schema",
      },
    ]);
    expect(projection.blockingPaths).toEqual([
      ["outcome", "service", "schema"],
      ["outcome", "interface"],
    ]);
    expect(projection.readyLeafIds).toEqual(["schema", "interface"]);
    expect(
      projection.parallelBranches.map(({ workItemId }) => workItemId),
    ).toEqual(["schema", "interface"]);
  });

  it("aborts blocking-path enumeration before returning a partial graph", () => {
    const graph = createWorkGraph({
      workItems: [
        { id: "outcome", title: "Outcome" },
        { id: "first", title: "First", parentId: "outcome", rank: 1 },
        { id: "second", title: "Second", parentId: "outcome", rank: 2 },
      ],
    });

    expect(() =>
      projectCriticalPath(graph, { now: NOW, maxBlockingPaths: 1 }),
    ).toThrowError(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "critical_path_projection_too_large",
      }),
    );
  });

  it("rejects an oversized path without recursive traversal", () => {
    const graph = createWorkGraph({
      workItems: [
        { id: "outcome", title: "Outcome" },
        { id: "middle", title: "Middle", parentId: "outcome" },
        { id: "leaf", title: "Leaf", parentId: "middle" },
      ],
    });

    expect(() =>
      projectCriticalPath(graph, {
        now: NOW,
        maxBlockingPathLength: 2,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "critical_path_projection_too_large",
      }),
    );
  });

  it("preserves every dependency path to one shared blocker", () => {
    const graph = createWorkGraph({
      workItems: [
        { id: "outcome", title: "Outcome", priorityRank: 1_024 },
        { id: "api", title: "API", parentId: "outcome", rank: 1 },
        { id: "cli", title: "CLI", parentId: "outcome", rank: 2 },
        { id: "migration", title: "Migration", priorityRank: 2_048 },
        { id: "database", title: "Database", priorityRank: 3_072 },
      ],
      dependencies: [
        { dependentWorkItemId: "api", blockerWorkItemId: "migration" },
        { dependentWorkItemId: "cli", blockerWorkItemId: "migration" },
        {
          dependentWorkItemId: "migration",
          blockerWorkItemId: "database",
        },
      ],
    });

    const projection = projectCriticalPath(graph, {
      now: NOW,
      targetWorkItemIds: ["outcome"],
    });

    expect(projection.nodes.map(({ item }) => item.id)).toEqual([
      "outcome",
      "api",
      "migration",
      "database",
      "cli",
    ]);
    expect(
      projection.nodes.find(({ item }) => item.id === "migration")
        ?.inclusionReasons,
    ).toEqual([
      {
        kind: "dependency_blocker",
        fromWorkItemId: "api",
        dependencyDeclaredByWorkItemId: "api",
      },
      {
        kind: "dependency_blocker",
        fromWorkItemId: "cli",
        dependencyDeclaredByWorkItemId: "cli",
      },
    ]);
    expect(projection.blockingPaths).toEqual([
      ["outcome", "api", "migration", "database"],
      ["outcome", "cli", "migration", "database"],
    ]);
    expect(projection.parallelBranches).toEqual([
      expect.objectContaining({
        workItemId: "database",
        targetWorkItemIds: ["outcome"],
        paths: [
          ["outcome", "api", "migration", "database"],
          ["outcome", "cli", "migration", "database"],
        ],
      }),
    ]);
  });

  it("projects active and stale leases plus blocking attention from one snapshot", () => {
    const graph = createWorkGraph({
      workItems: [
        { id: "outcome", title: "Outcome" },
        { id: "active", title: "Active", parentId: "outcome", rank: 1 },
        { id: "stale", title: "Stale", parentId: "outcome", rank: 2 },
        {
          id: "attention",
          title: "Attention",
          parentId: "outcome",
          rank: 3,
        },
      ],
    });

    const projection = projectCriticalPath(graph, {
      now: NOW,
      operationalStateByWorkItemId: {
        active: { currentLease: { expiresAt: NOW + 1 } },
        stale: { currentLease: { expiresAt: NOW } },
        attention: { hasUnresolvedBlockingAttention: true },
      },
    });
    const states = Object.fromEntries(
      projection.nodes.map(({ item, stage, claimable }) => [
        item.id,
        { stage, claimable },
      ]),
    );

    expect(states).toMatchObject({
      active: { stage: "in_progress", claimable: false },
      stale: { stage: "stale", claimable: true },
      attention: { stage: "needs_attention", claimable: false },
    });
    expect(projection.readyLeafIds).toEqual([]);
    expect(projection.blockingAttentionIds).toEqual(["attention"]);
    expect(projection.parallelBranches).toEqual([
      expect.objectContaining({ workItemId: "stale", stage: "stale" }),
    ]);
  });

  it.each(["released", "cancelled"] as const)(
    "treats a %s dependency as satisfied",
    (lifecycle) => {
      const graph = createWorkGraph({
        workItems: [
          { id: "outcome", title: "Outcome" },
          { id: "finished", title: "Finished", lifecycle },
        ],
        dependencies: [
          {
            dependentWorkItemId: "outcome",
            blockerWorkItemId: "finished",
          },
        ],
      });

      const projection = projectCriticalPath(graph, { now: NOW });

      expect(projection.nodes.map(({ item }) => item.id)).toEqual(["outcome"]);
      expect(projection.edges).toEqual([]);
      expect(projection.readyLeafIds).toEqual(["outcome"]);
    },
  );

  it("orders and filters target roots with effective priority", () => {
    const scopes = [
      createKnowledgeScope({
        id: "initiative",
        kind: "initiative",
        title: "Initiative",
        canonicalUrl: "https://example.test/initiatives/initiative",
        markdownUrl: "https://example.test/initiatives/initiative.md",
        rank: 1_024,
      }),
      createKnowledgeScope({
        id: "project-a",
        kind: "project",
        title: "Project A",
        canonicalUrl: "https://example.test/projects/a",
        markdownUrl: "https://example.test/projects/a.md",
        rank: 1_024,
      }),
      createKnowledgeScope({
        id: "project-b",
        kind: "project",
        title: "Project B",
        canonicalUrl: "https://example.test/projects/b",
        markdownUrl: "https://example.test/projects/b.md",
        rank: 2_048,
      }),
    ];
    const graph = createWorkGraph({
      workItems: [
        {
          id: "later",
          title: "Later",
          priorityRank: 2_048,
          schedulingInitiativeId: "initiative",
          schedulingProjectId: "project-a",
        },
        {
          id: "first",
          title: "First",
          priorityRank: 1_024,
          schedulingInitiativeId: "initiative",
          schedulingProjectId: "project-a",
        },
        {
          id: "other-project",
          title: "Other project",
          priorityRank: 1_024,
          schedulingInitiativeId: "initiative",
          schedulingProjectId: "project-b",
        },
      ],
    });

    expect(
      projectCriticalPath(graph, {
        now: NOW,
        knowledgeScopes: scopes,
        selectionScope: { projectId: "project-a" },
      }).targetOutcomeIds,
    ).toEqual(["first", "later"]);
  });

  it("uses identifiers to break otherwise equal priority ties", () => {
    const graph = createWorkGraph({
      workItems: [
        { id: "zebra", title: "Zebra" },
        { id: "alpha", title: "Alpha" },
      ],
    });

    expect(
      projectCriticalPath(graph, { now: NOW }).targetOutcomeIds,
    ).toEqual(["alpha", "zebra"]);
  });

  it("rejects a cyclic fixture even when it bypasses graph construction", () => {
    const valid = createWorkGraph({
      workItems: [
        { id: "a", title: "A" },
        { id: "b", title: "B" },
      ],
    });
    const cyclic = {
      ...valid,
      dependencies: [
        { dependentWorkItemId: "a", blockerWorkItemId: "b" },
        { dependentWorkItemId: "b", blockerWorkItemId: "a" },
      ],
    } satisfies WorkGraph;

    expect(() => projectCriticalPath(cyclic, { now: NOW })).toThrowError(
      expect.objectContaining<Partial<WorkGraphError>>({ code: "graph_cycle" }),
    );
  });
});
