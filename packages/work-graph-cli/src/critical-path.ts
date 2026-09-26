import type {
  CriticalPathEdge,
  CriticalPathNode,
  CriticalPathProjection,
} from "./generated/client/types.gen.js";

export interface CriticalPathScope {
  readonly initiativeId?: string;
  readonly projectId?: string;
  readonly rootWorkItemId?: string;
}

const compact = (value: string): string =>
  value.replaceAll(/\s+/gu, " ").trim();

const nodeLabel = (node: CriticalPathNode): string =>
  `${compact(node.item.title)} (${node.item.id}) [${node.stage}${
    node.claimable ? ", claimable" : ""
  }]`;

const priorityLabel = (node: CriticalPathNode): string =>
  `${node.priority.initiativeRank}/${node.priority.projectRank}/${node.priority.ticketRank}${
    node.priority.effectiveExpedited ? ", expedited" : ""
  }${
    node.priority.donatedFromWorkItemId === null
      ? ""
      : `, urgency donated by ${node.priority.donatedFromWorkItemId}`
  }`;

const edgeKey = (fromWorkItemId: string, toWorkItemId: string): string =>
  `${fromWorkItemId}\0${toWorkItemId}`;

const edgeReason = (edge: CriticalPathEdge): string => {
  if (edge.kind === "decomposition") {
    return `decomposition child of ${edge.fromWorkItemId}`;
  }
  return `dependency blocker for ${edge.fromWorkItemId}, declared by ${edge.dependencyDeclaredByWorkItemId}`;
};

const scopeLabel = (scope: CriticalPathScope): string => {
  if (scope.rootWorkItemId !== undefined) {
    return `root ${scope.rootWorkItemId}`;
  }
  if (scope.initiativeId !== undefined && scope.projectId !== undefined) {
    return `initiative ${scope.initiativeId}, project ${scope.projectId}`;
  }
  if (scope.initiativeId !== undefined) {
    return `initiative ${scope.initiativeId}`;
  }
  if (scope.projectId !== undefined) return `project ${scope.projectId}`;
  return "global";
};

const renderNodeSection = (
  title: string,
  nodeIds: readonly string[],
  nodesById: ReadonlyMap<string, CriticalPathNode>,
): string[] => [
  `${title}:`,
  ...(nodeIds.length === 0
    ? ["  none"]
    : nodeIds.map((id) => {
        const node = nodesById.get(id);
        return `  - ${node === undefined ? id : nodeLabel(node)}`;
      })),
];

type NodesById = ReadonlyMap<string, CriticalPathNode>;
type EdgesByPair = ReadonlyMap<string, readonly CriticalPathEdge[]>;

const indexEdges = (
  edges: readonly CriticalPathEdge[],
): EdgesByPair => {
  const edgesByPair = new Map<string, CriticalPathEdge[]>();
  for (const edge of edges) {
    const key = edgeKey(edge.fromWorkItemId, edge.toWorkItemId);
    edgesByPair.set(key, [...(edgesByPair.get(key) ?? []), edge]);
  }
  return edgesByPair;
};

const nodeOrId = (id: string, nodesById: NodesById): string => {
  const node = nodesById.get(id);
  return node === undefined ? id : nodeLabel(node);
};

const renderPriorityOutcomes = (
  targetOutcomeIds: readonly string[],
  nodesById: NodesById,
): string[] => {
  const lines = ["Priority outcomes:"];
  for (const [index, id] of targetOutcomeIds.entries()) {
    const node = nodesById.get(id);
    lines.push(
      node === undefined
        ? `  ${index + 1}. ${id}`
        : `  ${index + 1}. ${nodeLabel(node)} priority ${priorityLabel(node)}`,
    );
  }
  return lines;
};

const blockingStepReason = (
  path: readonly string[],
  depth: number,
  id: string,
  edgesByPair: EdgesByPair,
): string => {
  if (depth === 0) return "priority outcome";
  const fromWorkItemId = path[depth - 1];
  if (fromWorkItemId === undefined) return "included in blocking path";
  const edges = edgesByPair.get(edgeKey(fromWorkItemId, id));
  if (edges === undefined || edges.length === 0) {
    return "included in blocking path";
  }
  return edges.map(edgeReason).join("; ");
};

const renderBlockingChains = (
  blockingPaths: readonly (readonly string[])[],
  nodesById: NodesById,
  edgesByPair: EdgesByPair,
): string[] => {
  const lines = ["Blocking chains:"];
  for (const [pathIndex, path] of blockingPaths.entries()) {
    lines.push(`  ${pathIndex + 1}.`);
    for (const [depth, id] of path.entries()) {
      const branch = depth === 0 ? "" : "└─ ";
      lines.push(
        `     ${"  ".repeat(depth)}${branch}${nodeOrId(id, nodesById)} | ${blockingStepReason(path, depth, id, edgesByPair)}`,
      );
    }
  }
  return lines;
};

const idsInStage = (
  nodes: readonly CriticalPathNode[],
  stage: CriticalPathNode["stage"],
): string[] =>
  nodes
    .filter((node) => node.stage === stage)
    .map(({ item }) => item.id);

const renderParallelBranches = (
  projection: CriticalPathProjection,
  nodesById: NodesById,
): string[] => {
  const lines = ["Parallel branches:"];
  if (projection.parallelBranches.length === 0) return [...lines, "  none"];

  for (const branch of projection.parallelBranches) {
    lines.push(
      `  - ${nodeOrId(branch.workItemId, nodesById)}`,
      `    unblocks outcomes: ${branch.targetWorkItemIds.join(", ") || "none"}`,
    );
    for (const path of branch.paths) {
      lines.push(`    via: ${path.join(" -> ")}`);
    }
  }
  return lines;
};

export const renderCriticalPath = (
  projection: CriticalPathProjection,
  scope: CriticalPathScope,
): string => {
  const nodesById = new Map(
    projection.nodes.map((node) => [node.item.id, node] as const),
  );
  const lines = [`Critical path (${scopeLabel(scope)})`];

  if (projection.targetOutcomeIds.length === 0) {
    lines.push("", "No open priority outcomes in this scope.");
    return `${lines.join("\n")}\n`;
  }

  lines.push(
    "",
    ...renderPriorityOutcomes(projection.targetOutcomeIds, nodesById),
    "",
    ...renderBlockingChains(
      projection.blockingPaths,
      nodesById,
      indexEdges(projection.edges),
    ),
    "",
    ...renderNodeSection("Ready leaves", projection.readyLeafIds, nodesById),
    "",
    ...renderNodeSection(
      "Active work",
      idsInStage(projection.nodes, "in_progress"),
      nodesById,
    ),
    "",
    ...renderNodeSection(
      "Stale leases",
      idsInStage(projection.nodes, "stale"),
      nodesById,
    ),
    "",
    ...renderNodeSection(
      "Blocking attention",
      projection.blockingAttentionIds,
      nodesById,
    ),
    "",
    ...renderParallelBranches(projection, nodesById),
  );

  return `${lines.join("\n")}\n`;
};
