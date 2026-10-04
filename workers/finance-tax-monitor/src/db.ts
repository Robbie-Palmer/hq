import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Env } from "./env";
import * as schema from "./schema";

export type DbClient = postgres.Sql;
export type Db = PostgresJsDatabase<typeof schema> & { $client: DbClient };

export function databaseConnection(env: Env): string | undefined {
  return env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
}

export function createDb(connectionString: string): {
  db: Db;
  client: DbClient;
} {
  const client = postgres(connectionString, { prepare: false });
  const db = drizzle(client, { schema, casing: "snake_case" });
  return { db, client };
}

export async function closeDbClient(
  client: DbClient | undefined,
): Promise<void> {
  if (!client) return;
  try {
    await client.end({ timeout: 5 });
  } catch (error) {
    console.error("finance tax monitor database cleanup failed", error);
  }
}

export async function withDb<T>(
  env: Env,
  operation: (db: Db) => Promise<T>,
): Promise<T> {
  const connectionString = databaseConnection(env);
  if (!connectionString) throw new Error("No finance database connection configured");
  const { db, client } = createDb(connectionString);
  try {
    return await operation(db);
  } finally {
    await closeDbClient(client);
  }
}
