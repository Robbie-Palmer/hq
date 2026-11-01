import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const mailboxProviderEnum = pgEnum("mailbox_provider", [
  "microsoft_graph",
  "gmail",
]);

export const providerMailboxStateEnum = pgEnum("provider_mailbox_state", [
  "active",
  "pending_mailbox_deletion",
  "mailbox_purged",
]);

export const archiveStateEnum = pgEnum("archive_state", [
  "retained",
  "pending_archive_deletion",
  "archive_purged",
]);

export const encryptedContentClassEnum = pgEnum("encrypted_content_class", [
  "raw_mime",
  "attachment",
  "retained_document",
  "evaluation_sample",
  "export_bundle",
  "temporary_work",
]);

export const proposalStateEnum = pgEnum("proposal_state", [
  "pending",
  "approved",
  "rejected",
  "expired",
  "executed",
  "failed",
]);

export const approvalDecisionEnum = pgEnum("approval_decision", [
  "approved",
  "rejected",
  "revoked",
]);

export const actionOutcomeStateEnum = pgEnum("action_outcome_state", [
  "succeeded",
  "failed",
  "unknown",
]);

export const mailboxAccount = pgTable(
  "mailbox_account",
  {
    id: uuid().primaryKey().defaultRandom(),
    provider: mailboxProviderEnum().notNull(),
    providerAccountId: text().notNull(),
    primaryAddress: text(),
    displayName: text(),
    providerState: providerMailboxStateEnum().notNull().default("active"),
    archiveState: archiveStateEnum().notNull().default("retained"),
    mailboxDeletionRequestedAt: timestamp({ withTimezone: true }),
    mailboxPurgedAt: timestamp({ withTimezone: true }),
    archiveDeletionRequestedAt: timestamp({ withTimezone: true }),
    archiveRecoveryUntil: timestamp({ withTimezone: true }),
    archivePurgedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("mailbox_account_provider_id_uidx").on(
      table.provider,
      table.providerAccountId,
    ),
    check(
      "mailbox_account_provider_id_not_blank_check",
      sql`btrim(${table.providerAccountId}) <> ''`,
    ),
    check(
      "mailbox_account_archive_recovery_check",
      sql`${table.archiveDeletionRequestedAt} is null or ${table.archiveRecoveryUntil} >= ${table.archiveDeletionRequestedAt}`,
    ),
  ],
);

export const providerSyncState = pgTable(
  "provider_sync_state",
  {
    id: uuid().primaryKey().defaultRandom(),
    accountId: uuid()
      .notNull()
      .references(() => mailboxAccount.id, { onDelete: "restrict" }),
    resourceKind: text().notNull(),
    cursor: text(),
    lastAttemptAt: timestamp({ withTimezone: true }),
    lastSuccessfulAt: timestamp({ withTimezone: true }),
    lastErrorCode: text(),
    lastErrorAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("provider_sync_state_account_resource_uidx").on(
      table.accountId,
      table.resourceKind,
    ),
    check(
      "provider_sync_state_resource_not_blank_check",
      sql`btrim(${table.resourceKind}) <> ''`,
    ),
  ],
);

export const contentHash = pgTable(
  "content_hash",
  {
    id: uuid().primaryKey().defaultRandom(),
    accountId: uuid()
      .notNull()
      .references(() => mailboxAccount.id, { onDelete: "restrict" }),
    algorithm: text().notNull().default("sha256"),
    digest: text().notNull(),
    byteLength: bigint({ mode: "number" }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("content_hash_account_algorithm_digest_uidx").on(
      table.accountId,
      table.algorithm,
      table.digest,
    ),
    check(
      "content_hash_sha256_check",
      sql`${table.algorithm} <> 'sha256' or ${table.digest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "content_hash_byte_length_check",
      sql`${table.byteLength} >= 0`,
    ),
  ],
);

export const contentObject = pgTable(
  "content_object",
  {
    id: uuid().primaryKey().defaultRandom(),
    accountId: uuid()
      .notNull()
      .references(() => mailboxAccount.id, { onDelete: "restrict" }),
    contentHashId: uuid()
      .notNull()
      .references(() => contentHash.id, { onDelete: "restrict" }),
    contentClass: encryptedContentClassEnum().notNull(),
    objectKey: text().notNull(),
    objectVersion: integer().notNull().default(1),
    ciphertextAlgorithm: text().notNull().default("AES-256-GCM"),
    keyWrapAlgorithm: text().notNull().default("AES-256-KW"),
    envelopeVersion: integer().notNull().default(1),
    keyVersion: text().notNull(),
    nonceBase64: text().notNull(),
    wrappedDataKeyBase64: text().notNull(),
    archiveState: archiveStateEnum().notNull().default("retained"),
    deletionRequestedAt: timestamp({ withTimezone: true }),
    recoveryUntil: timestamp({ withTimezone: true }),
    purgedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("content_object_key_uidx").on(table.objectKey),
    uniqueIndex("content_object_account_id_version_uidx").on(
      table.accountId,
      table.id,
      table.objectVersion,
    ),
    index("content_object_hash_idx").on(table.contentHashId),
    index("content_object_account_class_idx").on(
      table.accountId,
      table.contentClass,
    ),
    check(
      "content_object_version_positive_check",
      sql`${table.objectVersion} > 0 and ${table.envelopeVersion} > 0`,
    ),
    check(
      "content_object_algorithms_check",
      sql`${table.ciphertextAlgorithm} = 'AES-256-GCM' and ${table.keyWrapAlgorithm} = 'AES-256-KW'`,
    ),
    check(
      "content_object_recovery_check",
      sql`${table.deletionRequestedAt} is null or ${table.recoveryUntil} >= ${table.deletionRequestedAt}`,
    ),
  ],
);

export const mailMessage = pgTable(
  "mail_message",
  {
    id: uuid().primaryKey().defaultRandom(),
    accountId: uuid()
      .notNull()
      .references(() => mailboxAccount.id, { onDelete: "restrict" }),
    providerMessageId: text().notNull(),
    providerThreadId: text(),
    internetMessageId: text(),
    rawObjectId: uuid()
      .notNull()
      .references(() => contentObject.id, { onDelete: "restrict" }),
    subject: text(),
    sender: jsonb().$type<Record<string, unknown>>(),
    recipients: jsonb().$type<Record<string, unknown>>(),
    receivedAt: timestamp({ withTimezone: true }),
    sentAt: timestamp({ withTimezone: true }),
    providerUpdatedAt: timestamp({ withTimezone: true }),
    observedAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("mail_message_account_provider_id_uidx").on(
      table.accountId,
      table.providerMessageId,
    ),
    index("mail_message_account_received_idx").on(
      table.accountId,
      table.receivedAt,
    ),
    check(
      "mail_message_provider_id_not_blank_check",
      sql`btrim(${table.providerMessageId}) <> ''`,
    ),
  ],
);

export const mailAttachment = pgTable(
  "mail_attachment",
  {
    id: uuid().primaryKey().defaultRandom(),
    accountId: uuid()
      .notNull()
      .references(() => mailboxAccount.id, { onDelete: "restrict" }),
    messageId: uuid()
      .notNull()
      .references(() => mailMessage.id, { onDelete: "restrict" }),
    providerAttachmentId: text().notNull(),
    contentObjectId: uuid()
      .notNull()
      .references(() => contentObject.id, { onDelete: "restrict" }),
    filename: text(),
    mediaType: text(),
    inlineContentId: text(),
    byteLength: bigint({ mode: "number" }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("mail_attachment_account_provider_id_uidx").on(
      table.accountId,
      table.providerAttachmentId,
    ),
    index("mail_attachment_message_idx").on(table.messageId),
    check(
      "mail_attachment_provider_id_not_blank_check",
      sql`btrim(${table.providerAttachmentId}) <> ''`,
    ),
    check(
      "mail_attachment_byte_length_check",
      sql`${table.byteLength} >= 0`,
    ),
  ],
);

export const evidence = pgTable(
  "evidence",
  {
    id: uuid().primaryKey().defaultRandom(),
    accountId: uuid()
      .notNull()
      .references(() => mailboxAccount.id, { onDelete: "restrict" }),
    messageId: uuid().references(() => mailMessage.id, {
      onDelete: "restrict",
    }),
    attachmentId: uuid().references(() => mailAttachment.id, {
      onDelete: "restrict",
    }),
    contentObjectId: uuid().references(() => contentObject.id, {
      onDelete: "restrict",
    }),
    kind: text().notNull(),
    locator: jsonb().$type<Record<string, unknown>>().notNull(),
    contentDigest: text().notNull(),
    capturedAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("evidence_account_captured_idx").on(
      table.accountId,
      table.capturedAt,
    ),
    check("evidence_kind_not_blank_check", sql`btrim(${table.kind}) <> ''`),
  ],
);

export const actionProposal = pgTable(
  "action_proposal",
  {
    id: uuid().primaryKey().defaultRandom(),
    accountId: uuid()
      .notNull()
      .references(() => mailboxAccount.id, { onDelete: "restrict" }),
    proposalType: text().notNull(),
    state: proposalStateEnum().notNull().default("pending"),
    idempotencyKey: text().notNull(),
    summary: text().notNull(),
    rationale: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("action_proposal_account_idempotency_uidx").on(
      table.accountId,
      table.idempotencyKey,
    ),
    index("action_proposal_account_state_idx").on(
      table.accountId,
      table.state,
    ),
    check(
      "action_proposal_type_not_blank_check",
      sql`btrim(${table.proposalType}) <> ''`,
    ),
    check(
      "action_proposal_idempotency_not_blank_check",
      sql`btrim(${table.idempotencyKey}) <> ''`,
    ),
  ],
);

export const actionManifest = pgTable(
  "action_manifest",
  {
    id: uuid().primaryKey().defaultRandom(),
    proposalId: uuid()
      .notNull()
      .references(() => actionProposal.id, { onDelete: "restrict" }),
    version: integer().notNull(),
    digest: text().notNull(),
    operations: jsonb().$type<readonly Record<string, unknown>[]>().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("action_manifest_proposal_version_uidx").on(
      table.proposalId,
      table.version,
    ),
    uniqueIndex("action_manifest_proposal_digest_uidx").on(
      table.proposalId,
      table.digest,
    ),
    check("action_manifest_version_positive_check", sql`${table.version} > 0`),
  ],
);

export const approval = pgTable(
  "approval",
  {
    id: uuid().primaryKey().defaultRandom(),
    proposalId: uuid()
      .notNull()
      .references(() => actionProposal.id, { onDelete: "restrict" }),
    manifestId: uuid()
      .notNull()
      .references(() => actionManifest.id, { onDelete: "restrict" }),
    sequence: integer().notNull(),
    decision: approvalDecisionEnum().notNull(),
    decidedBy: text().notNull(),
    reason: text(),
    decidedAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("approval_proposal_sequence_uidx").on(
      table.proposalId,
      table.sequence,
    ),
    index("approval_manifest_idx").on(table.manifestId),
    check("approval_sequence_positive_check", sql`${table.sequence} > 0`),
    check(
      "approval_decided_by_not_blank_check",
      sql`btrim(${table.decidedBy}) <> ''`,
    ),
  ],
);

export const actionOutcome = pgTable(
  "action_outcome",
  {
    id: uuid().primaryKey().defaultRandom(),
    proposalId: uuid()
      .notNull()
      .references(() => actionProposal.id, { onDelete: "restrict" }),
    manifestId: uuid()
      .notNull()
      .references(() => actionManifest.id, { onDelete: "restrict" }),
    attempt: integer().notNull(),
    state: actionOutcomeStateEnum().notNull(),
    providerActionId: text(),
    details: jsonb().$type<Record<string, unknown>>().notNull(),
    startedAt: timestamp({ withTimezone: true }).notNull(),
    finishedAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("action_outcome_proposal_attempt_uidx").on(
      table.proposalId,
      table.attempt,
    ),
    uniqueIndex("action_outcome_provider_action_uidx")
      .on(table.providerActionId)
      .where(sql`${table.providerActionId} is not null`),
    check("action_outcome_attempt_positive_check", sql`${table.attempt} > 0`),
    check(
      "action_outcome_finished_after_started_check",
      sql`${table.finishedAt} >= ${table.startedAt}`,
    ),
  ],
);

export const idempotencyKey = pgTable(
  "idempotency_key",
  {
    id: uuid().primaryKey().defaultRandom(),
    accountId: uuid()
      .notNull()
      .references(() => mailboxAccount.id, { onDelete: "restrict" }),
    scope: text().notNull(),
    key: text().notNull(),
    requestDigest: text().notNull(),
    result: jsonb().$type<Record<string, unknown>>(),
    expiresAt: timestamp({ withTimezone: true }),
    completedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idempotency_key_account_scope_key_uidx").on(
      table.accountId,
      table.scope,
      table.key,
    ),
    index("idempotency_key_expires_idx").on(table.expiresAt),
    check(
      "idempotency_key_scope_not_blank_check",
      sql`btrim(${table.scope}) <> ''`,
    ),
    check(
      "idempotency_key_key_not_blank_check",
      sql`btrim(${table.key}) <> ''`,
    ),
  ],
);

export const auditEvent = pgTable(
  "audit_event",
  {
    id: uuid().primaryKey().defaultRandom(),
    accountId: uuid()
      .notNull()
      .references(() => mailboxAccount.id, { onDelete: "restrict" }),
    eventType: text().notNull(),
    actorType: text().notNull(),
    actorId: text(),
    subjectType: text().notNull(),
    subjectId: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    previousEventHash: text(),
    eventHash: text().notNull(),
    occurredAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("audit_event_account_hash_uidx").on(
      table.accountId,
      table.eventHash,
    ),
    index("audit_event_account_occurred_idx").on(
      table.accountId,
      table.occurredAt,
      table.id,
    ),
    check(
      "audit_event_type_not_blank_check",
      sql`btrim(${table.eventType}) <> ''`,
    ),
    check(
      "audit_event_subject_not_blank_check",
      sql`btrim(${table.subjectType}) <> '' and btrim(${table.subjectId}) <> ''`,
    ),
  ],
);
