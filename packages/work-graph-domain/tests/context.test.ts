import {
  createKnowledgeScope,
  createWorkGraph,
  projectWorkItemStage,
  resolveWorkItemContext,
  type WorkGraphInput,
  WorkGraphError,
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
  it("links one pull request to several work items with explicit roles", () => {
    const graph = createWorkGraph({
      workItems: [
        { id: "implementation", title: "Implement it" },
        { id: "verification", title: "Verify it" },
      ],
      pullRequests: [
        {
          repository: "Example/Work-Graph",
          number: 42,
          url: "https://github.com/example/work-graph/pull/42",
          headSha: "0123456789abcdef0123456789abcdef01234567",
          state: "open",
          draft: false,
          mergeability: "mergeable",
          reviewDecision: "approved",
          checkSummary: "success",
          observedAt: "2026-09-20T10:00:00Z",
        },
      ],
      workItemPullRequests: [
        {
          workItemId: "implementation",
          repository: "example/work-graph",
          number: 42,
          role: "implementation",
        },
        {
          workItemId: "verification",
          repository: "example/work-graph",
          number: 42,
          role: "evidence",
        },
      ],
    });

    expect(resolveWorkItemContext(graph, "implementation")).toContainEqual(
      expect.objectContaining({
        kind: "pull_request",
        role: "implementation",
      }),
    );
    expect(resolveWorkItemContext(graph, "verification")).toContainEqual(
      expect.objectContaining({ kind: "pull_request", role: "evidence" }),
    );
  });

  it("allows several pull requests to provide context for one work item", () => {
    const snapshot = {
      repository: "example/work-graph",
      url: "https://github.com/example/work-graph/pull/1",
      headSha: "0123456789abcdef0123456789abcdef01234567",
      state: "open" as const,
      draft: false,
      mergeability: "unknown" as const,
      reviewDecision: null,
      checkSummary: "pending" as const,
      observedAt: "2026-09-20T10:00:00.000Z",
    };
    const graph = createWorkGraph({
      workItems: [{ id: "work", title: "Work" }],
      pullRequests: [
        { ...snapshot, number: 1 },
        {
          ...snapshot,
          number: 2,
          url: "https://github.com/example/work-graph/pull/2",
        },
      ],
      workItemPullRequests: [
        {
          workItemId: "work",
          repository: snapshot.repository,
          number: 1,
          role: "implementation",
        },
        {
          workItemId: "work",
          repository: snapshot.repository,
          number: 2,
          role: "related",
        },
      ],
    });

    expect(
      resolveWorkItemContext(graph, "work")
        .filter((context) => context.kind === "pull_request")
        .map(({ pullRequest, role }) => [pullRequest.number, role]),
    ).toEqual([
      [1, "implementation"],
      [2, "related"],
    ]);
  });

  it("does not treat a linked pull request as a dependency edge", () => {
    const withoutPullRequest = createWorkGraph({
      workItems: [{ id: "work", title: "Work" }],
    });
    const withPullRequest = createWorkGraph({
      workItems: [{ id: "work", title: "Work" }],
      pullRequests: [
        {
          repository: "example/work-graph",
          number: 42,
          url: "https://github.com/example/work-graph/pull/42",
          headSha: "0123456789abcdef0123456789abcdef01234567",
          state: "open",
          draft: true,
          mergeability: "conflicting",
          reviewDecision: "changes_requested",
          checkSummary: "failure",
          observedAt: "2026-09-20T10:00:00.000Z",
        },
      ],
      workItemPullRequests: [
        {
          workItemId: "work",
          repository: "example/work-graph",
          number: 42,
          role: "implementation",
        },
      ],
    });

    expect(projectWorkItemStage(withPullRequest, "work")).toBe(
      projectWorkItemStage(withoutPullRequest, "work"),
    );
  });
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

  it.each([
    [
      {
        contexts: [
          { workItemId: "work", kind: "brief", content: " " },
        ],
      },
      "invalid_context_content",
    ],
    [
      {
        contexts: [
          { workItemId: "work", kind: "summary", content: "Summary" },
        ],
      },
      "invalid_context_kind",
    ],
    [
      {
        contexts: [
          { workItemId: "work", kind: "brief", content: "First" },
          { workItemId: "work", kind: "brief", content: "Second" },
        ],
      },
      "duplicate_context",
    ],
    [
      {
        architectureDecisions: [
          {
            workItemId: "work",
            title: " ",
            url: "https://example.test/adrs/1",
            role: "governing",
          },
        ],
      },
      "invalid_architecture_decision_title",
    ],
    [
      {
        architectureDecisions: [
          {
            workItemId: "work",
            title: "Decision",
            url: "https://example.test/adrs/1",
            role: "advisory",
          },
        ],
      },
      "invalid_architecture_decision_role",
    ],
    [
      {
        architectureDecisions: [
          {
            workItemId: "work",
            title: "First",
            url: "https://example.test/adrs/1",
            role: "governing",
          },
          {
            workItemId: "work",
            title: "Second",
            url: "https://example.test/adrs/1",
            role: "background",
          },
        ],
      },
      "duplicate_architecture_decision",
    ],
    [
      {
        references: [
          {
            workItemId: "work",
            title: "Reference",
            url: "not-a-url",
          },
        ],
      },
      "invalid_context_url",
    ],
    [
      {
        references: [
          {
            workItemId: "work",
            title: " ",
            url: "https://example.test/reference",
          },
        ],
      },
      "invalid_reference_title",
    ],
    [
      {
        references: [
          {
            workItemId: "work",
            title: "First",
            url: "https://example.test/reference",
          },
          {
            workItemId: "work",
            title: "Second",
            url: "https://example.test/reference",
          },
        ],
      },
      "duplicate_reference",
    ],
  ] as const)("rejects malformed context records with %s", (records, code) => {
    expect(() =>
      createWorkGraph({
        workItems: [{ id: "work", title: "Work" }],
        ...(records as unknown as Partial<WorkGraphInput>),
      }),
    ).toThrowError(expect.objectContaining<Partial<WorkGraphError>>({ code }));
  });

  it("rejects context for an unknown work item", () => {
    expect(() =>
      createWorkGraph({
        workItems: [{ id: "work", title: "Work" }],
        contexts: [
          { workItemId: "missing", kind: "brief", content: "Missing" },
        ],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "work_item_not_found",
      }),
    );
  });
  it.todo("filters work by semantic fields without arbitrary labels");
});
