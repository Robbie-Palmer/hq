import {
  and,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  createKnowledgeScope,
  createWorkGraph,
  isWorkItemInSelectionScope,
  normalizeAndValidateContextRecords,
  orderWorkItemsByPriority,
  projectWorkItemPriorities,
  projectWorkItemStage,
  resolveWorkItemContext as resolveDomainWorkItemContext,
  validatePostReleaseNote,
  validateKnowledgeScopeRelationships,
  WorkGraphError,
  type KnowledgeScope,
  type KnowledgeScopeInput,
  type KnowledgeScopeRelationship,
  type NewWorkItemInput,
  type PullRequestSnapshot,
  type ResolvedWorkItemContext,
  type TerminalWorkItemState,
  type WorkGraph,
  type WorkItem,
  type WorkItemArchitectureDecision,
  type WorkItemContext,
  type WorkItemDependency,
  type WorkItemPriorityProjection,
  type WorkItemPullRequest,
  type WorkStage,
  type WorkItemReference,
  type WorkItemSelectionScope,
} from "work-graph-domain";
import type { Db, DbTransaction } from "./connection";
import { claimableWorkItemWhere } from "./queries/claimable-work-item";
import {
  graphCycleQuery,
  type GraphCycleRow,
} from "./queries/graph-cycle";
import {
  attentionRequest,
  attentionResolution,
  event,
  graphMutationLock,
  idempotencyKey,
  knowledgeScope,
  knowledgeScopeRelationship,
  lease,
  note,
  pullRequest,
  workItem,
  workItemArchitectureDecision,
  workItemContext,
  workItemDependency,
  workItemHierarchy,
  workItemPriorityContext,
  workItemPullRequest,
  workItemReference,
} from "./schema";

const GRAPH_MUTATION_LOCK_ID = "global";
const EVENT_SEQUENCE_LOCK_ID = "event-sequence";
const PRIORITY_RANK_GAP = 1_024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const WORK_GRAPH_EVENT_TYPES = [
  "attention.requested",
  "attention.resolved",
  "dependency.added",
  "dependency.removed",
  "context.put",
  "knowledge_scope.put",
  "knowledge_scope_relationship.added",
  "knowledge_scope_relationship.removed",
  "reference.put",
  "pull_request.linked",
  "pull_request.refreshed",
  "lease.claimed",
  "lease.ended",
  "lease.renewed",
  "note.created",
  "work_item.created",
  "work_item.decomposed",
  "work_item.expedited",
  "work_item.priority_moved",
  "work_item.lifecycle_changed",
  "work_item.reparented",
  "work_item.scheduling_scope_changed",
  "work_item.unexpedited",
  "knowledge_scope.priority_moved",
] as const;

export type WorkGraphEventType = (typeof WORK_GRAPH_EVENT_TYPES)[number];

export type StoredLease = typeof lease.$inferSelect;
export type StoredNote = typeof note.$inferSelect;
export type StoredEvent = typeof event.$inferSelect;
export type StoredAttentionRequest = typeof attentionRequest.$inferSelect;
export type StoredAttentionResolution =
  typeof attentionResolution.$inferSelect;

export interface ListKnowledgeScopesInput {
  readonly kind?: KnowledgeScope["kind"];
  readonly cursor?: string;
  readonly limit?: number;
}

export interface KnowledgeScopeRelationshipCursor {
  readonly parentKnowledgeScopeId: string;
  readonly childKnowledgeScopeId: string;
}

export interface ListKnowledgeScopeRelationshipsInput {
  readonly cursor?: KnowledgeScopeRelationshipCursor;
  readonly limit?: number;
}

export interface ClaimWorkItemInput {
  readonly leaseId: string;
  readonly workerId: string;
  readonly leaseDurationSeconds: number;
  readonly workItemId?: string;
  readonly initiativeId?: string;
  readonly parentId?: string;
  readonly projectId?: string;
}

export type ListWorkItemsInput = WorkItemSelectionScope;

export interface WorkItemSchedulingScopeInput {
  readonly schedulingInitiativeId: string | null;
  readonly schedulingProjectId: string | null;
}

export interface RenewLeaseInput {
  readonly leaseId: string;
  readonly epoch: number;
  readonly leaseDurationSeconds: number;
}

export interface CompletionEvidence {
  readonly mergeEvidence: string;
  readonly deploymentEvidence: string;
}

interface ClaimedWorkItemTermination {
  readonly leaseId: string;
  readonly epoch: number;
  readonly workItemId: string;
}

export type TerminateClaimedWorkItemInput = ClaimedWorkItemTermination &
  (
    | ({ readonly outcome: "released" } & CompletionEvidence)
    | { readonly outcome: "cancelled" }
  );

export interface DecompositionChildInput
  extends Omit<
    NewWorkItemInput,
    | "parentId"
    | "priorityRank"
    | "schedulingInitiativeId"
    | "schedulingProjectId"
    | "expedited"
    | "expediteReason"
  > {
  readonly rank: number;
}

export interface DecompositionChildClaimInput {
  readonly workItemId: string;
  readonly leaseId: string;
  readonly leaseDurationSeconds: number;
}

export interface DecomposeClaimedWorkItemInput {
  readonly leaseId: string;
  readonly epoch: number;
  readonly workItemId: string;
  readonly children: readonly DecompositionChildInput[];
  readonly dependencies?: readonly WorkItemDependency[];
  readonly claim?: DecompositionChildClaimInput;
}

export interface RankedWorkItem {
  readonly workItem: WorkItem;
  readonly rank: number;
}

export interface DecomposeClaimedWorkItemResult {
  readonly children: readonly RankedWorkItem[];
  readonly dependencies: readonly WorkItemDependency[];
  readonly endedLease: StoredLease;
  readonly claimedLease: StoredLease | null;
}

interface ValidatedDecomposition {
  readonly children: readonly RankedWorkItem[];
  readonly dependencies: readonly WorkItemDependency[];
  readonly fingerprint: string;
}

interface DecompositionValidationState {
  readonly childIds: Set<string>;
  readonly childRanks: Set<number>;
  readonly parentWorkItemId: string;
}

export interface CreateNoteInput {
  readonly id: string;
  readonly workItemId: string;
  readonly leaseId: string;
  readonly epoch: number;
  readonly content: string;
}

export interface CreatePostReleaseNoteInput {
  readonly id: string;
  readonly workItemId: string;
  readonly author: string;
  readonly content: string;
}

export interface CreateAttentionRequestInput {
  readonly id: string;
  readonly workItemId: string;
  readonly leaseId: string;
  readonly epoch: number;
  readonly kind: string;
  readonly question: string;
  readonly note?: string;
  readonly blocking: boolean;
}

export interface CreateAttentionRequestResult {
  readonly attentionRequest: StoredAttentionRequest;
  readonly endedLease: StoredLease | null;
}

export interface ResolveAttentionRequestInput {
  readonly id: string;
  readonly attentionRequestId: string;
  readonly resolution: string;
}

export interface ResolveAttentionRequestResult {
  readonly resolution: StoredAttentionResolution;
  readonly workItemId: string;
}

export interface AttentionRequestReadModel extends StoredAttentionRequest {
  readonly resolution: StoredAttentionResolution | null;
}

export interface ListAttentionRequestsInput {
  readonly workItemId?: string;
  readonly state?: "unresolved" | "resolved";
  readonly blocking?: boolean;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ListWorkItemNotesInput {
  readonly workItemId: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ListEventsInput {
  readonly workItemId?: string;
  readonly type?: WorkGraphEventType;
  readonly lifecycle?: TerminalWorkItemState;
  readonly afterSequence?: number;
  readonly limit?: number;
}

export interface WorkItemDependencyCursor {
  readonly dependentWorkItemId: string;
  readonly blockerWorkItemId: string;
}

export interface ListWorkItemDependenciesInput {
  readonly workItemId: string;
  readonly cursor?: WorkItemDependencyCursor;
  readonly limit?: number;
}

export interface ListWorkItemLeasesInput {
  readonly workItemId: string;
  readonly afterEpoch?: number;
  readonly limit?: number;
}

interface AppendEventInput {
  readonly type: WorkGraphEventType;
  readonly workItemId?: string;
  readonly data: Record<string, unknown>;
  readonly occurredAt?: Date;
}

export interface WorkItemReadModel extends WorkItem {
  readonly stage: WorkStage;
  readonly currentLease: StoredLease | null;
  readonly priority: WorkItemPriorityProjection;
}

export interface PriorityMoveInput {
  readonly higherThanId?: string;
  readonly lowerThanId?: string;
}

export interface IdempotentMutationOptions {
  readonly idempotencyKey?: string;
}

type DatabaseError = Error & {
  code?: string;
  constraint_name?: string;
};

const getDatabaseError = (error: unknown): DatabaseError | undefined => {
  if (!(error instanceof Error)) return undefined;
  if ("code" in error && typeof error.code === "string") {
    return error as DatabaseError;
  }
  if ("cause" in error) {
    return getDatabaseError(error.cause);
  }
  return undefined;
};

const requireIdentifier = (
  value: string,
  code: "invalid_parent_id" | "invalid_work_item_id",
): void => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new WorkGraphError(
      code,
      code === "invalid_parent_id"
        ? "A parent work item ID cannot be empty."
        : "A work item ID cannot be empty.",
    );
  }
};

const requireKnowledgeScopeId = (value: string): void => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new WorkGraphError(
      "invalid_knowledge_scope_id",
      "A knowledge scope ID cannot be empty.",
    );
  }
};

const compareStoredRanks = (
  left: { readonly id: string; readonly rank: number | null },
  right: { readonly id: string; readonly rank: number | null },
): number => {
  if (left.rank === null) {
    return right.rank === null ? left.id.localeCompare(right.id) : 1;
  }
  if (right.rank === null) return -1;
  return left.rank - right.rank || left.id.localeCompare(right.id);
};

const knowledgeScopeNotFound = (id: string) =>
  new WorkGraphError(
    "knowledge_scope_not_found",
    `Knowledge scope ${id} does not exist.`,
  );

const toKnowledgeScope = (
  stored: typeof knowledgeScope.$inferSelect,
): KnowledgeScope => ({
  id: stored.id,
  kind: stored.kind,
  title: stored.title,
  canonicalUrl: stored.canonicalUrl,
  markdownUrl: stored.markdownUrl,
  sourceRevision: stored.sourceRevision,
  rank: stored.rank,
});

const requireLeaseId = (leaseId: string): void => {
  if (typeof leaseId !== "string" || !UUID_PATTERN.test(leaseId)) {
    throw new WorkGraphError(
      "invalid_lease_id",
      "A lease ID must be a UUID.",
    );
  }
};

const requireIdempotencyKey = (key: string): void => {
  if (typeof key !== "string" || !UUID_PATTERN.test(key)) {
    throw new WorkGraphError(
      "invalid_idempotency_key",
      "An idempotency key must be a UUID.",
    );
  }
};

const requireUuid = (
  value: string,
  code:
    | "invalid_attention_request_id"
    | "invalid_attention_resolution_id"
    | "invalid_note_id",
  message: string,
): void => {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new WorkGraphError(code, message);
  }
};

const requireText = (
  value: string,
  code:
    | "invalid_attention_kind"
    | "invalid_attention_question"
    | "invalid_attention_resolution"
    | "invalid_note_content",
  message: string,
): void => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new WorkGraphError(code, message);
  }
};

const requireCompletionEvidence = (evidence: CompletionEvidence): void => {
  for (const [name, value] of [
    ["Merge", evidence.mergeEvidence],
    ["Deployment", evidence.deploymentEvidence],
  ] as const) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new WorkGraphError(
        "invalid_completion_evidence",
        `${name} evidence cannot be empty when releasing completed work.`,
      );
    }
  }
};

const requireWorkerId = (workerId: string): void => {
  if (typeof workerId !== "string" || workerId.trim().length === 0) {
    throw new WorkGraphError(
      "invalid_worker_id",
      "A worker ID cannot be empty.",
    );
  }
};

const requireLeaseDuration = (leaseDurationSeconds: number): void => {
  if (
    !Number.isSafeInteger(leaseDurationSeconds) ||
    leaseDurationSeconds <= 0
  ) {
    throw new WorkGraphError(
      "invalid_lease_duration",
      "A lease duration must be a positive whole number of seconds.",
    );
  }
};

const requireLeaseEpoch = (epoch: number): void => {
  if (!Number.isSafeInteger(epoch) || epoch <= 0) {
    throw new WorkGraphError(
      "invalid_lease_epoch",
      "A lease epoch must be a positive whole number.",
    );
  }
};

const leaseNotCurrent = (leaseId: string, epoch: number): WorkGraphError =>
  new WorkGraphError(
    "lease_not_current",
    `Lease ${leaseId} at epoch ${epoch} is not current and active.`,
  );

const readDatabaseClock = async (
  transaction: DbTransaction,
): Promise<Date> => {
  const [clock] = await transaction.execute<{ currentTime: string }>(sql`
    select clock_timestamp() as "currentTime"
  `);
  if (!clock) {
    throw new Error("Reading the database clock returned no row.");
  }
  return new Date(clock.currentTime);
};

const calculateLeaseExpiry = (
  acquiredAt: Date,
  leaseDurationSeconds: number,
): Date => {
  const expiresAt = new Date(
    acquiredAt.getTime() + leaseDurationSeconds * 1_000,
  );
  if (Number.isNaN(expiresAt.getTime())) {
    throw new WorkGraphError(
      "invalid_lease_duration",
      "The lease duration exceeds the supported timestamp range.",
    );
  }
  return expiresAt;
};

const validateDecompositionChild = (
  child: DecompositionChildInput,
  state: DecompositionValidationState,
): RankedWorkItem => {
  const normalized = createWorkGraph({
    workItems: [
      {
        id: child.id,
        title: child.title,
      },
    ],
  }).workItems[0]!;
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
  if (state.childIds.has(child.id)) {
    throw new WorkGraphError(
      "duplicate_work_item",
      `Work item ${child.id} already exists.`,
    );
  }
  if (state.childRanks.has(child.rank)) {
    throw new WorkGraphError(
      "invalid_child_rank",
      `Child rank ${child.rank} is used more than once beneath work item ${state.parentWorkItemId}.`,
    );
  }
  state.childIds.add(child.id);
  state.childRanks.add(child.rank);
  return {
    workItem: {
      ...normalized,
      parentId: state.parentWorkItemId,
      rank: child.rank,
    },
    rank: child.rank,
  };
};

const validateDecompositionClaim = (
  claim: DecompositionChildClaimInput | undefined,
  childIds: ReadonlySet<string>,
): void => {
  if (claim === undefined) return;
  requireIdentifier(claim.workItemId, "invalid_work_item_id");
  requireLeaseId(claim.leaseId);
  requireLeaseDuration(claim.leaseDurationSeconds);
  if (!childIds.has(claim.workItemId)) {
    throw new WorkGraphError(
      "invalid_decomposition",
      `Claimed work item ${claim.workItemId} must be one of the new children.`,
    );
  }
};

const validateDecomposition = (
  input: DecomposeClaimedWorkItemInput,
  options: IdempotentMutationOptions,
): ValidatedDecomposition => {
  requireLeaseId(input.leaseId);
  requireLeaseEpoch(input.epoch);
  requireIdentifier(input.workItemId, "invalid_work_item_id");
  if (input.children.length === 0) {
    throw new WorkGraphError(
      "invalid_decomposition",
      `Work item ${input.workItemId} cannot be decomposed without children.`,
    );
  }
  if (options.idempotencyKey !== undefined) {
    requireIdempotencyKey(options.idempotencyKey);
  }

  const state: DecompositionValidationState = {
    childIds: new Set<string>(),
    childRanks: new Set<number>(),
    parentWorkItemId: input.workItemId,
  };
  const children = input.children
    .map((child) => validateDecompositionChild(child, state))
    .sort((left, right) => left.rank - right.rank);

  const dependencies = [...(input.dependencies ?? [])];
  for (const dependency of dependencies) {
    requireIdentifier(
      dependency.dependentWorkItemId,
      "invalid_work_item_id",
    );
    requireIdentifier(dependency.blockerWorkItemId, "invalid_work_item_id");
  }
  validateDecompositionClaim(input.claim, state.childIds);

  return {
    children,
    dependencies,
    fingerprint: JSON.stringify([
      input.leaseId,
      input.epoch,
      input.workItemId,
      children.map(({ workItem: child, rank }) => [
        child.id,
        child.title,
        rank,
      ]),
      dependencies.map((dependency) => [
        dependency.dependentWorkItemId,
        dependency.blockerWorkItemId,
      ]),
      input.claim
        ? [
            input.claim.workItemId,
            input.claim.leaseId,
            input.claim.leaseDurationSeconds,
          ]
        : null,
    ]),
  };
};

const throwDecompositionDatabaseError = (
  error: unknown,
  input: DecomposeClaimedWorkItemInput,
): never => {
  if (error instanceof WorkGraphError) throw error;

  const databaseError = getDatabaseError(error);
  switch (`${databaseError?.code}:${databaseError?.constraint_name}`) {
    case "23505:leases_pkey":
      throw new WorkGraphError(
        "duplicate_lease_id",
        `Lease ${input.claim?.leaseId ?? input.leaseId} already exists.`,
      );
    case "23505:work_item_hierarchy_parent_rank_uidx":
      throw new WorkGraphError(
        "invalid_child_rank",
        `A child rank is already in use beneath work item ${input.workItemId}.`,
      );
    case "23505:work_item_dependencies_pk":
      throw new WorkGraphError(
        "dependency_already_exists",
        "A decomposition dependency already exists.",
      );
    case "23514:work_item_dependencies_not_self_check":
      throw new WorkGraphError(
        "self_dependency",
        "A work item cannot depend on itself.",
      );
  }
  if (databaseError?.code === "23505") {
    throw new WorkGraphError(
      "duplicate_work_item",
      "A decomposition child already exists.",
    );
  }
  throw error;
};

const workItemNotFound = (workItemId: string): WorkGraphError =>
  new WorkGraphError(
    "work_item_not_found",
    `Work item ${workItemId} does not exist.`,
  );

const translateForeignKeyError = (
  error: unknown,
  workItemId: string,
): never => {
  if (getDatabaseError(error)?.code === "23503") {
    throw workItemNotFound(workItemId);
  }
  throw error;
};

export class WorkGraphRepository {
  constructor(private readonly db: Db) {}

  async listKnowledgeScopes(
    input: ListKnowledgeScopesInput = {},
  ): Promise<readonly KnowledgeScope[]> {
    const query = this.db
      .select()
      .from(knowledgeScope)
      .where(
        and(
          input.kind === undefined
            ? undefined
            : eq(knowledgeScope.kind, input.kind),
          input.cursor === undefined
            ? undefined
            : gt(knowledgeScope.id, input.cursor),
        ),
      )
      .orderBy(knowledgeScope.id);
    const rows =
      input.limit === undefined ? await query : await query.limit(input.limit);
    return rows.map(toKnowledgeScope);
  }

  async getKnowledgeScope(id: string): Promise<KnowledgeScope> {
    requireKnowledgeScopeId(id);
    const [stored] = await this.db
      .select()
      .from(knowledgeScope)
      .where(eq(knowledgeScope.id, id))
      .limit(1);
    if (!stored) throw knowledgeScopeNotFound(id);
    return toKnowledgeScope(stored);
  }

  async putKnowledgeScope(
    input: KnowledgeScopeInput,
    options: IdempotentMutationOptions = {},
  ): Promise<KnowledgeScope> {
    const normalized = createKnowledgeScope(input);
    if (options.idempotencyKey !== undefined) {
      requireIdempotencyKey(options.idempotencyKey);
    }

    return this.db.transaction(async (transaction) => {
      await this.lockEventSequence(transaction);
      if (options.idempotencyKey !== undefined) {
        const replayed = await this.beginIdempotentMutation(
          transaction,
          options.idempotencyKey,
          "put-knowledge-scope",
          JSON.stringify(normalized),
        );
        if (replayed) {
          return this.requireStoredKnowledgeScope(transaction, normalized.id);
        }
      }

      await this.lockGraphMutation(transaction);
      const [existing] = await transaction
        .select({ kind: knowledgeScope.kind, rank: knowledgeScope.rank })
        .from(knowledgeScope)
        .where(eq(knowledgeScope.id, normalized.id))
        .limit(1);
      if (existing && existing.kind !== normalized.kind) {
        throw new WorkGraphError(
          "invalid_knowledge_scope_kind",
          `Knowledge scope ${normalized.id} cannot change kind after creation.`,
        );
      }

      const [stored] = await transaction
        .insert(knowledgeScope)
        .values({ ...normalized, rank: existing?.rank ?? null })
        .onConflictDoUpdate({
          target: knowledgeScope.id,
          set: {
            kind: normalized.kind,
            title: normalized.title,
            canonicalUrl: normalized.canonicalUrl,
            markdownUrl: normalized.markdownUrl,
            sourceRevision: normalized.sourceRevision,
            rank: existing?.rank ?? null,
          },
        })
        .returning();
      if (!stored) throw new Error("Knowledge scope upsert returned no row.");
      if (!existing) {
        await this.placeKnowledgeScopeAtMedian(
          transaction,
          normalized.id,
          normalized.kind,
        );
      }
      const result = await this.requireStoredKnowledgeScope(
        transaction,
        normalized.id,
      );
      await this.appendEvent(transaction, {
        type: "knowledge_scope.put",
        data: {
          id: normalized.id,
          kind: normalized.kind,
          title: normalized.title,
          canonicalUrl: normalized.canonicalUrl,
          markdownUrl: normalized.markdownUrl,
          sourceRevision: normalized.sourceRevision,
          rank: result.rank,
        },
      });
      return result;
    });
  }

  async moveKnowledgeScopePriority(
    id: string,
    input: PriorityMoveInput,
    options: IdempotentMutationOptions = {},
  ): Promise<KnowledgeScope> {
    requireKnowledgeScopeId(id);
    if (input.higherThanId !== undefined) {
      requireKnowledgeScopeId(input.higherThanId);
    }
    if (input.lowerThanId !== undefined) {
      requireKnowledgeScopeId(input.lowerThanId);
    }
    if (options.idempotencyKey !== undefined) {
      requireIdempotencyKey(options.idempotencyKey);
    }

    return this.db.transaction(async (transaction) => {
      await this.lockEventSequence(transaction);
      if (options.idempotencyKey !== undefined) {
        const replayed = await this.beginIdempotentMutation(
          transaction,
          options.idempotencyKey,
          "move-knowledge-scope-priority",
          JSON.stringify([id, input.higherThanId, input.lowerThanId]),
        );
        if (replayed) return this.requireStoredKnowledgeScope(transaction, id);
      }

      await this.lockGraphMutation(transaction);
      const target = await this.requireStoredKnowledgeScope(transaction, id);
      const rows = await transaction
        .select({ id: knowledgeScope.id, rank: knowledgeScope.rank })
        .from(knowledgeScope)
        .where(eq(knowledgeScope.kind, target.kind));
      rows.sort(compareStoredRanks);
      const orderedIds = rows
        .map(({ id: candidateId }) => candidateId)
        .filter((candidateId) => candidateId !== id);
      const index = this.insertionIndex(orderedIds, input);
      orderedIds.splice(index, 0, id);
      await this.writeKnowledgeScopeRanks(transaction, orderedIds);
      const moved = await this.requireStoredKnowledgeScope(transaction, id);
      await this.appendEvent(transaction, {
        type: "knowledge_scope.priority_moved",
        data: {
          id,
          higherThanId: input.higherThanId ?? null,
          lowerThanId: input.lowerThanId ?? null,
          rank: moved.rank,
        },
      });
      return moved;
    });
  }

  async listKnowledgeScopeRelationships(
    input: ListKnowledgeScopeRelationshipsInput = {},
  ): Promise<
    readonly KnowledgeScopeRelationship[]
  > {
    const query = this.db
      .select({
        parentKnowledgeScopeId:
          knowledgeScopeRelationship.parentKnowledgeScopeId,
        childKnowledgeScopeId:
          knowledgeScopeRelationship.childKnowledgeScopeId,
      })
      .from(knowledgeScopeRelationship)
      .where(
        input.cursor === undefined
          ? undefined
          : or(
              gt(
                knowledgeScopeRelationship.parentKnowledgeScopeId,
                input.cursor.parentKnowledgeScopeId,
              ),
              and(
                eq(
                  knowledgeScopeRelationship.parentKnowledgeScopeId,
                  input.cursor.parentKnowledgeScopeId,
                ),
                gt(
                  knowledgeScopeRelationship.childKnowledgeScopeId,
                  input.cursor.childKnowledgeScopeId,
                ),
              ),
            ),
      )
      .orderBy(
        knowledgeScopeRelationship.parentKnowledgeScopeId,
        knowledgeScopeRelationship.childKnowledgeScopeId,
      );
    return input.limit === undefined ? query : query.limit(input.limit);
  }

  async addKnowledgeScopeRelationship(
    relationship: KnowledgeScopeRelationship,
    options: IdempotentMutationOptions = {},
  ): Promise<void> {
    if (options.idempotencyKey !== undefined) {
      requireIdempotencyKey(options.idempotencyKey);
    }

    await this.db.transaction(async (transaction) => {
      await this.lockEventSequence(transaction);
      if (options.idempotencyKey !== undefined) {
        const replayed = await this.beginIdempotentMutation(
          transaction,
          options.idempotencyKey,
          "add-knowledge-scope-relationship",
          JSON.stringify(relationship),
        );
        if (replayed) return;
      }

      await this.lockGraphMutation(transaction);
      const graph = await this.loadKnowledgeScopeGraph(transaction);
      validateKnowledgeScopeRelationships(graph.ids, [
        ...graph.relationships,
        relationship,
      ]);
      await transaction.insert(knowledgeScopeRelationship).values(relationship);
      await this.appendEvent(transaction, {
        type: "knowledge_scope_relationship.added",
        data: {
          parentKnowledgeScopeId: relationship.parentKnowledgeScopeId,
          childKnowledgeScopeId: relationship.childKnowledgeScopeId,
        },
      });
    });
  }

  async removeKnowledgeScopeRelationship(
    relationship: KnowledgeScopeRelationship,
    options: IdempotentMutationOptions = {},
  ): Promise<void> {
    if (options.idempotencyKey !== undefined) {
      requireIdempotencyKey(options.idempotencyKey);
    }

    await this.db.transaction(async (transaction) => {
      await this.lockEventSequence(transaction);
      if (options.idempotencyKey !== undefined) {
        const replayed = await this.beginIdempotentMutation(
          transaction,
          options.idempotencyKey,
          "remove-knowledge-scope-relationship",
          JSON.stringify(relationship),
        );
        if (replayed) return;
      }

      await this.lockGraphMutation(transaction);
      const [scheduledWork] = await transaction
        .select({ workItemId: workItemPriorityContext.workItemId })
        .from(workItemPriorityContext)
        .where(
          and(
            eq(
              workItemPriorityContext.schedulingInitiativeId,
              relationship.parentKnowledgeScopeId,
            ),
            eq(
              workItemPriorityContext.schedulingProjectId,
              relationship.childKnowledgeScopeId,
            ),
          ),
        )
        .limit(1);
      if (scheduledWork) {
        throw new WorkGraphError(
          "invalid_scheduling_scope",
          `Knowledge scope relationship ${relationship.parentKnowledgeScopeId} -> ${relationship.childKnowledgeScopeId} schedules work item ${scheduledWork.workItemId} and cannot be removed.`,
        );
      }
      const removed = await transaction
        .delete(knowledgeScopeRelationship)
        .where(
          and(
            eq(
              knowledgeScopeRelationship.parentKnowledgeScopeId,
              relationship.parentKnowledgeScopeId,
            ),
            eq(
              knowledgeScopeRelationship.childKnowledgeScopeId,
              relationship.childKnowledgeScopeId,
            ),
          ),
        )
        .returning({
          parentKnowledgeScopeId:
            knowledgeScopeRelationship.parentKnowledgeScopeId,
        });
      if (removed.length === 0) {
        throw new WorkGraphError(
          "knowledge_scope_relationship_not_found",
          `Knowledge scope relationship ${relationship.parentKnowledgeScopeId} -> ${relationship.childKnowledgeScopeId} does not exist.`,
        );
      }
      await this.appendEvent(transaction, {
        type: "knowledge_scope_relationship.removed",
        data: {
          parentKnowledgeScopeId: relationship.parentKnowledgeScopeId,
          childKnowledgeScopeId: relationship.childKnowledgeScopeId,
        },
      });
    });
  }

  async load(): Promise<WorkGraph> {
    return this.db.transaction(
      (transaction) => this.loadGraph(transaction),
      {
        isolationLevel: "repeatable read",
        accessMode: "read only",
      },
    );
  }

  async listWorkItems(
    input: ListWorkItemsInput = {},
  ): Promise<readonly WorkItemReadModel[]> {
    return this.db.transaction(
      async (transaction) => {
        const graph = await this.loadGraph(transaction);
        const scopes = await this.loadKnowledgeScopes(transaction);
        const currentLeases = await transaction
          .select()
          .from(lease)
          .where(isNull(lease.endedAt));
        const unresolvedBlockingAttention = await transaction
          .select({ workItemId: attentionRequest.workItemId })
          .from(attentionRequest)
          .leftJoin(
            attentionResolution,
            eq(
              attentionResolution.attentionRequestId,
              attentionRequest.id,
            ),
          )
          .where(
            and(
              eq(attentionRequest.blocking, true),
              isNull(attentionResolution.id),
            ),
          );
        const now = await readDatabaseClock(transaction);
        const leasesByWorkItemId = new Map(
          currentLeases.map((storedLease) => [
            storedLease.workItemId,
            storedLease,
          ]),
        );
        const workItemIdsNeedingAttention = new Set(
          unresolvedBlockingAttention.map(({ workItemId }) => workItemId),
        );
        const priorities = projectWorkItemPriorities(graph, scopes);

        return orderWorkItemsByPriority(graph, scopes)
          .filter((item) => isWorkItemInSelectionScope(graph, item, input))
          .map((item) => {
            const currentLease = leasesByWorkItemId.get(item.id) ?? null;
            return {
              ...item,
              stage: projectWorkItemStage(graph, item.id, {
                currentLease: currentLease
                  ? { expiresAt: currentLease.expiresAt.getTime() }
                  : null,
                now: now.getTime(),
                hasUnresolvedBlockingAttention:
                  workItemIdsNeedingAttention.has(item.id),
              }),
              currentLease,
              priority: priorities.get(item.id)!,
            };
          });
      },
      {
        isolationLevel: "repeatable read",
        accessMode: "read only",
      },
    );
  }

  async getWorkItem(workItemId: string): Promise<WorkItemReadModel> {
    requireIdentifier(workItemId, "invalid_work_item_id");
    const found = (await this.listWorkItems()).find(
      (item) => item.id === workItemId,
    );
    if (!found) throw workItemNotFound(workItemId);
    return found;
  }

  async resolveWorkItemContext(
    workItemId: string,
  ): Promise<readonly ResolvedWorkItemContext[]> {
    requireIdentifier(workItemId, "invalid_work_item_id");
    return this.db.transaction(
      async (transaction) => {
        const graph = await this.loadGraph(transaction);
        return resolveDomainWorkItemContext(
          graph,
          workItemId,
          await this.loadKnowledgeScopes(transaction),
        );
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  }

  async putWorkItemContext(
    input: WorkItemContext,
    options: IdempotentMutationOptions = {},
  ): Promise<WorkItemContext> {
    if (options.idempotencyKey !== undefined) {
      requireIdempotencyKey(options.idempotencyKey);
    }
    return this.db.transaction(async (transaction) => {
      await this.lockEventSequence(transaction);
      const item = await this.requireGraphWorkItem(transaction, input.workItemId);
      const [normalized] = normalizeAndValidateContextRecords(
        {
          contexts: [input],
          architectureDecisions: [],
          references: [],
          pullRequests: [],
          workItemPullRequests: [],
        },
        new Map([[item.id, item]]),
      ).contexts;
      if (!normalized) throw new Error("Context validation returned no record.");
      if (options.idempotencyKey !== undefined) {
        const replayed = await this.beginIdempotentMutation(
          transaction,
          options.idempotencyKey,
          "put-work-item-context",
          JSON.stringify(normalized),
        );
        if (replayed) {
          const [stored] = await transaction
            .select({
              workItemId: workItemContext.workItemId,
              kind: workItemContext.kind,
              content: workItemContext.content,
            })
            .from(workItemContext)
            .where(
              and(
                eq(workItemContext.workItemId, normalized.workItemId),
                eq(workItemContext.kind, normalized.kind),
              ),
            )
            .limit(1);
          if (!stored) throw workItemNotFound(normalized.workItemId);
          return stored;
        }
      }
      const [stored] = await transaction
        .insert(workItemContext)
        .values(normalized)
        .onConflictDoUpdate({
          target: [workItemContext.workItemId, workItemContext.kind],
          set: { content: normalized.content },
        })
        .returning({
          workItemId: workItemContext.workItemId,
          kind: workItemContext.kind,
          content: workItemContext.content,
        });
      if (!stored) throw new Error("Context upsert returned no row.");
      await this.appendEvent(transaction, {
        type: "context.put",
        workItemId: stored.workItemId,
        data: { kind: stored.kind, content: stored.content },
      });
      return stored;
    });
  }

  async putWorkItemArchitectureDecision(
    input: WorkItemArchitectureDecision,
    options: IdempotentMutationOptions = {},
  ): Promise<WorkItemArchitectureDecision> {
    if (options.idempotencyKey !== undefined) {
      requireIdempotencyKey(options.idempotencyKey);
    }
    return this.db.transaction(async (transaction) => {
      await this.lockEventSequence(transaction);
      const item = await this.requireGraphWorkItem(transaction, input.workItemId);
      const [normalized] = normalizeAndValidateContextRecords(
        {
          contexts: [],
          architectureDecisions: [input],
          references: [],
          pullRequests: [],
          workItemPullRequests: [],
        },
        new Map([[item.id, item]]),
      ).architectureDecisions;
      if (!normalized) throw new Error("ADR validation returned no record.");
      if (options.idempotencyKey !== undefined) {
        const replayed = await this.beginIdempotentMutation(
          transaction,
          options.idempotencyKey,
          "put-work-item-architecture-decision",
          JSON.stringify(normalized),
        );
        if (replayed) {
          const [stored] = await transaction
            .select({
              workItemId: workItemArchitectureDecision.workItemId,
              title: workItemArchitectureDecision.title,
              url: workItemArchitectureDecision.url,
              role: workItemArchitectureDecision.role,
            })
            .from(workItemArchitectureDecision)
            .where(
              and(
                eq(
                  workItemArchitectureDecision.workItemId,
                  normalized.workItemId,
                ),
                eq(workItemArchitectureDecision.url, normalized.url),
              ),
            )
            .limit(1);
          if (!stored) throw workItemNotFound(normalized.workItemId);
          return stored;
        }
      }
      const [stored] = await transaction
        .insert(workItemArchitectureDecision)
        .values(normalized)
        .onConflictDoUpdate({
          target: [
            workItemArchitectureDecision.workItemId,
            workItemArchitectureDecision.url,
          ],
          set: { title: normalized.title, role: normalized.role },
        })
        .returning({
          workItemId: workItemArchitectureDecision.workItemId,
          title: workItemArchitectureDecision.title,
          url: workItemArchitectureDecision.url,
          role: workItemArchitectureDecision.role,
        });
      if (!stored) throw new Error("ADR upsert returned no row.");
      await this.appendEvent(transaction, {
        type: "context.put",
        workItemId: stored.workItemId,
        data: {
          kind: "architecture_decision",
          title: stored.title,
          url: stored.url,
          role: stored.role,
        },
      });
      return stored;
    });
  }

  async putWorkItemReference(
    input: WorkItemReference,
    options: IdempotentMutationOptions = {},
  ): Promise<WorkItemReference> {
    if (options.idempotencyKey !== undefined) {
      requireIdempotencyKey(options.idempotencyKey);
    }
    return this.db.transaction(async (transaction) => {
      await this.lockEventSequence(transaction);
      const item = await this.requireGraphWorkItem(transaction, input.workItemId);
      const [normalized] = normalizeAndValidateContextRecords(
        {
          contexts: [],
          architectureDecisions: [],
          references: [input],
          pullRequests: [],
          workItemPullRequests: [],
        },
        new Map([[item.id, item]]),
      ).references;
      if (!normalized) throw new Error("Reference validation returned no record.");
      if (options.idempotencyKey !== undefined) {
        const replayed = await this.beginIdempotentMutation(
          transaction,
          options.idempotencyKey,
          "put-work-item-reference",
          JSON.stringify(normalized),
        );
        if (replayed) {
          const [stored] = await transaction
            .select({
              workItemId: workItemReference.workItemId,
              title: workItemReference.title,
              url: workItemReference.url,
            })
            .from(workItemReference)
            .where(
              and(
                eq(workItemReference.workItemId, normalized.workItemId),
                eq(workItemReference.url, normalized.url),
              ),
            )
            .limit(1);
          if (!stored) throw workItemNotFound(normalized.workItemId);
          return stored;
        }
      }
      const [stored] = await transaction
        .insert(workItemReference)
        .values(normalized)
        .onConflictDoUpdate({
          target: [workItemReference.workItemId, workItemReference.url],
          set: { title: normalized.title },
        })
        .returning({
          workItemId: workItemReference.workItemId,
          title: workItemReference.title,
          url: workItemReference.url,
        });
      if (!stored) throw new Error("Reference upsert returned no row.");
      await this.appendEvent(transaction, {
        type: "reference.put",
        workItemId: stored.workItemId,
        data: { title: stored.title, url: stored.url },
      });
      return stored;
    });
  }

  async refreshPullRequest(
    input: PullRequestSnapshot,
    options: IdempotentMutationOptions = {},
  ): Promise<PullRequestSnapshot> {
    const [normalized] = createWorkGraph({
      pullRequests: [input],
    }).pullRequests;
    if (!normalized) {
      throw new Error("Pull request validation returned no snapshot.");
    }
    if (options.idempotencyKey !== undefined) {
      requireIdempotencyKey(options.idempotencyKey);
    }

    return this.db.transaction(async (transaction) => {
      await this.lockEventSequence(transaction);
      if (options.idempotencyKey !== undefined) {
        const replayed = await this.beginIdempotentMutation(
          transaction,
          options.idempotencyKey,
          "refresh-pull-request",
          JSON.stringify(normalized),
        );
        if (replayed) {
          return this.requireStoredPullRequest(
            transaction,
            normalized.repository,
            normalized.number,
          );
        }
      }

      const refreshed = await transaction
        .insert(pullRequest)
        .values({
          ...normalized,
          observedAt: new Date(normalized.observedAt),
        })
        .onConflictDoUpdate({
          target: [pullRequest.repository, pullRequest.number],
          set: {
            url: normalized.url,
            headSha: normalized.headSha,
            state: normalized.state,
            draft: normalized.draft,
            mergeability: normalized.mergeability,
            reviewDecision: normalized.reviewDecision,
            checkSummary: normalized.checkSummary,
            observedAt: new Date(normalized.observedAt),
          },
          setWhere: lte(
            pullRequest.observedAt,
            new Date(normalized.observedAt),
          ),
        })
        .returning({ repository: pullRequest.repository });
      if (refreshed.length > 0) {
        await this.appendEvent(transaction, {
          type: "pull_request.refreshed",
          data: { ...normalized },
        });
      }
      return this.requireStoredPullRequest(
        transaction,
        normalized.repository,
        normalized.number,
      );
    });
  }

  async putWorkItemPullRequest(
    input: WorkItemPullRequest,
    options: IdempotentMutationOptions = {},
  ): Promise<WorkItemPullRequest> {
    if (options.idempotencyKey !== undefined) {
      requireIdempotencyKey(options.idempotencyKey);
    }
    return this.db.transaction(async (transaction) => {
      await this.lockEventSequence(transaction);
      const item = await this.requireGraphWorkItem(transaction, input.workItemId);
      const snapshot = await this.requireStoredPullRequest(
        transaction,
        input.repository.toLowerCase(),
        input.number,
      );
      const [normalized] = normalizeAndValidateContextRecords(
        {
          contexts: [],
          architectureDecisions: [],
          references: [],
          pullRequests: [snapshot],
          workItemPullRequests: [input],
        },
        new Map([[item.id, item]]),
      ).workItemPullRequests;
      if (!normalized) {
        throw new Error("Pull request link validation returned no record.");
      }
      if (options.idempotencyKey !== undefined) {
        const replayed = await this.beginIdempotentMutation(
          transaction,
          options.idempotencyKey,
          "put-work-item-pull-request",
          JSON.stringify(normalized),
        );
        if (replayed) return normalized;
      }

      await transaction
        .insert(workItemPullRequest)
        .values(normalized)
        .onConflictDoUpdate({
          target: [
            workItemPullRequest.workItemId,
            workItemPullRequest.repository,
            workItemPullRequest.number,
          ],
          set: { role: normalized.role },
        });
      await this.appendEvent(transaction, {
        type: "pull_request.linked",
        workItemId: normalized.workItemId,
        data: {
          repository: normalized.repository,
          number: normalized.number,
          role: normalized.role,
        },
      });
      return normalized;
    });
  }

  async createWorkItem(
    input: NewWorkItemInput,
    options: IdempotentMutationOptions = {},
  ): Promise<WorkItem> {
    const [normalized] = createWorkGraph({
      workItems: [{ ...input, parentId: null }],
    }).workItems;
    if (!normalized) {
      throw new Error("Work item validation returned no work item.");
    }

    const parentId = input.parentId ?? null;
    if (parentId !== null) {
      requireIdentifier(parentId, "invalid_parent_id");
    }
    if (options.idempotencyKey !== undefined) {
      requireIdempotencyKey(options.idempotencyKey);
    }

    try {
      return await this.db.transaction(async (transaction) => {
        await this.lockEventSequence(transaction);
        if (options.idempotencyKey !== undefined) {
          const replayed = await this.beginIdempotentMutation(
            transaction,
            options.idempotencyKey,
            "create-work-item",
            JSON.stringify([
              normalized.id,
              normalized.title,
              parentId,
              normalized.schedulingInitiativeId,
              normalized.schedulingProjectId,
              normalized.expedited,
              normalized.expediteReason,
            ]),
          );
          if (replayed) {
            const replayedGraph = await this.loadGraph(transaction);
            const replayedItem = replayedGraph.workItems.find(
              ({ id }) => id === normalized.id,
            );
            if (!replayedItem) throw workItemNotFound(normalized.id);
            return replayedItem;
          }
        }

        await this.lockGraphMutation(transaction);
        if (
          parentId !== null &&
          (normalized.schedulingInitiativeId !== null ||
            normalized.schedulingProjectId !== null)
        ) {
          throw new WorkGraphError(
            "invalid_scheduling_scope",
            "Only a priority-owning ticket can set scheduling scopes; children inherit them.",
          );
        }
        const scheduling =
          parentId === null
            ? await this.validateSchedulingScopes(transaction, normalized)
            : { initiativeId: null, projectId: null };

        await transaction.insert(workItem).values({
          id: normalized.id,
          title: normalized.title,
          expedited: normalized.expedited,
          expediteReason: normalized.expediteReason,
        });

        if (parentId !== null) {
          await transaction.insert(workItemHierarchy).values({
            childWorkItemId: normalized.id,
            parentWorkItemId: parentId,
          });
          await this.rejectCycle(transaction);
        } else {
          await transaction.insert(workItemPriorityContext).values({
            workItemId: normalized.id,
            schedulingInitiativeId: scheduling.initiativeId,
            schedulingProjectId: scheduling.projectId,
            rank: null,
          });
          await this.placeWorkItemAtMedian(
            transaction,
            normalized.id,
            scheduling.projectId,
          );
        }

        await this.appendEvent(transaction, {
          type: "work_item.created",
          workItemId: normalized.id,
          data: {
            title: normalized.title,
            parentId,
            rank: null,
            priorityRank:
              parentId === null
                ? (
                    await this.requireStoredPriorityContext(
                      transaction,
                      normalized.id,
                    )
                  ).rank
                : null,
            schedulingInitiativeId: scheduling.initiativeId,
            schedulingProjectId: scheduling.projectId,
          },
        });

        const createdGraph = await this.loadGraph(transaction);
        return createdGraph.workItems.find(({ id }) => id === normalized.id)!;
      });
    } catch (error) {
      const databaseError = getDatabaseError(error);
      if (databaseError?.code === "23505") {
        throw new WorkGraphError(
          "duplicate_work_item",
          `Work item ${normalized.id} already exists.`,
        );
      }
      if (
        databaseError?.code === "23514" &&
        databaseError.constraint_name === "work_item_hierarchy_not_self_check"
      ) {
        throw new WorkGraphError(
          "graph_cycle",
          "The change creates a waits-for cycle.",
        );
      }
      return translateForeignKeyError(error, parentId ?? normalized.id);
    }
  }

  async moveWorkItemPriority(
    workItemId: string,
    input: PriorityMoveInput,
    options: IdempotentMutationOptions = {},
  ): Promise<WorkItem> {
    requireIdentifier(workItemId, "invalid_work_item_id");
    if (input.higherThanId !== undefined) {
      requireIdentifier(input.higherThanId, "invalid_work_item_id");
    }
    if (input.lowerThanId !== undefined) {
      requireIdentifier(input.lowerThanId, "invalid_work_item_id");
    }
    if (options.idempotencyKey !== undefined) {
      requireIdempotencyKey(options.idempotencyKey);
    }

    return this.db.transaction(async (transaction) => {
      await this.lockEventSequence(transaction);
      if (options.idempotencyKey !== undefined) {
        const replayed = await this.beginIdempotentMutation(
          transaction,
          options.idempotencyKey,
          "move-work-item-priority",
          JSON.stringify([workItemId, input.higherThanId, input.lowerThanId]),
        );
        if (replayed) {
          return this.requireGraphWorkItem(transaction, workItemId);
        }
      }

      await this.lockGraphMutation(transaction);
      const context = await this.requireStoredPriorityContext(
        transaction,
        workItemId,
      );
      const orderedIds = (
        await this.listPriorityOwnerIds(
          transaction,
          context.schedulingProjectId,
        )
      ).filter((id) => id !== workItemId);
      const index = this.insertionIndex(orderedIds, input);
      orderedIds.splice(index, 0, workItemId);
      await this.writeWorkItemPriorityRanks(transaction, orderedIds);
      const moved = await this.requireStoredPriorityContext(
        transaction,
        workItemId,
      );
      await this.appendEvent(transaction, {
        type: "work_item.priority_moved",
        workItemId,
        data: {
          higherThanId: input.higherThanId ?? null,
          lowerThanId: input.lowerThanId ?? null,
          priorityRank: moved.rank,
          schedulingProjectId: moved.schedulingProjectId,
        },
      });
      return this.requireGraphWorkItem(transaction, workItemId);
    });
  }

  async setWorkItemSchedulingScope(
    workItemId: string,
    input: WorkItemSchedulingScopeInput,
    options: IdempotentMutationOptions = {},
  ): Promise<WorkItem> {
    requireIdentifier(workItemId, "invalid_work_item_id");
    if (options.idempotencyKey !== undefined) {
      requireIdempotencyKey(options.idempotencyKey);
    }

    return this.db.transaction(async (transaction) => {
      await this.lockEventSequence(transaction);
      if (options.idempotencyKey !== undefined) {
        const replayed = await this.beginIdempotentMutation(
          transaction,
          options.idempotencyKey,
          "set-work-item-scheduling-scope",
          JSON.stringify([workItemId, input]),
        );
        if (replayed) {
          return this.requireGraphWorkItem(transaction, workItemId);
        }
      }

      await this.lockGraphMutation(transaction);
      const current = await this.requireStoredPriorityContext(
        transaction,
        workItemId,
      );
      const scheduling = await this.validateSchedulingScopes(transaction, {
        schedulingInitiativeId: input.schedulingInitiativeId,
        schedulingProjectId: input.schedulingProjectId,
      });
      if (
        current.schedulingInitiativeId === scheduling.initiativeId &&
        current.schedulingProjectId === scheduling.projectId
      ) {
        return this.requireGraphWorkItem(transaction, workItemId);
      }
      const previousProjectId = current.schedulingProjectId;
      await transaction
        .update(workItemPriorityContext)
        .set({
          schedulingInitiativeId: scheduling.initiativeId,
          schedulingProjectId: scheduling.projectId,
          ...(previousProjectId === scheduling.projectId
            ? {}
            : { rank: null }),
        })
        .where(eq(workItemPriorityContext.workItemId, workItemId));
      if (previousProjectId !== scheduling.projectId) {
        await this.placeWorkItemAtMedian(
          transaction,
          workItemId,
          scheduling.projectId,
        );
      }
      const updated = await this.requireStoredPriorityContext(
        transaction,
        workItemId,
      );
      await this.appendEvent(transaction, {
        type: "work_item.scheduling_scope_changed",
        workItemId,
        data: {
          previousSchedulingInitiativeId: current.schedulingInitiativeId,
          previousSchedulingProjectId: previousProjectId,
          schedulingInitiativeId: updated.schedulingInitiativeId,
          schedulingProjectId: updated.schedulingProjectId,
          priorityRank: updated.rank,
        },
      });
      return this.requireGraphWorkItem(transaction, workItemId);
    });
  }

  async expediteWorkItem(
    workItemId: string,
    reason: string,
    options: IdempotentMutationOptions = {},
  ): Promise<WorkItem> {
    requireIdentifier(workItemId, "invalid_work_item_id");
    if (reason.trim().length === 0) {
      throw new WorkGraphError(
        "invalid_expedite_reason",
        "An expedite reason cannot be empty.",
      );
    }
    if (options.idempotencyKey !== undefined) {
      requireIdempotencyKey(options.idempotencyKey);
    }

    return this.db.transaction(async (transaction) => {
      await this.lockEventSequence(transaction);
      if (options.idempotencyKey !== undefined) {
        const replayed = await this.beginIdempotentMutation(
          transaction,
          options.idempotencyKey,
          "expedite-work-item",
          JSON.stringify([workItemId, reason]),
        );
        if (replayed) return this.requireGraphWorkItem(transaction, workItemId);
      }
      await this.lockGraphMutation(transaction);
      await this.requireStoredPriorityContext(transaction, workItemId);
      await this.requireOpenWorkItem(transaction, workItemId);
      await transaction
        .update(workItem)
        .set({ expedited: true, expediteReason: reason })
        .where(eq(workItem.id, workItemId));
      await this.appendEvent(transaction, {
        type: "work_item.expedited",
        workItemId,
        data: { reason },
      });
      return this.requireGraphWorkItem(transaction, workItemId);
    });
  }

  async unexpediteWorkItem(
    workItemId: string,
    options: IdempotentMutationOptions = {},
  ): Promise<WorkItem> {
    requireIdentifier(workItemId, "invalid_work_item_id");
    if (options.idempotencyKey !== undefined) {
      requireIdempotencyKey(options.idempotencyKey);
    }

    return this.db.transaction(async (transaction) => {
      await this.lockEventSequence(transaction);
      if (options.idempotencyKey !== undefined) {
        const replayed = await this.beginIdempotentMutation(
          transaction,
          options.idempotencyKey,
          "unexpedite-work-item",
          workItemId,
        );
        if (replayed) return this.requireGraphWorkItem(transaction, workItemId);
      }
      await this.lockGraphMutation(transaction);
      await this.requireStoredPriorityContext(transaction, workItemId);
      await this.requireOpenWorkItem(transaction, workItemId);
      await transaction
        .update(workItem)
        .set({ expedited: false, expediteReason: null })
        .where(eq(workItem.id, workItemId));
      await this.appendEvent(transaction, {
        type: "work_item.unexpedited",
        workItemId,
        data: {},
      });
      return this.requireGraphWorkItem(transaction, workItemId);
    });
  }

  async createNote(
    input: CreateNoteInput,
    options: IdempotentMutationOptions = {},
  ): Promise<StoredNote> {
    requireUuid(input.id, "invalid_note_id", "A note ID must be a UUID.");
    requireIdentifier(input.workItemId, "invalid_work_item_id");
    requireLeaseId(input.leaseId);
    requireLeaseEpoch(input.epoch);
    requireText(
      input.content,
      "invalid_note_content",
      "A note cannot be empty.",
    );
    if (options.idempotencyKey !== undefined) {
      requireIdempotencyKey(options.idempotencyKey);
    }

    try {
      return await this.db.transaction(async (transaction) => {
        await this.lockEventSequence(transaction);
        if (options.idempotencyKey !== undefined) {
          const replayed = await this.beginIdempotentMutation(
            transaction,
            options.idempotencyKey,
            "create-note",
            JSON.stringify([
              input.id,
              input.workItemId,
              input.leaseId,
              input.epoch,
              input.content,
            ]),
          );
          if (replayed) {
            return this.requireStoredNote(transaction, input.id);
          }
        }

        const { storedLease } = await this.lockWorkItemAndRequireLease(
          transaction,
          input,
        );
        const [created] = await transaction
          .insert(note)
          .values({
            id: input.id,
            workItemId: input.workItemId,
            leaseId: input.leaseId,
            author: storedLease.workerId,
            content: input.content,
          })
          .returning();
        if (!created) throw new Error("Note creation returned no note.");
        await this.appendEvent(transaction, {
          type: "note.created",
          workItemId: input.workItemId,
          data: {
            noteId: input.id,
            leaseId: input.leaseId,
            author: storedLease.workerId,
            kind: "work",
          },
        });
        return created;
      });
    } catch (error) {
      if (getDatabaseError(error)?.code === "23505") {
        throw new WorkGraphError(
          "duplicate_note",
          `Note ${input.id} already exists.`,
        );
      }
      throw error;
    }
  }

  async createPostReleaseNote(
    input: CreatePostReleaseNoteInput,
    options: IdempotentMutationOptions = {},
  ): Promise<StoredNote> {
    requireUuid(input.id, "invalid_note_id", "A note ID must be a UUID.");
    requireIdentifier(input.workItemId, "invalid_work_item_id");
    requireText(
      input.content,
      "invalid_note_content",
      "A note cannot be empty.",
    );
    if (options.idempotencyKey !== undefined) {
      requireIdempotencyKey(options.idempotencyKey);
    }

    try {
      return await this.db.transaction(async (transaction) => {
        await this.lockEventSequence(transaction);
        if (options.idempotencyKey !== undefined) {
          const replayed = await this.beginIdempotentMutation(
            transaction,
            options.idempotencyKey,
            "create-post-release-note",
            JSON.stringify([
              input.id,
              input.workItemId,
              input.author,
              input.content,
            ]),
          );
          if (replayed) {
            return this.requireStoredNote(transaction, input.id);
          }
        }

        const [lockedWorkItem] = await transaction
          .select({ lifecycle: workItem.lifecycle })
          .from(workItem)
          .where(eq(workItem.id, input.workItemId))
          .for("update");
        if (!lockedWorkItem) throw workItemNotFound(input.workItemId);
        validatePostReleaseNote({
          workItemId: input.workItemId,
          lifecycle: lockedWorkItem.lifecycle,
          author: input.author,
        });

        const [created] = await transaction
          .insert(note)
          .values({
            id: input.id,
            workItemId: input.workItemId,
            leaseId: null,
            author: input.author,
            content: input.content,
          })
          .returning();
        if (!created) throw new Error("Note creation returned no note.");
        await this.appendEvent(transaction, {
          type: "note.created",
          workItemId: input.workItemId,
          data: {
            noteId: input.id,
            leaseId: null,
            author: input.author,
            kind: "post_release",
          },
        });
        return created;
      });
    } catch (error) {
      if (getDatabaseError(error)?.code === "23505") {
        throw new WorkGraphError(
          "duplicate_note",
          `Note ${input.id} already exists.`,
        );
      }
      throw error;
    }
  }

  async listNotes(
    input: ListWorkItemNotesInput | string,
  ): Promise<readonly StoredNote[]> {
    const parameters =
      typeof input === "string" ? { workItemId: input } : input;
    requireIdentifier(parameters.workItemId, "invalid_work_item_id");
    const query = this.db
      .select()
      .from(note)
      .where(
        and(
          eq(note.workItemId, parameters.workItemId),
          parameters.cursor === undefined
            ? undefined
            : gt(note.id, parameters.cursor),
        ),
      )
      .orderBy(note.id);
    return parameters.limit === undefined
      ? query
      : query.limit(parameters.limit);
  }

  async listEvents(
    input: ListEventsInput = {},
  ): Promise<readonly StoredEvent[]> {
    if (input.workItemId !== undefined) {
      requireIdentifier(input.workItemId, "invalid_work_item_id");
    }
    const query = this.db
      .select()
      .from(event)
      .where(
        and(
          input.workItemId === undefined
            ? undefined
            : eq(event.workItemId, input.workItemId),
          input.type === undefined ? undefined : eq(event.type, input.type),
          input.lifecycle === undefined
            ? undefined
            : sql`${event.data} ->> 'to' = ${input.lifecycle}`,
          input.afterSequence === undefined
            ? undefined
            : gt(event.sequence, input.afterSequence),
        ),
      )
      .orderBy(event.sequence);
    return input.limit === undefined ? query : query.limit(input.limit);
  }

  async listAttentionRequests(
    input: ListAttentionRequestsInput = {},
  ): Promise<
    readonly AttentionRequestReadModel[]
  > {
    if (input.workItemId !== undefined) {
      requireIdentifier(input.workItemId, "invalid_work_item_id");
    }
    let stateCondition: SQL | undefined;
    if (input.state === "resolved") {
      stateCondition = isNotNull(attentionResolution.id);
    } else if (input.state === "unresolved") {
      stateCondition = isNull(attentionResolution.id);
    }
    const query = this.db
      .select({
        attentionRequest,
        resolution: attentionResolution,
      })
      .from(attentionRequest)
      .leftJoin(
        attentionResolution,
        eq(attentionResolution.attentionRequestId, attentionRequest.id),
      )
      .where(
        and(
          input.workItemId === undefined
            ? undefined
            : eq(attentionRequest.workItemId, input.workItemId),
          stateCondition,
          input.blocking === undefined
            ? undefined
            : eq(attentionRequest.blocking, input.blocking),
          input.cursor === undefined
            ? undefined
            : gt(attentionRequest.id, input.cursor),
        ),
      )
      .orderBy(attentionRequest.id);
    const rows =
      input.limit === undefined ? await query : await query.limit(input.limit);
    return rows.map((row) => ({
      ...row.attentionRequest,
      resolution: row.resolution,
    }));
  }

  async listDependencies(
    input: ListWorkItemDependenciesInput,
  ): Promise<readonly WorkItemDependency[]> {
    requireIdentifier(input.workItemId, "invalid_work_item_id");
    const query = this.db
      .select({
        dependentWorkItemId: workItemDependency.dependentWorkItemId,
        blockerWorkItemId: workItemDependency.blockerWorkItemId,
      })
      .from(workItemDependency)
      .where(
        and(
          or(
            eq(workItemDependency.dependentWorkItemId, input.workItemId),
            eq(workItemDependency.blockerWorkItemId, input.workItemId),
          ),
          input.cursor === undefined
            ? undefined
            : or(
                gt(
                  workItemDependency.dependentWorkItemId,
                  input.cursor.dependentWorkItemId,
                ),
                and(
                  eq(
                    workItemDependency.dependentWorkItemId,
                    input.cursor.dependentWorkItemId,
                  ),
                  gt(
                    workItemDependency.blockerWorkItemId,
                    input.cursor.blockerWorkItemId,
                  ),
                ),
              ),
        ),
      )
      .orderBy(
        workItemDependency.dependentWorkItemId,
        workItemDependency.blockerWorkItemId,
      );
    return input.limit === undefined ? query : query.limit(input.limit);
  }

  async createAttentionRequest(
    input: CreateAttentionRequestInput,
    options: IdempotentMutationOptions = {},
  ): Promise<CreateAttentionRequestResult> {
    requireUuid(
      input.id,
      "invalid_attention_request_id",
      "An attention request ID must be a UUID.",
    );
    requireIdentifier(input.workItemId, "invalid_work_item_id");
    requireLeaseId(input.leaseId);
    requireLeaseEpoch(input.epoch);
    requireText(
      input.kind,
      "invalid_attention_kind",
      "An attention kind cannot be empty.",
    );
    requireText(
      input.question,
      "invalid_attention_question",
      "An attention question cannot be empty.",
    );
    if (input.note !== undefined) {
      requireText(
        input.note,
        "invalid_note_content",
        "An attention note cannot be empty.",
      );
    }
    if (options.idempotencyKey !== undefined) {
      requireIdempotencyKey(options.idempotencyKey);
    }

    try {
      return await this.db.transaction(async (transaction) => {
        await this.lockEventSequence(transaction);
        if (options.idempotencyKey !== undefined) {
          const replayed = await this.beginIdempotentMutation(
            transaction,
            options.idempotencyKey,
            "create-attention-request",
            JSON.stringify([
              input.id,
              input.workItemId,
              input.leaseId,
              input.epoch,
              input.kind,
              input.question,
              input.note ?? null,
              input.blocking,
            ]),
          );
          if (replayed) {
            const storedRequest = await this.requireStoredAttentionRequest(
              transaction,
              input.id,
            );
            return {
              attentionRequest: storedRequest,
              endedLease: storedRequest.blocking
                ? await this.requireStoredLease(transaction, input.leaseId)
                : null,
            };
          }
        }

        const { storedLease, now } =
          await this.lockWorkItemAndRequireLease(transaction, input);
        const [created] = await transaction
          .insert(attentionRequest)
          .values({
            id: input.id,
            workItemId: input.workItemId,
            requestingLeaseId: input.leaseId,
            kind: input.kind,
            question: input.question,
            note: input.note ?? null,
            blocking: input.blocking,
          })
          .returning();
        if (!created) {
          throw new Error("Attention request creation returned no request.");
        }

        await this.appendEvent(transaction, {
          type: "attention.requested",
          workItemId: input.workItemId,
          occurredAt: now,
          data: {
            attentionRequestId: input.id,
            leaseId: input.leaseId,
            kind: input.kind,
            question: input.question,
            note: input.note ?? null,
            blocking: input.blocking,
          },
        });

        if (!input.blocking) {
          return { attentionRequest: created, endedLease: null };
        }
        const [endedLease] = await transaction
          .update(lease)
          .set({ endedAt: now, outcome: "attention_requested" })
          .where(
            and(
              eq(lease.id, storedLease.id),
              eq(lease.epoch, input.epoch),
              isNull(lease.endedAt),
              gt(lease.expiresAt, now),
            ),
          )
          .returning();
        if (!endedLease) throw leaseNotCurrent(input.leaseId, input.epoch);
        await this.appendEvent(transaction, {
          type: "lease.ended",
          workItemId: input.workItemId,
          occurredAt: now,
          data: {
            leaseId: endedLease.id,
            epoch: endedLease.epoch,
            workerId: endedLease.workerId,
            outcome: endedLease.outcome,
          },
        });
        return { attentionRequest: created, endedLease };
      });
    } catch (error) {
      if (getDatabaseError(error)?.code === "23505") {
        throw new WorkGraphError(
          "duplicate_attention_request",
          `Attention request ${input.id} already exists.`,
        );
      }
      throw error;
    }
  }

  async resolveAttentionRequest(
    input: ResolveAttentionRequestInput,
    options: IdempotentMutationOptions = {},
  ): Promise<ResolveAttentionRequestResult> {
    requireUuid(
      input.id,
      "invalid_attention_resolution_id",
      "An attention resolution ID must be a UUID.",
    );
    requireUuid(
      input.attentionRequestId,
      "invalid_attention_request_id",
      "An attention request ID must be a UUID.",
    );
    requireText(
      input.resolution,
      "invalid_attention_resolution",
      "An attention resolution cannot be empty.",
    );
    if (options.idempotencyKey !== undefined) {
      requireIdempotencyKey(options.idempotencyKey);
    }

    try {
      return await this.db.transaction(async (transaction) => {
        await this.lockEventSequence(transaction);
        if (options.idempotencyKey !== undefined) {
          const replayed = await this.beginIdempotentMutation(
            transaction,
            options.idempotencyKey,
            "resolve-attention-request",
            JSON.stringify([
              input.id,
              input.attentionRequestId,
              input.resolution,
            ]),
          );
          if (replayed) {
            const resolution = await this.requireStoredAttentionResolution(
              transaction,
              input.id,
            );
            const request = await this.requireStoredAttentionRequest(
              transaction,
              input.attentionRequestId,
            );
            return { resolution, workItemId: request.workItemId };
          }
        }

        const [lockedRequest] = await transaction
          .select({
            id: attentionRequest.id,
            workItemId: attentionRequest.workItemId,
          })
          .from(attentionRequest)
          .where(eq(attentionRequest.id, input.attentionRequestId))
          .for("update");
        if (!lockedRequest) {
          throw new WorkGraphError(
            "attention_request_not_found",
            `Attention request ${input.attentionRequestId} does not exist.`,
          );
        }
        const [created] = await transaction
          .insert(attentionResolution)
          .values(input)
          .returning();
        if (!created) {
          throw new Error("Attention resolution creation returned no row.");
        }
        await this.appendEvent(transaction, {
          type: "attention.resolved",
          workItemId: lockedRequest.workItemId,
          occurredAt: created.createdAt,
          data: {
            attentionRequestId: input.attentionRequestId,
            attentionResolutionId: input.id,
            resolution: input.resolution,
          },
        });
        return { resolution: created, workItemId: lockedRequest.workItemId };
      });
    } catch (error) {
      const databaseError = getDatabaseError(error);
      if (
        databaseError?.code === "23505" &&
        databaseError.constraint_name === "attention_resolutions_pkey"
      ) {
        throw new WorkGraphError(
          "duplicate_attention_resolution",
          `Attention resolution ${input.id} already exists.`,
        );
      }
      if (databaseError?.code === "23505") {
        throw new WorkGraphError(
          "attention_request_already_resolved",
          `Attention request ${input.attentionRequestId} is already resolved.`,
        );
      }
      throw error;
    }
  }

  async claimWorkItem(input: ClaimWorkItemInput): Promise<StoredLease | null> {
    requireLeaseId(input.leaseId);
    requireWorkerId(input.workerId);
    requireLeaseDuration(input.leaseDurationSeconds);
    if (input.workItemId !== undefined) {
      requireIdentifier(input.workItemId, "invalid_work_item_id");
    }
    if (input.initiativeId !== undefined) {
      requireKnowledgeScopeId(input.initiativeId);
    }
    if (input.projectId !== undefined) {
      requireKnowledgeScopeId(input.projectId);
    }
    if (input.parentId !== undefined) {
      requireIdentifier(input.parentId, "invalid_parent_id");
    }
    if (
      input.workItemId !== undefined &&
      (input.initiativeId !== undefined ||
        input.projectId !== undefined ||
        input.parentId !== undefined)
    ) {
      throw new WorkGraphError(
        "invalid_claim_scope",
        "A specified work item cannot be combined with scope filters.",
      );
    }

    try {
      return await this.db.transaction(
        async (transaction) => {
          await this.lockEventSequence(transaction);
          await this.lockGraphSnapshot(transaction);

          const candidateId = await this.findClaimableWorkItemId(
            transaction,
            input.workItemId,
            {
              ...(input.initiativeId === undefined
                ? {}
                : { initiativeId: input.initiativeId }),
              ...(input.projectId === undefined
                ? {}
                : { projectId: input.projectId }),
              ...(input.parentId === undefined
                ? {}
                : { parentId: input.parentId }),
            },
          );
          if (candidateId === null) return null;

          const acquiredAt = await readDatabaseClock(transaction);
          const expiresAt = calculateLeaseExpiry(
            acquiredAt,
            input.leaseDurationSeconds,
          );

          const expiredLeases = await transaction
            .update(lease)
            .set({ endedAt: acquiredAt, outcome: "expired" })
            .where(
              and(
                eq(lease.workItemId, candidateId),
                isNull(lease.endedAt),
                lte(lease.expiresAt, acquiredAt),
              ),
            )
            .returning();
          for (const expiredLease of expiredLeases) {
            await this.appendEvent(transaction, {
              type: "lease.ended",
              workItemId: candidateId,
              occurredAt: acquiredAt,
              data: {
                leaseId: expiredLease.id,
                epoch: expiredLease.epoch,
                workerId: expiredLease.workerId,
                outcome: expiredLease.outcome,
              },
            });
          }

          const [epochRow] = await transaction
            .select({
              nextEpoch: sql<number>`coalesce(max(${lease.epoch}), 0) + 1`,
            })
            .from(lease)
            .where(eq(lease.workItemId, candidateId));
          if (!epochRow) {
            throw new Error("Lease epoch allocation returned no row.");
          }

          const [claimedLease] = await transaction
            .insert(lease)
            .values({
              id: input.leaseId,
              workItemId: candidateId,
              workerId: input.workerId,
              epoch: epochRow.nextEpoch,
              acquiredAt,
              expiresAt,
            })
            .returning();
          if (!claimedLease) {
            throw new Error("Lease creation returned no lease.");
          }
          await this.appendEvent(transaction, {
            type: "lease.claimed",
            workItemId: candidateId,
            occurredAt: acquiredAt,
            data: {
              leaseId: claimedLease.id,
              epoch: claimedLease.epoch,
              workerId: claimedLease.workerId,
              expiresAt: claimedLease.expiresAt.toISOString(),
            },
          });
          return claimedLease;
        },
        { isolationLevel: "read committed" },
      );
    } catch (error) {
      const databaseError = getDatabaseError(error);
      if (
        databaseError?.code === "23505" &&
        databaseError.constraint_name === "leases_pkey"
      ) {
        throw new WorkGraphError(
          "duplicate_lease_id",
          `Lease ${input.leaseId} already exists.`,
        );
      }
      throw error;
    }
  }

  async renewLease(input: RenewLeaseInput): Promise<StoredLease> {
    requireLeaseId(input.leaseId);
    requireLeaseEpoch(input.epoch);
    requireLeaseDuration(input.leaseDurationSeconds);

    return this.db.transaction(async (transaction) => {
      await this.lockEventSequence(transaction);
      const [storedLease] = await transaction
        .select({ workItemId: lease.workItemId })
        .from(lease)
        .where(eq(lease.id, input.leaseId))
        .limit(1);
      if (!storedLease) {
        throw leaseNotCurrent(input.leaseId, input.epoch);
      }

      await transaction
        .select({ id: workItem.id })
        .from(workItem)
        .where(eq(workItem.id, storedLease.workItemId))
        .for("update");

      const renewedAt = await readDatabaseClock(transaction);
      const expiresAt = calculateLeaseExpiry(
        renewedAt,
        input.leaseDurationSeconds,
      );

      const [renewedLease] = await transaction
        .update(lease)
        .set({ expiresAt })
        .where(
          and(
            eq(lease.id, input.leaseId),
            eq(lease.workItemId, storedLease.workItemId),
            eq(lease.epoch, input.epoch),
            isNull(lease.endedAt),
            gt(lease.expiresAt, renewedAt),
          ),
        )
        .returning();
      if (!renewedLease) {
        throw leaseNotCurrent(input.leaseId, input.epoch);
      }
      await this.appendEvent(transaction, {
        type: "lease.renewed",
        workItemId: storedLease.workItemId,
        occurredAt: renewedAt,
        data: {
          leaseId: renewedLease.id,
          epoch: renewedLease.epoch,
          workerId: renewedLease.workerId,
          expiresAt: renewedLease.expiresAt.toISOString(),
        },
      });
      return renewedLease;
    });
  }

  async decomposeClaimedWorkItem(
    input: DecomposeClaimedWorkItemInput,
    options: IdempotentMutationOptions = {},
  ): Promise<DecomposeClaimedWorkItemResult> {
    const validated = validateDecomposition(input, options);

    try {
      return await this.db.transaction(async (transaction) => {
        await this.lockEventSequence(transaction);
        return this.executeDecomposition(
          transaction,
          input,
          validated,
          options,
        );
      });
    } catch (error) {
      return throwDecompositionDatabaseError(error, input);
    }
  }

  private async executeDecomposition(
    transaction: DbTransaction,
    input: DecomposeClaimedWorkItemInput,
    validated: ValidatedDecomposition,
    options: IdempotentMutationOptions,
  ): Promise<DecomposeClaimedWorkItemResult> {
    const replayed = await this.replayDecomposition(
      transaction,
      input,
      validated,
      options.idempotencyKey,
    );
    if (replayed) return replayed;

    await this.lockGraphMutation(transaction);
    const { storedLease, now } = await this.lockWorkItemAndRequireLease(
      transaction,
      input,
    );
    await this.requireOpenWorkItem(transaction, input.workItemId);
    await this.insertDecompositionGraph(
      transaction,
      input.workItemId,
      validated,
    );
    const endedLease = await this.endDecomposedLease(
      transaction,
      input,
      storedLease,
      now,
    );
    const claimedLease = await this.claimDecompositionChild(
      transaction,
      input.claim,
      storedLease.workerId,
      now,
    );
    for (const { workItem: child, rank } of validated.children) {
      await this.appendEvent(transaction, {
        type: "work_item.created",
        workItemId: child.id,
        occurredAt: now,
        data: {
          title: child.title,
          parentId: input.workItemId,
          rank,
          priorityRank: null,
        },
      });
    }
    for (const dependency of validated.dependencies) {
      await this.appendEvent(transaction, {
        type: "dependency.added",
        workItemId: dependency.dependentWorkItemId,
        occurredAt: now,
        data: { blockerWorkItemId: dependency.blockerWorkItemId },
      });
    }
    await this.appendEvent(transaction, {
      type: "work_item.decomposed",
      workItemId: input.workItemId,
      occurredAt: now,
      data: {
        childWorkItemIds: validated.children.map(
          ({ workItem: child }) => child.id,
        ),
      },
    });
    await this.appendEvent(transaction, {
      type: "lease.ended",
      workItemId: input.workItemId,
      occurredAt: now,
      data: {
        leaseId: endedLease.id,
        epoch: endedLease.epoch,
        workerId: endedLease.workerId,
        outcome: endedLease.outcome,
      },
    });
    if (claimedLease !== null) {
      await this.appendEvent(transaction, {
        type: "lease.claimed",
        workItemId: claimedLease.workItemId,
        occurredAt: now,
        data: {
          leaseId: claimedLease.id,
          epoch: claimedLease.epoch,
          workerId: claimedLease.workerId,
          expiresAt: claimedLease.expiresAt.toISOString(),
        },
      });
    }
    return {
      children: validated.children,
      dependencies: validated.dependencies,
      endedLease,
      claimedLease,
    };
  }

  private async replayDecomposition(
    transaction: DbTransaction,
    input: DecomposeClaimedWorkItemInput,
    validated: ValidatedDecomposition,
    idempotencyKeyValue: string | undefined,
  ): Promise<DecomposeClaimedWorkItemResult | null> {
    if (idempotencyKeyValue === undefined) return null;
    const replayed = await this.beginIdempotentMutation(
      transaction,
      idempotencyKeyValue,
      "decompose-work-item",
      validated.fingerprint,
    );
    if (!replayed) return null;

    return {
      children: await this.requireStoredRankedChildren(
        transaction,
        input.workItemId,
        validated.children.map(({ workItem: child }) => child.id),
      ),
      dependencies: validated.dependencies,
      endedLease: await this.requireStoredLease(transaction, input.leaseId),
      claimedLease: input.claim
        ? await this.requireStoredLease(transaction, input.claim.leaseId)
        : null,
    };
  }

  private async requireOpenWorkItem(
    transaction: DbTransaction,
    workItemId: string,
  ): Promise<void> {
    const [stored] = await transaction
      .select({ lifecycle: workItem.lifecycle })
      .from(workItem)
      .where(eq(workItem.id, workItemId))
      .limit(1);
    if (stored?.lifecycle !== "open") {
      throw new WorkGraphError(
        "work_item_already_terminal",
        `Work item ${workItemId} is already ${stored?.lifecycle ?? "terminal"}.`,
      );
    }
  }

  private async insertDecompositionGraph(
    transaction: DbTransaction,
    parentWorkItemId: string,
    validated: ValidatedDecomposition,
  ): Promise<void> {
    await transaction.insert(workItem).values(
      validated.children.map(({ workItem: child }) => ({
        id: child.id,
        title: child.title,
        expedited: child.expedited,
        expediteReason: child.expediteReason,
      })),
    );
    await transaction.insert(workItemHierarchy).values(
      validated.children.map(({ workItem: child, rank }) => ({
        childWorkItemId: child.id,
        parentWorkItemId,
        rank,
      })),
    );
    if (validated.dependencies.length > 0) {
      const referencedWorkItemIds = new Set(
        validated.dependencies.flatMap((dependency) => [
          dependency.dependentWorkItemId,
          dependency.blockerWorkItemId,
        ]),
      );
      for (const referencedWorkItemId of referencedWorkItemIds) {
        await this.requireStoredWorkItem(transaction, referencedWorkItemId);
      }
      await transaction
        .insert(workItemDependency)
        .values([...validated.dependencies]);
    }
    await this.rejectCycle(transaction);
  }

  private async endDecomposedLease(
    transaction: DbTransaction,
    input: DecomposeClaimedWorkItemInput,
    storedLease: StoredLease,
    now: Date,
  ): Promise<StoredLease> {
    const [endedLease] = await transaction
      .update(lease)
      .set({ endedAt: now, outcome: "decomposed" })
      .where(
        and(
          eq(lease.id, storedLease.id),
          eq(lease.workItemId, input.workItemId),
          eq(lease.epoch, input.epoch),
          isNull(lease.endedAt),
          gt(lease.expiresAt, now),
        ),
      )
      .returning();
    if (!endedLease) throw leaseNotCurrent(input.leaseId, input.epoch);
    return endedLease;
  }

  private async claimDecompositionChild(
    transaction: DbTransaction,
    claim: DecompositionChildClaimInput | undefined,
    workerId: string,
    now: Date,
  ): Promise<StoredLease | null> {
    if (claim === undefined) return null;
    const [claimableChild] = await transaction
      .select({ id: workItem.id })
      .from(workItem)
      .where(claimableWorkItemWhere(claim.workItemId))
      .limit(1)
      .for("update");
    if (!claimableChild) {
      throw new WorkGraphError(
        "decomposition_child_not_claimable",
        `Child work item ${claim.workItemId} is not ready to claim.`,
      );
    }
    const expiresAt = calculateLeaseExpiry(now, claim.leaseDurationSeconds);
    const [createdLease] = await transaction
      .insert(lease)
      .values({
        id: claim.leaseId,
        workItemId: claimableChild.id,
        workerId,
        epoch: 1,
        acquiredAt: now,
        expiresAt,
      })
      .returning();
    if (!createdLease) {
      throw new Error("Child lease creation returned no lease.");
    }
    return createdLease;
  }

  async terminateClaimedWorkItem(
    input: TerminateClaimedWorkItemInput,
  ): Promise<StoredLease> {
    requireLeaseId(input.leaseId);
    requireLeaseEpoch(input.epoch);
    requireIdentifier(input.workItemId, "invalid_work_item_id");
    if (input.outcome === "released") {
      requireCompletionEvidence(input);
    }

    return this.db.transaction(async (transaction) => {
      await this.lockEventSequence(transaction);
      const [lockedWorkItem] = await transaction
        .select({ id: workItem.id })
        .from(workItem)
        .where(eq(workItem.id, input.workItemId))
        .for("update");
      if (!lockedWorkItem) throw workItemNotFound(input.workItemId);

      const completedAt = await readDatabaseClock(transaction);

      const [completedLease] = await transaction
        .update(lease)
        .set({ endedAt: completedAt, outcome: input.outcome })
        .where(
          and(
            eq(lease.id, input.leaseId),
            eq(lease.workItemId, input.workItemId),
            eq(lease.epoch, input.epoch),
            isNull(lease.endedAt),
            gt(lease.expiresAt, completedAt),
          ),
        )
        .returning();
      if (!completedLease) {
        throw leaseNotCurrent(input.leaseId, input.epoch);
      }

      const updated = await transaction
        .update(workItem)
        .set({ lifecycle: input.outcome })
        .where(
          and(
            eq(workItem.id, input.workItemId),
            eq(workItem.lifecycle, "open"),
          ),
        )
        .returning({ id: workItem.id });
      if (updated.length === 0) {
        const [existing] = await transaction
          .select({ lifecycle: workItem.lifecycle })
          .from(workItem)
          .where(eq(workItem.id, input.workItemId))
          .limit(1);
        throw new WorkGraphError(
          "work_item_already_terminal",
          `Work item ${input.workItemId} is already ${existing?.lifecycle ?? "terminal"}.`,
        );
      }

      await this.appendEvent(transaction, {
        type: "lease.ended",
        workItemId: input.workItemId,
        occurredAt: completedAt,
        data: {
          leaseId: completedLease.id,
          epoch: completedLease.epoch,
          workerId: completedLease.workerId,
          outcome: completedLease.outcome,
        },
      });
      await this.appendEvent(transaction, {
        type: "work_item.lifecycle_changed",
        workItemId: input.workItemId,
        occurredAt: completedAt,
        data: {
          from: "open",
          to: input.outcome,
          ...(input.outcome === "released"
            ? {
                mergeEvidence: input.mergeEvidence,
                deploymentEvidence: input.deploymentEvidence,
              }
            : {}),
        },
      });

      return completedLease;
    });
  }

  async listLeases(
    input: ListWorkItemLeasesInput | string,
  ): Promise<readonly StoredLease[]> {
    const parameters =
      typeof input === "string" ? { workItemId: input } : input;
    requireIdentifier(parameters.workItemId, "invalid_work_item_id");
    const query = this.db
      .select()
      .from(lease)
      .where(
        and(
          eq(lease.workItemId, parameters.workItemId),
          parameters.afterEpoch === undefined
            ? undefined
            : gt(lease.epoch, parameters.afterEpoch),
        ),
      )
      .orderBy(lease.epoch);
    return parameters.limit === undefined
      ? query
      : query.limit(parameters.limit);
  }

  async getCurrentLease(workItemId: string): Promise<StoredLease | null> {
    requireIdentifier(workItemId, "invalid_work_item_id");
    const [currentLease] = await this.db
      .select()
      .from(lease)
      .where(and(eq(lease.workItemId, workItemId), isNull(lease.endedAt)))
      .limit(1);
    return currentLease ?? null;
  }

  async reparentWorkItem(
    workItemId: string,
    parentId: string | null,
  ): Promise<void> {
    requireIdentifier(workItemId, "invalid_work_item_id");
    if (parentId !== null) {
      requireIdentifier(parentId, "invalid_parent_id");
    }

    try {
      await this.db.transaction(async (transaction) => {
        await this.lockEventSequence(transaction);
        await this.lockGraphMutation(transaction);
        await this.requireStoredWorkItem(transaction, workItemId);

        const [currentHierarchy] = await transaction
          .select({
            parentWorkItemId: workItemHierarchy.parentWorkItemId,
            rank: workItemHierarchy.rank,
          })
          .from(workItemHierarchy)
          .where(eq(workItemHierarchy.childWorkItemId, workItemId))
          .limit(1);
        const [priorityContext] = await transaction
          .select()
          .from(workItemPriorityContext)
          .where(eq(workItemPriorityContext.workItemId, workItemId))
          .limit(1);

        if (parentId === null) {
          await transaction
            .delete(workItemHierarchy)
            .where(eq(workItemHierarchy.childWorkItemId, workItemId));
          if (currentHierarchy && !priorityContext) {
            await transaction.insert(workItemPriorityContext).values({
              workItemId,
              schedulingInitiativeId: null,
              schedulingProjectId: null,
              rank: null,
            });
            await this.placeWorkItemAtMedian(transaction, workItemId, null);
          }
        } else {
          const preservedRank =
            currentHierarchy?.parentWorkItemId === parentId
              ? currentHierarchy.rank
              : null;
          await transaction
            .insert(workItemHierarchy)
            .values({
              childWorkItemId: workItemId,
              parentWorkItemId: parentId,
              rank: preservedRank,
            })
            .onConflictDoUpdate({
              target: workItemHierarchy.childWorkItemId,
              set: { parentWorkItemId: parentId, rank: preservedRank },
            });
          if (!currentHierarchy && priorityContext) {
            await transaction
              .delete(workItemPriorityContext)
              .where(eq(workItemPriorityContext.workItemId, workItemId));
            await this.writeWorkItemPriorityRanks(
              transaction,
              await this.listPriorityOwnerIds(
                transaction,
                priorityContext.schedulingProjectId,
              ),
            );
          }
        }

        await this.rejectCycle(transaction);
        const previousParentId = currentHierarchy?.parentWorkItemId ?? null;
        if (previousParentId !== parentId) {
          await this.appendEvent(transaction, {
            type: "work_item.reparented",
            workItemId,
            data: {
              previousParentId,
              parentId,
              rank:
                currentHierarchy?.parentWorkItemId === parentId
                  ? currentHierarchy.rank
                  : null,
            },
          });
        }
      });
    } catch (error) {
      const databaseError = getDatabaseError(error);
      if (
        databaseError?.code === "23514" &&
        databaseError.constraint_name === "work_item_hierarchy_not_self_check"
      ) {
        throw new WorkGraphError(
          "graph_cycle",
          "The change creates a waits-for cycle.",
        );
      }
      translateForeignKeyError(error, parentId ?? workItemId);
    }
  }

  async addDependency(
    dependency: WorkItemDependency,
    options: IdempotentMutationOptions = {},
  ): Promise<void> {
    if (options.idempotencyKey !== undefined) {
      requireIdempotencyKey(options.idempotencyKey);
    }

    try {
      await this.db.transaction(async (transaction) => {
        await this.lockEventSequence(transaction);
        if (options.idempotencyKey !== undefined) {
          const replayed = await this.beginIdempotentMutation(
            transaction,
            options.idempotencyKey,
            "add-dependency",
            JSON.stringify([
              dependency.dependentWorkItemId,
              dependency.blockerWorkItemId,
            ]),
          );
          if (replayed) return;
        }

        await this.lockGraphMutation(transaction);
        await this.requireStoredWorkItem(
          transaction,
          dependency.dependentWorkItemId,
        );
        await this.requireStoredWorkItem(
          transaction,
          dependency.blockerWorkItemId,
        );
        await transaction.insert(workItemDependency).values(dependency);
        await this.rejectCycle(transaction);
        await this.appendEvent(transaction, {
          type: "dependency.added",
          workItemId: dependency.dependentWorkItemId,
          data: { blockerWorkItemId: dependency.blockerWorkItemId },
        });
      });
    } catch (error) {
      const databaseError = getDatabaseError(error);
      if (databaseError?.code === "23505") {
        throw new WorkGraphError(
          "dependency_already_exists",
          `Dependency ${dependency.dependentWorkItemId} -> ${dependency.blockerWorkItemId} already exists.`,
        );
      }
      if (
        databaseError?.code === "23514" &&
        databaseError.constraint_name ===
          "work_item_dependencies_not_self_check"
      ) {
        throw new WorkGraphError(
          "self_dependency",
          `Work item ${dependency.dependentWorkItemId} cannot depend on itself.`,
        );
      }
      translateForeignKeyError(error, dependency.dependentWorkItemId);
    }
  }

  async removeDependency(
    dependency: WorkItemDependency,
    options: IdempotentMutationOptions = {},
  ): Promise<void> {
    if (options.idempotencyKey !== undefined) {
      requireIdempotencyKey(options.idempotencyKey);
    }

    await this.db.transaction(async (transaction) => {
      await this.lockEventSequence(transaction);
      if (options.idempotencyKey !== undefined) {
        const replayed = await this.beginIdempotentMutation(
          transaction,
          options.idempotencyKey,
          "remove-dependency",
          JSON.stringify([
            dependency.dependentWorkItemId,
            dependency.blockerWorkItemId,
          ]),
        );
        if (replayed) return;
      }

      await this.lockGraphMutation(transaction);
      const removed = await transaction
        .delete(workItemDependency)
        .where(
          and(
            eq(
              workItemDependency.dependentWorkItemId,
              dependency.dependentWorkItemId,
            ),
            eq(
              workItemDependency.blockerWorkItemId,
              dependency.blockerWorkItemId,
            ),
          ),
        )
        .returning({
          dependentWorkItemId: workItemDependency.dependentWorkItemId,
        });
      if (removed.length === 0) {
        throw new WorkGraphError(
          "dependency_not_found",
          `Dependency ${dependency.dependentWorkItemId} -> ${dependency.blockerWorkItemId} does not exist.`,
        );
      }
      await this.rejectCycle(transaction);
      await this.appendEvent(transaction, {
        type: "dependency.removed",
        workItemId: dependency.dependentWorkItemId,
        data: { blockerWorkItemId: dependency.blockerWorkItemId },
      });
    });
  }

  async releaseWorkItem(
    workItemId: string,
    evidence: CompletionEvidence,
  ): Promise<void> {
    requireCompletionEvidence(evidence);
    await this.terminateWorkItem(workItemId, "released", evidence);
  }

  async cancelWorkItem(workItemId: string): Promise<void> {
    await this.terminateWorkItem(workItemId, "cancelled");
  }

  private async terminateWorkItem(
    workItemId: string,
    lifecycle: TerminalWorkItemState,
    completionEvidence?: CompletionEvidence,
  ): Promise<void> {
    requireIdentifier(workItemId, "invalid_work_item_id");

    await this.db.transaction(async (transaction) => {
      await this.lockEventSequence(transaction);
      const [existing] = await transaction
        .select({ lifecycle: workItem.lifecycle })
        .from(workItem)
        .where(eq(workItem.id, workItemId))
        .limit(1)
        .for("update");
      if (!existing) {
        throw workItemNotFound(workItemId);
      }

      const terminatedAt = await readDatabaseClock(transaction);
      const expiredLeases = await transaction
        .update(lease)
        .set({ endedAt: terminatedAt, outcome: "expired" })
        .where(
          and(
            eq(lease.workItemId, workItemId),
            isNull(lease.endedAt),
            lte(lease.expiresAt, terminatedAt),
          ),
        )
        .returning();

      // Claims serialize on the same row. Check for a lease in a fresh
      // READ COMMITTED statement after acquiring the lock.
      const [currentLease] = await transaction
        .select({ id: lease.id })
        .from(lease)
        .where(and(eq(lease.workItemId, workItemId), isNull(lease.endedAt)))
        .limit(1);
      if (currentLease) {
        throw new WorkGraphError(
          "work_item_has_current_lease",
          `Work item ${workItemId} has a current lease.`,
        );
      }
      if (existing.lifecycle !== "open") {
        throw new WorkGraphError(
          "work_item_already_terminal",
          `Work item ${workItemId} is already ${existing.lifecycle}.`,
        );
      }

      await transaction
        .update(workItem)
        .set({ lifecycle })
        .where(eq(workItem.id, workItemId));
      for (const expiredLease of expiredLeases) {
        await this.appendEvent(transaction, {
          type: "lease.ended",
          workItemId,
          occurredAt: terminatedAt,
          data: {
            leaseId: expiredLease.id,
            epoch: expiredLease.epoch,
            workerId: expiredLease.workerId,
            outcome: expiredLease.outcome,
          },
        });
      }
      await this.appendEvent(transaction, {
        type: "work_item.lifecycle_changed",
        workItemId,
        occurredAt: terminatedAt,
        data: {
          from: "open",
          to: lifecycle,
          ...(lifecycle === "released" && completionEvidence !== undefined
            ? completionEvidence
            : {}),
        },
      });
    });
  }

  private async lockGraphMutation(transaction: DbTransaction): Promise<void> {
    const locked = await transaction
      .select({ id: graphMutationLock.id })
      .from(graphMutationLock)
      .where(eq(graphMutationLock.id, GRAPH_MUTATION_LOCK_ID))
      .for("update");
    if (locked.length !== 1) {
      throw new Error("The global graph mutation lock row is missing.");
    }
  }

  private async appendEvent(
    transaction: DbTransaction,
    input: AppendEventInput,
  ): Promise<void> {
    await transaction.insert(event).values({
      type: input.type,
      workItemId: input.workItemId ?? null,
      data: input.data,
      occurredAt: input.occurredAt,
    });
  }

  private async lockWorkItemAndRequireLease(
    transaction: DbTransaction,
    input: {
      readonly workItemId: string;
      readonly leaseId: string;
      readonly epoch: number;
    },
  ): Promise<{ storedLease: StoredLease; now: Date }> {
    const [lockedWorkItem] = await transaction
      .select({ id: workItem.id })
      .from(workItem)
      .where(eq(workItem.id, input.workItemId))
      .for("update");
    if (!lockedWorkItem) throw workItemNotFound(input.workItemId);

    const now = await readDatabaseClock(transaction);
    const [storedLease] = await transaction
      .select()
      .from(lease)
      .where(
        and(
          eq(lease.id, input.leaseId),
          eq(lease.workItemId, input.workItemId),
          eq(lease.epoch, input.epoch),
          isNull(lease.endedAt),
          gt(lease.expiresAt, now),
        ),
      )
      .limit(1);
    if (!storedLease) throw leaseNotCurrent(input.leaseId, input.epoch);
    return { storedLease, now };
  }

  private async requireStoredNote(
    transaction: DbTransaction,
    noteId: string,
  ): Promise<StoredNote> {
    const [stored] = await transaction
      .select()
      .from(note)
      .where(eq(note.id, noteId))
      .limit(1);
    if (!stored) throw new Error(`Idempotent note ${noteId} is missing.`);
    return stored;
  }

  private async loadKnowledgeScopeGraph(transaction: DbTransaction): Promise<{
    ids: ReadonlySet<string>;
    relationships: readonly KnowledgeScopeRelationship[];
  }> {
    const ids = new Set(
      (
        await transaction
          .select({ id: knowledgeScope.id })
          .from(knowledgeScope)
      ).map(({ id }) => id),
    );
    const relationships = await transaction
      .select({
        parentKnowledgeScopeId:
          knowledgeScopeRelationship.parentKnowledgeScopeId,
        childKnowledgeScopeId:
          knowledgeScopeRelationship.childKnowledgeScopeId,
      })
      .from(knowledgeScopeRelationship);
    return { ids, relationships };
  }

  private async requireStoredAttentionRequest(
    transaction: DbTransaction,
    attentionRequestId: string,
  ): Promise<StoredAttentionRequest> {
    const [stored] = await transaction
      .select()
      .from(attentionRequest)
      .where(eq(attentionRequest.id, attentionRequestId))
      .limit(1);
    if (!stored) {
      throw new Error(
        `Idempotent attention request ${attentionRequestId} is missing.`,
      );
    }
    return stored;
  }

  private async requireStoredAttentionResolution(
    transaction: DbTransaction,
    attentionResolutionId: string,
  ): Promise<StoredAttentionResolution> {
    const [stored] = await transaction
      .select()
      .from(attentionResolution)
      .where(eq(attentionResolution.id, attentionResolutionId))
      .limit(1);
    if (!stored) {
      throw new Error(
        `Idempotent attention resolution ${attentionResolutionId} is missing.`,
      );
    }
    return stored;
  }

  private async requireStoredLease(
    transaction: DbTransaction,
    leaseId: string,
  ): Promise<StoredLease> {
    const [stored] = await transaction
      .select()
      .from(lease)
      .where(eq(lease.id, leaseId))
      .limit(1);
    if (!stored) throw new Error(`Idempotent lease ${leaseId} is missing.`);
    return stored;
  }

  private async requireStoredRankedChildren(
    transaction: DbTransaction,
    parentWorkItemId: string,
    childWorkItemIds: readonly string[],
  ): Promise<readonly RankedWorkItem[]> {
    const rows = await transaction
      .select({
        id: workItem.id,
        title: workItem.title,
        lifecycle: workItem.lifecycle,
        expedited: workItem.expedited,
        expediteReason: workItem.expediteReason,
        priorityRank: workItemPriorityContext.rank,
        schedulingInitiativeId:
          workItemPriorityContext.schedulingInitiativeId,
        schedulingProjectId: workItemPriorityContext.schedulingProjectId,
        parentId: workItemHierarchy.parentWorkItemId,
        rank: workItemHierarchy.rank,
      })
      .from(workItem)
      .innerJoin(
        workItemHierarchy,
        eq(workItemHierarchy.childWorkItemId, workItem.id),
      )
      .leftJoin(
        workItemPriorityContext,
        eq(workItemPriorityContext.workItemId, workItem.id),
      )
      .where(
        and(
          eq(workItemHierarchy.parentWorkItemId, parentWorkItemId),
          inArray(workItem.id, [...childWorkItemIds]),
        ),
      )
      .orderBy(workItemHierarchy.rank, workItem.id);
    if (
      rows.length !== childWorkItemIds.length ||
      rows.some(({ rank }) => rank === null)
    ) {
      throw new Error(
        `Idempotent decomposition for ${parentWorkItemId} is incomplete.`,
      );
    }
    return rows.map(({ rank, ...child }) => ({
      workItem: { ...child, rank: rank as number },
      rank: rank as number,
    }));
  }

  private async beginIdempotentMutation(
    transaction: DbTransaction,
    key: string,
    operation: string,
    requestFingerprint: string,
  ): Promise<boolean> {
    const inserted = await transaction
      .insert(idempotencyKey)
      .values({ id: key, operation, requestFingerprint })
      .onConflictDoNothing()
      .returning({ id: idempotencyKey.id });
    if (inserted.length === 1) return false;

    const [receipt] = await transaction
      .select({
        operation: idempotencyKey.operation,
        requestFingerprint: idempotencyKey.requestFingerprint,
      })
      .from(idempotencyKey)
      .where(eq(idempotencyKey.id, key))
      .limit(1);
    if (
      receipt?.operation === operation &&
      receipt.requestFingerprint === requestFingerprint
    ) {
      return true;
    }

    throw new WorkGraphError(
      "idempotency_key_reused",
      `Idempotency key ${key} was already used for a different mutation.`,
    );
  }

  private async loadKnowledgeScopes(
    transaction: DbTransaction,
  ): Promise<readonly KnowledgeScope[]> {
    const rows = await transaction
      .select()
      .from(knowledgeScope)
      .orderBy(knowledgeScope.kind, knowledgeScope.rank, knowledgeScope.id);
    return rows.map(toKnowledgeScope);
  }

  private async requireStoredKnowledgeScope(
    transaction: DbTransaction,
    id: string,
  ): Promise<KnowledgeScope> {
    const [stored] = await transaction
      .select()
      .from(knowledgeScope)
      .where(eq(knowledgeScope.id, id))
      .limit(1);
    if (!stored) throw knowledgeScopeNotFound(id);
    return toKnowledgeScope(stored);
  }

  private async requireStoredPriorityContext(
    transaction: DbTransaction,
    workItemId: string,
  ): Promise<typeof workItemPriorityContext.$inferSelect> {
    const [stored] = await transaction
      .select()
      .from(workItemPriorityContext)
      .where(eq(workItemPriorityContext.workItemId, workItemId))
      .limit(1);
    if (!stored) {
      throw new WorkGraphError(
        "invalid_priority_move",
        `Work item ${workItemId} inherits priority from a parent and cannot be moved independently.`,
      );
    }
    return stored;
  }

  private async validateSchedulingScopes(
    transaction: DbTransaction,
    input: Pick<
      WorkItem,
      "schedulingInitiativeId" | "schedulingProjectId"
    >,
  ): Promise<{
    readonly initiativeId: string | null;
    readonly projectId: string | null;
  }> {
    let initiativeId = input.schedulingInitiativeId;
    const projectId = input.schedulingProjectId;

    if (initiativeId !== null) {
      const initiative = await this.requireStoredKnowledgeScope(
        transaction,
        initiativeId,
      );
      if (initiative.kind !== "initiative") {
        throw new WorkGraphError(
          "invalid_scheduling_scope",
          `Knowledge scope ${initiativeId} is not an initiative.`,
        );
      }
    }
    if (projectId !== null) {
      const project = await this.requireStoredKnowledgeScope(
        transaction,
        projectId,
      );
      if (project.kind !== "project") {
        throw new WorkGraphError(
          "invalid_scheduling_scope",
          `Knowledge scope ${projectId} is not a project.`,
        );
      }

      const parents = await transaction
        .select({ id: knowledgeScope.id })
        .from(knowledgeScopeRelationship)
        .innerJoin(
          knowledgeScope,
          eq(
            knowledgeScope.id,
            knowledgeScopeRelationship.parentKnowledgeScopeId,
          ),
        )
        .where(
          and(
            eq(knowledgeScopeRelationship.childKnowledgeScopeId, projectId),
            eq(knowledgeScope.kind, "initiative"),
          ),
        )
        .orderBy(knowledgeScope.rank, knowledgeScope.id);

      if (initiativeId === null && parents.length === 1) {
        initiativeId = parents[0]!.id;
      } else if (initiativeId === null && parents.length > 1) {
        throw new WorkGraphError(
          "invalid_scheduling_scope",
          `Project ${projectId} has several initiative parents; choose one scheduling initiative.`,
        );
      } else if (
        initiativeId !== null &&
        !parents.some(({ id }) => id === initiativeId)
      ) {
        throw new WorkGraphError(
          "invalid_scheduling_scope",
          `Project ${projectId} is not linked to scheduling initiative ${initiativeId}.`,
        );
      }
    }

    return { initiativeId, projectId };
  }

  private insertionIndex(
    orderedIds: readonly string[],
    input: PriorityMoveInput,
  ): number {
    if (input.higherThanId === undefined && input.lowerThanId === undefined) {
      throw new WorkGraphError(
        "invalid_priority_move",
        "A priority move requires a higher-than or lower-than anchor.",
      );
    }
    const higherIndex =
      input.higherThanId === undefined
        ? orderedIds.length
        : orderedIds.indexOf(input.higherThanId);
    const lowerIndex =
      input.lowerThanId === undefined
        ? -1
        : orderedIds.indexOf(input.lowerThanId);
    if (
      (input.higherThanId !== undefined && higherIndex < 0) ||
      (input.lowerThanId !== undefined && lowerIndex < 0)
    ) {
      throw new WorkGraphError(
        "invalid_priority_move",
        "Priority anchors must exist in the same contextual ranking.",
      );
    }
    const minimum = lowerIndex + 1;
    const maximum = higherIndex;
    if (minimum > maximum) {
      throw new WorkGraphError(
        "invalid_priority_move",
        "The requested higher-than and lower-than anchors contradict their current order.",
      );
    }
    if (input.lowerThanId === undefined) return maximum;
    if (input.higherThanId === undefined) return minimum;
    return Math.floor((minimum + maximum) / 2);
  }

  private async writeKnowledgeScopeRanks(
    transaction: DbTransaction,
    orderedIds: readonly string[],
  ): Promise<void> {
    if (orderedIds.length === 0) return;
    await transaction
      .update(knowledgeScope)
      .set({ rank: null })
      .where(inArray(knowledgeScope.id, [...orderedIds]));
    for (const [index, id] of orderedIds.entries()) {
      await transaction
        .update(knowledgeScope)
        .set({ rank: (index + 1) * PRIORITY_RANK_GAP })
        .where(eq(knowledgeScope.id, id));
    }
  }

  private async placeKnowledgeScopeAtMedian(
    transaction: DbTransaction,
    id: string,
    kind: KnowledgeScope["kind"],
  ): Promise<void> {
    const rows = await transaction
      .select({ id: knowledgeScope.id, rank: knowledgeScope.rank })
      .from(knowledgeScope)
      .where(eq(knowledgeScope.kind, kind));
    const orderedIds = rows
      .filter((row) => row.id !== id)
      .sort((left, right) =>
        (left.rank ?? Number.MAX_SAFE_INTEGER) -
          (right.rank ?? Number.MAX_SAFE_INTEGER) ||
        left.id.localeCompare(right.id),
      )
      .map(({ id: candidateId }) => candidateId);
    orderedIds.splice(Math.ceil(orderedIds.length / 2), 0, id);
    await this.writeKnowledgeScopeRanks(transaction, orderedIds);
  }

  private async writeWorkItemPriorityRanks(
    transaction: DbTransaction,
    orderedIds: readonly string[],
  ): Promise<void> {
    if (orderedIds.length === 0) return;
    await transaction
      .update(workItemPriorityContext)
      .set({ rank: null })
      .where(inArray(workItemPriorityContext.workItemId, [...orderedIds]));
    for (const [index, id] of orderedIds.entries()) {
      await transaction
        .update(workItemPriorityContext)
        .set({ rank: (index + 1) * PRIORITY_RANK_GAP })
        .where(eq(workItemPriorityContext.workItemId, id));
    }
  }

  private async listPriorityOwnerIds(
    transaction: DbTransaction,
    projectId: string | null,
  ): Promise<string[]> {
    const rows = await transaction
      .select({
        id: workItemPriorityContext.workItemId,
        rank: workItemPriorityContext.rank,
      })
      .from(workItemPriorityContext)
      .where(
        projectId === null
          ? isNull(workItemPriorityContext.schedulingProjectId)
          : eq(workItemPriorityContext.schedulingProjectId, projectId),
      );
    rows.sort(compareStoredRanks);
    return rows.map(({ id }) => id);
  }

  private async placeWorkItemAtMedian(
    transaction: DbTransaction,
    workItemId: string,
    projectId: string | null,
  ): Promise<void> {
    const orderedIds = (
      await this.listPriorityOwnerIds(transaction, projectId)
    ).filter((id) => id !== workItemId);
    orderedIds.splice(Math.ceil(orderedIds.length / 2), 0, workItemId);
    await this.writeWorkItemPriorityRanks(transaction, orderedIds);
  }

  private async loadGraph(transaction: DbTransaction): Promise<WorkGraph> {
    const workItems = await transaction
      .select({
        id: workItem.id,
        title: workItem.title,
        lifecycle: workItem.lifecycle,
        expedited: workItem.expedited,
        expediteReason: workItem.expediteReason,
        priorityRank: workItemPriorityContext.rank,
        schedulingInitiativeId:
          workItemPriorityContext.schedulingInitiativeId,
        schedulingProjectId: workItemPriorityContext.schedulingProjectId,
        parentId: workItemHierarchy.parentWorkItemId,
        rank: workItemHierarchy.rank,
      })
      .from(workItem)
      .leftJoin(
        workItemHierarchy,
        eq(workItemHierarchy.childWorkItemId, workItem.id),
      )
      .leftJoin(
        workItemPriorityContext,
        eq(workItemPriorityContext.workItemId, workItem.id),
      )
      .orderBy(workItem.createdAt, workItem.id);
    const dependencies = await transaction
      .select({
        dependentWorkItemId: workItemDependency.dependentWorkItemId,
        blockerWorkItemId: workItemDependency.blockerWorkItemId,
      })
      .from(workItemDependency)
      .orderBy(
        workItemDependency.dependentWorkItemId,
        workItemDependency.blockerWorkItemId,
      );

    const contexts = await transaction
      .select({
        workItemId: workItemContext.workItemId,
        kind: workItemContext.kind,
        content: workItemContext.content,
      })
      .from(workItemContext)
      .orderBy(workItemContext.workItemId, workItemContext.kind);
    const architectureDecisions = await transaction
      .select({
        workItemId: workItemArchitectureDecision.workItemId,
        title: workItemArchitectureDecision.title,
        url: workItemArchitectureDecision.url,
        role: workItemArchitectureDecision.role,
      })
      .from(workItemArchitectureDecision)
      .orderBy(
        workItemArchitectureDecision.workItemId,
        workItemArchitectureDecision.url,
      );
    const references = await transaction
      .select({
        workItemId: workItemReference.workItemId,
        title: workItemReference.title,
        url: workItemReference.url,
      })
      .from(workItemReference)
      .orderBy(workItemReference.workItemId, workItemReference.url);
    const pullRequests = (
      await transaction
        .select({
          repository: pullRequest.repository,
          number: pullRequest.number,
          url: pullRequest.url,
          headSha: pullRequest.headSha,
          state: pullRequest.state,
          draft: pullRequest.draft,
          mergeability: pullRequest.mergeability,
          reviewDecision: pullRequest.reviewDecision,
          checkSummary: pullRequest.checkSummary,
          observedAt: pullRequest.observedAt,
        })
        .from(pullRequest)
        .orderBy(pullRequest.repository, pullRequest.number)
    ).map(({ observedAt, ...snapshot }) => ({
      ...snapshot,
      observedAt: observedAt.toISOString(),
    }));
    const workItemPullRequests = await transaction
      .select({
        workItemId: workItemPullRequest.workItemId,
        repository: workItemPullRequest.repository,
        number: workItemPullRequest.number,
        role: workItemPullRequest.role,
      })
      .from(workItemPullRequest)
      .orderBy(
        workItemPullRequest.workItemId,
        workItemPullRequest.repository,
        workItemPullRequest.number,
      );

    return createWorkGraph({
      workItems,
      dependencies,
      contexts,
      architectureDecisions,
      references,
      pullRequests,
      workItemPullRequests,
    });
  }

  private async requireStoredPullRequest(
    transaction: DbTransaction,
    repository: string,
    number: number,
  ): Promise<PullRequestSnapshot> {
    const [stored] = await transaction
      .select({
        repository: pullRequest.repository,
        number: pullRequest.number,
        url: pullRequest.url,
        headSha: pullRequest.headSha,
        state: pullRequest.state,
        draft: pullRequest.draft,
        mergeability: pullRequest.mergeability,
        reviewDecision: pullRequest.reviewDecision,
        checkSummary: pullRequest.checkSummary,
        observedAt: pullRequest.observedAt,
      })
      .from(pullRequest)
      .where(
        and(
          eq(pullRequest.repository, repository),
          eq(pullRequest.number, number),
        ),
      )
      .limit(1);
    if (!stored) {
      throw new WorkGraphError(
        "pull_request_not_found",
        `Pull request ${repository}#${number} does not exist.`,
      );
    }
    return { ...stored, observedAt: stored.observedAt.toISOString() };
  }

  private async requireGraphWorkItem(
    transaction: DbTransaction,
    workItemId: string,
  ): Promise<WorkItem> {
    const graph = await this.loadGraph(transaction);
    const item = graph.workItems.find(({ id }) => id === workItemId);
    if (!item) throw workItemNotFound(workItemId);
    return item;
  }

  private async lockGraphSnapshot(transaction: DbTransaction): Promise<void> {
    const locked = await transaction
      .select({ id: graphMutationLock.id })
      .from(graphMutationLock)
      .where(eq(graphMutationLock.id, GRAPH_MUTATION_LOCK_ID))
      .for("share");
    if (locked.length !== 1) {
      throw new Error("The global graph mutation lock row is missing.");
    }
  }

  private async lockEventSequence(transaction: DbTransaction): Promise<void> {
    const locked = await transaction
      .select({ id: graphMutationLock.id })
      .from(graphMutationLock)
      .where(eq(graphMutationLock.id, EVENT_SEQUENCE_LOCK_ID))
      .for("update");
    if (locked.length !== 1) {
      throw new Error("The event sequence lock row is missing.");
    }
  }

  private async findClaimableWorkItemId(
    transaction: DbTransaction,
    requestedWorkItemId?: string,
    scope: WorkItemSelectionScope = {},
  ): Promise<string | null> {
    let candidateIds: readonly string[];
    if (requestedWorkItemId === undefined) {
      const claimableIds = new Set(
        (
          await transaction
            .select({ id: workItem.id })
            .from(workItem)
            .where(claimableWorkItemWhere())
        ).map(({ id }) => id),
      );
      const graph = await this.loadGraph(transaction);
      candidateIds = orderWorkItemsByPriority(
        graph,
        await this.loadKnowledgeScopes(transaction),
      )
        .filter((item) => isWorkItemInSelectionScope(graph, item, scope))
        .map(({ id }) => id)
        .filter((id) => claimableIds.has(id));
    } else {
      candidateIds = [requestedWorkItemId];
    }

    for (const candidateId of candidateIds) {
      const [candidate] = await transaction
        .select({ id: workItem.id })
        .from(workItem)
        .where(claimableWorkItemWhere(candidateId))
        .limit(1)
        .for("update", { of: workItem, skipLocked: true });
      if (!candidate) continue;

      // A concurrent claimant can commit between predicate evaluation and row
      // locking. Recheck in a new READ COMMITTED statement after the lock is
      // held, then move on if it is no longer eligible.
      const [stillClaimable] = await transaction
        .select({ id: workItem.id })
        .from(workItem)
        .where(claimableWorkItemWhere(candidate.id))
        .limit(1);
      if (stillClaimable) return candidate.id;
    }

    if (requestedWorkItemId !== undefined) {
      await this.requireStoredWorkItem(transaction, requestedWorkItemId);
    }
    return null;
  }

  private async requireStoredWorkItem(
    transaction: DbTransaction,
    workItemId: string,
  ): Promise<void> {
    const stored = await transaction
      .select({ id: workItem.id })
      .from(workItem)
      .where(eq(workItem.id, workItemId))
      .limit(1);
    if (stored.length === 0) {
      throw workItemNotFound(workItemId);
    }
  }

  private async rejectCycle(transaction: DbTransaction): Promise<void> {
    const [result] = await transaction.execute<GraphCycleRow>(graphCycleQuery);
    if (result?.hasCycle === true) {
      throw new WorkGraphError(
        "graph_cycle",
        "The change creates a waits-for cycle.",
      );
    }
  }
}
