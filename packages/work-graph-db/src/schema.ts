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
  KNOWLEDGE_SCOPE_KINDS,
  LEASE_OUTCOMES,
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

export const knowledgeScopeKindEnum = pgEnum(
  "knowledge_scope_kind",
  KNOWLEDGE_SCOPE_KINDS,
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
