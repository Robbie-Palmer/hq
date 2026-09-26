import { isNonBlankString } from "ts-base/strings";
import { WorkGraphError } from "./errors";
import type {
  WorkGraph,
  WorkGraphInput,
  NewWorkItemInput,
  WorkItem,
  WorkItemDependency,
  WorkItemInput,
} from "./model";
import {
  WORK_ITEM_LIFECYCLES,
  type TerminalWorkItemState,
  type WorkItemLifecycle,
} from "./vocabulary";
import { normalizeAndValidateContextRecords } from "./context";

const isWorkItemLifecycle = (value: unknown): value is WorkItemLifecycle =>
  WORK_ITEM_LIFECYCLES.some((lifecycle) => lifecycle === value);

const validatePriorityFields = (workItem: WorkItem): void => {
  if (
    workItem.priorityRank !== null &&
    (!Number.isSafeInteger(workItem.priorityRank) ||
      workItem.priorityRank <= 0 ||
      workItem.priorityRank > 2_147_483_647)
  ) {
    throw new WorkGraphError(
      "invalid_priority_rank",
      `Work item ${workItem.id} must have a positive whole-number priority rank.`,
    );
  }
  if (
    (workItem.schedulingInitiativeId !== null &&
      !isNonBlankString(workItem.schedulingInitiativeId)) ||
    (workItem.schedulingProjectId !== null &&
      !isNonBlankString(workItem.schedulingProjectId))
  ) {
    throw new WorkGraphError(
      "invalid_scheduling_scope",
      `Work item ${workItem.id} has an invalid scheduling scope.`,
    );
  }
  if (
    workItem.parentId !== null &&
    (workItem.priorityRank !== null ||
      workItem.schedulingInitiativeId !== null ||
      workItem.schedulingProjectId !== null)
  ) {
    throw new WorkGraphError(
      "invalid_scheduling_scope",
      `Work item ${workItem.id} inherits scheduling priority from its parent.`,
    );
  }
};

const validateExpediteFields = (workItem: WorkItem): void => {
  if (
    workItem.expediteReason !== null &&
    !isNonBlankString(workItem.expediteReason)
  ) {
    throw new WorkGraphError(
      "invalid_expedite_reason",
      `Work item ${workItem.id} has an empty expedite reason.`,
    );
  }
  if (workItem.expedited !== (workItem.expediteReason !== null)) {
    throw new WorkGraphError(
      "invalid_expedite_reason",
      `Work item ${workItem.id} must record a reason exactly when it is expedited.`,
    );
  }
};

const validateWorkItemFields = (workItem: WorkItem): void => {
  if (!isNonBlankString(workItem.id)) {
    throw new WorkGraphError(
      "invalid_work_item_id",
      "A work item ID cannot be empty.",
    );
  }
  if (!isNonBlankString(workItem.title)) {
    throw new WorkGraphError(
      "invalid_work_item_title",
      `Work item ${workItem.id} must have a title.`,
    );
  }
  if (!isWorkItemLifecycle(workItem.lifecycle)) {
    throw new WorkGraphError(
      "invalid_work_item_lifecycle",
      `Work item ${workItem.id} has an invalid lifecycle.`,
    );
  }
  if (workItem.parentId !== null && !isNonBlankString(workItem.parentId)) {
    throw new WorkGraphError(
      "invalid_parent_id",
      `Work item ${workItem.id} has an invalid parent ID.`,
    );
  }
  if (
    workItem.rank !== null &&
    (workItem.parentId === null ||
      !Number.isSafeInteger(workItem.rank) ||
      workItem.rank <= 0 ||
      workItem.rank > 2_147_483_647)
  ) {
    throw new WorkGraphError(
      "invalid_child_rank",
      `Work item ${workItem.id} must have a positive whole-number rank.`,
    );
  }
  validatePriorityFields(workItem);
  validateExpediteFields(workItem);
};

const normalizeWorkItem = (input: WorkItemInput): WorkItem => {
  if (!isNonBlankString(input.id)) {
    throw new WorkGraphError(
      "invalid_work_item_id",
      "A work item ID cannot be empty.",
    );
  }

  if (!isNonBlankString(input.title)) {
    throw new WorkGraphError(
      "invalid_work_item_title",
      `Work item ${input.id} must have a title.`,
    );
  }

  const lifecycle = input.lifecycle ?? "open";
  if (!isWorkItemLifecycle(lifecycle)) {
    throw new WorkGraphError(
      "invalid_work_item_lifecycle",
      `Work item ${input.id} has an invalid lifecycle.`,
    );
  }

  const parentId = input.parentId ?? null;
  if (parentId !== null && !isNonBlankString(parentId)) {
    throw new WorkGraphError(
      "invalid_parent_id",
      `Work item ${input.id} has an invalid parent ID.`,
    );
  }

  const rank = input.rank ?? null;
  const priorityRank = input.priorityRank ?? null;
  const schedulingInitiativeId = input.schedulingInitiativeId ?? null;
  const schedulingProjectId = input.schedulingProjectId ?? null;
  const expedited = input.expedited ?? false;
  const expediteReason = input.expediteReason ?? null;

  return {
    id: input.id,
    title: input.title,
    lifecycle,
    parentId,
    rank,
    priorityRank,
    schedulingInitiativeId,
    schedulingProjectId,
    expedited,
    expediteReason,
  };
};

const indexWorkItems = (workItems: readonly WorkItem[]) => {
  const workItemsById = new Map<string, WorkItem>();

  for (const workItem of workItems) {
    if (workItemsById.has(workItem.id)) {
      throw new WorkGraphError(
        "duplicate_work_item",
        `Work item ${workItem.id} already exists.`,
      );
    }
    workItemsById.set(workItem.id, workItem);
  }

  return workItemsById;
};

const requireWorkItem = (
  workItemsById: ReadonlyMap<string, WorkItem>,
  workItemId: string,
) => {
  const workItem = workItemsById.get(workItemId);
  if (!workItem) {
    throw new WorkGraphError(
      "work_item_not_found",
      `Work item ${workItemId} does not exist.`,
    );
  }
  return workItem;
};

const validateHierarchy = (
  workItems: readonly WorkItem[],
  workItemsById: ReadonlyMap<string, WorkItem>,
): void => {
  const ranksByParent = new Map<string, Set<number>>();

  for (const workItem of workItems) {
    if (workItem.parentId === null) continue;

    requireWorkItem(workItemsById, workItem.parentId);
    if (workItem.rank === null) continue;

    const siblingRanks = ranksByParent.get(workItem.parentId) ?? new Set();
    if (siblingRanks.has(workItem.rank)) {
      throw new WorkGraphError(
        "invalid_child_rank",
        `Child rank ${workItem.rank} is used more than once beneath work item ${workItem.parentId}.`,
      );
    }
    siblingRanks.add(workItem.rank);
    ranksByParent.set(workItem.parentId, siblingRanks);
  }
};

const validatePriorityRanks = (workItems: readonly WorkItem[]): void => {
  const ranksByProject = new Map<string, Set<number>>();

  for (const workItem of workItems) {
    if (workItem.priorityRank === null) continue;
    const projectKey = workItem.schedulingProjectId ?? "";
    const ranks = ranksByProject.get(projectKey) ?? new Set<number>();
    if (ranks.has(workItem.priorityRank)) {
      throw new WorkGraphError(
        "invalid_priority_rank",
        `Priority rank ${workItem.priorityRank} is used more than once in scheduling project ${workItem.schedulingProjectId ?? "the unscoped queue"}.`,
      );
    }
    ranks.add(workItem.priorityRank);
    ranksByProject.set(projectKey, ranks);
  }
};

const validateDependencies = (
  dependencies: readonly WorkItemDependency[],
  workItemsById: ReadonlyMap<string, WorkItem>,
): void => {
  const blockersByDependent = new Map<string, Set<string>>();

  for (const dependency of dependencies) {
    requireWorkItem(workItemsById, dependency.dependentWorkItemId);
    requireWorkItem(workItemsById, dependency.blockerWorkItemId);

    if (dependency.dependentWorkItemId === dependency.blockerWorkItemId) {
      throw new WorkGraphError(
        "self_dependency",
        `Work item ${dependency.dependentWorkItemId} cannot depend on itself.`,
      );
    }

    const blockerIds =
      blockersByDependent.get(dependency.dependentWorkItemId) ??
      new Set<string>();
    if (blockerIds.has(dependency.blockerWorkItemId)) {
      throw new WorkGraphError(
        "dependency_already_exists",
        `Dependency ${dependency.dependentWorkItemId} -> ${dependency.blockerWorkItemId} already exists.`,
      );
    }
    blockerIds.add(dependency.blockerWorkItemId);
    blockersByDependent.set(dependency.dependentWorkItemId, blockerIds);
  }
};

const appendWait = (
  waitsFor: Map<string, Set<string>>,
  waitingWorkItemId: string,
  blockingWorkItemId: string,
) => {
  const blockers = waitsFor.get(waitingWorkItemId) ?? new Set<string>();
  blockers.add(blockingWorkItemId);
  waitsFor.set(waitingWorkItemId, blockers);
};

const buildWaitsForGraph = (graph: WorkGraph) => {
  const waitsFor = new Map<string, Set<string>>();
  const childrenByParent = new Map<string, string[]>();

  for (const workItem of graph.workItems) {
    waitsFor.set(workItem.id, new Set());
    childrenByParent.set(workItem.id, []);
  }

  for (const workItem of graph.workItems) {
    if (workItem.parentId !== null) {
      appendWait(waitsFor, workItem.parentId, workItem.id);
      childrenByParent.get(workItem.parentId)?.push(workItem.id);
    }
  }

  for (const dependency of graph.dependencies) {
    const descendants = [dependency.dependentWorkItemId];
    const expanded = new Set<string>();

    while (descendants.length > 0) {
      const dependentWorkItemId = descendants.pop();
      if (!dependentWorkItemId || expanded.has(dependentWorkItemId)) {
        continue;
      }
      expanded.add(dependentWorkItemId);
      appendWait(
        waitsFor,
        dependentWorkItemId,
        dependency.blockerWorkItemId,
      );
      descendants.push(...(childrenByParent.get(dependentWorkItemId) ?? []));
    }
  }

  return waitsFor;
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
const hasCycle = (waitsFor: ReadonlyMap<string, ReadonlySet<string>>) => {
  const incomingEdgeCounts = new Map<string, number>();
  for (const workItemId of waitsFor.keys()) {
    incomingEdgeCounts.set(workItemId, 0);
  }

  for (const blockers of waitsFor.values()) {
    for (const blockerId of blockers) {
      incomingEdgeCounts.set(
        blockerId,
        (incomingEdgeCounts.get(blockerId) ?? 0) + 1,
      );
    }
  }

  const readyWorkItemIds: string[] = [];
  for (const [workItemId, incomingEdgeCount] of incomingEdgeCounts) {
    if (incomingEdgeCount === 0) {
      readyWorkItemIds.push(workItemId);
    }
  }

  let visitedCount = 0;
  for (
    let readyIndex = 0;
    readyIndex < readyWorkItemIds.length;
    readyIndex += 1
  ) {
    const workItemId = readyWorkItemIds[readyIndex];
    if (!workItemId) {
      continue;
    }
    visitedCount += 1;

    for (const blockerId of waitsFor.get(workItemId) ?? []) {
      const nextIncomingEdgeCount =
        (incomingEdgeCounts.get(blockerId) ?? 0) - 1;
      incomingEdgeCounts.set(blockerId, nextIncomingEdgeCount);
      if (nextIncomingEdgeCount === 0) {
        readyWorkItemIds.push(blockerId);
      }
    }
  }

  return visitedCount !== waitsFor.size;
};

export const validateWorkGraph = (graph: WorkGraph): void => {
  for (const workItem of graph.workItems) {
    validateWorkItemFields(workItem);
  }

  const workItemsById = indexWorkItems(graph.workItems);
  validateHierarchy(graph.workItems, workItemsById);
  validatePriorityRanks(graph.workItems);
  validateDependencies(graph.dependencies, workItemsById);
  normalizeAndValidateContextRecords(graph, workItemsById);

  if (hasCycle(buildWaitsForGraph(graph))) {
    throw new WorkGraphError(
      "graph_cycle",
      "The change creates a waits-for cycle.",
    );
  }
};

export const createWorkGraph = (input: WorkGraphInput = {}): WorkGraph => {
  const graphWithoutContext = {
    workItems: (input.workItems ?? []).map(normalizeWorkItem),
    dependencies: (input.dependencies ?? []).map((dependency) => ({
      ...dependency,
    })),
    pullRequests: (input.pullRequests ?? []).map((pullRequest) => ({
      ...pullRequest,
    })),
    workItemPullRequests: (input.workItemPullRequests ?? []).map((link) => ({
      ...link,
    })),
  };
  const graph = {
    ...graphWithoutContext,
    ...normalizeAndValidateContextRecords(
      {
        ...graphWithoutContext,
        contexts: input.contexts ?? [],
        architectureDecisions: input.architectureDecisions ?? [],
        references: input.references ?? [],
        pullRequests: graphWithoutContext.pullRequests,
        workItemPullRequests: graphWithoutContext.workItemPullRequests,
      },
      indexWorkItems(graphWithoutContext.workItems),
    ),
  } satisfies WorkGraph;
  validateWorkGraph(graph);
  return graph;
};

export const getWorkItem = (
  graph: WorkGraph,
  workItemId: string,
): WorkItem => requireWorkItem(indexWorkItems(graph.workItems), workItemId);

export const addWorkItem = (
  graph: WorkGraph,
  input: NewWorkItemInput,
): WorkGraph => {
  const candidate = {
    ...graph,
    workItems: [...graph.workItems, normalizeWorkItem(input)],
  } satisfies WorkGraph;
  validateWorkGraph(candidate);
  return candidate;
};

export const reparentWorkItem = (
  graph: WorkGraph,
  workItemId: string,
  parentId: string | null,
): WorkGraph => {
  const workItemsById = indexWorkItems(graph.workItems);
  requireWorkItem(workItemsById, workItemId);
  if (parentId !== null) {
    requireWorkItem(workItemsById, parentId);
  }

  const candidate = {
    ...graph,
    workItems: graph.workItems.map((workItem) =>
      workItem.id === workItemId
        ? {
            ...workItem,
            parentId,
            rank: workItem.parentId === parentId ? workItem.rank : null,
            priorityRank: parentId === null ? workItem.priorityRank : null,
            schedulingInitiativeId:
              parentId === null ? workItem.schedulingInitiativeId : null,
            schedulingProjectId:
              parentId === null ? workItem.schedulingProjectId : null,
          }
        : workItem,
    ),
  } satisfies WorkGraph;
  validateWorkGraph(candidate);
  return candidate;
};

export const addDependency = (
  graph: WorkGraph,
  dependency: WorkItemDependency,
): WorkGraph => {
  const candidate = {
    ...graph,
    dependencies: [...graph.dependencies, { ...dependency }],
  } satisfies WorkGraph;
  validateWorkGraph(candidate);
  return candidate;
};

export const removeDependency = (
  graph: WorkGraph,
  dependency: WorkItemDependency,
): WorkGraph => {
  const dependencyIndex = graph.dependencies.findIndex(
    (candidate) =>
      candidate.dependentWorkItemId === dependency.dependentWorkItemId &&
      candidate.blockerWorkItemId === dependency.blockerWorkItemId,
  );
  if (dependencyIndex === -1) {
    throw new WorkGraphError(
      "dependency_not_found",
      `Dependency ${dependency.dependentWorkItemId} -> ${dependency.blockerWorkItemId} does not exist.`,
    );
  }

  return {
    ...graph,
    dependencies: graph.dependencies.filter(
      (_candidate, index) => index !== dependencyIndex,
    ),
  };
};

export const getDirectChildren = (
  graph: WorkGraph,
  parentId: string,
): readonly WorkItem[] => {
  getWorkItem(graph, parentId);
  return graph.workItems
    .filter((workItem) => workItem.parentId === parentId)
    .sort(
      (left, right) =>
        (left.rank ?? Number.MAX_SAFE_INTEGER) -
        (right.rank ?? Number.MAX_SAFE_INTEGER),
    );
};

export const getAncestors = (
  graph: WorkGraph,
  workItemId: string,
): readonly WorkItem[] => {
  const workItemsById = indexWorkItems(graph.workItems);
  const ancestors: WorkItem[] = [];
  let current = requireWorkItem(workItemsById, workItemId);

  while (current.parentId !== null) {
    current = requireWorkItem(workItemsById, current.parentId);
    ancestors.push(current);
  }

  return ancestors;
};

export const getEffectiveDependencies = (
  graph: WorkGraph,
  workItemId: string,
): readonly WorkItemDependency[] => {
  const sourceIds = new Set([
    workItemId,
    ...getAncestors(graph, workItemId).map((ancestor) => ancestor.id),
  ]);
  return graph.dependencies.filter((dependency) =>
    sourceIds.has(dependency.dependentWorkItemId),
  );
};

export const getUnsatisfiedDependencies = (
  graph: WorkGraph,
  workItemId: string,
): readonly WorkItemDependency[] => {
  const workItemsById = indexWorkItems(graph.workItems);
  return getEffectiveDependencies(graph, workItemId).filter(
    (dependency) =>
      requireWorkItem(workItemsById, dependency.blockerWorkItemId).lifecycle ===
      "open",
  );
};

const terminateWorkItem = (
  graph: WorkGraph,
  workItemId: string,
  terminalState: TerminalWorkItemState,
): WorkGraph => {
  const workItem = getWorkItem(graph, workItemId);
  if (workItem.lifecycle !== "open") {
    throw new WorkGraphError(
      "work_item_already_terminal",
      `Work item ${workItemId} is already ${workItem.lifecycle}.`,
    );
  }

  return {
    ...graph,
    workItems: graph.workItems.map((candidate) =>
      candidate.id === workItemId
        ? { ...candidate, lifecycle: terminalState }
        : candidate,
    ),
  };
};

export const releaseWorkItem = (
  graph: WorkGraph,
  workItemId: string,
): WorkGraph => terminateWorkItem(graph, workItemId, "released");

export const cancelWorkItem = (
  graph: WorkGraph,
  workItemId: string,
): WorkGraph => terminateWorkItem(graph, workItemId, "cancelled");

export interface DecomposeWorkItemInput {
  readonly parentWorkItemId: string;
  readonly children: readonly (Omit<NewWorkItemInput, "parentId"> & {
    readonly rank: number;
  })[];
  readonly dependencies?: readonly WorkItemDependency[];
}

export const decomposeWorkItem = (
  graph: WorkGraph,
  input: DecomposeWorkItemInput,
): WorkGraph => {
  const parent = getWorkItem(graph, input.parentWorkItemId);
  if (parent.lifecycle !== "open") {
    throw new WorkGraphError(
      "work_item_already_terminal",
      `Work item ${parent.id} is already ${parent.lifecycle}.`,
    );
  }
  if (input.children.length === 0) {
    throw new WorkGraphError(
      "invalid_decomposition",
      `Work item ${parent.id} cannot be decomposed without children.`,
    );
  }

  const ranks = new Set<number>();
  for (const child of input.children) {
    if (
      !Number.isSafeInteger(child.rank) ||
      child.rank <= 0 ||
      child.rank > 2_147_483_647
    ) {
      throw new WorkGraphError(
        "invalid_child_rank",
        `Child work item ${child.id} must have a positive whole-number rank.`,
      );
    }
    if (ranks.has(child.rank)) {
      throw new WorkGraphError(
        "invalid_child_rank",
        `Child rank ${child.rank} is used more than once beneath work item ${parent.id}.`,
      );
    }
    ranks.add(child.rank);
  }

  const candidate = {
    ...graph,
    workItems: [
      ...graph.workItems,
      ...[...input.children]
        .sort((left, right) => left.rank - right.rank)
        .map((child) => normalizeWorkItem({ ...child, parentId: parent.id })),
    ],
    dependencies: [
      ...graph.dependencies,
      ...(input.dependencies ?? []).map((dependency) => ({ ...dependency })),
    ],
  } satisfies WorkGraph;
  validateWorkGraph(candidate);
  return candidate;
};
