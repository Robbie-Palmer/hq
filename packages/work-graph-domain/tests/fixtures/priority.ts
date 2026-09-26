import type {
  KnowledgeScopeInput,
  WorkGraphInput,
} from "../../src/index";

export interface PriorityFixture {
  readonly graph: WorkGraphInput;
  readonly name: string;
  readonly orderedIds: readonly string[];
  readonly scopes?: readonly KnowledgeScopeInput[];
}

const scope = (
  id: string,
  kind: KnowledgeScopeInput["kind"],
  rank: number,
): KnowledgeScopeInput => ({
  id,
  kind,
  rank,
  title: id,
  canonicalUrl: `https://example.test/${kind}s/${id}`,
  markdownUrl: `https://example.test/${kind}s/${id}.md`,
});

export const priorityFixtures: readonly PriorityFixture[] = [
  {
    name: "interleaves projects instead of grouping every high-initiative ticket",
    scopes: [
      scope("product", "initiative", 1_024),
      scope("platform", "initiative", 2_048),
      scope("checkout", "project", 1_024),
      scope("database", "project", 2_048),
    ],
    graph: {
      workItems: [
        {
          id: "product-later-1",
          title: "Product later 1",
          priorityRank: 1_024,
          schedulingInitiativeId: "product",
          schedulingProjectId: "checkout",
        },
        {
          id: "product-later-2",
          title: "Product later 2",
          priorityRank: 2_048,
          schedulingInitiativeId: "product",
          schedulingProjectId: "checkout",
        },
        {
          id: "product-later-3",
          title: "Product later 3",
          priorityRank: 3_072,
          schedulingInitiativeId: "product",
          schedulingProjectId: "checkout",
        },
        {
          id: "product-later-4",
          title: "Product later 4",
          priorityRank: 4_096,
          schedulingInitiativeId: "product",
          schedulingProjectId: "checkout",
        },
        {
          id: "product-backlog",
          title: "Product backlog",
          priorityRank: 5_120,
          schedulingInitiativeId: "product",
          schedulingProjectId: "checkout",
        },
        {
          id: "platform-now",
          title: "Platform now",
          priorityRank: 1_024,
          schedulingInitiativeId: "platform",
          schedulingProjectId: "database",
        },
      ],
    },
    orderedIds: [
      "product-later-1",
      "product-later-2",
      "product-later-3",
      "platform-now",
      "product-later-4",
      "product-backlog",
    ],
  },
  {
    name: "moves a blocker into its most urgent dependent's position",
    graph: {
      workItems: [
        { id: "release", title: "Release", priorityRank: 1_024 },
        {
          id: "release-api",
          title: "Release API",
          parentId: "release",
          rank: 1,
        },
        {
          id: "release-ui",
          title: "Release UI",
          parentId: "release",
          rank: 2,
        },
        { id: "database", title: "Database migration", priorityRank: 2_048 },
        { id: "chores", title: "Chores", priorityRank: 3_072 },
      ],
      dependencies: [
        {
          dependentWorkItemId: "release-api",
          blockerWorkItemId: "database",
        },
      ],
    },
    orderedIds: [
      "release",
      "release-api",
      "database",
      "release-ui",
      "chores",
    ],
  },
  {
    name: "donates expedited urgency through dependency chains",
    graph: {
      workItems: [
        {
          id: "urgent",
          title: "Urgent release",
          priorityRank: 3_072,
          expedited: true,
          expediteReason: "Restore production authentication.",
        },
        { id: "normal", title: "Normal release", priorityRank: 1_024 },
        { id: "shared", title: "Shared prerequisite", priorityRank: 2_048 },
      ],
      dependencies: [
        { dependentWorkItemId: "urgent", blockerWorkItemId: "shared" },
      ],
    },
    orderedIds: ["urgent", "shared", "normal"],
  },
  {
    name: "falls back to stable IDs when every scheduling input ties",
    graph: {
      workItems: [
        { id: "zebra", title: "Zebra" },
        { id: "alpha", title: "Alpha" },
      ],
    },
    orderedIds: ["alpha", "zebra"],
  },
];
