import {
  addDependency,
  addWorkItem,
  createWorkGraph,
  projectWorkItemStage,
  removeDependency,
  type WorkGraph,
  type WorkItemInput,
  validateWorkGraph,
  WorkGraphError,
} from "../src/index";

describe("work graph mutations", () => {
  it("accepts a work item with only its identity and title", () => {
    const graph = addWorkItem(createWorkGraph(), {
      id: "work",
      title: "Sparse work item",
    });

    expect(graph.workItems).toEqual([
      {
        id: "work",
        title: "Sparse work item",
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

  it("rejects missing parents and dependency endpoints", () => {
    expect(() =>
      createWorkGraph({
        workItems: [{ id: "work", title: "Work", parentId: "missing" }],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "work_item_not_found",
      }),
    );

    expect(() =>
      createWorkGraph({
        workItems: [{ id: "work", title: "Work" }],
        dependencies: [
          {
            dependentWorkItemId: "work",
            blockerWorkItemId: "missing",
          },
        ],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "work_item_not_found",
      }),
    );
  });

  it("rejects malformed and duplicate work items", () => {
    expect(() =>
      createWorkGraph({ workItems: [{ id: "", title: "Work" }] }),
    ).toThrowError(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "invalid_work_item_id",
      }),
    );
    expect(() =>
      createWorkGraph({ workItems: [{ id: "work", title: " " }] }),
    ).toThrowError(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "invalid_work_item_title",
      }),
    );

    const invalidLifecycle = {
      id: "work",
      title: "Work",
      lifecycle: "done",
    } as unknown as WorkItemInput;
    expect(() =>
      createWorkGraph({ workItems: [invalidLifecycle] }),
    ).toThrowError(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "invalid_work_item_lifecycle",
      }),
    );

    expect(() =>
      createWorkGraph({
        workItems: [
          { id: "work", title: "First" },
          { id: "work", title: "Second" },
        ],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "duplicate_work_item",
      }),
    );
  });

  it("validates work-item fields in an assembled graph", () => {
    const malformed = {
      workItems: [
        {
          id: "work",
          title: "Work",
          lifecycle: "done",
          parentId: null,
        },
      ],
      dependencies: [],
    } as unknown as WorkGraph;

    expect(() => validateWorkGraph(malformed)).toThrowError(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "invalid_work_item_lifecycle",
      }),
    );
  });

  it("detects cycles regardless of work-item input order", () => {
    expect(() =>
      createWorkGraph({
        workItems: [
          { id: "child", title: "Child", parentId: "parent" },
          { id: "parent", title: "Parent" },
        ],
        dependencies: [
          {
            dependentWorkItemId: "child",
            blockerWorkItemId: "parent",
          },
        ],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<WorkGraphError>>({ code: "graph_cycle" }),
    );
  });

  it("can remove a dependency without disturbing either work item", () => {
    const graph = createWorkGraph({
      workItems: [
        { id: "dependent", title: "Dependent" },
        { id: "blocker", title: "Blocker" },
      ],
    });
    const dependency = {
      dependentWorkItemId: "dependent",
      blockerWorkItemId: "blocker",
    };
    const blocked = addDependency(graph, dependency);
    const unblocked = removeDependency(blocked, dependency);

    expect(projectWorkItemStage(blocked, "dependent")).toBe("blocked");
    expect(projectWorkItemStage(unblocked, "dependent")).toBe("ready");
    expect(unblocked.workItems).toEqual(graph.workItems);
  });

  it("rejects duplicate, self-referential, and missing dependency edits", () => {
    const graph = createWorkGraph({
      workItems: [
        { id: "dependent", title: "Dependent" },
        { id: "blocker", title: "Blocker" },
      ],
    });
    const dependency = {
      dependentWorkItemId: "dependent",
      blockerWorkItemId: "blocker",
    };
    const blocked = addDependency(graph, dependency);

    expect(() => addDependency(blocked, dependency)).toThrowError(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "dependency_already_exists",
      }),
    );
    expect(() =>
      addDependency(graph, {
        dependentWorkItemId: "dependent",
        blockerWorkItemId: "dependent",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "self_dependency",
      }),
    );
    expect(() => removeDependency(graph, dependency)).toThrowError(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "dependency_not_found",
      }),
    );
  });

  it("distinguishes dependency pairs containing null characters", () => {
    const graph = createWorkGraph({
      workItems: [
        { id: "a", title: "A" },
        { id: "a\0b", title: "A NUL B" },
        { id: "b\0c", title: "B NUL C" },
        { id: "c", title: "C" },
      ],
      dependencies: [
        { dependentWorkItemId: "a", blockerWorkItemId: "b\0c" },
        { dependentWorkItemId: "a\0b", blockerWorkItemId: "c" },
      ],
    });

    expect(graph.dependencies).toHaveLength(2);
  });

  it("validates deep hierarchies without using the call stack", () => {
    const workItems = Array.from({ length: 12_000 }, (_, index) => ({
      id: `work-${index}`,
      title: `Work ${index}`,
      parentId: index === 0 ? null : `work-${index - 1}`,
    }));

    expect(createWorkGraph({ workItems }).workItems).toHaveLength(12_000);
  });
});
