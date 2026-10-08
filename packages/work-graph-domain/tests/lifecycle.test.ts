import {
  cancelWorkItem,
  createWorkGraph,
  getWorkItem,
  projectWorkItemStage,
  releaseWorkItem,
  WorkGraphError,
} from "../src/index";

describe("explicit work-item termination", () => {
  it.each([
    ["release", releaseWorkItem, "released"],
    ["cancellation", cancelWorkItem, "cancelled"],
  ] as const)("records an explicit %s", (_name, terminate, terminalState) => {
    const graph = createWorkGraph({
      workItems: [{ id: "work", title: "Work" }],
    });
    const terminated = terminate(graph, "work");

    expect(getWorkItem(terminated, "work").lifecycle).toBe(terminalState);
    expect(projectWorkItemStage(terminated, "work")).toBe(terminalState);
    expect(getWorkItem(graph, "work").lifecycle).toBe("open");
  });

  it("does not infer a parent transition from its final child", () => {
    const graph = createWorkGraph({
      workItems: [
        { id: "parent", title: "Parent" },
        { id: "child", title: "Child", parentId: "parent" },
      ],
    });

    const terminated = releaseWorkItem(graph, "child");

    expect(getWorkItem(terminated, "parent").lifecycle).toBe("open");
    expect(projectWorkItemStage(terminated, "parent")).toBe("ready");
  });

  it("rejects a second terminal transition", () => {
    const graph = createWorkGraph({
      workItems: [{ id: "work", title: "Work" }],
    });
    const released = releaseWorkItem(graph, "work");

    expect(() => cancelWorkItem(released, "work")).toThrowError(
      expect.objectContaining<Partial<WorkGraphError>>({
        code: "work_item_already_terminal",
      }),
    );
  });
});
