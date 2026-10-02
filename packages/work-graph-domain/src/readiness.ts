import {
  getDirectChildren,
  getUnsatisfiedDependencies,
  getWorkItem,
} from "./graph";
import type { WorkGraph, WorkItemOperationalState } from "./model";
import type { WorkStage } from "./vocabulary";

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
  if (workItem.lifecycle !== "open") {
    return workItem.lifecycle;
  }

  if (operationalState.hasUnresolvedBlockingAttention === true) {
    return "needs_attention";
  }

  const currentLease = operationalState.currentLease;
  if (currentLease) {
    const now = operationalState.now ?? Date.now();
    return currentLease.expiresAt > now ? "in_progress" : "stale";
  }

  return hasReadinessBlocker(graph, workItemId) ? "blocked" : "ready";
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
