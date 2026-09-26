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

export const renderCriticalPath = (
  projection: CriticalPathProjection,
  scope: CriticalPathScope,
): string => {
  const nodesById = new Map(
    projection.nodes.map((node) => [node.item.id, node] as const),
  );
  const edgesByPair = new Map<string, CriticalPathEdge[]>();
  for (const edge of projection.edges) {
    const key = edgeKey(edge.fromWorkItemId, edge.toWorkItemId);
    edgesByPair.set(key, [...(edgesByPair.get(key) ?? []), edge]);
  }
  const lines = [`Critical path (${scopeLabel(scope)})`];

  if (projection.targetOutcomeIds.length === 0) {
    lines.push("", "No open priority outcomes in this scope.");
    return `${lines.join("\n")}\n`;
  }

  lines.push("", "Priority outcomes:");
  for (const [index, id] of projection.targetOutcomeIds.entries()) {
    const node = nodesById.get(id);
    lines.push(
      node === undefined
        ? `  ${index + 1}. ${id}`
        : `  ${index + 1}. ${nodeLabel(node)} priority ${priorityLabel(node)}`,
    );
  }

  lines.push("", "Blocking chains:");
  for (const [pathIndex, path] of projection.blockingPaths.entries()) {
    lines.push(`  ${pathIndex + 1}.`);
    for (const [depth, id] of path.entries()) {
      const node = nodesById.get(id);
      const edges =
        depth === 0
          ? []
          : edgesByPair.get(edgeKey(path[depth - 1] ?? "", id));
      const reason =
        depth === 0
          ? "priority outcome"
          : edges === undefined || edges.length === 0
            ? "included in blocking path"
            : edges.map(edgeReason).join("; ");
      lines.push(
        `     ${"  ".repeat(depth)}${depth === 0 ? "" : "└─ "}${
          node === undefined ? id : nodeLabel(node)
        } | ${reason}`,
      );
    }
  }

  const activeIds = projection.nodes
    .filter(({ stage }) => stage === "in_progress")
    .map(({ item }) => item.id);
  const staleIds = projection.nodes
    .filter(({ stage }) => stage === "stale")
    .map(({ item }) => item.id);
  lines.push(
    "",
    ...renderNodeSection("Ready leaves", projection.readyLeafIds, nodesById),
    "",
    ...renderNodeSection("Active work", activeIds, nodesById),
    "",
    ...renderNodeSection("Stale leases", staleIds, nodesById),
    "",
    ...renderNodeSection(
      "Blocking attention",
      projection.blockingAttentionIds,
      nodesById,
    ),
    "",
    "Parallel branches:",
  );

  if (projection.parallelBranches.length === 0) {
    lines.push("  none");
  } else {
    for (const branch of projection.parallelBranches) {
      const node = nodesById.get(branch.workItemId);
      lines.push(
        `  - ${node === undefined ? branch.workItemId : nodeLabel(node)}`,
        `    unblocks outcomes: ${branch.targetWorkItemIds.join(", ") || "none"}`,
      );
      for (const path of branch.paths) {
        lines.push(`    via: ${path.join(" -> ")}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
};
