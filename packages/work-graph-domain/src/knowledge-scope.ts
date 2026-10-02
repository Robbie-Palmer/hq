import { isNonBlankString } from "ts-base/strings";
import { WorkGraphError } from "./errors";
import type {
  KnowledgeScope,
  KnowledgeScopeInput,
  KnowledgeScopeRelationship,
} from "./model";
import {
  KNOWLEDGE_SCOPE_KINDS,
  type KnowledgeScopeKind,
} from "./vocabulary";

const MAX_INT32 = 2_147_483_647;
const MAX_ARCHIVE_REASON_LENGTH = 10_000;

const isKnowledgeScopeKind = (value: unknown): value is KnowledgeScopeKind =>
  typeof value === "string" &&
  (KNOWLEDGE_SCOPE_KINDS as readonly string[]).includes(value);

const requireHttpUrl = (value: unknown, field: string): string => {
  if (typeof value !== "string") {
    throw new WorkGraphError(
      "invalid_knowledge_scope_url",
      `A knowledge scope ${field} must be an HTTP or HTTPS URL.`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new WorkGraphError(
      "invalid_knowledge_scope_url",
      `A knowledge scope ${field} must be an HTTP or HTTPS URL.`,
    );
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new WorkGraphError(
      "invalid_knowledge_scope_url",
      `A knowledge scope ${field} must be an HTTP or HTTPS URL without credentials.`,
    );
  }
  return parsed.href;
};

export const normalizeKnowledgeScopeArchiveReason = (
  value: unknown,
): string => {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > MAX_ARCHIVE_REASON_LENGTH
  ) {
    throw new WorkGraphError(
      "invalid_knowledge_scope_archive_reason",
      "A knowledge scope archive reason must contain between 1 and 10,000 characters.",
    );
  }
  return value;
};

export const createKnowledgeScope = (
  input: KnowledgeScopeInput,
): KnowledgeScope => {
  if (!isNonBlankString(input.id)) {
    throw new WorkGraphError(
      "invalid_knowledge_scope_id",
      "A knowledge scope ID cannot be empty.",
    );
  }
  if (!isKnowledgeScopeKind(input.kind)) {
    throw new WorkGraphError(
      "invalid_knowledge_scope_kind",
      `Knowledge scope ${input.id} has an invalid kind.`,
    );
  }
  if (!isNonBlankString(input.title)) {
    throw new WorkGraphError(
      "invalid_knowledge_scope_title",
      `Knowledge scope ${input.id} must have a title.`,
    );
  }
  if (
    input.sourceRevision !== undefined &&
    input.sourceRevision !== null &&
    !isNonBlankString(input.sourceRevision)
  ) {
    throw new WorkGraphError(
      "invalid_knowledge_scope_source_revision",
      `Knowledge scope ${input.id} has an invalid source revision.`,
    );
  }

  const rank = input.rank ?? null;
  if (
    rank !== null &&
    (!Number.isSafeInteger(rank) || rank <= 0 || rank > MAX_INT32)
  ) {
    throw new WorkGraphError(
      "invalid_knowledge_scope_rank",
      `Knowledge scope ${input.id} must have a positive whole-number rank.`,
    );
  }
  return {
    id: input.id,
    kind: input.kind,
    title: input.title,
    canonicalUrl: requireHttpUrl(input.canonicalUrl, "canonical URL"),
    markdownUrl: requireHttpUrl(input.markdownUrl, "Markdown URL"),
    sourceRevision: input.sourceRevision ?? null,
    lifecycle: "active",
    archiveReason: null,
    rank,
  };
};

const indexKnowledgeScopeRelationships = (
  knowledgeScopeIds: ReadonlySet<string>,
  relationships: readonly KnowledgeScopeRelationship[],
): {
  childrenByParent: ReadonlyMap<string, ReadonlySet<string>>;
  incomingEdges: Map<string, number>;
} => {
  const childrenByParent = new Map<string, Set<string>>();
  const incomingEdges = new Map<string, number>();
  for (const id of knowledgeScopeIds) {
    childrenByParent.set(id, new Set());
    incomingEdges.set(id, 0);
  }

  for (const relationship of relationships) {
    const { childKnowledgeScopeId: childId, parentKnowledgeScopeId: parentId } =
      relationship;
    for (const id of [parentId, childId]) {
      if (!isNonBlankString(id) || !knowledgeScopeIds.has(id)) {
        throw new WorkGraphError(
          "knowledge_scope_not_found",
          `Knowledge scope ${id} does not exist.`,
        );
      }
    }
    if (parentId === childId) {
      throw new WorkGraphError(
        "knowledge_scope_cycle",
        "A knowledge scope cannot contain itself.",
      );
    }
    const children = childrenByParent.get(parentId);
    if (!children) {
      throw new Error("Knowledge scope relationship index is incomplete.");
    }
    if (children.has(childId)) {
      throw new WorkGraphError(
        "knowledge_scope_relationship_already_exists",
        `Knowledge scope relationship ${parentId} -> ${childId} already exists.`,
      );
    }
    children.add(childId);
    incomingEdges.set(childId, (incomingEdges.get(childId) ?? 0) + 1);
  }

  return { childrenByParent, incomingEdges };
};

const validateAcyclicKnowledgeScopeGraph = (
  knowledgeScopeIds: ReadonlySet<string>,
  childrenByParent: ReadonlyMap<string, ReadonlySet<string>>,
  incomingEdges: Map<string, number>,
): void => {

  const ready = [...incomingEdges]
    .filter(([, count]) => count === 0)
    .map(([id]) => id);
  let visited = 0;
  for (const parentId of ready) {
    visited += 1;
    for (const childId of childrenByParent.get(parentId) ?? []) {
      const count = (incomingEdges.get(childId) ?? 0) - 1;
      incomingEdges.set(childId, count);
      if (count === 0) ready.push(childId);
    }
  }
  if (visited !== knowledgeScopeIds.size) {
    throw new WorkGraphError(
      "knowledge_scope_cycle",
      "The change creates a knowledge-scope cycle.",
    );
  }
};

export const validateKnowledgeScopeRelationships = (
  knowledgeScopeIds: ReadonlySet<string>,
  relationships: readonly KnowledgeScopeRelationship[],
): void => {
  const { childrenByParent, incomingEdges } = indexKnowledgeScopeRelationships(
    knowledgeScopeIds,
    relationships,
  );
  validateAcyclicKnowledgeScopeGraph(
    knowledgeScopeIds,
    childrenByParent,
    incomingEdges,
  );
};
