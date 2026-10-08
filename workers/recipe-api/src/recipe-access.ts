import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import type { Db } from "recipe-db";
import * as schema from "recipe-db/schema";

export async function readableRecipeFilter(
  db: Pick<Db, "select">,
  userId?: string,
): Promise<SQL> {
  if (!userId) return eq(schema.recipe.visibility, "public");

  const [membership] = await db
    .select({ organizationId: schema.member.organizationId })
    .from(schema.member)
    .where(eq(schema.member.userId, userId))
    .limit(1);

  if (!membership) {
    return or(
      eq(schema.recipe.visibility, "public"),
      eq(schema.recipe.userId, userId),
    )!;
  }

  const members = await db
    .select({ userId: schema.member.userId })
    .from(schema.member)
    .where(eq(schema.member.organizationId, membership.organizationId));
  const memberIds = members.map((member) => member.userId);

  return or(
    eq(schema.recipe.visibility, "public"),
    eq(schema.recipe.userId, userId),
    and(
      eq(schema.recipe.visibility, "household"),
      inArray(schema.recipe.userId, memberIds),
    ),
  )!;
}
