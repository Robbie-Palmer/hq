import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "recipe-db";
import * as schema from "recipe-db/schema";
import {
  pantryAggregateScopeFilter,
  type PantryLocation,
  pantryResourceId,
  pantryResponseForScope,
  type PantryScope,
  pantryScopeFilter,
  resolvePantryScope,
} from "./pantry";

type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const MAX_AGENT_PANTRY_CHANGES = 100;

export type AgentPantryChange = {
  ingredientSlug: string;
  expectedVersion: string | null;
  location: PantryLocation | null;
};

export type AgentPantryMutation = {
  userId: string;
  agentId: string;
  agentName: string;
  hostId: string;
  hostName?: string;
  capability: "pantry.reconcile";
  reason: string;
  idempotencyKey: string;
  changes: AgentPantryChange[];
};

export class AgentMutationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentMutationConflictError";
  }
}

function version(value: string | null): bigint | null {
  if (value === null) return null;
  if (!/^\d+$/.test(value)) {
    throw new AgentMutationConflictError(`Invalid row version: ${value}`);
  }
  return BigInt(value);
}

function commandFingerprint(input: AgentPantryMutation): string {
  return JSON.stringify([
    input.capability,
    input.reason,
    [...input.changes]
      .sort((a, b) => a.ingredientSlug.localeCompare(b.ingredientSlug))
      .map((change) => [
        change.ingredientSlug,
        change.expectedVersion,
        change.location,
      ]),
  ]);
}

async function lockScope(
  tx: DbTransaction,
  userId: string,
): Promise<PantryScope> {
  await tx
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .for("update")
    .limit(1);
  const scope = await resolvePantryScope(tx, userId);
  if (scope.type === "household") {
    const [household] = await tx
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(eq(schema.organization.id, scope.householdId))
      .for("update")
      .limit(1);
    if (!household) throw new AgentMutationConflictError("Household no longer exists");
  }
  return scope;
}

async function lockedAggregate(tx: DbTransaction, scope: PantryScope) {
  await tx
    .insert(schema.pantryAggregate)
    .values({
      userId: scope.type === "personal" ? scope.userId : null,
      organizationId: scope.type === "household" ? scope.householdId : null,
    })
    .onConflictDoNothing();
  const [aggregate] = await tx
    .select({ id: schema.pantryAggregate.id })
    .from(schema.pantryAggregate)
    .where(pantryAggregateScopeFilter(scope))
    .for("update")
    .limit(1);
  if (!aggregate) throw new Error("Pantry aggregate could not be created");
  return aggregate;
}

function owner(scope: PantryScope) {
  return {
    userId: scope.type === "personal" ? scope.userId : null,
    organizationId: scope.type === "household" ? scope.householdId : null,
  };
}

function validateChanges(changes: AgentPantryChange[]) {
  if (changes.length === 0 || changes.length > MAX_AGENT_PANTRY_CHANGES) {
    throw new AgentMutationConflictError(
      `A change set must contain 1-${MAX_AGENT_PANTRY_CHANGES} items`,
    );
  }
  const slugs = new Set<string>();
  for (const change of changes) {
    if (slugs.has(change.ingredientSlug)) {
      throw new AgentMutationConflictError(
        `Duplicate ingredient: ${change.ingredientSlug}`,
      );
    }
    slugs.add(change.ingredientSlug);
  }
}

type PantryItem = typeof schema.pantryItem.$inferSelect;
type PantryItemMap = Map<string, PantryItem>;

async function replayedAgentMutation(
  tx: DbTransaction,
  input: AgentPantryMutation,
  scope: PantryScope,
  fingerprint: string,
) {
  const [existing] = await tx
    .select()
    .from(schema.agentMutationChangeSet)
    .where(eq(schema.agentMutationChangeSet.idempotencyKey, input.idempotencyKey))
    .limit(1);
  if (!existing) return null;
  const matches =
    existing.actorUserId === input.userId &&
    existing.actorAgentId === input.agentId &&
    existing.actorHostId === input.hostId &&
    existing.capability === input.capability &&
    existing.targetId === pantryResourceId(scope) &&
    existing.commandFingerprint === fingerprint;
  if (!matches) {
    throw new AgentMutationConflictError(
      "Idempotency key was already used for a different mutation",
    );
  }
  return {
    changeSetId: existing.id,
    replayed: true as const,
    pantry: await pantryResponseForScope(tx, scope),
  };
}

async function currentPantryItems(
  tx: DbTransaction,
  scope: PantryScope,
  changes: AgentPantryChange[],
): Promise<PantryItemMap> {
  const rows = await tx
    .select()
    .from(schema.pantryItem)
    .where(
      and(
        pantryScopeFilter(scope),
        inArray(
          schema.pantryItem.ingredientSlug,
          changes.map((change) => change.ingredientSlug),
        ),
      ),
    )
    .for("update");
  return new Map(rows.map((item) => [item.ingredientSlug, item]));
}

function assertExpectedVersions(
  changes: AgentPantryChange[],
  current: PantryItemMap,
) {
  for (const change of changes) {
    const item = current.get(change.ingredientSlug);
    if ((item?.version ?? null) !== version(change.expectedVersion)) {
      throw new AgentMutationConflictError(
        `${change.ingredientSlug} changed after the agent read it`,
      );
    }
    if (!item && change.location === null) {
      throw new AgentMutationConflictError(
        `${change.ingredientSlug} is already absent`,
      );
    }
  }
}

async function applyPantryChange(
  tx: DbTransaction,
  input: {
    aggregateId: string;
    changeSetId: string;
    change: AgentPantryChange;
    item: PantryItem | undefined;
    scope: PantryScope;
  },
) {
  const { aggregateId, changeSetId, change, item, scope } = input;
  const stableItemId = item?.id ?? crypto.randomUUID();
  const nextVersion = (item?.version ?? 0n) + 1n;
  if (change.location === null && item) {
    await tx.delete(schema.pantryItem).where(eq(schema.pantryItem.id, item.id));
    await tx
      .insert(schema.pantryItemAbsence)
      .values({
        aggregateId,
        stableItemId,
        ingredientSlug: change.ingredientSlug,
        version: nextVersion,
        changeSetId,
      })
      .onConflictDoUpdate({
        target: [
          schema.pantryItemAbsence.aggregateId,
          schema.pantryItemAbsence.ingredientSlug,
        ],
        set: { stableItemId, version: nextVersion, changeSetId },
      });
  } else if (change.location && item) {
    await tx
      .update(schema.pantryItem)
      .set({
        location: change.location,
        version: nextVersion,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.pantryItem.id, item.id),
          eq(schema.pantryItem.version, item.version),
        ),
      );
  } else if (change.location) {
    await tx.insert(schema.pantryItem).values({
      id: stableItemId,
      ...owner(scope),
      ingredientSlug: change.ingredientSlug,
      location: change.location,
      version: nextVersion,
    });
  }
  if (change.location) {
    await tx
      .delete(schema.pantryItemAbsence)
      .where(
        and(
          eq(schema.pantryItemAbsence.aggregateId, aggregateId),
          eq(schema.pantryItemAbsence.ingredientSlug, change.ingredientSlug),
        ),
      );
  }
  return { stableItemId, nextVersion };
}

async function applyPantryChanges(
  tx: DbTransaction,
  input: {
    aggregateId: string;
    changeSetId: string;
    changes: AgentPantryChange[];
    current: PantryItemMap;
    scope: PantryScope;
  },
) {
  const items: (typeof schema.agentMutationChangeItem.$inferInsert)[] = [];
  for (const [ordinal, change] of input.changes.entries()) {
    const item = input.current.get(change.ingredientSlug);
    const { stableItemId, nextVersion } = await applyPantryChange(tx, {
      aggregateId: input.aggregateId,
      changeSetId: input.changeSetId,
      change,
      item,
      scope: input.scope,
    });
    items.push({
      changeSetId: input.changeSetId,
      ordinal,
      stableItemId,
      ingredientSlug: change.ingredientSlug,
      beforeValue: item
        ? { ingredientSlug: item.ingredientSlug, location: item.location }
        : null,
      afterValue: change.location
        ? { ingredientSlug: change.ingredientSlug, location: change.location }
        : null,
      beforeVersion: item?.version ?? null,
      afterVersion: nextVersion,
    });
  }
  await tx.insert(schema.agentMutationChangeItem).values(items);
}

async function incrementPantryRevision(
  tx: DbTransaction,
  aggregateId: string,
) {
  const [updated] = await tx
    .update(schema.pantryAggregate)
    .set({
      revision: sql`${schema.pantryAggregate.revision} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(schema.pantryAggregate.id, aggregateId))
    .returning({ revision: schema.pantryAggregate.revision });
  if (!updated) throw new Error("Pantry revision update failed");
  return updated.revision;
}

export async function applyAgentPantryMutation(
  db: Db,
  input: AgentPantryMutation,
) {
  validateChanges(input.changes);
  const fingerprint = commandFingerprint(input);
  return db.transaction(async (tx) => {
    const scope = await lockScope(tx, input.userId);
    const aggregate = await lockedAggregate(tx, scope);
    const replay = await replayedAgentMutation(tx, input, scope, fingerprint);
    if (replay) return replay;
    const current = await currentPantryItems(tx, scope, input.changes);
    assertExpectedVersions(input.changes, current);

    const changeSetId = crypto.randomUUID();
    await tx.insert(schema.agentMutationChangeSet).values({
      id: changeSetId,
      actorType: "agent",
      actorUserId: input.userId,
      actorAgentId: input.agentId,
      actorAgentName: input.agentName,
      actorHostId: input.hostId,
      actorHostName: input.hostName,
      capability: input.capability,
      targetType: "pantry",
      targetId: pantryResourceId(scope),
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      commandFingerprint: fingerprint,
    });

    await applyPantryChanges(tx, {
      aggregateId: aggregate.id,
      changeSetId,
      changes: input.changes,
      current,
      scope,
    });
    const revision = await incrementPantryRevision(tx, aggregate.id);
    return {
      changeSetId,
      replayed: false,
      pantry: await pantryResponseForScope(tx, scope, { revision }),
    };
  });
}

export type UndoPreviewItem = {
  stableItemId: string;
  ingredientSlug: string;
  beforeValue: schema.PantryMutationValue | null;
  afterValue: schema.PantryMutationValue | null;
  currentValue: schema.PantryMutationValue | null;
  status: "ready" | "conflict";
};

async function previewInTransaction(
  tx: DbTransaction,
  userId: string,
  changeSetId: string,
) {
  const [changeSet] = await tx
    .select()
    .from(schema.agentMutationChangeSet)
    .where(
      and(
        eq(schema.agentMutationChangeSet.id, changeSetId),
        eq(schema.agentMutationChangeSet.actorUserId, userId),
        eq(schema.agentMutationChangeSet.targetType, "pantry"),
      ),
    )
    .limit(1);
  if (!changeSet) return null;
  const scope = await lockScope(tx, userId);
  if (changeSet.targetId !== pantryResourceId(scope)) {
    throw new AgentMutationConflictError("The pantry owner changed after this mutation");
  }
  const aggregate = await lockedAggregate(tx, scope);
  const ledgerItems = await tx
    .select()
    .from(schema.agentMutationChangeItem)
    .where(eq(schema.agentMutationChangeItem.changeSetId, changeSetId))
    .orderBy(asc(schema.agentMutationChangeItem.ordinal));
  const slugs = ledgerItems.map((item) => item.ingredientSlug);
  const currentItems = slugs.length
    ? await tx
        .select()
        .from(schema.pantryItem)
        .where(
          and(
            pantryScopeFilter(scope),
            inArray(schema.pantryItem.ingredientSlug, slugs),
          ),
        )
        .for("update")
    : [];
  const absences = slugs.length
    ? await tx
        .select()
        .from(schema.pantryItemAbsence)
        .where(
          and(
            eq(schema.pantryItemAbsence.aggregateId, aggregate.id),
            inArray(schema.pantryItemAbsence.ingredientSlug, slugs),
          ),
        )
        .for("update")
    : [];
  const currentBySlug = new Map(
    currentItems.map((item) => [item.ingredientSlug, item]),
  );
  const absenceBySlug = new Map(absences.map((item) => [item.ingredientSlug, item]));
  const items: UndoPreviewItem[] = ledgerItems.map((ledgerItem) => {
    const current = currentBySlug.get(ledgerItem.ingredientSlug);
    const absence = absenceBySlug.get(ledgerItem.ingredientSlug);
    const afterMatches = ledgerItem.afterValue
      ? current?.id === ledgerItem.stableItemId &&
        current.version === ledgerItem.afterVersion &&
        current.location === ledgerItem.afterValue.location
      : !current &&
        absence?.stableItemId === ledgerItem.stableItemId &&
        absence.version === ledgerItem.afterVersion;
    return {
      stableItemId: ledgerItem.stableItemId,
      ingredientSlug: ledgerItem.ingredientSlug,
      beforeValue: ledgerItem.beforeValue,
      afterValue: ledgerItem.afterValue,
      currentValue: current
        ? { ingredientSlug: current.ingredientSlug, location: current.location }
        : null,
      status: afterMatches ? "ready" : "conflict",
    };
  });
  return { changeSet, scope, aggregate, ledgerItems, currentBySlug, items };
}

export async function previewAgentMutationUndo(
  db: Db,
  userId: string,
  changeSetId: string,
) {
  return db.transaction(async (tx) => {
    const preview = await previewInTransaction(tx, userId, changeSetId);
    if (!preview) return null;
    return {
      changeSetId,
      reason: preview.changeSet.reason,
      createdAt: preview.changeSet.createdAt.toISOString(),
      items: preview.items,
      canUndo: preview.items.length > 0 && preview.items.every((item) => item.status === "ready"),
    };
  });
}

type UndoAgentMutationInput = {
  userId: string;
  changeSetId: string;
  idempotencyKey: string;
  stableItemIds?: string[];
};

type UndoPreview = NonNullable<
  Awaited<ReturnType<typeof previewInTransaction>>
>;

async function replayedUndo(
  tx: DbTransaction,
  input: UndoAgentMutationInput,
  requestFingerprint: string,
) {
  const [existing] = await tx
    .select()
    .from(schema.agentMutationChangeSet)
    .where(eq(schema.agentMutationChangeSet.idempotencyKey, input.idempotencyKey))
    .limit(1);
  if (!existing) return null;
  const matches =
    existing.actorUserId === input.userId &&
    existing.compensatesChangeSetId === input.changeSetId &&
    existing.commandFingerprint === requestFingerprint;
  if (!matches) {
    throw new AgentMutationConflictError(
      "Idempotency key was already used for a different mutation",
    );
  }
  return { applied: true as const, changeSetId: existing.id, replayed: true };
}

function selectedUndoItemIds(
  preview: UndoPreview,
  requestedIds: string[] | undefined,
) {
  const selected = requestedIds
    ? new Set(requestedIds)
    : new Set(preview.items.map((item) => item.stableItemId));
  const selectedPreview = preview.items.filter((item) =>
    selected.has(item.stableItemId),
  );
  const invalid =
    selectedPreview.length === 0 ||
    selectedPreview.length !== selected.size ||
    selectedPreview.some((item) => item.status === "conflict");
  return invalid ? null : selected;
}

async function applyCompensationItem(
  tx: DbTransaction,
  input: {
    compensationId: string;
    ledgerItem: typeof schema.agentMutationChangeItem.$inferSelect;
    current: PantryItem | undefined;
    preview: UndoPreview;
  },
) {
  const { compensationId, ledgerItem, current, preview } = input;
  const nextVersion = ledgerItem.afterVersion + 1n;
  if (ledgerItem.beforeValue === null && current) {
    await tx.delete(schema.pantryItem).where(eq(schema.pantryItem.id, current.id));
    await tx
      .insert(schema.pantryItemAbsence)
      .values({
        aggregateId: preview.aggregate.id,
        stableItemId: ledgerItem.stableItemId,
        ingredientSlug: ledgerItem.ingredientSlug,
        version: nextVersion,
        changeSetId: compensationId,
      })
      .onConflictDoUpdate({
        target: [
          schema.pantryItemAbsence.aggregateId,
          schema.pantryItemAbsence.ingredientSlug,
        ],
        set: { version: nextVersion, changeSetId: compensationId },
      });
  } else if (ledgerItem.beforeValue && current) {
    await tx
      .update(schema.pantryItem)
      .set({
        location: ledgerItem.beforeValue.location,
        version: nextVersion,
        updatedAt: new Date(),
      })
      .where(eq(schema.pantryItem.id, current.id));
  } else if (ledgerItem.beforeValue) {
    await tx.insert(schema.pantryItem).values({
      id: ledgerItem.stableItemId,
      ...owner(preview.scope),
      ingredientSlug: ledgerItem.ingredientSlug,
      location: ledgerItem.beforeValue.location,
      version: nextVersion,
    });
    await tx
      .delete(schema.pantryItemAbsence)
      .where(
        and(
          eq(schema.pantryItemAbsence.aggregateId, preview.aggregate.id),
          eq(schema.pantryItemAbsence.ingredientSlug, ledgerItem.ingredientSlug),
        ),
      );
  }
  return nextVersion;
}

async function applyCompensationItems(
  tx: DbTransaction,
  input: {
    compensationId: string;
    preview: UndoPreview;
    selected: Set<string>;
  },
) {
  const items: (typeof schema.agentMutationChangeItem.$inferInsert)[] = [];
  const selectedItems = input.preview.ledgerItems.filter((item) =>
    input.selected.has(item.stableItemId),
  );
  for (const [ordinal, ledgerItem] of selectedItems.entries()) {
    const nextVersion = await applyCompensationItem(tx, {
      compensationId: input.compensationId,
      ledgerItem,
      current: input.preview.currentBySlug.get(ledgerItem.ingredientSlug),
      preview: input.preview,
    });
    items.push({
      changeSetId: input.compensationId,
      ordinal,
      stableItemId: ledgerItem.stableItemId,
      ingredientSlug: ledgerItem.ingredientSlug,
      beforeValue: ledgerItem.afterValue,
      afterValue: ledgerItem.beforeValue,
      beforeVersion: ledgerItem.afterVersion,
      afterVersion: nextVersion,
    });
  }
  await tx.insert(schema.agentMutationChangeItem).values(items);
}

export async function undoAgentMutation(
  db: Db,
  input: UndoAgentMutationInput,
) {
  return db.transaction(async (tx) => {
    const requestFingerprint = JSON.stringify([
      input.changeSetId,
      input.stableItemIds ? [...input.stableItemIds].sort() : "*",
    ]);
    const replay = await replayedUndo(tx, input, requestFingerprint);
    if (replay) return replay;
    const preview = await previewInTransaction(tx, input.userId, input.changeSetId);
    if (!preview) return null;
    const selected = selectedUndoItemIds(preview, input.stableItemIds);
    if (!selected) {
      return { applied: false as const, preview: { items: preview.items } };
    }
    const compensationId = crypto.randomUUID();
    await tx.insert(schema.agentMutationChangeSet).values({
      id: compensationId,
      actorType: "user",
      actorUserId: input.userId,
      capability: "agent_mutation.undo",
      targetType: "pantry",
      targetId: preview.changeSet.targetId,
      reason: `Undo: ${preview.changeSet.reason}`,
      idempotencyKey: input.idempotencyKey,
      commandFingerprint: requestFingerprint,
      compensatesChangeSetId: input.changeSetId,
    });
    await applyCompensationItems(tx, { compensationId, preview, selected });
    await incrementPantryRevision(tx, preview.aggregate.id);
    return { applied: true as const, changeSetId: compensationId, replayed: false };
  });
}

export async function listAgentMutationHistory(db: Db, userId: string) {
  const changeSets = await db
    .select()
    .from(schema.agentMutationChangeSet)
    .where(eq(schema.agentMutationChangeSet.actorUserId, userId))
    .orderBy(desc(schema.agentMutationChangeSet.createdAt), desc(schema.agentMutationChangeSet.id))
    .limit(50);
  if (changeSets.length === 0) return [];
  const items = await db
    .select()
    .from(schema.agentMutationChangeItem)
    .where(inArray(schema.agentMutationChangeItem.changeSetId, changeSets.map((set) => set.id)))
    .orderBy(asc(schema.agentMutationChangeItem.ordinal));
  return changeSets.map((set) => ({
    id: set.id,
    actorType: set.actorType,
    agentId: set.actorAgentId,
    agentName: set.actorAgentName,
    hostId: set.actorHostId,
    hostName: set.actorHostName,
    capability: set.capability,
    targetType: set.targetType,
    targetId: set.targetId,
    reason: set.reason,
    compensatesChangeSetId: set.compensatesChangeSetId,
    createdAt: set.createdAt.toISOString(),
    items: items
      .filter((item) => item.changeSetId === set.id)
      .map((item) => ({
        stableItemId: item.stableItemId,
        ingredientSlug: item.ingredientSlug,
        beforeValue: item.beforeValue,
        afterValue: item.afterValue,
        beforeVersion: item.beforeVersion?.toString() ?? null,
        afterVersion: item.afterVersion.toString(),
      })),
  }));
}
