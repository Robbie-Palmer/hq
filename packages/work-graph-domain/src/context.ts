import { compareStrings, isNonBlankString } from "ts-base/strings";
import { WorkGraphError } from "./errors";
import type {
  KnowledgeScope,
  PullRequestSnapshot,
  WorkGraph,
  WorkItem,
  WorkItemArchitectureDecision,
  WorkItemContext,
  WorkItemReference,
  WorkItemPullRequest,
} from "./model";
import {
  ARCHITECTURE_DECISION_ROLES,
  PULL_REQUEST_CHECK_SUMMARIES,
  PULL_REQUEST_MERGEABILITIES,
  PULL_REQUEST_REVIEW_DECISIONS,
  PULL_REQUEST_ROLES,
  PULL_REQUEST_STATES,
  WORK_ITEM_CONTEXT_KINDS,
  type ArchitectureDecisionRole,
  type PullRequestRole,
  type WorkItemContextKind,
} from "./vocabulary";

const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const HEAD_SHA_PATTERN = /^[0-9a-f]{40}$/i;

const pullRequestIdentity = (repository: string, number: number): string =>
  `${repository.toLowerCase()}\u0000${number}`;

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
    if (!isNonBlankString(context.content)) {
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
    if (!isNonBlankString(decision.title)) {
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
    if (!isNonBlankString(reference.title)) {
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

const normalizePullRequests = (
  pullRequests: readonly PullRequestSnapshot[],
): readonly PullRequestSnapshot[] => {
  const identities = new Set<string>();
  return pullRequests.map((pullRequest) => {
    if (
      !REPOSITORY_PATTERN.test(pullRequest.repository) ||
      !Number.isSafeInteger(pullRequest.number) ||
      pullRequest.number <= 0 ||
      !HEAD_SHA_PATTERN.test(pullRequest.headSha) ||
      !(PULL_REQUEST_STATES as readonly unknown[]).includes(
        pullRequest.state,
      ) ||
      typeof pullRequest.draft !== "boolean" ||
      !(PULL_REQUEST_MERGEABILITIES as readonly unknown[]).includes(
        pullRequest.mergeability,
      ) ||
      (pullRequest.reviewDecision !== null &&
        !(PULL_REQUEST_REVIEW_DECISIONS as readonly unknown[]).includes(
          pullRequest.reviewDecision,
        )) ||
      !(PULL_REQUEST_CHECK_SUMMARIES as readonly unknown[]).includes(
        pullRequest.checkSummary,
      ) ||
      !Number.isFinite(Date.parse(pullRequest.observedAt))
    ) {
      throw new WorkGraphError(
        "invalid_pull_request",
        `Pull request ${pullRequest.repository}#${pullRequest.number} has an invalid snapshot.`,
      );
    }
    const normalized = {
      ...pullRequest,
      repository: pullRequest.repository.toLowerCase(),
      url: normalizeUrl(pullRequest.url, "A pull request URL"),
      headSha: pullRequest.headSha.toLowerCase(),
      observedAt: new Date(pullRequest.observedAt).toISOString(),
    };
    const identity = pullRequestIdentity(
      normalized.repository,
      normalized.number,
    );
    if (identities.has(identity)) {
      throw new WorkGraphError(
        "duplicate_pull_request",
        `Pull request ${normalized.repository}#${normalized.number} appears more than once.`,
      );
    }
    identities.add(identity);
    return normalized;
  });
};

const normalizeWorkItemPullRequests = (
  links: readonly WorkItemPullRequest[],
  pullRequests: readonly PullRequestSnapshot[],
  workItemsById: ReadonlyMap<string, WorkItem>,
): readonly WorkItemPullRequest[] => {
  const pullRequestIdentities = new Set(
    pullRequests.map(({ repository, number }) =>
      pullRequestIdentity(repository, number),
    ),
  );
  const identities = new Set<string>();
  return links.map((link) => {
    requireWorkItem(workItemsById, link.workItemId);
    const repository = link.repository.toLowerCase();
    const pullRequestKey = pullRequestIdentity(repository, link.number);
    if (!pullRequestIdentities.has(pullRequestKey)) {
      throw new WorkGraphError(
        "pull_request_not_found",
        `Pull request ${repository}#${link.number} does not exist.`,
      );
    }
    if (!(PULL_REQUEST_ROLES as readonly unknown[]).includes(link.role)) {
      throw new WorkGraphError(
        "invalid_pull_request_role",
        `Work item ${link.workItemId} has an invalid pull request role.`,
      );
    }
    const identity = `${link.workItemId}\u0000${pullRequestKey}`;
    if (identities.has(identity)) {
      throw new WorkGraphError(
        "duplicate_work_item_pull_request",
        `Work item ${link.workItemId} links pull request ${repository}#${link.number} more than once.`,
      );
    }
    identities.add(identity);
    return { ...link, repository };
  });
};

export const normalizeAndValidateContextRecords = (
  graph: Pick<
    WorkGraph,
    | "contexts"
    | "architectureDecisions"
    | "references"
    | "pullRequests"
    | "workItemPullRequests"
  >,
  workItemsById: ReadonlyMap<string, WorkItem>,
): Pick<
  WorkGraph,
  | "contexts"
  | "architectureDecisions"
  | "references"
  | "pullRequests"
  | "workItemPullRequests"
> => {
  const pullRequests = normalizePullRequests(graph.pullRequests ?? []);
  return {
    contexts: normalizeContexts(graph.contexts ?? [], workItemsById),
    architectureDecisions: normalizeArchitectureDecisions(
      graph.architectureDecisions ?? [],
      workItemsById,
    ),
    references: normalizeReferences(graph.references ?? [], workItemsById),
    pullRequests,
    workItemPullRequests: normalizeWorkItemPullRequests(
      graph.workItemPullRequests ?? [],
      pullRequests,
      workItemsById,
    ),
  };
};

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
    })
  | (ResolvedContextBase & {
      readonly kind: "pull_request";
      readonly role: PullRequestRole;
      readonly pullRequest: PullRequestSnapshot;
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
          compareStrings(left.url, right.url),
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
      .sort((left, right) => compareStrings(left.url, right.url));
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

const pullRequestRoleOrder = (role: PullRequestRole): number =>
  PULL_REQUEST_ROLES.indexOf(role);

const resolvePullRequests = (
  graph: WorkGraph,
  lineage: readonly WorkItem[],
): readonly ResolvedWorkItemContext[] => {
  const snapshots = new Map(
    graph.pullRequests.map((pullRequest) => [
      pullRequestIdentity(pullRequest.repository, pullRequest.number),
      pullRequest,
    ]),
  );
  const resolved: ResolvedWorkItemContext[] = [];
  const seen = new Set<string>();

  for (const [inheritanceDepth, item] of lineage.entries()) {
    const links = graph.workItemPullRequests
      .filter((link) => link.workItemId === item.id)
      .sort(
        (left, right) =>
          pullRequestRoleOrder(left.role) - pullRequestRoleOrder(right.role) ||
          compareStrings(left.repository, right.repository) ||
          left.number - right.number,
      );
    for (const link of links) {
      const identity = pullRequestIdentity(link.repository, link.number);
      if (seen.has(identity)) continue;
      const pullRequest = snapshots.get(identity);
      if (!pullRequest) continue;
      seen.add(identity);
      resolved.push({
        kind: "pull_request",
        role: link.role,
        pullRequest,
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
    ...resolvePullRequests(graph, lineage),
    ...resolveReferences(graph, lineage),
  ];
};
