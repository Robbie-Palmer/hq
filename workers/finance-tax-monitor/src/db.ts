import {
  closePostgresClient,
  createDrizzlePostgres,
  resolvePostgresConnectionString,
  type DrizzlePostgresDatabase,
  type PostgresClient,
} from "drizzle-postgres";
import type { Env } from "./env";
import * as schema from "./schema";

export type DbClient = PostgresClient;
export type Db = DrizzlePostgresDatabase<typeof schema>;

export function databaseConnection(env: Env): string | undefined {
  return resolvePostgresConnectionString(env);
}

export function createDb(connectionString: string): {
  db: Db;
  client: DbClient;
} {
  return createDrizzlePostgres(connectionString, schema);
}

export async function closeDbClient(
  client: DbClient | undefined,
): Promise<void> {
  if (!client) return;
  try {
    await closePostgresClient(client);
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
