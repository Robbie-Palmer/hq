import {
  createWorkGraph,
  isWorkItemClaimable,
  projectWorkItemStage,
} from "../src/index";

describe("attention requests", () => {
  it("removes work from the ready queue while blocking attention remains unresolved", () => {
    const graph = createWorkGraph({
      workItems: [{ id: "work", title: "Needs a decision" }],
    });

    expect(
      projectWorkItemStage(graph, "work", {
        hasUnresolvedBlockingAttention: true,
      }),
    ).toBe("needs_attention");
    expect(
      isWorkItemClaimable(graph, "work", {
        hasUnresolvedBlockingAttention: true,
      }),
    ).toBe(false);
  });

  it("returns work to ready after the last blocking request is resolved and every readiness predicate passes", () => {
    const graph = createWorkGraph({
      workItems: [{ id: "work", title: "Decision received" }],
    });

    expect(
      projectWorkItemStage(graph, "work", {
        hasUnresolvedBlockingAttention: false,
      }),
    ).toBe("ready");
    expect(
      isWorkItemClaimable(graph, "work", {
        hasUnresolvedBlockingAttention: false,
      }),
    ).toBe(true);
  });

  it("keeps work blocked after the last attention request is resolved when another blocker remains", () => {
    const graph = createWorkGraph({
      workItems: [
        { id: "work", title: "Still blocked" },
        { id: "blocker", title: "Blocker" },
      ],
      dependencies: [
        {
          dependentWorkItemId: "work",
          blockerWorkItemId: "blocker",
        },
      ],
    });

    expect(
      projectWorkItemStage(graph, "work", {
        hasUnresolvedBlockingAttention: false,
      }),
    ).toBe("blocked");
    expect(isWorkItemClaimable(graph, "work")).toBe(false);
  });
  it.todo(
    "prefers the previous worker without delaying higher-priority work indefinitely",
  );
});
