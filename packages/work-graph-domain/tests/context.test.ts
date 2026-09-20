import {
  createKnowledgeScope,
  createWorkGraph,
  projectWorkItemStage,
  resolveWorkItemContext,
} from "../src/index";

describe("work-item context", () => {
  it("accepts a work item with only a title", () => {
    const graph = createWorkGraph({
      workItems: [{ id: "work", title: "Sparse work" }],
    });

    expect(graph.workItems).toEqual([
      {
        id: "work",
        title: "Sparse work",
        lifecycle: "open",
        parentId: null,
        priorityRank: null,
        schedulingInitiativeId: null,
        schedulingProjectId: null,
        expedited: false,
        expediteReason: null,
        rank: null,
      },
    ]);
  });
  it("keeps briefs and acceptance criteria optional", () => {
    const graph = createWorkGraph({
      workItems: [{ id: "work", title: "Sparse work" }],
      contexts: [
        { workItemId: "work", kind: "brief", content: "Do the work." },
      ],
    });

    expect(resolveWorkItemContext(graph, "work")).toEqual([
      {
        kind: "brief",
        content: "Do the work.",
        sourceWorkItemId: "work",
        inheritanceDepth: 0,
      },
    ]);
  });

  it("orders only the available context in a claim response", () => {
    const graph = createWorkGraph({
      workItems: [
        {
          id: "work",
          title: "Work",
          schedulingInitiativeId: "initiative",
          schedulingProjectId: "project",
          priorityRank: 1,
        },
      ],
      contexts: [
        {
          workItemId: "work",
          kind: "acceptance_criteria",
          content: "The tests pass.",
        },
        { workItemId: "work", kind: "brief", content: "Implement it." },
      ],
      architectureDecisions: [
        {
          workItemId: "work",
          title: "Background decision",
          url: "https://example.test/adrs/background",
          role: "background",
        },
        {
          workItemId: "work",
          title: "Governing decision",
          url: "https://example.test/adrs/governing",
          role: "governing",
        },
      ],
      references: [
        {
          workItemId: "work",
          title: "Issue",
          url: "https://example.test/issues/1",
        },
      ],
    });
    const scopes = [
      createKnowledgeScope({
        id: "initiative",
        kind: "initiative",
        title: "Initiative",
        canonicalUrl: "https://example.test/initiatives/one",
        markdownUrl: "https://example.test/initiatives/one.md",
      }),
      createKnowledgeScope({
        id: "project",
        kind: "project",
        title: "Project",
        canonicalUrl: "https://example.test/projects/one",
        markdownUrl: "https://example.test/projects/one.md",
      }),
    ];

    expect(
      resolveWorkItemContext(graph, "work", scopes).map((context) =>
        context.kind === "architecture_decision"
          ? `${context.kind}:${context.role}`
          : context.kind,
      ),
    ).toEqual([
      "brief",
      "acceptance_criteria",
      "architecture_decision:governing",
      "architecture_decision:background",
      "project",
      "initiative",
      "reference",
    ]);
  });

  it("presents the nearest parent context before more distant parent context", () => {
    const graph = createWorkGraph({
      workItems: [
        { id: "grandparent", title: "Grandparent" },
        { id: "parent", title: "Parent", parentId: "grandparent" },
        { id: "child", title: "Child", parentId: "parent" },
      ],
      contexts: [
        {
          workItemId: "grandparent",
          kind: "brief",
          content: "Grandparent brief",
        },
        {
          workItemId: "parent",
          kind: "acceptance_criteria",
          content: "Parent criteria",
        },
      ],
      references: [
        {
          workItemId: "grandparent",
          title: "Distant",
          url: "https://example.test/distant",
        },
        {
          workItemId: "parent",
          title: "Nearest",
          url: "https://example.test/nearest",
        },
      ],
    });

    expect(
      resolveWorkItemContext(graph, "child").map(
        ({ sourceWorkItemId }) => sourceWorkItemId,
      ),
    ).toEqual(["parent", "grandparent", "parent", "grandparent"]);
  });
  it.todo("keeps initiative and project mirrors separate from executable work");
  it("treats ADRs as governing or background knowledge context", () => {
    const graph = createWorkGraph({
      workItems: [{ id: "work", title: "Work" }],
      architectureDecisions: [
        {
          workItemId: "work",
          title: "Decision",
          url: "https://example.test/adrs/1",
          role: "governing",
        },
      ],
    });

    expect(resolveWorkItemContext(graph, "work")).toContainEqual(
      expect.objectContaining({
        kind: "architecture_decision",
        role: "governing",
      }),
    );
  });
  it.todo("links one pull request to several work items with explicit roles");
  it.todo("allows several pull requests to provide context for one work item");
  it.todo("does not treat a linked pull request as a dependency edge");
  it("keeps supplemental references free of scheduling semantics", () => {
    const withoutReference = createWorkGraph({
      workItems: [{ id: "work", title: "Work" }],
    });
    const withReference = createWorkGraph({
      workItems: [{ id: "work", title: "Work" }],
      references: [
        {
          workItemId: "work",
          title: "Background reading",
          url: "https://example.test/background",
        },
      ],
    });

    expect(projectWorkItemStage(withReference, "work")).toBe(
      projectWorkItemStage(withoutReference, "work"),
    );
  });
  it.todo("filters work by semantic fields without arbitrary labels");
});
