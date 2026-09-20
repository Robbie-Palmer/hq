import {
  createWorkGraph,
  isWorkItemClaimable,
  orderWorkItemsByPriority,
  projectWorkItemStage,
} from "../src/index";

describe("execution leases", () => {
  it("keeps claimed work assigned when higher-priority work becomes ready", () => {
    const graph = createWorkGraph({
      workItems: [
        { id: "claimed", title: "Claimed", priorityRank: 2_048 },
        { id: "urgent", title: "Urgent", priorityRank: 1_024 },
      ],
    });
    const now = 1_000;
    const claimedState = {
      currentLease: { expiresAt: now + 1_000 },
      now,
    };

    expect(orderWorkItemsByPriority(graph).map(({ id }) => id)).toEqual([
      "urgent",
      "claimed",
    ]);
    expect(projectWorkItemStage(graph, "urgent")).toBe("ready");
    expect(projectWorkItemStage(graph, "claimed", claimedState)).toBe(
      "in_progress",
    );
    expect(isWorkItemClaimable(graph, "claimed", claimedState)).toBe(false);
  });
});
