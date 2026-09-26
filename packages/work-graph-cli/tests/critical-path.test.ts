import { describe, expect, it } from "vitest";
import { renderCriticalPath } from "../src/critical-path.js";
import type {
  CriticalPathNode,
  CriticalPathProjection,
} from "../src/generated/client/types.gen.js";

const node = (
  id: string,
  title: string,
  stage: CriticalPathNode["stage"],
  claimable: boolean,
  ticketRank: number,
): CriticalPathNode => ({
  item: {
    id,
    title,
    lifecycle: "open",
    parentId: null,
    rank: null,
    priorityRank: ticketRank,
    schedulingInitiativeId: "initiative",
    schedulingProjectId: "project",
    expedited: false,
    expediteReason: null,
  },
  stage,
  claimable,
  priority: {
    initiativeRank: 1,
    projectRank: 2,
    ticketRank,
    expedited: false,
    effectiveExpedited: false,
    donatedFromWorkItemId: null,
  },
  inclusionReasons:
    id === "outcome"
      ? [{ kind: "target_outcome" }]
      : [{ kind: "decomposition_child", fromWorkItemId: "outcome" }],
});

const projection: CriticalPathProjection = {
  targetOutcomeIds: ["outcome"],
  nodes: [
    node("outcome", "Ship the outcome", "blocked", false, 1),
    node("active", "Build API", "in_progress", false, 2),
    node("shared", "Shared schema\nchange", "stale", true, 3),
    node("review", "Approve design", "needs_attention", false, 4),
    node("docs", "Write docs", "ready", true, 5),
  ],
  edges: [
    {
      kind: "decomposition",
      fromWorkItemId: "outcome",
      toWorkItemId: "active",
    },
    {
      kind: "dependency",
      fromWorkItemId: "active",
      toWorkItemId: "shared",
      dependencyDeclaredByWorkItemId: "active",
    },
    {
      kind: "decomposition",
      fromWorkItemId: "outcome",
      toWorkItemId: "review",
    },
    {
      kind: "dependency",
      fromWorkItemId: "review",
      toWorkItemId: "shared",
      dependencyDeclaredByWorkItemId: "review",
    },
    {
      kind: "decomposition",
      fromWorkItemId: "outcome",
      toWorkItemId: "docs",
    },
  ],
  blockingPaths: [
    ["outcome", "active", "shared"],
    ["outcome", "review", "shared"],
    ["outcome", "docs"],
  ],
  readyLeafIds: ["docs"],
  blockingAttentionIds: ["review"],
  parallelBranches: [
    {
      workItemId: "shared",
      stage: "stale",
      claimable: true,
      targetWorkItemIds: ["outcome"],
      paths: [
        ["outcome", "active", "shared"],
        ["outcome", "review", "shared"],
      ],
    },
    {
      workItemId: "docs",
      stage: "ready",
      claimable: true,
      targetWorkItemIds: ["outcome"],
      paths: [["outcome", "docs"]],
    },
  ],
};

describe("Given a critical-path projection", () => {
  it("renders deterministic blocking chains and operational summaries", () => {
    const rendered = renderCriticalPath(projection, {
      initiativeId: "initiative",
      projectId: "project",
    });

    expect(rendered).toBe(
      [
        "Critical path (initiative initiative, project project)",
        "",
        "Priority outcomes:",
        "  1. Ship the outcome (outcome) [blocked] priority 1/2/1",
        "",
        "Blocking chains:",
        "  1.",
        "     Ship the outcome (outcome) [blocked] | priority outcome",
        "       └─ Build API (active) [in_progress] | decomposition child of outcome",
        "         └─ Shared schema change (shared) [stale, claimable] | dependency blocker for active, declared by active",
        "  2.",
        "     Ship the outcome (outcome) [blocked] | priority outcome",
        "       └─ Approve design (review) [needs_attention] | decomposition child of outcome",
        "         └─ Shared schema change (shared) [stale, claimable] | dependency blocker for review, declared by review",
        "  3.",
        "     Ship the outcome (outcome) [blocked] | priority outcome",
        "       └─ Write docs (docs) [ready, claimable] | decomposition child of outcome",
        "",
        "Ready leaves:",
        "  - Write docs (docs) [ready, claimable]",
        "",
        "Active work:",
        "  - Build API (active) [in_progress]",
        "",
        "Stale leases:",
        "  - Shared schema change (shared) [stale, claimable]",
        "",
        "Blocking attention:",
        "  - Approve design (review) [needs_attention]",
        "",
        "Parallel branches:",
        "  - Shared schema change (shared) [stale, claimable]",
        "    unblocks outcomes: outcome",
        "    via: outcome -> active -> shared",
        "    via: outcome -> review -> shared",
        "  - Write docs (docs) [ready, claimable]",
        "    unblocks outcomes: outcome",
        "    via: outcome -> docs",
        "",
      ].join("\n"),
    );
  });

  it("renders an empty scoped projection without placeholder work", () => {
    expect(
      renderCriticalPath(
        {
          targetOutcomeIds: [],
          nodes: [],
          edges: [],
          blockingPaths: [],
          readyLeafIds: [],
          blockingAttentionIds: [],
          parallelBranches: [],
        },
        { rootWorkItemId: "finished" },
      ),
    ).toBe(
      "Critical path (root finished)\n\nNo open priority outcomes in this scope.\n",
    );
  });

  it("reports when no blocking branch is claimable", () => {
    const attentionOnly: CriticalPathProjection = {
      targetOutcomeIds: ["review"],
      nodes: [
        node("review", "Approve design", "needs_attention", false, 1),
      ],
      edges: [],
      blockingPaths: [["review"]],
      readyLeafIds: [],
      blockingAttentionIds: ["review"],
      parallelBranches: [],
    };

    expect(renderCriticalPath(attentionOnly, { projectId: "project" })).toContain(
      "Parallel branches:\n  none\n",
    );
  });
});
