import { and, eq, inArray, sql } from "drizzle-orm";
import * as schema from "recipe-db/schema";
import type {
  PantryAbsenceRevision,
  PantryCurrentItem,
  PantryTransition,
} from "recipe-domain/pantry";
import type { DbTransaction } from "../../db/types";
import {
  pantryAggregateScopeFilter,
  type PantryScope,
  pantryScopeFilter,
  resolvePantryScope,
} from "../../pantry";

export type PantryAggregate = { id: string };

export async function lockPantryScope(
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
  if (scope.type === "personal") return scope;
  const [household] = await tx
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(eq(schema.organization.id, scope.householdId))
    .for("update")
    .limit(1);
  if (!household) throw new Error("Household no longer exists");
  return scope;
}

export async function ensureLockedPantryAggregate(
  tx: DbTransaction,
  scope: PantryScope,
): Promise<PantryAggregate> {
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

export async function findCurrentPantryItems(
  tx: DbTransaction,
  scope: PantryScope,
  ingredientSlugs: string[],
): Promise<Map<string, PantryCurrentItem>> {
  if (ingredientSlugs.length === 0) return new Map();
  const rows = await tx
    .select()
    .from(schema.pantryItem)
    .where(
      and(
        pantryScopeFilter(scope),
        inArray(schema.pantryItem.ingredientSlug, ingredientSlugs),
      ),
    )
    .for("update");
  return new Map(
    rows.map((item) => [
      item.ingredientSlug,
      {
        stableItemId: item.id,
        ingredientSlug: item.ingredientSlug,
        location: item.location,
        version: item.version,
      },
    ]),
  );
}

export async function findPantryAbsenceRevisions(
  tx: DbTransaction,
  aggregateId: string,
  ingredientSlugs: string[],
): Promise<Map<string, PantryAbsenceRevision>> {
  if (ingredientSlugs.length === 0) return new Map();
  const rows = await tx
    .select()
    .from(schema.pantryItemAbsence)
    .where(
      and(
        eq(schema.pantryItemAbsence.aggregateId, aggregateId),
        inArray(schema.pantryItemAbsence.ingredientSlug, ingredientSlugs),
      ),
    )
    .for("update");
  return new Map(
    rows.map((item) => [
      item.ingredientSlug,
      { stableItemId: item.stableItemId, version: item.version },
    ]),
  );
}

function pantryOwner(scope: PantryScope) {
  return {
    userId: scope.type === "personal" ? scope.userId : null,
    organizationId: scope.type === "household" ? scope.householdId : null,
  };
}

export async function applyPantryTransition(
  tx: DbTransaction,
  input: {
    aggregateId: string;
    changeSetId: string;
    scope: PantryScope;
    transition: PantryTransition;
  },
): Promise<void> {
  const { aggregateId, changeSetId, scope, transition } = input;
  if (transition.afterValue === null) {
    await tx
      .delete(schema.pantryItem)
      .where(eq(schema.pantryItem.id, transition.stableItemId));
    await tx
      .insert(schema.pantryItemAbsence)
      .values({
        aggregateId,
        stableItemId: transition.stableItemId,
        ingredientSlug: transition.ingredientSlug,
        version: transition.afterVersion,
        changeSetId,
      })
      .onConflictDoUpdate({
        target: [
          schema.pantryItemAbsence.aggregateId,
          schema.pantryItemAbsence.ingredientSlug,
        ],
        set: {
          stableItemId: transition.stableItemId,
          version: transition.afterVersion,
          changeSetId,
        },
      });
    return;
  }
  if (transition.beforeValue) {
    if (transition.beforeVersion === null) {
      throw new Error("An existing pantry item must have a previous version");
    }
    await tx
      .update(schema.pantryItem)
      .set({
        location: transition.afterValue.location,
        version: transition.afterVersion,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.pantryItem.id, transition.stableItemId),
          eq(schema.pantryItem.version, transition.beforeVersion),
        ),
      );
  } else {
    await tx.insert(schema.pantryItem).values({
      id: transition.stableItemId,
      ...pantryOwner(scope),
      ingredientSlug: transition.ingredientSlug,
      location: transition.afterValue.location,
      version: transition.afterVersion,
    });
  }
  await tx
    .delete(schema.pantryItemAbsence)
    .where(
      and(
        eq(schema.pantryItemAbsence.aggregateId, aggregateId),
        eq(
          schema.pantryItemAbsence.ingredientSlug,
          transition.ingredientSlug,
        ),
      ),
    );
}

export async function incrementPantryRevision(
  tx: DbTransaction,
  aggregateId: string,
): Promise<bigint> {
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
