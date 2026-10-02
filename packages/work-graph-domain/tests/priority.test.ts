import {
  createKnowledgeScope,
  createWorkGraph,
  getWorkItem,
  isWorkItemInSelectionScope,
  orderWorkItemsByPriority,
  projectWorkItemPriorities,
  projectWorkItemPriority,
  validateWorkGraph,
  WorkGraphError,
} from "../src/index";
import { priorityFixtures } from "./fixtures/priority";

const orderedIds = (
  fixture: (typeof priorityFixtures)[number],
): readonly string[] => {
  const graph = createWorkGraph(fixture.graph);
  const scopes = (fixture.scopes ?? []).map(createKnowledgeScope);
  return orderWorkItemsByPriority(graph, scopes).map(({ id }) => id);
};

describe("priority projection", () => {
  it.each(priorityFixtures)("$name", (fixture) => {
    expect(orderedIds(fixture)).toEqual(fixture.orderedIds);
  });

  it("inherits one ticket priority through decomposition without rewarding depth", () => {
    const graph = createWorkGraph({
      workItems: [
        { id: "ticket", title: "Ticket", priorityRank: 1_024 },
        { id: "child", title: "Child", parentId: "ticket", rank: 2 },
        { id: "grandchild", title: "Grandchild", parentId: "child", rank: 1 },
        { id: "other", title: "Other", priorityRank: 2_048 },
      ],
    });

    expect(projectWorkItemPriority(graph, "ticket").ticketRank).toBe(1);
    expect(projectWorkItemPriority(graph, "child").ticketRank).toBe(1);
    expect(projectWorkItemPriority(graph, "grandchild").ticketRank).toBe(1);
    expect(projectWorkItemPriority(graph, "other").ticketRank).toBe(2);
  });

  it("projects every work item from one priority state", () => {
    const graph = createWorkGraph(priorityFixtures[2]!.graph);
    const projections = projectWorkItemPriorities(graph);

    expect([...projections]).toEqual(
      graph.workItems.map((item) => [
        item.id,
        projectWorkItemPriority(graph, item.id),
      ]),
    );
  });

  it("preserves relative order when a queue is filtered", () => {
    const fixture = priorityFixtures[1]!;
    const graph = createWorkGraph(fixture.graph);
    const includedIds = new Set(["database", "release-ui", "chores"]);
    const filtered = orderWorkItemsByPriority(graph).filter(({ id }) =>
      includedIds.has(id),
    );

    expect(filtered.map(({ id }) => id)).toEqual([
      "database",
      "release-ui",
      "chores",
    ]);
  });

  it("matches inherited initiative and project scopes plus direct parents", () => {
    const graph = createWorkGraph({
      workItems: [
        {
          id: "ticket",
          title: "Ticket",
          priorityRank: 1_024,
          schedulingInitiativeId: "initiative-a",
          schedulingProjectId: "project-a",
        },
        { id: "child", title: "Child", parentId: "ticket", rank: 1 },
        { id: "grandchild", title: "Grandchild", parentId: "child", rank: 1 },
      ],
    });
    const child = graph.workItems.find(({ id }) => id === "child")!;
    const grandchild = graph.workItems.find(({ id }) => id === "grandchild")!;

    expect(
      isWorkItemInSelectionScope(graph, child, {
        initiativeId: "initiative-a",
        projectId: "project-a",
        parentId: "ticket",
      }),
    ).toBe(true);
    expect(
      isWorkItemInSelectionScope(graph, grandchild, {
        projectId: "project-a",
        parentId: "ticket",
      }),
    ).toBe(false);
  });

  it("combines inclusion dimensions and gives exclusions precedence", () => {
    const graph = createWorkGraph({
      workItems: [
        {
          id: "ticket-a",
          title: "Ticket A",
          priorityRank: 1_024,
          schedulingInitiativeId: "initiative-a",
          schedulingProjectId: "project-a",
        },
        {
          id: "ticket-b",
          title: "Ticket B",
          priorityRank: 1_024,
          schedulingInitiativeId: "initiative-a",
          schedulingProjectId: "project-b",
        },
        { id: "unscoped", title: "Unscoped", priorityRank: 1_024 },
      ],
    });
    const ticketA = getWorkItem(graph, "ticket-a");
    const ticketB = getWorkItem(graph, "ticket-b");
    const unscoped = getWorkItem(graph, "unscoped");
    const scope = {
      includeInitiativeIds: ["initiative-a", "initiative-b"],
      includeProjectIds: ["project-a", "project-b"],
      excludeProjectIds: ["project-b"],
    };

    expect(isWorkItemInSelectionScope(graph, ticketA, scope)).toBe(true);
    expect(isWorkItemInSelectionScope(graph, ticketB, scope)).toBe(false);
    expect(isWorkItemInSelectionScope(graph, unscoped, scope)).toBe(false);
    expect(
      isWorkItemInSelectionScope(graph, unscoped, {
        includeInitiativeIds: [],
        includeProjectIds: [],
      }),
    ).toBe(true);
  });

  it("matches titles case-insensitively across a ticket lineage and gives exclusions precedence", () => {
    const graph = createWorkGraph({
      workItems: [
        { id: "outcome", title: "Ship Work Graph", priorityRank: 1_024 },
        { id: "api", title: "Build API", parentId: "outcome", rank: 1 },
        { id: "cli", title: "Build CLI", parentId: "outcome", rank: 2 },
        { id: "leaf", title: "Add filters", parentId: "cli", rank: 1 },
      ],
    });

    expect(
      isWorkItemInSelectionScope(graph, getWorkItem(graph, "leaf"), {
        includeParentTitles: ["Ship Work Graph"],
      }),
    ).toBe(true);
    expect(
      isWorkItemInSelectionScope(graph, getWorkItem(graph, "outcome"), {
        includeParentTitles: ["Ship Work Graph"],
      }),
    ).toBe(true);
    expect(
      isWorkItemInSelectionScope(graph, getWorkItem(graph, "api"), {
        includeParentTitles: ["Ship Work Graph"],
        excludeParentTitles: ["Build API"],
      }),
    ).toBe(false);
    expect(
      isWorkItemInSelectionScope(graph, getWorkItem(graph, "leaf"), {
        includeParentTitles: ["ship work graph"],
      }),
    ).toBe(true);
    expect(
      isWorkItemInSelectionScope(graph, getWorkItem(graph, "leaf"), {
        includeParentTitles: ["Ship Work"],
      }),
    ).toBe(false);
  });

  it("treats singular scope fields as one-element inclusion aliases", () => {
    const graph = createWorkGraph({
      workItems: [
        {
          id: "ticket",
          title: "Ticket",
          priorityRank: 1_024,
          schedulingInitiativeId: "initiative",
          schedulingProjectId: "project",
        },
      ],
    });
    const ticket = getWorkItem(graph, "ticket");

    expect(
      isWorkItemInSelectionScope(graph, ticket, {
        initiativeId: "initiative",
        projectId: "project",
      }),
    ).toBe(true);
    expect(
      isWorkItemInSelectionScope(graph, ticket, {
        projectId: "project",
        excludeProjectIds: ["project"],
      }),
    ).toBe(false);
  });

  it("does not reorder existing work when a ticket is added at the bottom", () => {
    const existing = createWorkGraph({
      workItems: [
        { id: "first", title: "First", priorityRank: 1_024 },
        { id: "second", title: "Second", priorityRank: 2_048 },
        { id: "third", title: "Third", priorityRank: 3_072 },
      ],
    });
    const withBacklog = createWorkGraph({
      workItems: [
        ...existing.workItems,
        { id: "backlog", title: "Backlog", priorityRank: 4_096 },
      ],
    });

    expect(orderWorkItemsByPriority(existing).map(({ id }) => id)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(orderWorkItemsByPriority(withBacklog).map(({ id }) => id)).toEqual([
      "first",
      "second",
      "third",
      "backlog",
    ]);
  });

  it("reports donated urgency without changing stored expedite state", () => {
    const graph = createWorkGraph(priorityFixtures[2]!.graph);

    expect(projectWorkItemPriority(graph, "shared")).toMatchObject({
      donatedFromWorkItemId: "urgent",
      effectiveExpedited: true,
      expedited: false,
    });
  });

  it("rejects invalid priority ranks and inconsistent expedite state", () => {
    expect(() =>
      createWorkGraph({
        workItems: [{ id: "work", title: "Work", priorityRank: 0 }],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "invalid_priority_rank",
      }),
    );

    expect(() =>
      createWorkGraph({
        workItems: [{ id: "work", title: "Work", expedited: true }],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "invalid_expedite_reason",
      }),
    );

    expect(() =>
      createWorkGraph({
        workItems: [
          { id: "ticket", title: "Ticket", priorityRank: 1_024 },
          {
            id: "child",
            title: "Child",
            parentId: "ticket",
            schedulingProjectId: "project",
          },
        ],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "invalid_scheduling_scope",
      }),
    );

    const graph = createWorkGraph({
      workItems: [{ id: "work", title: "Work" }],
    });
    expect(() =>
      validateWorkGraph({
        ...graph,
        workItems: [
          {
            ...graph.workItems[0]!,
            expedited: true,
            expediteReason: 42 as unknown as string,
          },
        ],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "invalid_expedite_reason",
      }),
    );
  });
});
