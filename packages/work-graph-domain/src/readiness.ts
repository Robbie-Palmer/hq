import {
  getDirectChildren,
  getUnsatisfiedDependencies,
  getWorkItem,
} from "./graph";
import type { WorkGraph, WorkItemOperationalState } from "./model";
import type { WorkItemLifecycle, WorkStage } from "./vocabulary";

export interface WorkItemStageFacts extends WorkItemOperationalState {
  readonly hasUnfinishedDirectChildren: boolean;
  readonly hasUnsatisfiedDependencies: boolean;
  readonly lifecycle: WorkItemLifecycle;
}

export const projectWorkItemStageFromFacts = ({
  lifecycle,
  hasUnfinishedDirectChildren,
  hasUnsatisfiedDependencies,
  hasUnresolvedBlockingAttention,
  currentLease,
  now,
}: WorkItemStageFacts): WorkStage => {
  if (lifecycle !== "open") return lifecycle;
  if (hasUnresolvedBlockingAttention === true) return "needs_attention";
  if (currentLease) {
    return currentLease.expiresAt > (now ?? Date.now())
      ? "in_progress"
      : "stale";
  }
  return hasUnfinishedDirectChildren || hasUnsatisfiedDependencies
    ? "blocked"
    : "ready";
};

const hasUnfinishedDirectChildren = (
  graph: WorkGraph,
  workItemId: string,
) =>
  getDirectChildren(graph, workItemId).some(
    (child) => child.lifecycle === "open",
  );

const hasReadinessBlocker = (graph: WorkGraph, workItemId: string) =>
  hasUnfinishedDirectChildren(graph, workItemId) ||
  getUnsatisfiedDependencies(graph, workItemId).length > 0;

export const projectWorkItemStage = (
  graph: WorkGraph,
  workItemId: string,
  operationalState: WorkItemOperationalState = {},
): WorkStage => {
  const workItem = getWorkItem(graph, workItemId);
  return projectWorkItemStageFromFacts({
    ...operationalState,
    lifecycle: workItem.lifecycle,
    hasUnfinishedDirectChildren: hasUnfinishedDirectChildren(
      graph,
      workItemId,
    ),
    hasUnsatisfiedDependencies:
      getUnsatisfiedDependencies(graph, workItemId).length > 0,
  });
};

export const isWorkItemClaimable = (
  graph: WorkGraph,
  workItemId: string,
  operationalState: WorkItemOperationalState = {},
): boolean => {
  const workItem = getWorkItem(graph, workItemId);
  if (
    workItem.lifecycle !== "open" ||
    operationalState.hasUnresolvedBlockingAttention === true
  ) {
    return false;
  }

  const currentLease = operationalState.currentLease;
  if (currentLease) {
    return currentLease.expiresAt <= (operationalState.now ?? Date.now());
  }

  return !hasReadinessBlocker(graph, workItemId);
};
