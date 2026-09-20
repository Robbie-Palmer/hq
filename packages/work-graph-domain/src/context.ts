import { WorkGraphError } from "./errors";
import type {
  KnowledgeScope,
  WorkGraph,
  WorkItem,
  WorkItemArchitectureDecision,
  WorkItemContext,
  WorkItemReference,
} from "./model";
import {
  ARCHITECTURE_DECISION_ROLES,
  WORK_ITEM_CONTEXT_KINDS,
  type ArchitectureDecisionRole,
  type WorkItemContextKind,
} from "./vocabulary";

const isNonBlank = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const compareText = (left: string, right: string): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

const normalizeUrl = (value: unknown, label: string): string => {
  if (typeof value !== "string") {
    throw new WorkGraphError(
      "invalid_context_url",
      `${label} must be an HTTP or HTTPS URL.`,
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new WorkGraphError(
      "invalid_context_url",
      `${label} must be an HTTP or HTTPS URL.`,
    );
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new WorkGraphError(
      "invalid_context_url",
      `${label} must be an HTTP or HTTPS URL without credentials.`,
    );
  }
  return parsed.href;
};

const requireWorkItem = (
  workItemsById: ReadonlyMap<string, WorkItem>,
  workItemId: string,
): void => {
  if (!workItemsById.has(workItemId)) {
    throw new WorkGraphError(
      "work_item_not_found",
      `Work item ${workItemId} does not exist.`,
    );
  }
};

const normalizeContexts = (
  contexts: readonly WorkItemContext[],
  workItemsById: ReadonlyMap<string, WorkItem>,
): readonly WorkItemContext[] => {
  const identities = new Set<string>();
  return contexts.map((context) => {
    requireWorkItem(workItemsById, context.workItemId);
    if (
      !(WORK_ITEM_CONTEXT_KINDS as readonly unknown[]).includes(context.kind)
    ) {
      throw new WorkGraphError(
        "invalid_context_kind",
        `Work item ${context.workItemId} has an invalid context kind.`,
      );
    }
    if (!isNonBlank(context.content)) {
      throw new WorkGraphError(
        "invalid_context_content",
        `Work item ${context.workItemId} has empty ${context.kind} context.`,
      );
    }
    const identity = `${context.workItemId}\u0000${context.kind}`;
    if (identities.has(identity)) {
      throw new WorkGraphError(
        "duplicate_context",
        `Work item ${context.workItemId} has more than one ${context.kind} record.`,
      );
    }
    identities.add(identity);
    return { ...context };
  });
};

const normalizeArchitectureDecisions = (
  decisions: readonly WorkItemArchitectureDecision[],
  workItemsById: ReadonlyMap<string, WorkItem>,
): readonly WorkItemArchitectureDecision[] => {
  const identities = new Set<string>();
  return decisions.map((decision) => {
    requireWorkItem(workItemsById, decision.workItemId);
    if (!isNonBlank(decision.title)) {
      throw new WorkGraphError(
        "invalid_architecture_decision_title",
        `Work item ${decision.workItemId} has an architecture decision without a title.`,
      );
    }
    if (
      !(ARCHITECTURE_DECISION_ROLES as readonly unknown[]).includes(
        decision.role,
      )
    ) {
      throw new WorkGraphError(
        "invalid_architecture_decision_role",
        `Work item ${decision.workItemId} has an invalid architecture decision role.`,
      );
    }
    const normalized = {
      ...decision,
      url: normalizeUrl(decision.url, "An architecture decision URL"),
    };
    const identity = `${normalized.workItemId}\u0000${normalized.url}`;
    if (identities.has(identity)) {
      throw new WorkGraphError(
        "duplicate_architecture_decision",
        `Work item ${decision.workItemId} links architecture decision ${normalized.url} more than once.`,
      );
    }
    identities.add(identity);
    return normalized;
  });
};

const normalizeReferences = (
  references: readonly WorkItemReference[],
  workItemsById: ReadonlyMap<string, WorkItem>,
): readonly WorkItemReference[] => {
  const identities = new Set<string>();
  return references.map((reference) => {
    requireWorkItem(workItemsById, reference.workItemId);
    if (!isNonBlank(reference.title)) {
      throw new WorkGraphError(
        "invalid_reference_title",
        `Work item ${reference.workItemId} has a reference without a title.`,
      );
    }
    const normalized = {
      ...reference,
      url: normalizeUrl(reference.url, "A supplemental reference URL"),
    };
    const identity = `${normalized.workItemId}\u0000${normalized.url}`;
    if (identities.has(identity)) {
      throw new WorkGraphError(
        "duplicate_reference",
        `Work item ${reference.workItemId} links reference ${normalized.url} more than once.`,
      );
    }
    identities.add(identity);
    return normalized;
  });
};

export const normalizeAndValidateContextRecords = (
  graph: Pick<
    WorkGraph,
    "contexts" | "architectureDecisions" | "references"
  >,
  workItemsById: ReadonlyMap<string, WorkItem>,
): Pick<
  WorkGraph,
  "contexts" | "architectureDecisions" | "references"
> => ({
  contexts: normalizeContexts(graph.contexts ?? [], workItemsById),
  architectureDecisions: normalizeArchitectureDecisions(
    graph.architectureDecisions ?? [],
    workItemsById,
  ),
  references: normalizeReferences(graph.references ?? [], workItemsById),
});

interface ResolvedContextBase {
  readonly sourceWorkItemId: string;
  readonly inheritanceDepth: number;
}

export type ResolvedWorkItemContext =
  | (ResolvedContextBase & {
      readonly kind: WorkItemContextKind;
      readonly content: string;
    })
  | (ResolvedContextBase & {
      readonly kind: "architecture_decision";
      readonly title: string;
      readonly url: string;
      readonly role: ArchitectureDecisionRole;
    })
  | (ResolvedContextBase & {
      readonly kind: "project" | "initiative";
      readonly scope: KnowledgeScope;
    })
  | (ResolvedContextBase & {
      readonly kind: "reference";
      readonly title: string;
      readonly url: string;
    });

const lineageFor = (
  graph: WorkGraph,
  workItemId: string,
): readonly WorkItem[] => {
  const byId = new Map(graph.workItems.map((item) => [item.id, item]));
  const item = byId.get(workItemId);
  if (!item) {
    throw new WorkGraphError(
      "work_item_not_found",
      `Work item ${workItemId} does not exist.`,
    );
  }
  const lineage = [item];
  let current = item;
  while (current.parentId !== null) {
    const parent = byId.get(current.parentId);
    if (!parent) {
      throw new WorkGraphError(
        "work_item_not_found",
        `Work item ${current.parentId} does not exist.`,
      );
    }
    lineage.push(parent);
    current = parent;
  }
  return lineage;
};

const roleOrder = (role: ArchitectureDecisionRole): number =>
  role === "governing" ? 0 : 1;

const resolveTextContexts = (
  graph: WorkGraph,
  lineage: readonly WorkItem[],
): readonly ResolvedWorkItemContext[] => {
  const resolved: ResolvedWorkItemContext[] = [];
  const resolvedKinds = new Set<WorkItemContextKind>();

  for (const [inheritanceDepth, item] of lineage.entries()) {
    for (const kind of WORK_ITEM_CONTEXT_KINDS) {
      if (resolvedKinds.has(kind)) continue;
      const context = graph.contexts.find(
        (candidate) =>
          candidate.workItemId === item.id && candidate.kind === kind,
      );
      if (!context) continue;
      resolved.push({
        kind,
        content: context.content,
        sourceWorkItemId: item.id,
        inheritanceDepth,
      });
      resolvedKinds.add(kind);
    }
  }
  return resolved;
};

const resolveArchitectureDecisions = (
  graph: WorkGraph,
  lineage: readonly WorkItem[],
): readonly ResolvedWorkItemContext[] => {
  const resolved: ResolvedWorkItemContext[] = [];
  const seenUrls = new Set<string>();

  for (const [inheritanceDepth, item] of lineage.entries()) {
    const decisions = graph.architectureDecisions
      .filter((decision) => decision.workItemId === item.id)
      .sort(
        (left, right) =>
          roleOrder(left.role) - roleOrder(right.role) ||
          compareText(left.url, right.url),
      );
    for (const decision of decisions) {
      if (seenUrls.has(decision.url)) continue;
      seenUrls.add(decision.url);
      resolved.push({
        kind: "architecture_decision",
        title: decision.title,
        url: decision.url,
        role: decision.role,
        sourceWorkItemId: item.id,
        inheritanceDepth,
      });
    }
  }
  return resolved;
};

const resolveKnowledgeScopes = (
  lineage: readonly WorkItem[],
  knowledgeScopes: readonly KnowledgeScope[],
): readonly ResolvedWorkItemContext[] => {
  const ownerDepth = lineage.findIndex(
    (item) =>
      item.schedulingProjectId !== null ||
      item.schedulingInitiativeId !== null,
  );
  const owner = lineage[ownerDepth];
  if (ownerDepth === -1 || !owner) return [];

  const resolved: ResolvedWorkItemContext[] = [];
  for (const [kind, scopeId] of [
    ["project", owner.schedulingProjectId],
    ["initiative", owner.schedulingInitiativeId],
  ] as const) {
    if (scopeId === null) continue;
    const scope = knowledgeScopes.find(
      (candidate) => candidate.id === scopeId && candidate.kind === kind,
    );
    if (!scope) continue;
    resolved.push({
      kind,
      scope,
      sourceWorkItemId: owner.id,
      inheritanceDepth: ownerDepth,
    });
  }
  return resolved;
};

const resolveReferences = (
  graph: WorkGraph,
  lineage: readonly WorkItem[],
): readonly ResolvedWorkItemContext[] => {
  const resolved: ResolvedWorkItemContext[] = [];
  const seenUrls = new Set<string>();

  for (const [inheritanceDepth, item] of lineage.entries()) {
    const references = graph.references
      .filter((reference) => reference.workItemId === item.id)
      .sort((left, right) => compareText(left.url, right.url));
    for (const reference of references) {
      if (seenUrls.has(reference.url)) continue;
      seenUrls.add(reference.url);
      resolved.push({
        kind: "reference",
        title: reference.title,
        url: reference.url,
        sourceWorkItemId: item.id,
        inheritanceDepth,
      });
    }
  }
  return resolved;
};

export const resolveWorkItemContext = (
  graph: WorkGraph,
  workItemId: string,
  knowledgeScopes: readonly KnowledgeScope[] = [],
): readonly ResolvedWorkItemContext[] => {
  const lineage = lineageFor(graph, workItemId);
  return [
    ...resolveTextContexts(graph, lineage),
    ...resolveArchitectureDecisions(graph, lineage),
    ...resolveKnowledgeScopes(lineage, knowledgeScopes),
    ...resolveReferences(graph, lineage),
  ];
};
