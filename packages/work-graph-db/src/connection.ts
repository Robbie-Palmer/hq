import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

type DbClient = postgres.Sql;
export type Db = PostgresJsDatabase<typeof schema> & { $client: DbClient };
export type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function createDb(connectionString: string): Db {
  // Hyperdrive can route transactions to different backend connections, so
  // named prepared statements cannot be reused safely.
  const client = postgres(connectionString, { prepare: false });
  return drizzle(client, { schema, casing: "snake_case" });
}

export async function closeDb(db: Db | undefined): Promise<void> {
  if (!db) return;
  await db.$client.end({ timeout: 5 });
}
