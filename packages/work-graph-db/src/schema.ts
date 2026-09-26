import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  ARCHITECTURE_DECISION_ROLES,
  DELIVERY_EVIDENCE_KINDS,
  DELIVERY_EVIDENCE_STATES,
  EVIDENCE_CORRELATION_KINDS,
  KNOWLEDGE_SCOPE_KINDS,
  KNOWLEDGE_SCOPE_LIFECYCLES,
  LEASE_OUTCOMES,
  PULL_REQUEST_CHECK_SUMMARIES,
  PULL_REQUEST_MERGEABILITIES,
  PULL_REQUEST_REVIEW_DECISIONS,
  PULL_REQUEST_ROLES,
  PULL_REQUEST_STATES,
  WORK_ITEM_CONTEXT_KINDS,
  WORK_ITEM_LIFECYCLES,
} from "work-graph-domain";

export const workItemContextKindEnum = pgEnum(
  "work_item_context_kind",
  WORK_ITEM_CONTEXT_KINDS,
);

export const architectureDecisionRoleEnum = pgEnum(
  "architecture_decision_role",
  ARCHITECTURE_DECISION_ROLES,
);

export const pullRequestRoleEnum = pgEnum(
  "pull_request_role",
  PULL_REQUEST_ROLES,
);

export const pullRequestStateEnum = pgEnum(
  "pull_request_state",
  PULL_REQUEST_STATES,
);

export const pullRequestMergeabilityEnum = pgEnum(
  "pull_request_mergeability",
  PULL_REQUEST_MERGEABILITIES,
);

export const pullRequestReviewDecisionEnum = pgEnum(
  "pull_request_review_decision",
  PULL_REQUEST_REVIEW_DECISIONS,
);

export const pullRequestCheckSummaryEnum = pgEnum(
  "pull_request_check_summary",
  PULL_REQUEST_CHECK_SUMMARIES,
);

export const deliveryEvidenceKindEnum = pgEnum(
  "delivery_evidence_kind",
  DELIVERY_EVIDENCE_KINDS,
);

export const deliveryEvidenceStateEnum = pgEnum(
  "delivery_evidence_state",
  DELIVERY_EVIDENCE_STATES,
);

export const evidenceCorrelationKindEnum = pgEnum(
  "evidence_correlation_kind",
  EVIDENCE_CORRELATION_KINDS,
);

export const knowledgeScopeKindEnum = pgEnum(
  "knowledge_scope_kind",
  KNOWLEDGE_SCOPE_KINDS,
);

export const knowledgeScopeLifecycleEnum = pgEnum(
  "knowledge_scope_lifecycle",
  KNOWLEDGE_SCOPE_LIFECYCLES,
);

export const workItemLifecycleEnum = pgEnum(
  "work_item_lifecycle",
  WORK_ITEM_LIFECYCLES,
);

export const leaseOutcomeEnum = pgEnum("lease_outcome", LEASE_OUTCOMES);

export const workItem = pgTable(
  "work_items",
  {
    id: text().primaryKey(),
    title: text().notNull(),
    lifecycle: workItemLifecycleEnum().notNull().default("open"),
    expedited: boolean().notNull().default(false),
    expediteReason: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check("work_items_id_not_blank_check", sql`btrim(${table.id}) <> ''`),
    check(
      "work_items_title_not_blank_check",
      sql`btrim(${table.title}) <> ''`,
    ),
    check(
      "work_items_expedite_reason_check",
      sql`${table.expedited} = (${table.expediteReason} is not null and btrim(${table.expediteReason}) <> '')`,
    ),
  ],
);

export const workItemHierarchy = pgTable(
  "work_item_hierarchy",
  {
    childWorkItemId: text()
      .primaryKey()
      .references(() => workItem.id, { onDelete: "restrict" }),
    parentWorkItemId: text()
      .notNull()
      .references(() => workItem.id, { onDelete: "restrict" }),
    rank: integer(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("work_item_hierarchy_parent_work_item_id_idx").on(
      table.parentWorkItemId,
    ),
    uniqueIndex("work_item_hierarchy_parent_rank_uidx")
      .on(table.parentWorkItemId, table.rank)
      .where(sql`${table.rank} is not null`),
    check(
      "work_item_hierarchy_not_self_check",
      sql`${table.childWorkItemId} <> ${table.parentWorkItemId}`,
    ),
    check(
      "work_item_hierarchy_rank_positive_check",
      sql`${table.rank} is null or ${table.rank} > 0`,
    ),
  ],
);

export const workItemDependency = pgTable(
  "work_item_dependencies",
  {
    dependentWorkItemId: text()
      .notNull()
      .references(() => workItem.id, { onDelete: "restrict" }),
    blockerWorkItemId: text()
      .notNull()
      .references(() => workItem.id, { onDelete: "restrict" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "work_item_dependencies_pk",
      columns: [table.dependentWorkItemId, table.blockerWorkItemId],
    }),
    index("work_item_dependencies_blocker_work_item_id_idx").on(
      table.blockerWorkItemId,
    ),
    check(
      "work_item_dependencies_not_self_check",
      sql`${table.dependentWorkItemId} <> ${table.blockerWorkItemId}`,
    ),
  ],
);

export const workItemContext = pgTable(
  "work_item_contexts",
  {
    workItemId: text()
      .notNull()
      .references(() => workItem.id, { onDelete: "restrict" }),
    kind: workItemContextKindEnum().notNull(),
    content: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    primaryKey({
      name: "work_item_contexts_pk",
      columns: [table.workItemId, table.kind],
    }),
    check(
      "work_item_contexts_content_not_blank_check",
      sql`btrim(${table.content}) <> ''`,
    ),
  ],
);

export const workItemArchitectureDecision = pgTable(
  "work_item_architecture_decisions",
  {
    workItemId: text()
      .notNull()
      .references(() => workItem.id, { onDelete: "restrict" }),
    url: text().notNull(),
    title: text().notNull(),
    role: architectureDecisionRoleEnum().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    primaryKey({
      name: "work_item_architecture_decisions_pk",
      columns: [table.workItemId, table.url],
    }),
    check(
      "work_item_architecture_decisions_url_not_blank_check",
      sql`btrim(${table.url}) <> ''`,
    ),
    check(
      "work_item_architecture_decisions_title_not_blank_check",
      sql`btrim(${table.title}) <> ''`,
    ),
  ],
);

export const workItemReference = pgTable(
  "work_item_references",
  {
    workItemId: text()
      .notNull()
      .references(() => workItem.id, { onDelete: "restrict" }),
    url: text().notNull(),
    title: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    primaryKey({
      name: "work_item_references_pk",
      columns: [table.workItemId, table.url],
    }),
    check(
      "work_item_references_url_not_blank_check",
      sql`btrim(${table.url}) <> ''`,
    ),
    check(
      "work_item_references_title_not_blank_check",
      sql`btrim(${table.title}) <> ''`,
    ),
  ],
);

export const pullRequest = pgTable(
  "pull_requests",
  {
    repository: text().notNull(),
    number: integer().notNull(),
    url: text().notNull(),
    headSha: text().notNull(),
    acceptedHeadSha: text(),
    mergeCommitSha: text(),
    state: pullRequestStateEnum().notNull(),
    draft: boolean().notNull(),
    mergeability: pullRequestMergeabilityEnum().notNull(),
    reviewDecision: pullRequestReviewDecisionEnum(),
    checkSummary: pullRequestCheckSummaryEnum().notNull(),
    observedAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    primaryKey({
      name: "pull_requests_pk",
      columns: [table.repository, table.number],
    }),
    check(
      "pull_requests_repository_not_blank_check",
      sql`btrim(${table.repository}) <> ''`,
    ),
    check("pull_requests_number_positive_check", sql`${table.number} > 0`),
    check(
      "pull_requests_url_not_blank_check",
      sql`btrim(${table.url}) <> ''`,
    ),
    check(
      "pull_requests_head_sha_not_blank_check",
      sql`btrim(${table.headSha}) <> ''`,
    ),
    check(
      "pull_requests_accepted_head_sha_not_blank_check",
      sql`${table.acceptedHeadSha} is null or btrim(${table.acceptedHeadSha}) <> ''`,
    ),
    check(
      "pull_requests_merge_commit_sha_not_blank_check",
      sql`${table.mergeCommitSha} is null or btrim(${table.mergeCommitSha}) <> ''`,
    ),
  ],
);

export const workItemPullRequest = pgTable(
  "work_item_pull_requests",
  {
    workItemId: text()
      .notNull()
      .references(() => workItem.id, { onDelete: "restrict" }),
    repository: text().notNull(),
    number: integer().notNull(),
    role: pullRequestRoleEnum().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    primaryKey({
      name: "work_item_pull_requests_pk",
      columns: [table.workItemId, table.repository, table.number],
    }),
    foreignKey({
      name: "work_item_pull_requests_pull_request_fk",
      columns: [table.repository, table.number],
      foreignColumns: [pullRequest.repository, pullRequest.number],
    }).onDelete("restrict"),
    index("work_item_pull_requests_pull_request_idx").on(
      table.repository,
      table.number,
    ),
  ],
);

export const externalDelivery = pgTable(
  "external_deliveries",
  {
    provider: text().notNull(),
    externalId: text().notNull(),
    payloadDigest: text().notNull(),
    receivedAt: timestamp({ withTimezone: true }).notNull(),
    ingestedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "external_deliveries_pk",
      columns: [table.provider, table.externalId],
    }),
    check(
      "external_deliveries_provider_not_blank_check",
      sql`btrim(${table.provider}) <> ''`,
    ),
    check(
      "external_deliveries_external_id_not_blank_check",
      sql`btrim(${table.externalId}) <> ''`,
    ),
    check(
      "external_deliveries_payload_digest_check",
      sql`${table.payloadDigest} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const deliveryEvidenceObservation = pgTable(
  "delivery_evidence_observations",
  {
    id: uuid().primaryKey(),
    deliveryProvider: text().notNull(),
    deliveryExternalId: text().notNull(),
    provider: text().notNull(),
    externalId: text().notNull(),
    repository: text().notNull(),
    commitSha: text().notNull(),
    kind: deliveryEvidenceKindEnum().notNull(),
    state: deliveryEvidenceStateEnum().notNull(),
    name: text(),
    environment: text(),
    sourceUrl: text().notNull(),
    providerObservedAt: timestamp({ withTimezone: true }).notNull(),
    ingestedAt: timestamp({ withTimezone: true }).notNull(),
    correlationKind: evidenceCorrelationKindEnum().notNull(),
    pullRequestRepository: text(),
    pullRequestNumber: integer(),
  },
  (table) => [
    foreignKey({
      name: "delivery_evidence_observations_delivery_fk",
      columns: [table.deliveryProvider, table.deliveryExternalId],
      foreignColumns: [externalDelivery.provider, externalDelivery.externalId],
    }).onDelete("restrict"),
    uniqueIndex("delivery_evidence_observations_external_identity_uidx").on(
      table.provider,
      table.kind,
      table.externalId,
      table.providerObservedAt,
      table.state,
    ),
    index("delivery_evidence_observations_commit_idx").on(
      table.repository,
      table.commitSha,
    ),
    check(
      "delivery_evidence_observations_correlation_check",
      sql`(${table.correlationKind} = 'unmatched' and ${table.pullRequestRepository} is null and ${table.pullRequestNumber} is null) or (${table.correlationKind} <> 'unmatched' and ${table.pullRequestRepository} is not null and ${table.pullRequestNumber} is not null and ${table.pullRequestNumber} > 0)`,
    ),
  ],
);

export const currentDeliveryEvidence = pgTable(
  "current_delivery_evidence",
  {
    provider: text().notNull(),
    kind: deliveryEvidenceKindEnum().notNull(),
    externalId: text().notNull(),
    observationId: uuid()
      .notNull()
      .references(() => deliveryEvidenceObservation.id, { onDelete: "restrict" }),
    providerObservedAt: timestamp({ withTimezone: true }).notNull(),
    projectedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "current_delivery_evidence_pk",
      columns: [table.provider, table.kind, table.externalId],
    }),
    uniqueIndex("current_delivery_evidence_observation_id_uidx").on(
      table.observationId,
    ),
  ],
);

export const completionPolicyRevision = pgTable(
  "completion_policy_revisions",
  {
    policyId: text().notNull(),
    revision: integer().notNull(),
    requiredCiNames: text().array().notNull(),
    productionEnvironments: text().array().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "completion_policy_revisions_pk",
      columns: [table.policyId, table.revision],
    }),
    check(
      "completion_policy_revisions_revision_positive_check",
      sql`${table.revision} > 0`,
    ),
    check(
      "completion_policy_revisions_ci_not_empty_check",
      sql`cardinality(${table.requiredCiNames}) > 0`,
    ),
    check(
      "completion_policy_revisions_environments_not_empty_check",
      sql`cardinality(${table.productionEnvironments}) > 0`,
    ),
  ],
);

export const workItemCompletionPolicy = pgTable(
  "work_item_completion_policies",
  {
    workItemId: text()
      .primaryKey()
      .references(() => workItem.id, { onDelete: "restrict" }),
    policyId: text().notNull(),
    policyRevision: integer().notNull(),
    assignedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [
    foreignKey({
      name: "work_item_completion_policies_revision_fk",
      columns: [table.policyId, table.policyRevision],
      foreignColumns: [
        completionPolicyRevision.policyId,
        completionPolicyRevision.revision,
      ],
    }).onDelete("restrict"),
  ],
);

export const completionCandidateEvaluation = pgTable(
  "completion_candidate_evaluations",
  {
    id: uuid().primaryKey(),
    workItemId: text()
      .notNull()
      .references(() => workItem.id, { onDelete: "restrict" }),
    policyId: text().notNull(),
    policyRevision: integer().notNull(),
    candidate: boolean().notNull(),
    reasons: jsonb().$type<readonly string[]>().notNull(),
    evidenceObservationIds: uuid().array().notNull(),
    evaluatedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [
    foreignKey({
      name: "completion_candidate_evaluations_policy_revision_fk",
      columns: [table.policyId, table.policyRevision],
      foreignColumns: [
        completionPolicyRevision.policyId,
        completionPolicyRevision.revision,
      ],
    }).onDelete("restrict"),
    index("completion_candidate_evaluations_work_item_idx").on(
      table.workItemId,
      table.evaluatedAt,
    ),
    uniqueIndex("completion_candidate_evaluations_id_work_item_uidx").on(
      table.id,
      table.workItemId,
    ),
  ],
);

export const workItemCompletionCandidate = pgTable(
  "work_item_completion_candidates",
  {
    workItemId: text()
      .primaryKey()
      .references(() => workItem.id, { onDelete: "restrict" }),
    evaluationId: uuid().notNull(),
    projectedAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [
    foreignKey({
      name: "work_item_completion_candidates_evaluation_fk",
      columns: [table.evaluationId, table.workItemId],
      foreignColumns: [
        completionCandidateEvaluation.id,
        completionCandidateEvaluation.workItemId,
      ],
    }).onDelete("restrict"),
    uniqueIndex("work_item_completion_candidates_evaluation_id_uidx").on(
      table.evaluationId,
    ),
  ],
);

export const graphMutationLock = pgTable("graph_mutation_locks", {
  id: text().primaryKey(),
});

export const knowledgeScope = pgTable(
  "knowledge_scopes",
  {
    id: text().primaryKey(),
    kind: knowledgeScopeKindEnum().notNull(),
    title: text().notNull(),
    canonicalUrl: text().notNull(),
    markdownUrl: text().notNull(),
    sourceRevision: text(),
    lifecycle: knowledgeScopeLifecycleEnum().notNull().default("active"),
    archiveReason: text(),
    rank: integer(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("knowledge_scopes_kind_rank_uidx")
      .on(table.kind, table.rank)
      .where(sql`${table.rank} is not null`),
    index("knowledge_scopes_lifecycle_kind_idx").on(
      table.lifecycle,
      table.kind,
    ),
    check("knowledge_scopes_id_not_blank_check", sql`btrim(${table.id}) <> ''`),
    check(
      "knowledge_scopes_title_not_blank_check",
      sql`btrim(${table.title}) <> ''`,
    ),
    check(
      "knowledge_scopes_source_revision_not_blank_check",
      sql`${table.sourceRevision} is null or btrim(${table.sourceRevision}) <> ''`,
    ),
    check(
      "knowledge_scopes_rank_positive_check",
      sql`${table.rank} is null or ${table.rank} > 0`,
    ),
    check(
      "knowledge_scopes_archive_reason_check",
      sql`(${table.lifecycle} = 'active' and ${table.archiveReason} is null) or (${table.lifecycle} = 'archived' and ${table.archiveReason} is not null and btrim(${table.archiveReason}) <> '')`,
    ),
    check(
      "knowledge_scopes_archived_rank_check",
      sql`${table.lifecycle} = 'active' or ${table.rank} is null`,
    ),
  ],
);

export const workItemPriorityContext = pgTable(
  "work_item_priority_contexts",
  {
    workItemId: text()
      .primaryKey()
      .references(() => workItem.id, { onDelete: "restrict" }),
    schedulingInitiativeId: text().references(() => knowledgeScope.id, {
      onDelete: "restrict",
    }),
    schedulingProjectId: text().references(() => knowledgeScope.id, {
      onDelete: "restrict",
    }),
    rank: integer(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("work_item_priority_contexts_project_rank_uidx")
      .on(table.schedulingProjectId, table.rank)
      .where(sql`${table.schedulingProjectId} is not null`),
    uniqueIndex("work_item_priority_contexts_unscoped_rank_uidx")
      .on(table.rank)
      .where(sql`${table.schedulingProjectId} is null`),
    index("work_item_priority_contexts_initiative_id_idx").on(
      table.schedulingInitiativeId,
    ),
    check(
      "work_item_priority_contexts_rank_positive_check",
      sql`${table.rank} is null or ${table.rank} > 0`,
    ),
  ],
);

export const knowledgeScopeRelationship = pgTable(
  "knowledge_scope_relationships",
  {
    parentKnowledgeScopeId: text().notNull(),
    childKnowledgeScopeId: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "knowledge_scope_relationships_pk",
      columns: [table.parentKnowledgeScopeId, table.childKnowledgeScopeId],
    }),
    foreignKey({
      name: "knowledge_scope_relationships_parent_fk",
      columns: [table.parentKnowledgeScopeId],
      foreignColumns: [knowledgeScope.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "knowledge_scope_relationships_child_fk",
      columns: [table.childKnowledgeScopeId],
      foreignColumns: [knowledgeScope.id],
    }).onDelete("restrict"),
    index("knowledge_scope_relationships_child_id_idx").on(
      table.childKnowledgeScopeId,
    ),
    check(
      "knowledge_scope_relationships_not_self_check",
      sql`${table.parentKnowledgeScopeId} <> ${table.childKnowledgeScopeId}`,
    ),
  ],
);

export const idempotencyKey = pgTable(
  "idempotency_keys",
  {
    id: uuid().primaryKey(),
    operation: text().notNull(),
    requestFingerprint: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "idempotency_keys_operation_not_blank_check",
      sql`btrim(${table.operation}) <> ''`,
    ),
    check(
      "idempotency_keys_request_fingerprint_not_blank_check",
      sql`btrim(${table.requestFingerprint}) <> ''`,
    ),
  ],
);

export const event = pgTable(
  "events",
  {
    // The migration serializes inserts until commit so this identity is a
    // stable cursor watermark even when writers run concurrently.
    sequence: integer().primaryKey().generatedAlwaysAsIdentity(),
    type: text().notNull(),
    workItemId: text().references(() => workItem.id, {
      onDelete: "restrict",
    }),
    data: jsonb().$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("events_work_item_id_sequence_idx").on(
      table.workItemId,
      table.sequence,
    ),
    check("events_type_not_blank_check", sql`btrim(${table.type}) <> ''`),
  ],
);

export const lease = pgTable(
  "leases",
  {
    id: uuid().primaryKey(),
    workItemId: text()
      .notNull()
      .references(() => workItem.id, { onDelete: "restrict" }),
    workerId: text().notNull(),
    epoch: integer().notNull(),
    acquiredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    endedAt: timestamp({ withTimezone: true }),
    outcome: leaseOutcomeEnum(),
  },
  (table) => [
    uniqueIndex("leases_id_work_item_id_uidx").on(table.id, table.workItemId),
    uniqueIndex("leases_work_item_id_epoch_uidx").on(
      table.workItemId,
      table.epoch,
    ),
    uniqueIndex("leases_one_current_per_work_item_uidx")
      .on(table.workItemId)
      .where(sql`${table.endedAt} is null`),
    check(
      "leases_worker_id_not_blank_check",
      sql`btrim(${table.workerId}) <> ''`,
    ),
    check("leases_epoch_positive_check", sql`${table.epoch} > 0`),
    check(
      "leases_expiry_after_acquisition_check",
      sql`${table.expiresAt} > ${table.acquiredAt}`,
    ),
    check(
      "leases_end_and_outcome_check",
      sql`(${table.endedAt} is null) = (${table.outcome} is null)`,
    ),
    check(
      "leases_end_after_acquisition_check",
      sql`${table.endedAt} is null or ${table.endedAt} >= ${table.acquiredAt}`,
    ),
  ],
);

export const note = pgTable(
  "notes",
  {
    id: uuid().primaryKey(),
    workItemId: text()
      .notNull()
      .references(() => workItem.id, { onDelete: "restrict" }),
    leaseId: uuid(),
    author: text().notNull(),
    content: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "notes_lease_work_item_fk",
      columns: [table.leaseId, table.workItemId],
      foreignColumns: [lease.id, lease.workItemId],
    }).onDelete("restrict"),
    index("notes_work_item_id_created_at_idx").on(
      table.workItemId,
      table.createdAt,
    ),
    check("notes_content_not_blank_check", sql`btrim(${table.content}) <> ''`),
    check("notes_author_not_blank_check", sql`btrim(${table.author}) <> ''`),
  ],
);

export const attentionRequest = pgTable(
  "attention_requests",
  {
    id: uuid().primaryKey(),
    workItemId: text()
      .notNull()
      .references(() => workItem.id, { onDelete: "restrict" }),
    requestingLeaseId: uuid().notNull(),
    kind: text().notNull(),
    question: text().notNull(),
    note: text(),
    blocking: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "attention_requests_lease_work_item_fk",
      columns: [table.requestingLeaseId, table.workItemId],
      foreignColumns: [lease.id, lease.workItemId],
    }).onDelete("restrict"),
    index("attention_requests_work_item_id_created_at_idx").on(
      table.workItemId,
      table.createdAt,
    ),
    check(
      "attention_requests_kind_not_blank_check",
      sql`btrim(${table.kind}) <> ''`,
    ),
    check(
      "attention_requests_question_not_blank_check",
      sql`btrim(${table.question}) <> ''`,
    ),
    check(
      "attention_requests_note_not_blank_check",
      sql`${table.note} is null or btrim(${table.note}) <> ''`,
    ),
  ],
);

export const attentionResolution = pgTable(
  "attention_resolutions",
  {
    id: uuid().primaryKey(),
    attentionRequestId: uuid().notNull(),
    resolution: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "attention_resolutions_request_id_fk",
      columns: [table.attentionRequestId],
      foreignColumns: [attentionRequest.id],
    }).onDelete("restrict"),
    uniqueIndex("attention_resolutions_attention_request_id_uidx").on(
      table.attentionRequestId,
    ),
    check(
      "attention_resolutions_resolution_not_blank_check",
      sql`btrim(${table.resolution}) <> ''`,
    ),
  ],
);
