import {
  cancelWorkItem,
  createWorkGraph,
  isWorkItemClaimable,
  projectWorkItemStage,
  releaseWorkItem,
} from "../src/index";

describe("work-item readiness", () => {
  it("makes an unblocked childless open item ready", () => {
    const graph = createWorkGraph({
      workItems: [{ id: "work", title: "Do the work" }],
    });

    expect(projectWorkItemStage(graph, "work")).toBe("ready");
    expect(isWorkItemClaimable(graph, "work")).toBe(true);
  });

  it("blocks an item with an unsatisfied dependency", () => {
    const graph = createWorkGraph({
      workItems: [
        { id: "blocked", title: "Blocked work" },
        { id: "blocker", title: "Required work" },
      ],
      dependencies: [
        {
          dependentWorkItemId: "blocked",
          blockerWorkItemId: "blocker",
        },
      ],
    });

    expect(projectWorkItemStage(graph, "blocked")).toBe("blocked");
    expect(isWorkItemClaimable(graph, "blocked")).toBe(false);
  });

  it("blocks a parent while any direct child remains open", () => {
    const graph = createWorkGraph({
      workItems: [
        { id: "parent", title: "Parent" },
        { id: "done", title: "Done child", parentId: "parent" },
        { id: "open", title: "Open child", parentId: "parent" },
      ],
    });
    const partlyFinished = releaseWorkItem(graph, "done");

    expect(projectWorkItemStage(partlyFinished, "parent")).toBe("blocked");
  });

  it(
    "keeps a parent open and projects it as ready after every direct child terminates",
    () => {
      const graph = createWorkGraph({
        workItems: [
          { id: "parent", title: "Parent" },
          { id: "released", title: "Released child", parentId: "parent" },
          { id: "cancelled", title: "Cancelled child", parentId: "parent" },
        ],
      });
      const released = releaseWorkItem(graph, "released");
      const finished = cancelWorkItem(released, "cancelled");

      expect(projectWorkItemStage(finished, "parent")).toBe("ready");
      expect(
        finished.workItems.find((workItem) => workItem.id === "parent")
          ?.lifecycle,
      ).toBe("open");
    },
  );

  it("projects an active lease as in progress", () => {
    const graph = createWorkGraph({
      workItems: [{ id: "work", title: "Leased work" }],
    });
    const operationalState = {
      currentLease: { expiresAt: 2_000 },
      now: 1_000,
    };

    expect(projectWorkItemStage(graph, "work", operationalState)).toBe(
      "in_progress",
    );
    expect(isWorkItemClaimable(graph, "work", operationalState)).toBe(false);
  });

  it("projects an expired lease as stale and reclaimable", () => {
    const graph = createWorkGraph({
      workItems: [{ id: "work", title: "Stale work" }],
    });
    const operationalState = {
      currentLease: { expiresAt: 1_000 },
      now: 1_000,
    };

    expect(projectWorkItemStage(graph, "work", operationalState)).toBe(
      "stale",
    );
    expect(isWorkItemClaimable(graph, "work", operationalState)).toBe(true);
  });

  it("projects unresolved blocking attention as needs attention", () => {
    const graph = createWorkGraph({
      workItems: [{ id: "work", title: "Work needing a decision" }],
    });
    const operationalState = { hasUnresolvedBlockingAttention: true };

    expect(projectWorkItemStage(graph, "work", operationalState)).toBe(
      "needs_attention",
    );
    expect(isWorkItemClaimable(graph, "work", operationalState)).toBe(false);
  });

  it("never makes released or cancelled work claimable", () => {
    const graph = createWorkGraph({
      workItems: [
        { id: "released", title: "Released", lifecycle: "released" },
        { id: "cancelled", title: "Cancelled", lifecycle: "cancelled" },
      ],
    });

    expect(projectWorkItemStage(graph, "released")).toBe("released");
    expect(projectWorkItemStage(graph, "cancelled")).toBe("cancelled");
    expect(isWorkItemClaimable(graph, "released")).toBe(false);
    expect(isWorkItemClaimable(graph, "cancelled")).toBe(false);
  });

  it("inherits unresolved dependencies from ancestor work items", () => {
    const graph = createWorkGraph({
      workItems: [
        { id: "parent", title: "Parent" },
        { id: "child", title: "Child", parentId: "parent" },
        { id: "blocker", title: "Ancestor blocker" },
      ],
      dependencies: [
        {
          dependentWorkItemId: "parent",
          blockerWorkItemId: "blocker",
        },
      ],
    });

    expect(projectWorkItemStage(graph, "child")).toBe("blocked");
    expect(isWorkItemClaimable(graph, "child")).toBe(false);
  });

  it("keeps stale work recoverable after an ancestor gains a blocker", () => {
    const graph = createWorkGraph({
      workItems: [
        { id: "parent", title: "Parent" },
        { id: "child", title: "Child", parentId: "parent" },
        { id: "blocker", title: "Ancestor blocker" },
      ],
      dependencies: [
        {
          dependentWorkItemId: "parent",
          blockerWorkItemId: "blocker",
        },
      ],
    });
    const staleState = {
      currentLease: { expiresAt: 1_000 },
      now: 1_000,
    };

    expect(projectWorkItemStage(graph, "child", staleState)).toBe("stale");
    expect(isWorkItemClaimable(graph, "child", staleState)).toBe(true);
  });
});
