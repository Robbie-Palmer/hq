import {
  addDependency,
  addWorkItem,
  cancelWorkItem,
  createWorkGraph,
  projectWorkItemStage,
  reparentWorkItem,
  releaseWorkItem,
  WorkGraphError,
} from "../src/index";

const dependency = (dependentWorkItemId: string, blockerWorkItemId: string) => ({
  dependentWorkItemId,
  blockerWorkItemId,
});

const threeItems = () =>
  createWorkGraph({
    workItems: [
      { id: "a", title: "A" },
      { id: "b", title: "B" },
      { id: "c", title: "C" },
    ],
  });

describe("work-item dependencies", () => {
  it("makes released blocker work satisfy its downstream dependencies", () => {
    const graph = addDependency(threeItems(), dependency("a", "b"));

    expect(projectWorkItemStage(graph, "a")).toBe("blocked");
    expect(projectWorkItemStage(releaseWorkItem(graph, "b"), "a")).toBe(
      "ready",
    );
  });

  it("makes cancelled blocker work satisfy its downstream dependencies", () => {
    const graph = addDependency(threeItems(), dependency("a", "b"));

    expect(projectWorkItemStage(cancelWorkItem(graph, "b"), "a")).toBe(
      "ready",
    );
  });

  it("requires replacement work to be added as a new blocker", () => {
    const original = addDependency(threeItems(), dependency("a", "b"));
    const cancelled = cancelWorkItem(original, "b");
    const withReplacement = addWorkItem(cancelled, {
      id: "replacement",
      title: "Replacement",
    });

    expect(projectWorkItemStage(withReplacement, "a")).toBe("ready");
    expect(
      projectWorkItemStage(
        addDependency(withReplacement, dependency("a", "replacement")),
        "a",
      ),
    ).toBe("blocked");
  });

  it("does not redirect dependencies when blocker work is cancelled", () => {
    const graph = addDependency(threeItems(), dependency("a", "b"));
    const cancelled = cancelWorkItem(graph, "b");

    expect(cancelled.dependencies).toEqual([dependency("a", "b")]);
  });

  it("rejects a direct dependency cycle", () => {
    const graph = addDependency(threeItems(), dependency("a", "b"));

    expect(() => addDependency(graph, dependency("b", "a"))).toThrowError(
      expect.objectContaining<Partial<WorkGraphError>>({ code: "graph_cycle" }),
    );
  });

  it("rejects a transitive dependency cycle", () => {
    const first = addDependency(threeItems(), dependency("a", "b"));
    const second = addDependency(first, dependency("b", "c"));

    expect(() => addDependency(second, dependency("c", "a"))).toThrowError(
      expect.objectContaining<Partial<WorkGraphError>>({ code: "graph_cycle" }),
    );
  });

  it("rejects a child depending on its own parent", () => {
    const graph = createWorkGraph({
      workItems: [
        { id: "parent", title: "Parent" },
        { id: "child", title: "Child", parentId: "parent" },
      ],
    });

    expect(() =>
      addDependency(graph, dependency("child", "parent")),
    ).toThrowError(
      expect.objectContaining<Partial<WorkGraphError>>({ code: "graph_cycle" }),
    );
  });

  it("rejects an ancestor depending on its own descendant", () => {
    const graph = createWorkGraph({
      workItems: [
        { id: "parent", title: "Parent" },
        { id: "child", title: "Child", parentId: "parent" },
      ],
    });

    expect(() =>
      addDependency(graph, dependency("parent", "child")),
    ).toThrowError(
      expect.objectContaining<Partial<WorkGraphError>>({ code: "graph_cycle" }),
    );
  });

  it("rejects reparenting that would create a combined waits-for cycle", () => {
    const graph = addDependency(threeItems(), dependency("b", "a"));

    expect(() => reparentWorkItem(graph, "b", "a")).toThrowError(
      expect.objectContaining<Partial<WorkGraphError>>({ code: "graph_cycle" }),
    );
  });

  it("keeps hierarchy and dependency relationships semantically separate", () => {
    const graph = addDependency(
      createWorkGraph({
        workItems: [
          { id: "parent", title: "Parent" },
          { id: "child", title: "Child", parentId: "parent" },
          { id: "blocker", title: "Blocker" },
        ],
      }),
      dependency("child", "blocker"),
    );

    expect(graph.dependencies).toEqual([dependency("child", "blocker")]);
    expect(
      graph.workItems.find((workItem) => workItem.id === "child")?.parentId,
    ).toBe("parent");
  });
});
