import { compareStrings } from "ts-base/strings";
import { getAncestors, getUnsatisfiedDependencies } from "./graph";
import type { KnowledgeScope, WorkGraph, WorkItem } from "./model";

const RANK_FUSION_OFFSET = 10;

interface PriorityPathSegment {
  readonly id: string;
  readonly rank: number | null;
}

interface PriorityKey {
  readonly expedited: boolean;
  readonly path: readonly PriorityPathSegment[];
  readonly score: number;
}

interface BasePriority {
  readonly initiativeRank: number;
  readonly key: PriorityKey;
  readonly projectRank: number;
  readonly ticketRank: number;
}

interface EffectivePriority {
  readonly donatedFromWorkItemId: string | null;
  readonly key: PriorityKey;
}

export interface WorkItemSelectionScope {
  readonly initiativeId?: string;
  readonly parentId?: string;
  readonly projectId?: string;
}

export interface WorkItemPriorityProjection {
  readonly donatedFromWorkItemId: string | null;
  readonly effectiveExpedited: boolean;
  readonly expedited: boolean;
  readonly initiativeRank: number;
  readonly projectRank: number;
  readonly ticketRank: number;
}

const comparePathSegment = (
  left: PriorityPathSegment,
  right: PriorityPathSegment,
): number => {
  if (left.rank !== right.rank) {
    if (left.rank === null) return 1;
    if (right.rank === null) return -1;
    return left.rank - right.rank;
  }
  return compareStrings(left.id, right.id);
};

const comparePriorityKey = (left: PriorityKey, right: PriorityKey): number => {
  if (left.expedited !== right.expedited) return left.expedited ? -1 : 1;
  if (left.score !== right.score) return left.score > right.score ? -1 : 1;

  const sharedLength = Math.min(left.path.length, right.path.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const leftSegment = left.path[index];
    const rightSegment = right.path[index];
    if (!leftSegment || !rightSegment) continue;
    const comparison = comparePathSegment(leftSegment, rightSegment);
    if (comparison !== 0) return comparison;
  }
  return left.path.length - right.path.length;
};

const compareRanked = (
  left: { readonly id: string; readonly rank: number | null },
  right: { readonly id: string; readonly rank: number | null },
): number => {
  if (left.rank === null) {
    return right.rank === null ? compareStrings(left.id, right.id) : 1;
  }
  if (right.rank === null) return -1;
  return left.rank - right.rank || compareStrings(left.id, right.id);
};

const ordinalRanks = <
  T extends { readonly id: string; readonly rank: number | null },
>(
  items: readonly T[],
): ReadonlyMap<string, number> =>
  new Map(
    [...items]
      .sort(compareRanked)
      .map((item, index) => [item.id, index + 1]),
  );

const medianRank = (count: number): number => Math.floor(count / 2) + 1;

export const getWorkItemSchedulingOwner = (
  graph: WorkGraph,
  item: WorkItem,
): WorkItem => {
  const lineage = [item, ...getAncestors(graph, item.id)];
  return lineage.find(({ priorityRank }) => priorityRank !== null) ?? item;
};

export const isWorkItemInSelectionScope = (
  graph: WorkGraph,
  item: WorkItem,
  scope: WorkItemSelectionScope,
): boolean => {
  if (scope.parentId !== undefined && item.parentId !== scope.parentId) {
    return false;
  }
  const owner = getWorkItemSchedulingOwner(graph, item);
  return (
    (scope.initiativeId === undefined ||
      owner.schedulingInitiativeId === scope.initiativeId) &&
    (scope.projectId === undefined ||
      owner.schedulingProjectId === scope.projectId)
  );
};

const scopeRanks = (
  scopes: readonly KnowledgeScope[],
  kind: KnowledgeScope["kind"],
): { readonly count: number; readonly ranks: ReadonlyMap<string, number> } => {
  const matching = scopes.filter((scope) => scope.kind === kind);
  return { count: matching.length, ranks: ordinalRanks(matching) };
};

const ticketRanks = (graph: WorkGraph): ReadonlyMap<string, number> => {
  const ownersByProject = new Map<string, WorkItem[]>();
  for (const item of graph.workItems) {
    if (item.priorityRank === null) continue;
    const projectId = item.schedulingProjectId ?? "";
    const owners = ownersByProject.get(projectId) ?? [];
    owners.push({ ...item, rank: item.priorityRank });
    ownersByProject.set(projectId, owners);
  }

  const result = new Map<string, number>();
  for (const owners of ownersByProject.values()) {
    for (const [id, rank] of ordinalRanks(owners)) result.set(id, rank);
  }
  return result;
};

const reciprocalRank = (rank: number): number =>
  1 / (RANK_FUSION_OFFSET + rank);

const basePriorities = (
  graph: WorkGraph,
  scopes: readonly KnowledgeScope[],
): ReadonlyMap<string, BasePriority> => {
  const initiative = scopeRanks(scopes, "initiative");
  const project = scopeRanks(scopes, "project");
  const tickets = ticketRanks(graph);
  const ticketCounts = new Map<string, number>();
  for (const item of graph.workItems) {
    if (item.priorityRank === null) continue;
    const projectId = item.schedulingProjectId ?? "";
    ticketCounts.set(projectId, (ticketCounts.get(projectId) ?? 0) + 1);
  }

  return new Map(
    graph.workItems.map((item) => {
      const lineage = [...getAncestors(graph, item.id)].reverse();
      lineage.push(item);
      const owner = getWorkItemSchedulingOwner(graph, item);
      const projectId = owner.schedulingProjectId ?? "";
      const initiativeRank =
        (owner.schedulingInitiativeId
          ? initiative.ranks.get(owner.schedulingInitiativeId)
          : undefined) ?? medianRank(initiative.count);
      const projectRank =
        (owner.schedulingProjectId
          ? project.ranks.get(owner.schedulingProjectId)
          : undefined) ?? medianRank(project.count);
      const ticketRank =
        tickets.get(owner.id) ?? medianRank(ticketCounts.get(projectId) ?? 0);

      return [
        item.id,
        {
          initiativeRank,
          projectRank,
          ticketRank,
          key: {
            expedited: lineage.some(({ expedited }) => expedited),
            score:
              reciprocalRank(initiativeRank) +
              reciprocalRank(projectRank) +
              reciprocalRank(ticketRank),
            path: lineage.map(({ id, rank }) => ({ id, rank })),
          },
        },
      ];
    }),
  );
};

const dependencyWaits = (graph: WorkGraph): ReadonlyMap<string, string[]> => {
  const waits = new Map<string, string[]>();
  for (const item of graph.workItems) {
    if (item.lifecycle !== "open") continue;
    waits.set(
      item.id,
      getUnsatisfiedDependencies(graph, item.id).map(
        ({ blockerWorkItemId }) => blockerWorkItemId,
      ),
    );
  }
  return waits;
};

const effectivePriorities = (
  graph: WorkGraph,
  base: ReadonlyMap<string, BasePriority>,
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
): ReadonlyMap<string, EffectivePriority> => {
  const effective = new Map<string, EffectivePriority>(
    [...base].map(([id, priority]) => [
      id,
      { donatedFromWorkItemId: null, key: priority.key },
    ]),
  );
  const waits = dependencyWaits(graph);

  for (const waitingItem of graph.workItems) {
    if (waitingItem.lifecycle !== "open") continue;
    const inherited = effective.get(waitingItem.id);
    if (!inherited) continue;

    const pending = [...(waits.get(waitingItem.id) ?? [])];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const blockerId = pending.pop();
      if (!blockerId || visited.has(blockerId)) continue;
      visited.add(blockerId);

      const current = effective.get(blockerId);
      if (
        current === undefined ||
        comparePriorityKey(inherited.key, current.key) < 0
      ) {
        effective.set(blockerId, {
          donatedFromWorkItemId:
            inherited.donatedFromWorkItemId ?? waitingItem.id,
          key: inherited.key,
        });
      }
      pending.push(...(waits.get(blockerId) ?? []));
    }
  }
  return effective;
};

const priorityState = (
  graph: WorkGraph,
  scopes: readonly KnowledgeScope[],
) => {
  const base = basePriorities(graph, scopes);
  return { base, effective: effectivePriorities(graph, base) };
};

export const projectWorkItemPriority = (
  graph: WorkGraph,
  workItemId: string,
  scopes: readonly KnowledgeScope[] = [],
): WorkItemPriorityProjection => {
  const projection = projectWorkItemPriorities(graph, scopes).get(workItemId);
  if (!projection) {
    throw new Error(`Work item ${workItemId} has no priority projection.`);
  }
  return projection;
};

export const projectWorkItemPriorities = (
  graph: WorkGraph,
  scopes: readonly KnowledgeScope[] = [],
): ReadonlyMap<string, WorkItemPriorityProjection> => {
  const { base, effective } = priorityState(graph, scopes);
  return new Map(
    graph.workItems.map((item) => {
      const basePriority = base.get(item.id)!;
      const effectivePriority = effective.get(item.id)!;
      return [
        item.id,
        {
          initiativeRank: basePriority.initiativeRank,
          projectRank: basePriority.projectRank,
          ticketRank: basePriority.ticketRank,
          expedited: basePriority.key.expedited,
          effectiveExpedited: effectivePriority.key.expedited,
          donatedFromWorkItemId: effectivePriority.donatedFromWorkItemId,
        },
      ];
    }),
  );
};

export const orderWorkItemsByPriority = (
  graph: WorkGraph,
  scopes: readonly KnowledgeScope[] = [],
): readonly WorkItem[] => {
  const { base, effective } = priorityState(graph, scopes);

  return [...graph.workItems].sort((left, right) => {
    const effectiveComparison = comparePriorityKey(
      effective.get(left.id)!.key,
      effective.get(right.id)!.key,
    );
    if (effectiveComparison !== 0) return effectiveComparison;

    const baseComparison = comparePriorityKey(
      base.get(left.id)!.key,
      base.get(right.id)!.key,
    );
    return baseComparison !== 0
      ? baseComparison
      : compareStrings(left.id, right.id);
  });
};
