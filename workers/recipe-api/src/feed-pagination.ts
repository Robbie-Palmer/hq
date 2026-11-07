import { sql, type SQL } from "drizzle-orm";
import { schema } from "recipe-db";
import { z } from "zod";

export type FeedCursor = Readonly<{ createdAt: string; id: string }>;

const feedCursorSchema = z.object({
  createdAt: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
  id: z.uuid(),
});

type FeedRow = Readonly<{
  recipe: Readonly<{ id: string }>;
  cursorCreatedAt: string;
}>;

export function encodeFeedCursor(cursor: FeedCursor): string {
  let encoded = btoa(JSON.stringify(cursor))
    .replaceAll("+", "-")
    .replaceAll("/", "_");
  while (encoded.endsWith("=")) encoded = encoded.slice(0, -1);
  return encoded;
}

export function decodeFeedCursor(
  value: string | undefined,
): FeedCursor | undefined {
  if (!value) return undefined;
  try {
    let base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    while (base64.length % 4 !== 0) base64 += "=";
    const parsed = feedCursorSchema.safeParse(JSON.parse(atob(base64)));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function recipeFeedCursorFilter(
  cursor: FeedCursor | undefined,
): SQL | undefined {
  if (!cursor) return undefined;
  return sql`(${schema.recipe.createdAt} < ${cursor.createdAt}::timestamptz OR (${schema.recipe.createdAt} = ${cursor.createdAt}::timestamptz AND ${schema.recipe.id} < ${cursor.id}))`;
}

export function recipeFeedCursorTimestamp(): SQL<string> {
  return sql<string>`${schema.recipe.createdAt}::text`;
}

export function paginateRecipeFeed<T extends FeedRow>(
  rows: T[],
  limit: number,
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > limit && last
        ? encodeFeedCursor({
            createdAt: last.cursorCreatedAt,
            id: last.recipe.id,
          })
        : null,
  };
}
