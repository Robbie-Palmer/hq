import {
  closePostgresClient,
  createDrizzlePostgres,
  type DrizzlePostgresDatabase,
  type PostgresClient,
  resolvePostgresConnectionString,
} from "drizzle-postgres";
import { schema } from "./schema";

export type RuntimeDatabase = DrizzlePostgresDatabase<typeof schema>;
export type RuntimeDatabaseClient = PostgresClient;

export type RuntimeDatabaseEnv = {
  HYPERDRIVE?: { connectionString: string };
  DATABASE_URL?: string;
};

export function createRuntimeDatabase(env: RuntimeDatabaseEnv) {
  const connectionString = resolvePostgresConnectionString(env);
  if (!connectionString) throw new Error("No database connection configured");
  return createDrizzlePostgres(connectionString, schema);
}

export function closeRuntimeDatabase(client: RuntimeDatabaseClient) {
  return closePostgresClient(client);
}
