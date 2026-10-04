import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";

export type PostgresClient = postgres.Sql;
export type DrizzlePostgresSchema = Record<string, unknown>;
export type DrizzlePostgresDatabase<
  TSchema extends DrizzlePostgresSchema,
> = PostgresJsDatabase<TSchema> & { $client: PostgresClient };

export type PostgresConnectionEnv = {
  HYPERDRIVE?: { connectionString: string };
  DATABASE_URL?: string;
};

export function resolvePostgresConnectionString(
  env: PostgresConnectionEnv,
): string | undefined {
  return env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
}

export function createDrizzlePostgres<
  TSchema extends DrizzlePostgresSchema,
>(
  connectionString: string,
  schema: TSchema,
): {
  db: DrizzlePostgresDatabase<TSchema>;
  client: PostgresClient;
} {
  // Hyperdrive can route requests to different backend connections, so named
  // prepared statements cannot be reused safely.
  const client = postgres(connectionString, { prepare: false });
  const db = drizzle(client, { schema, casing: "snake_case" });
  return { db, client };
}

export async function closePostgresClient(
  client: PostgresClient | undefined,
  timeoutSeconds = 5,
): Promise<void> {
  if (!client) return;
  await client.end({ timeout: timeoutSeconds });
}
