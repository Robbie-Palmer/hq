import { asc, eq, type SQL } from "drizzle-orm";
import type { Db } from "recipe-db";
import * as schema from "recipe-db/schema";
import type { PantryLocation } from "recipe-domain/pantry";

export { MAX_PANTRY_ITEMS, type PantryLocation } from "recipe-domain/pantry";

export type PantryScope =
  | { type: "personal"; userId: string }
  | {
      type: "household";
      householdId: string;
      householdName: string;
    };

export type PantryResponse = {
  resourceId: string;
  revision: string;
  operationId?: string;
  scope:
    | { type: "personal" }
    | { type: "household"; household: { id: string; name: string } };
  stock: Record<string, PantryLocation>;
  itemVersions: Record<string, string>;
};

export async function resolvePantryScope(
  db: Pick<Db, "select">,
  userId: string,
): Promise<PantryScope> {
  const [scope] = await db
    .select({
      householdId: schema.organization.id,
      householdName: schema.organization.name,
    })
    .from(schema.member)
    .leftJoin(
      schema.organization,
      eq(schema.member.organizationId, schema.organization.id),
    )
    .where(eq(schema.member.userId, userId))
    .limit(1);
  if (!scope) return { type: "personal", userId };
  if (!scope.householdId || !scope.householdName) {
    throw new Error("Household membership has no household");
  }
  return {
    type: "household",
    householdId: scope.householdId,
    householdName: scope.householdName,
  };
}

export function pantryScopeFilter(scope: PantryScope): SQL {
  return scope.type === "household"
    ? eq(schema.pantryItem.organizationId, scope.householdId)
    : eq(schema.pantryItem.userId, scope.userId);
}

export function pantryAggregateScopeFilter(scope: PantryScope): SQL {
  return scope.type === "household"
    ? eq(schema.pantryAggregate.organizationId, scope.householdId)
    : eq(schema.pantryAggregate.userId, scope.userId);
}

export function pantryResourceId(scope: PantryScope): string {
  return scope.type === "household" ? scope.householdId : scope.userId;
}

export async function findPantryAggregate(
  db: Pick<Db, "select">,
  scope: PantryScope,
) {
  const [aggregate] = await db
    .select({
      id: schema.pantryAggregate.id,
      revision: schema.pantryAggregate.revision,
    })
    .from(schema.pantryAggregate)
    .where(pantryAggregateScopeFilter(scope))
    .limit(1);
  return aggregate;
}

export async function pantryResponseForScope(
  db: Pick<Db, "select">,
  scope: PantryScope,
  options: { operationId?: string; revision?: bigint } = {},
): Promise<PantryResponse> {
  const items = await db
    .select({
      ingredientSlug: schema.pantryItem.ingredientSlug,
      location: schema.pantryItem.location,
      version: schema.pantryItem.version,
    })
    .from(schema.pantryItem)
    .where(pantryScopeFilter(scope))
    .orderBy(asc(schema.pantryItem.ingredientSlug));

  const revision =
    options.revision ?? (await findPantryAggregate(db, scope))?.revision ?? 0n;

  return {
    resourceId: pantryResourceId(scope),
    revision: revision.toString(),
    ...(options.operationId ? { operationId: options.operationId } : {}),
    scope:
      scope.type === "household"
        ? {
            type: scope.type,
            household: {
              id: scope.householdId,
              name: scope.householdName,
            },
          }
        : { type: scope.type },
    stock: Object.fromEntries(
      items.map(({ ingredientSlug, location }) => [ingredientSlug, location]),
    ) as Record<string, PantryLocation>,
    itemVersions: Object.fromEntries(
      items.map(({ ingredientSlug, version }) => [
        ingredientSlug,
        version.toString(),
      ]),
    ),
  };
}

export async function readPantry(db: Db, userId: string) {
  return db.transaction(
    async (tx) =>
      pantryResponseForScope(tx, await resolvePantryScope(tx, userId)),
    { accessMode: "read only", isolationLevel: "repeatable read" },
  );
}
