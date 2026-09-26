import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  primaryKey,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { RECIPE_VISIBILITIES } from "recipe-domain/visibility";

export const user = pgTable("user", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull(),
  image: text(),
  role: text().default("user"),
  banned: boolean(),
  banReason: text(),
  banExpires: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Better Auth keeps one canonical address on `user`. This table records every
// verified address owned by that account so app features can resolve aliases
// captured from linked identity providers without treating an email as the
// user ID.
export const userEmail = pgTable(
  "user_email",
  {
    email: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    verified: boolean().notNull().default(false),
    isPrimary: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("user_email_user_id_idx").on(table.userId)],
);

export const session = pgTable(
  "session",
  {
    id: text().primaryKey(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    token: text().notNull().unique(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    ipAddress: text(),
    userAgent: text(),
    impersonatedBy: text(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text().primaryKey(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    issuer: text().notNull().default(""),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }),
    scope: text(),
    password: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

export const verification = pgTable("verification", {
  id: text().primaryKey(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const authSecondaryStorage = pgTable(
  "auth_secondary_storage",
  {
    key: text().primaryKey(),
    value: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [
    index("auth_secondary_storage_expires_at_idx").on(table.expiresAt),
  ],
);

export const agentHost = pgTable(
  "agent_host",
  {
    id: text().primaryKey(),
    name: text(),
    userId: text().references(() => user.id, { onDelete: "cascade" }),
    defaultCapabilities: text(),
    publicKey: text(),
    kid: text(),
    jwksUrl: text(),
    enrollmentTokenHash: text(),
    enrollmentTokenExpiresAt: timestamp({ withTimezone: true }),
    status: text().notNull().default("active"),
    activatedAt: timestamp({ withTimezone: true }),
    expiresAt: timestamp({ withTimezone: true }),
    lastUsedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("agent_host_user_id_idx").on(table.userId),
    index("agent_host_kid_idx").on(table.kid),
    index("agent_host_enrollment_token_hash_idx").on(
      table.enrollmentTokenHash,
    ),
    index("agent_host_status_idx").on(table.status),
  ],
);

export const agent = pgTable(
  "agent",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    userId: text().references(() => user.id, { onDelete: "cascade" }),
    hostId: text()
      .notNull()
      .references(() => agentHost.id, { onDelete: "cascade" }),
    status: text().notNull().default("active"),
    mode: text().notNull().default("delegated"),
    publicKey: text().notNull(),
    kid: text(),
    jwksUrl: text(),
    lastUsedAt: timestamp({ withTimezone: true }),
    activatedAt: timestamp({ withTimezone: true }),
    expiresAt: timestamp({ withTimezone: true }),
    metadata: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("agent_user_id_idx").on(table.userId),
    index("agent_host_id_idx").on(table.hostId),
    index("agent_status_idx").on(table.status),
    index("agent_kid_idx").on(table.kid),
  ],
);

export const agentCapabilityGrant = pgTable(
  "agent_capability_grant",
  {
    id: text().primaryKey(),
    agentId: text()
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    capability: text().notNull(),
    deniedBy: text().references(() => user.id, { onDelete: "cascade" }),
    grantedBy: text().references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    status: text().notNull().default("active"),
    reason: text(),
    constraints: text(),
  },
  (table) => [
    index("agent_capability_grant_agent_id_idx").on(table.agentId),
    index("agent_capability_grant_capability_idx").on(table.capability),
    index("agent_capability_grant_granted_by_idx").on(table.grantedBy),
    index("agent_capability_grant_status_idx").on(table.status),
  ],
);

export const approvalRequest = pgTable(
  "approval_request",
  {
    id: text().primaryKey(),
    method: text().notNull(),
    agentId: text().references(() => agent.id, { onDelete: "cascade" }),
    hostId: text().references(() => agentHost.id, { onDelete: "cascade" }),
    userId: text().references(() => user.id, { onDelete: "cascade" }),
    capabilities: text(),
    status: text().notNull().default("pending"),
    userCodeHash: text(),
    loginHint: text(),
    bindingMessage: text(),
    clientNotificationToken: text(),
    clientNotificationEndpoint: text(),
    deliveryMode: text(),
    interval: integer().notNull(),
    lastPolledAt: timestamp({ withTimezone: true }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("approval_request_agent_id_idx").on(table.agentId),
    index("approval_request_host_id_idx").on(table.hostId),
    index("approval_request_user_id_idx").on(table.userId),
    index("approval_request_status_idx").on(table.status),
  ],
);

export const agentAuthAuditEvent = pgTable(
  "agent_auth_audit_event",
  {
    id: uuid().primaryKey().defaultRandom(),
    eventType: text().notNull(),
    actorType: text(),
    actorId: text(),
    userId: text(),
    agentId: text(),
    hostId: text(),
    targetType: text(),
    targetId: text(),
    capability: text(),
    outcome: text(),
    durationMs: integer(),
    correlationId: text(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("agent_auth_audit_event_user_time_idx").on(
      table.userId,
      table.occurredAt.desc(),
    ),
    index("agent_auth_audit_event_agent_time_idx").on(
      table.agentId,
      table.occurredAt.desc(),
    ),
    index("agent_auth_audit_event_host_time_idx").on(
      table.hostId,
      table.occurredAt.desc(),
    ),
    index("agent_auth_audit_event_correlation_idx").on(table.correlationId),
  ],
);

export const visibilityEnum = pgEnum("visibility", RECIPE_VISIBILITIES);

export const dietRecipeMatchModeEnum = pgEnum("diet_recipe_match_mode", [
  "hide",
  "warn",
]);

export const organization = pgTable("organization", {
  id: text().primaryKey(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  logo: text(),
  metadata: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const member = pgTable(
  "member",
  {
    id: text().primaryKey(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text().notNull().default("member"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("member_organization_id_idx").on(table.organizationId),
    index("member_user_id_idx").on(table.userId),
    uniqueIndex("member_user_unique").on(table.userId),
  ],
);

export const userFollow = pgTable(
  "user_follow",
  {
    followerUserId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    followedUserId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.followerUserId, table.followedUserId],
      name: "user_follow_pk",
    }),
    check(
      "user_follow_not_self",
      sql`${table.followerUserId} <> ${table.followedUserId}`,
    ),
    index("user_follow_followed_user_id_idx").on(table.followedUserId),
  ],
);

export const invitation = pgTable(
  "invitation",
  {
    id: text().primaryKey(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text().notNull(),
    role: text().notNull().default("member"),
    status: text().notNull().default("pending"),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    inviterId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("invitation_organization_id_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
    index("invitation_status_idx").on(table.status),
  ],
);

// Notification data uses class-table inheritance: every occurrence is a
// generic event, each recipient gets an independent delivery, and richer
// domains add relational subtype rows without widening the generic tables.
export const notificationEvent = pgTable(
  "notification_event",
  {
    id: text().primaryKey(),
    kind: text().notNull(),
    actorUserId: text().references(() => user.id, { onDelete: "set null" }),
    actorNameSnapshot: text(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("notification_event_kind_idx").on(table.kind)],
);

export const notificationDelivery = pgTable(
  "notification_delivery",
  {
    id: text().primaryKey(),
    eventId: text()
      .notNull()
      .references(() => notificationEvent.id, { onDelete: "cascade" }),
    recipientUserId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    readAt: timestamp({ withTimezone: true }),
    dismissedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    uniqueIndex("notification_delivery_event_recipient_uidx").on(
      table.eventId,
      table.recipientUserId,
    ),
    index("notification_delivery_recipient_read_at_idx").on(
      table.recipientUserId,
      table.readAt,
    ),
  ],
);

export const notificationAgentApprovalEvent = pgTable(
  "notification_agent_approval_event",
  {
    eventId: text()
      .primaryKey()
      .references(() => notificationEvent.id, { onDelete: "cascade" }),
    approvalRequestId: text().references(() => approvalRequest.id, {
      onDelete: "set null",
    }),
    agentIdSnapshot: text().notNull(),
    agentNameSnapshot: text().notNull(),
    capabilitiesSnapshot: text().notNull(),
    expiresAtSnapshot: timestamp({ withTimezone: true }).notNull(),
    approvalCodeCiphertext: text(),
  },
  (table) => [
    uniqueIndex("notification_agent_approval_request_uidx").on(
      table.approvalRequestId,
    ),
  ],
);

export const notificationHouseholdEvent = pgTable(
  "notification_household_event",
  {
    eventId: text()
      .primaryKey()
      .references(() => notificationEvent.id, { onDelete: "cascade" }),
    householdId: text().references(() => organization.id, {
      onDelete: "set null",
    }),
    householdNameSnapshot: text().notNull(),
  },
  (table) => [
    index("notification_household_event_household_idx").on(table.householdId),
  ],
);

export const notificationHouseholdInvitationEvent = pgTable(
  "notification_household_invitation_event",
  {
    eventId: text()
      .primaryKey()
      .references(() => notificationHouseholdEvent.eventId, {
        onDelete: "cascade",
      }),
    invitationId: text().references(() => invitation.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("notification_household_invitation_event_invitation_idx").on(
      table.invitationId,
    ),
  ],
);

export const recipe = pgTable(
  "recipe",
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: text().notNull().unique(),
    title: text().notNull(),
    description: text(),
    body: text(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    visibility: visibilityEnum().notNull().default("private"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("recipe_user_id_idx").on(table.userId),
    index("recipe_public_feed_idx").on(
      table.visibility,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index("recipe_household_feed_idx").on(
      table.userId,
      table.visibility,
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);

export const notificationRecipeRecommendationEvent = pgTable(
  "notification_recipe_recommendation_event",
  {
    eventId: text()
      .primaryKey()
      .references(() => notificationEvent.id, { onDelete: "cascade" }),
    recipeId: uuid().references(() => recipe.id, { onDelete: "set null" }),
    recipeSlugSnapshot: text().notNull(),
    recipeTitleSnapshot: text().notNull(),
  },
  (table) => [
    index("notification_recipe_recommendation_recipe_idx").on(table.recipeId),
  ],
);

export const ingredient = pgTable("ingredient", {
  slug: text().primaryKey(),
  name: text().notNull(),
  category: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const pantryLocationEnum = pgEnum("pantry_location", [
  "fridge",
  "cupboards",
  "fresh",
]);

/**
 * Revision state for one logical pantry. The owner mirrors pantry_item so a
 * solo pantry can become the household pantry without losing revision
 * continuity. Operation receipts are cleared when that resource identity
 * changes.
 */
export const pantryAggregate = pgTable(
  "pantry_aggregate",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text().references(() => user.id, { onDelete: "cascade" }),
    organizationId: text().references(() => organization.id, {
      onDelete: "cascade",
    }),
    revision: bigint({ mode: "bigint" }).notNull().default(sql`0`),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check(
      "pantry_aggregate_owner_check",
      sql`num_nonnulls(${table.userId}, ${table.organizationId}) = 1`,
    ),
    uniqueIndex("pantry_aggregate_user_uidx").on(table.userId),
    uniqueIndex("pantry_aggregate_household_uidx").on(table.organizationId),
  ],
);

/** A committed pantry command and its canonical response for retry safety. */
export const pantryOperation = pgTable(
  "pantry_operation",
  {
    aggregateId: uuid()
      .notNull()
      .references(() => pantryAggregate.id, { onDelete: "cascade" }),
    operationId: uuid().notNull(),
    commandFingerprint: text().notNull(),
    result: jsonb().$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.aggregateId, table.operationId] }),
    index("pantry_operation_created_at_idx").on(table.createdAt),
  ],
);

/**
 * Pantry stock has exactly one owner. Solo cooks own their stock directly;
 * joining or creating a household switches them to the household-owned rows.
 */
export const pantryItem = pgTable(
  "pantry_item",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text().references(() => user.id, { onDelete: "cascade" }),
    organizationId: text().references(() => organization.id, {
      onDelete: "cascade",
    }),
    ingredientSlug: text()
      .notNull()
      .references(() => ingredient.slug, { onDelete: "cascade" }),
    location: pantryLocationEnum().notNull(),
    version: bigint({ mode: "bigint" }).notNull().default(sql`1`),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check(
      "pantry_item_owner_check",
      sql`num_nonnulls(${table.userId}, ${table.organizationId}) = 1`,
    ),
    uniqueIndex("pantry_item_user_ingredient_uidx").on(
      table.userId,
      table.ingredientSlug,
    ),
    uniqueIndex("pantry_item_household_ingredient_uidx").on(
      table.organizationId,
      table.ingredientSlug,
    ),
    index("pantry_item_ingredient_slug_idx").on(table.ingredientSlug),
  ],
);

export const mutationActorTypeEnum = pgEnum("mutation_actor_type", [
  "agent",
  "user",
]);

export type PantryMutationValue = {
  ingredientSlug: string;
  location: (typeof pantryLocationEnum.enumValues)[number];
};

/**
 * One immutable, attributable write to a current-state projection. Undo creates
 * another row linked through compensatesChangeSetId; history is never edited.
 */
export const agentMutationChangeSet = pgTable(
  "agent_mutation_change_set",
  {
    id: uuid().primaryKey().defaultRandom(),
    actorType: mutationActorTypeEnum().notNull(),
    actorUserId: text().notNull(),
    actorAgentId: text(),
    actorAgentName: text(),
    actorHostId: text(),
    actorHostName: text(),
    capability: text().notNull(),
    targetType: text().notNull(),
    targetId: text().notNull(),
    reason: text().notNull(),
    idempotencyKey: uuid().notNull(),
    commandFingerprint: text().notNull(),
    compensatesChangeSetId: uuid().references(
      (): AnyPgColumn => agentMutationChangeSet.id,
    ),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "agent_mutation_change_set_actor_check",
      sql`(${table.actorType} = 'agent' AND num_nonnulls(${table.actorAgentId}, ${table.actorHostId}) = 2) OR (${table.actorType} = 'user' AND num_nonnulls(${table.actorAgentId}, ${table.actorHostId}) = 0)`,
    ),
    uniqueIndex("agent_mutation_change_set_idempotency_uidx").on(
      table.idempotencyKey,
    ),
    index("agent_mutation_change_set_user_time_idx").on(
      table.actorUserId,
      table.createdAt.desc(),
    ),
    index("agent_mutation_change_set_target_time_idx").on(
      table.targetType,
      table.targetId,
      table.createdAt.desc(),
    ),
    index("agent_mutation_change_set_compensates_idx").on(
      table.compensatesChangeSetId,
    ),
  ],
);

/** Structured before/after state needed for conflict-aware compensation. */
export const agentMutationChangeItem = pgTable(
  "agent_mutation_change_item",
  {
    id: uuid().primaryKey().defaultRandom(),
    changeSetId: uuid()
      .notNull()
      .references(() => agentMutationChangeSet.id, { onDelete: "restrict" }),
    ordinal: integer().notNull(),
    stableItemId: uuid().notNull(),
    ingredientSlug: text().notNull(),
    beforeValue: jsonb().$type<PantryMutationValue>(),
    afterValue: jsonb().$type<PantryMutationValue>(),
    beforeVersion: bigint({ mode: "bigint" }),
    // Removals store the absence-marker version even though afterValue is null.
    afterVersion: bigint({ mode: "bigint" }).notNull(),
  },
  (table) => [
    check(
      "agent_mutation_change_item_value_check",
      sql`num_nonnulls(${table.beforeValue}, ${table.afterValue}) >= 1`,
    ),
    uniqueIndex("agent_mutation_change_item_ordinal_uidx").on(
      table.changeSetId,
      table.ordinal,
    ),
    index("agent_mutation_change_item_stable_id_idx").on(table.stableItemId),
  ],
);

/**
 * Versioned absence marker for a removed pantry item. Undo may restore only
 * while this exact marker remains current and no item has been recreated.
 */
export const pantryItemAbsence = pgTable(
  "pantry_item_absence",
  {
    aggregateId: uuid()
      .notNull()
      .references(() => pantryAggregate.id, { onDelete: "cascade" }),
    stableItemId: uuid().notNull(),
    ingredientSlug: text().notNull(),
    version: bigint({ mode: "bigint" }).notNull(),
    changeSetId: uuid()
      .notNull()
      .references(() => agentMutationChangeSet.id, { onDelete: "restrict" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.aggregateId, table.ingredientSlug] }),
    index("pantry_item_absence_stable_id_idx").on(table.stableItemId),
  ],
);

export const shoppingListStatusEnum = pgEnum("shopping_list_status", [
  "active",
  "archived",
]);

export type ShoppingListSnapshot = {
  recipes: Array<{ slug: string; servings?: number }>;
  checked: string[];
  extras: Array<{ id: string; text: string; checked: boolean }>;
};

/**
 * One durable shopping trip. Active lists are mutable; starting a new list
 * keeps the previous list's final snapshot as history.
 * The owner rule matches pantry ownership so joining a household makes the
 * current list shared without copying it between individual accounts.
 */
export const shoppingList = pgTable(
  "shopping_list",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text().references(() => user.id, { onDelete: "cascade" }),
    organizationId: text().references(() => organization.id, {
      onDelete: "cascade",
    }),
    status: shoppingListStatusEnum().notNull().default("active"),
    revision: bigint({ mode: "bigint" }).notNull().default(sql`0`),
    snapshot: jsonb().$type<ShoppingListSnapshot>().notNull(),
    closedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check(
      "shopping_list_owner_check",
      sql`num_nonnulls(${table.userId}, ${table.organizationId}) = 1`,
    ),
    check(
      "shopping_list_closed_at_check",
      sql`(${table.status} = 'active' AND ${table.closedAt} IS NULL) OR (${table.status} = 'archived' AND ${table.closedAt} IS NOT NULL)`,
    ),
    uniqueIndex("shopping_list_active_user_uidx")
      .on(table.userId)
      .where(sql`${table.status} = 'active'`),
    uniqueIndex("shopping_list_active_household_uidx")
      .on(table.organizationId)
      .where(sql`${table.status} = 'active'`),
    index("shopping_list_user_history_idx").on(
      table.userId,
      table.createdAt.desc(),
    ),
    index("shopping_list_household_history_idx").on(
      table.organizationId,
      table.createdAt.desc(),
    ),
  ],
);

export const ingredientGroup = pgTable("ingredient_group", {
  key: text().primaryKey(),
  label: text().notNull(),
  description: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const ingredientGroupMember = pgTable(
  "ingredient_group_member",
  {
    groupKey: text()
      .notNull()
      .references(() => ingredientGroup.key, { onDelete: "cascade" }),
    ingredientSlug: text()
      .notNull()
      .references(() => ingredient.slug, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.groupKey, table.ingredientSlug],
      name: "ingredient_group_member_pk",
    }),
    index("ingredient_group_member_ingredient_slug_idx").on(table.ingredientSlug),
  ],
);

export const ingredientGroupRelationTypeEnum = pgEnum(
  "ingredient_group_relation_type",
  ["classification", "composition"],
);

export const ingredientGroupHierarchy = pgTable(
  "ingredient_group_hierarchy",
  {
    narrowerGroupKey: text()
      .notNull()
      .references(() => ingredientGroup.key, { onDelete: "cascade" }),
    broaderGroupKey: text()
      .notNull()
      .references(() => ingredientGroup.key, { onDelete: "cascade" }),
    relationType: ingredientGroupRelationTypeEnum().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.narrowerGroupKey, table.broaderGroupKey],
      name: "ingredient_group_hierarchy_pk",
    }),
    check(
      "ingredient_group_hierarchy_not_self_check",
      sql`${table.narrowerGroupKey} <> ${table.broaderGroupKey}`,
    ),
    index("ingredient_group_hierarchy_broader_group_key_idx").on(
      table.broaderGroupKey,
    ),
  ],
);

export const dietPreset = pgTable("diet_preset", {
  key: text().primaryKey(),
  label: text().notNull(),
  description: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const dietPresetExcludedGroup = pgTable(
  "diet_preset_excluded_group",
  {
    presetKey: text()
      .notNull()
      .references(() => dietPreset.key, { onDelete: "cascade" }),
    groupKey: text()
      .notNull()
      .references(() => ingredientGroup.key, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.presetKey, table.groupKey],
      name: "diet_preset_excluded_group_pk",
    }),
    index("diet_preset_excluded_group_group_key_idx").on(table.groupKey),
  ],
);

export const dietPresetExcludedIngredient = pgTable(
  "diet_preset_excluded_ingredient",
  {
    presetKey: text()
      .notNull()
      .references(() => dietPreset.key, { onDelete: "cascade" }),
    ingredientSlug: text()
      .notNull()
      .references(() => ingredient.slug, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.presetKey, table.ingredientSlug],
      name: "diet_preset_excluded_ingredient_pk",
    }),
    index("diet_preset_excluded_ingredient_slug_idx").on(table.ingredientSlug),
  ],
);

export const userDietProfile = pgTable(
  "user_diet_profile",
  {
    userId: text()
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    recipeMatchMode: dietRecipeMatchModeEnum().notNull().default("hide"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
);

export const userDietPreset = pgTable(
  "user_diet_preset",
  {
    userId: text()
      .notNull()
      .references(() => userDietProfile.userId, { onDelete: "cascade" }),
    presetKey: text()
      .notNull()
      .references(() => dietPreset.key, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.presetKey],
      name: "user_diet_preset_pk",
    }),
    index("user_diet_preset_preset_key_idx").on(table.presetKey),
  ],
);

export const userDietExcludedGroup = pgTable(
  "user_diet_excluded_group",
  {
    userId: text()
      .notNull()
      .references(() => userDietProfile.userId, { onDelete: "cascade" }),
    groupKey: text()
      .notNull()
      .references(() => ingredientGroup.key, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.groupKey],
      name: "user_diet_excluded_group_pk",
    }),
    index("user_diet_excluded_group_group_key_idx").on(table.groupKey),
  ],
);

export const userDietExcludedIngredient = pgTable(
  "user_diet_excluded_ingredient",
  {
    userId: text()
      .notNull()
      .references(() => userDietProfile.userId, { onDelete: "cascade" }),
    ingredientSlug: text()
      .notNull()
      .references(() => ingredient.slug, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.ingredientSlug],
      name: "user_diet_excluded_ingredient_pk",
    }),
    index("user_diet_excluded_ingredient_slug_idx").on(table.ingredientSlug),
  ],
);

/** Public recipes a user has chosen alongside recipes they own. */
export const userRecipeBox = pgTable("user_recipe_box", {
  userId: text()
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  completedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const userRecipeBoxItem = pgTable(
  "user_recipe_box_item",
  {
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    recipeSlug: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.recipeSlug] })],
);

/**
 * One attempt to cook a recipe. Entering cook mode creates the row; clicking
 * Finish sets completedAt. Keeping incomplete starts lets us measure cook-mode
 * usefulness without treating every open as a meal cooked.
 *
 * Recipe details are snapshots rather than foreign keys so a user's history
 * survives recipe edits and deletions, and works for built-in recipes too.
 */
export const cookingSession = pgTable(
  "cooking_session",
  {
    id: uuid().primaryKey(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    recipeSlug: text().notNull(),
    recipeTitle: text().notNull(),
    servings: integer().notNull(),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    index("cooking_session_user_started_idx").on(
      table.userId,
      table.startedAt.desc(),
    ),
    index("cooking_session_user_completed_idx").on(
      table.userId,
      table.completedAt.desc(),
    ),
    index("cooking_session_user_recipe_completed_idx").on(
      table.userId,
      table.recipeSlug,
      table.completedAt.desc(),
    ),
  ],
);

export const appRateLimit = pgTable("app_rate_limit", {
  key: text().primaryKey(),
  count: integer().notNull().default(0),
  windowStart: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Postgres is the source of truth for recipe import job state;
// R2 holds the immutable source images and stage artifact snapshots.

export const recipeImportStatusEnum = pgEnum("recipe_import_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
]);

export const recipeImportStageEnum = pgEnum("recipe_import_stage", [
  "extract",
  "normalize",
  "canonicalize",
  "finalize",
]);

export const recipeImportJob = pgTable(
  "recipe_import_job",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: recipeImportStatusEnum().notNull().default("queued"),
    currentStage: recipeImportStageEnum(),
    progressLabel: text(),
    errorType: text(),
    errorMessage: text(),
    workflowInstanceId: text(),
    imageCount: integer().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    index("recipe_import_job_user_id_idx").on(table.userId),
    index("recipe_import_job_user_status_idx").on(table.userId, table.status),
    index("recipe_import_job_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
  ],
);

export const recipeImportArtifact = pgTable(
  "recipe_import_artifact",
  {
    id: uuid().primaryKey().defaultRandom(),
    jobId: uuid()
      .notNull()
      .references(() => recipeImportJob.id, { onDelete: "cascade" }),
    stage: recipeImportStageEnum().notNull(),
    kind: text().notNull(),
    r2Key: text().notNull(),
    checksum: text().notNull(),
    schemaVersion: integer().notNull().default(1),
    model: text(),
    provider: text(),
    preview: jsonb(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("recipe_import_artifact_job_id_idx").on(table.jobId),
    // Workflow step retries upsert on this key so a replay cannot duplicate manifests.
    uniqueIndex("recipe_import_artifact_job_stage_kind_unique").on(
      table.jobId,
      table.stage,
      table.kind,
    ),
  ],
);

export const recipeImportAttempt = pgTable(
  "recipe_import_attempt",
  {
    id: uuid().primaryKey().defaultRandom(),
    jobId: uuid()
      .notNull()
      .references(() => recipeImportJob.id, { onDelete: "cascade" }),
    stage: recipeImportStageEnum().notNull(),
    attempt: integer().notNull(),
    succeeded: boolean().notNull(),
    retryable: boolean(),
    providerRequestId: text(),
    errorType: text(),
    errorMessage: text(),
    durationMs: integer(),
    model: text(),
    promptTokens: integer(),
    completionTokens: integer(),
    totalTokens: integer(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("recipe_import_attempt_job_id_idx").on(table.jobId),
    uniqueIndex("recipe_import_attempt_job_stage_attempt_unique").on(
      table.jobId,
      table.stage,
      table.attempt,
    ),
  ],
);
