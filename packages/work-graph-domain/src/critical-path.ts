import { compareStrings } from "ts-base/strings";
import {
  getDirectChildren,
  getEffectiveDependencies,
  getWorkItem,
  validateWorkGraph,
} from "./graph";
import type {
  KnowledgeScope,
  WorkGraph,
  WorkItem,
  WorkItemDependency,
  WorkItemOperationalState,
} from "./model";
import {
  isWorkItemClaimable,
  projectWorkItemStage,
} from "./readiness";
import {
  isWorkItemInSelectionScope,
  orderWorkItemsByPriority,
  projectWorkItemPriorities,
  type WorkItemPriorityProjection,
  type WorkItemSelectionScope,
} from "./priority";
import type { WorkStage } from "./vocabulary";

export type CriticalPathEdgeKind = "decomposition" | "dependency";

export type CriticalPathInclusionReason =
  | { readonly kind: "target_outcome" }
  | {
      readonly kind: "decomposition_child";
      readonly fromWorkItemId: string;
    }
  | {
      readonly kind: "dependency_blocker";
      readonly fromWorkItemId: string;
      readonly dependencyDeclaredByWorkItemId: string;
    };

export interface CriticalPathNode {
  readonly item: WorkItem;
  readonly stage: WorkStage;
  readonly claimable: boolean;
  readonly priority: WorkItemPriorityProjection;
  readonly inclusionReasons: readonly CriticalPathInclusionReason[];
}

export type CriticalPathEdge =
  | {
      readonly kind: "decomposition";
      readonly fromWorkItemId: string;
      readonly toWorkItemId: string;
    }
  | {
      readonly kind: "dependency";
      readonly fromWorkItemId: string;
      readonly toWorkItemId: string;
      readonly dependencyDeclaredByWorkItemId: string;
    };

export interface CriticalPathParallelBranch {
  readonly workItemId: string;
  readonly stage: WorkStage;
  readonly claimable: boolean;
  readonly targetWorkItemIds: readonly string[];
  readonly paths: readonly (readonly string[])[];
}

export interface CriticalPathProjection {
  readonly targetOutcomeIds: readonly string[];
  readonly nodes: readonly CriticalPathNode[];
  readonly edges: readonly CriticalPathEdge[];
  readonly blockingPaths: readonly (readonly string[])[];
  readonly readyLeafIds: readonly string[];
  readonly blockingAttentionIds: readonly string[];
  readonly parallelBranches: readonly CriticalPathParallelBranch[];
}

export interface CriticalPathProjectionOptions {
  /** A snapshot time keeps lease stages deterministic for a projection. */
  readonly now: number;
  readonly knowledgeScopes?: readonly KnowledgeScope[];
  readonly operationalStateByWorkItemId?: Readonly<
    Record<string, WorkItemOperationalState>
  >;
  readonly selectionScope?: WorkItemSelectionScope;
  /** Select exact outcomes. Without this, open roots in the selection scope apply. */
  readonly targetWorkItemIds?: readonly string[];
}

type WorkItemOrder = ReadonlyMap<string, number>;

interface CriticalPathTraversal {
  readonly includedWorkItemIds: ReadonlySet<string>;
  readonly reasonsByWorkItemId: ReadonlyMap<
    string,
    ReadonlyMap<string, CriticalPathInclusionReason>
  >;
  readonly edges: readonly CriticalPathEdge[];
}

interface MutableCriticalPathTraversal {
  readonly includedWorkItemIds: Set<string>;
  readonly reasonsByWorkItemId: Map<
    string,
    Map<string, CriticalPathInclusionReason>
  >;
  readonly edgesByKey: Map<string, CriticalPathEdge>;
  readonly pendingWorkItemIds: string[];
}

interface CriticalPathLeaves {
  readonly leafIds: readonly string[];
  readonly nodeById: ReadonlyMap<string, CriticalPathNode>;
  readonly pathsByLeafId: ReadonlyMap<string, readonly (readonly string[])[]>;
}

const reasonKey = (reason: CriticalPathInclusionReason): string => {
  switch (reason.kind) {
    case "target_outcome":
      return reason.kind;
    case "decomposition_child":
      return `${reason.kind}:${reason.fromWorkItemId}`;
    case "dependency_blocker":
      return `${reason.kind}:${reason.fromWorkItemId}:${reason.dependencyDeclaredByWorkItemId}`;
  }
};

const edgeKey = (edge: CriticalPathEdge): string =>
  edge.kind === "decomposition"
    ? `${edge.kind}:${edge.fromWorkItemId}:${edge.toWorkItemId}`
    : `${edge.kind}:${edge.fromWorkItemId}:${edge.toWorkItemId}:${edge.dependencyDeclaredByWorkItemId}`;

const projectOperationalState = (
  options: CriticalPathProjectionOptions,
  workItemId: string,
): WorkItemOperationalState => ({
  ...(options.operationalStateByWorkItemId?.[workItemId] ?? {}),
  now: options.now,
});

const selectTargetOutcomes = (
  graph: WorkGraph,
  orderedItems: readonly WorkItem[],
  options: CriticalPathProjectionOptions,
): readonly WorkItem[] => {
  if (options.targetWorkItemIds !== undefined) {
    const targetIds = new Set<string>();
    for (const workItemId of options.targetWorkItemIds) {
      getWorkItem(graph, workItemId);
      targetIds.add(workItemId);
    }
    return orderedItems.filter(
      (item) => item.lifecycle === "open" && targetIds.has(item.id),
    );
  }

  return orderedItems.filter((item) => {
    if (item.lifecycle !== "open") return false;
    if (options.selectionScope?.parentId === undefined && item.parentId !== null) {
      return false;
    }
    return isWorkItemInSelectionScope(
      graph,
      item,
      options.selectionScope ?? {},
    );
  });
};

const compareByOrder = (
  orderById: WorkItemOrder,
  leftId: string,
  rightId: string,
): number =>
  (orderById.get(leftId) ?? Number.MAX_SAFE_INTEGER) -
    (orderById.get(rightId) ?? Number.MAX_SAFE_INTEGER) ||
  compareStrings(leftId, rightId);

const compareEdges = (
  orderById: WorkItemOrder,
  left: CriticalPathEdge,
  right: CriticalPathEdge,
): number => {
  const fromComparison = compareByOrder(
    orderById,
    left.fromWorkItemId,
    right.fromWorkItemId,
  );
  if (fromComparison !== 0) return fromComparison;

  const toComparison = compareByOrder(
    orderById,
    left.toWorkItemId,
    right.toWorkItemId,
  );
  if (toComparison !== 0) return toComparison;
  if (left.kind !== right.kind) return compareStrings(left.kind, right.kind);
  if (left.kind === "dependency" && right.kind === "dependency") {
    return compareStrings(
      left.dependencyDeclaredByWorkItemId,
      right.dependencyDeclaredByWorkItemId,
    );
  }
  return 0;
};

const compareReasons = (
  orderById: WorkItemOrder,
  left: CriticalPathInclusionReason,
  right: CriticalPathInclusionReason,
): number => {
  if (left.kind === "target_outcome") {
    return right.kind === "target_outcome" ? 0 : -1;
  }
  if (right.kind === "target_outcome") return 1;

  const sourceComparison = compareByOrder(
    orderById,
    left.fromWorkItemId,
    right.fromWorkItemId,
  );
  if (sourceComparison !== 0) return sourceComparison;
  if (left.kind !== right.kind) return compareStrings(left.kind, right.kind);
  if (
    left.kind === "dependency_blocker" &&
    right.kind === "dependency_blocker"
  ) {
    return compareStrings(
      left.dependencyDeclaredByWorkItemId,
      right.dependencyDeclaredByWorkItemId,
    );
  }
  return 0;
};

const enumerateBlockingPaths = (
  targetOutcomeIds: readonly string[],
  edges: readonly CriticalPathEdge[],
  orderById: WorkItemOrder,
): readonly (readonly string[])[] => {
  const nextIdsByWorkItemId = new Map<string, Set<string>>();
  for (const edge of edges) {
    const nextIds =
      nextIdsByWorkItemId.get(edge.fromWorkItemId) ?? new Set<string>();
    nextIds.add(edge.toWorkItemId);
    nextIdsByWorkItemId.set(edge.fromWorkItemId, nextIds);
  }

  const paths: string[][] = [];
  const visit = (workItemId: string, path: readonly string[]): void => {
    const nextIds = [...(nextIdsByWorkItemId.get(workItemId) ?? [])].sort(
      (left, right) => compareByOrder(orderById, left, right),
    );
    if (nextIds.length === 0) {
      paths.push([...path, workItemId]);
      return;
    }
    for (const nextId of nextIds) visit(nextId, [...path, workItemId]);
  };

  for (const targetOutcomeId of targetOutcomeIds) {
    visit(targetOutcomeId, []);
  }
  return paths;
};

const createTraversal = (): MutableCriticalPathTraversal => ({
  includedWorkItemIds: new Set(),
  reasonsByWorkItemId: new Map(),
  edgesByKey: new Map(),
  pendingWorkItemIds: [],
});

const includeWorkItem = (
  traversal: MutableCriticalPathTraversal,
  workItemId: string,
  reason: CriticalPathInclusionReason,
): void => {
  const reasons =
    traversal.reasonsByWorkItemId.get(workItemId) ?? new Map();
  reasons.set(reasonKey(reason), reason);
  traversal.reasonsByWorkItemId.set(workItemId, reasons);

  if (traversal.includedWorkItemIds.has(workItemId)) return;
  traversal.includedWorkItemIds.add(workItemId);
  traversal.pendingWorkItemIds.push(workItemId);
};

const addEdge = (
  traversal: MutableCriticalPathTraversal,
  edge: CriticalPathEdge,
  reason: CriticalPathInclusionReason,
): void => {
  traversal.edgesByKey.set(edgeKey(edge), edge);
  includeWorkItem(traversal, edge.toWorkItemId, reason);
};

const addOpenChildren = (
  graph: WorkGraph,
  orderById: WorkItemOrder,
  workItemId: string,
  traversal: MutableCriticalPathTraversal,
): void => {
  const children = [...getDirectChildren(graph, workItemId)].sort(
    (left, right) => compareByOrder(orderById, left.id, right.id),
  );

  for (const child of children) {
    if (child.lifecycle !== "open") continue;
    addEdge(
      traversal,
      {
        kind: "decomposition",
        fromWorkItemId: workItemId,
        toWorkItemId: child.id,
      },
      { kind: "decomposition_child", fromWorkItemId: workItemId },
    );
  }
};

const compareDependencies = (
  orderById: WorkItemOrder,
  left: WorkItemDependency,
  right: WorkItemDependency,
): number =>
  compareByOrder(
    orderById,
    left.blockerWorkItemId,
    right.blockerWorkItemId,
  ) || compareStrings(left.dependentWorkItemId, right.dependentWorkItemId);

const addOpenDependencies = (
  graph: WorkGraph,
  orderById: WorkItemOrder,
  workItemId: string,
  traversal: MutableCriticalPathTraversal,
): void => {
  const dependencies = [...getEffectiveDependencies(graph, workItemId)].sort(
    (left, right) => compareDependencies(orderById, left, right),
  );

  for (const dependency of dependencies) {
    const blocker = getWorkItem(graph, dependency.blockerWorkItemId);
    if (blocker.lifecycle !== "open") continue;
    addEdge(
      traversal,
      {
        kind: "dependency",
        fromWorkItemId: workItemId,
        toWorkItemId: blocker.id,
        dependencyDeclaredByWorkItemId: dependency.dependentWorkItemId,
      },
      {
        kind: "dependency_blocker",
        fromWorkItemId: workItemId,
        dependencyDeclaredByWorkItemId: dependency.dependentWorkItemId,
      },
    );
  }
};

const traverseCriticalPath = (
  graph: WorkGraph,
  targets: readonly WorkItem[],
  orderById: WorkItemOrder,
): CriticalPathTraversal => {
  const traversal = createTraversal();
  for (const target of targets) {
    includeWorkItem(traversal, target.id, { kind: "target_outcome" });
  }

  for (
    let index = 0;
    index < traversal.pendingWorkItemIds.length;
    index += 1
  ) {
    const workItemId = traversal.pendingWorkItemIds[index];
    if (!workItemId) continue;
    addOpenChildren(graph, orderById, workItemId, traversal);
    addOpenDependencies(graph, orderById, workItemId, traversal);
  }

  return {
    includedWorkItemIds: traversal.includedWorkItemIds,
    reasonsByWorkItemId: traversal.reasonsByWorkItemId,
    edges: [...traversal.edgesByKey.values()].sort((left, right) =>
      compareEdges(orderById, left, right),
    ),
  };
};

const projectCriticalPathNodes = (
  graph: WorkGraph,
  options: CriticalPathProjectionOptions,
  orderedItems: readonly WorkItem[],
  orderById: WorkItemOrder,
  priorities: ReadonlyMap<string, WorkItemPriorityProjection>,
  traversal: CriticalPathTraversal,
): readonly CriticalPathNode[] =>
  orderedItems
    .filter((item) => traversal.includedWorkItemIds.has(item.id))
    .map((item) => {
      const operationalState = projectOperationalState(options, item.id);
      const inclusionReasons = [
        ...(traversal.reasonsByWorkItemId.get(item.id)?.values() ?? []),
      ].sort((left, right) => compareReasons(orderById, left, right));

      return {
        item,
        stage: projectWorkItemStage(graph, item.id, operationalState),
        claimable: isWorkItemClaimable(graph, item.id, operationalState),
        priority: priorities.get(item.id)!,
        inclusionReasons,
      };
    });

const groupPathsByLeaf = (
  blockingPaths: readonly (readonly string[])[],
): ReadonlyMap<string, readonly (readonly string[])[]> => {
  const pathsByLeafId = new Map<string, (readonly string[])[]>();
  for (const path of blockingPaths) {
    const leafId = path.at(-1);
    if (!leafId) continue;
    const paths = pathsByLeafId.get(leafId) ?? [];
    paths.push(path);
    pathsByLeafId.set(leafId, paths);
  }
  return pathsByLeafId;
};

const projectLeaves = (
  nodes: readonly CriticalPathNode[],
  blockingPaths: readonly (readonly string[])[],
  orderById: WorkItemOrder,
): CriticalPathLeaves => {
  const nodeById = new Map(nodes.map((node) => [node.item.id, node] as const));
  const pathsByLeafId = groupPathsByLeaf(blockingPaths);
  const leafIds = [...pathsByLeafId.keys()].sort((left, right) =>
    compareByOrder(orderById, left, right),
  );
  return { leafIds, nodeById, pathsByLeafId };
};

const projectParallelBranches = (
  targetOutcomeIds: readonly string[],
  leaves: CriticalPathLeaves,
): readonly CriticalPathParallelBranch[] =>
  leaves.leafIds
    .filter(
      (workItemId) => leaves.nodeById.get(workItemId)?.claimable === true,
    )
    .map((workItemId) => {
      const node = leaves.nodeById.get(workItemId)!;
      const paths = leaves.pathsByLeafId.get(workItemId) ?? [];
      return {
        workItemId,
        stage: node.stage,
        claimable: node.claimable,
        targetWorkItemIds: targetOutcomeIds.filter((targetId) =>
          paths.some(([pathTargetId]) => pathTargetId === targetId),
        ),
        paths,
      };
    });

const assembleProjection = (
  targetOutcomeIds: readonly string[],
  nodes: readonly CriticalPathNode[],
  edges: readonly CriticalPathEdge[],
  blockingPaths: readonly (readonly string[])[],
  leaves: CriticalPathLeaves,
): CriticalPathProjection => ({
  targetOutcomeIds,
  nodes,
  edges,
  blockingPaths,
  readyLeafIds: leaves.leafIds.filter(
    (id) => leaves.nodeById.get(id)?.stage === "ready",
  ),
  blockingAttentionIds: nodes
    .filter(({ stage }) => stage === "needs_attention")
    .map(({ item }) => item.id),
  parallelBranches: projectParallelBranches(targetOutcomeIds, leaves),
});

export const projectCriticalPath = (
  graph: WorkGraph,
  options: CriticalPathProjectionOptions,
): CriticalPathProjection => {
  validateWorkGraph(graph);

  const knowledgeScopes = options.knowledgeScopes ?? [];
  const orderedItems = orderWorkItemsByPriority(graph, knowledgeScopes);
  const orderById = new Map(
    orderedItems.map((item, index) => [item.id, index] as const),
  );
  const priorities = projectWorkItemPriorities(graph, knowledgeScopes);
  const targets = selectTargetOutcomes(graph, orderedItems, options);
  const targetOutcomeIds = targets.map(({ id }) => id);
  const traversal = traverseCriticalPath(graph, targets, orderById);
  const nodes = projectCriticalPathNodes(
    graph,
    options,
    orderedItems,
    orderById,
    priorities,
    traversal,
  );
  const blockingPaths = enumerateBlockingPaths(
    targetOutcomeIds,
    traversal.edges,
    orderById,
  );
  const leaves = projectLeaves(nodes, blockingPaths, orderById);
  return assembleProjection(
    targetOutcomeIds,
    nodes,
    traversal.edges,
    blockingPaths,
    leaves,
  );
};
