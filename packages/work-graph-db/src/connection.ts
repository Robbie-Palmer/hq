import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  type DatabaseQueryMetrics,
  recordDatabaseResultRow,
} from "./query-metrics";
import * as schema from "./schema";

type DbClient = postgres.Sql;
export type Db = PostgresJsDatabase<typeof schema> & { $client: DbClient };
export type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface DbConnectionOptions {
  readonly maxConnections?: number;
  readonly metrics?: DatabaseQueryMetrics;
}

export function createDb(
  connectionString: string,
  options: DbConnectionOptions = {},
): Db {
  const metrics = options.metrics;
  // Hyperdrive can route transactions to different backend connections, so
  // named prepared statements cannot be reused safely.
  const client = postgres(connectionString, {
    prepare: false,
    // Postgres.js otherwise queries pg_catalog for every new client to discover
    // array OIDs. Drizzle serializes and parses the built-in array columns used
    // by this schema, so that 300+ row startup query is unnecessary.
    fetch_types: false,
    ...(options.maxConnections === undefined
      ? {}
      : { max: options.maxConnections }),
    ...(metrics === undefined
      ? {}
      : {
          debug: () => {
            metrics.queryCount += 1;
          },
          transform: {
            row: {
              from: (row: postgres.Row) =>
                recordDatabaseResultRow(metrics, row),
            },
          },
        }),
  });
  return drizzle(client, { schema, casing: "snake_case" });
}

export async function closeDb(db: Db | undefined): Promise<void> {
  if (!db) return;
  await db.$client.end({ timeout: 5 });
}
