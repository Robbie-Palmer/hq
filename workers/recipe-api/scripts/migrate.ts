import { migrate } from "drizzle-orm/postgres-js/migrator";
import { requiredEnv } from "node-base/env";
import { closeDbClient, createDb } from "recipe-db";

const errorFields = [
  "name",
  "message",
  "code",
  "detail",
  "hint",
  "schema",
  "table",
  "column",
  "constraint",
  "routine",
] as const;

function logMigrationError(error: unknown): void {
  console.error("Database migration failed.");

  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current && !seen.has(current)) {
    seen.add(current);

    if (typeof current !== "object") {
      console.error(String(current));
      return;
    }

    const record = current as Record<string, unknown>;
    const details = Object.fromEntries(
      errorFields.flatMap((field) =>
        typeof record[field] === "string" ? [[field, record[field]]] : [],
      ),
    );
    console.error(details);
    current = record.cause;
  }
}

const databaseUrl = requiredEnv("DATABASE_URL");
const { db, client } = createDb(databaseUrl);

try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.info("Database migrations applied successfully.");
} catch (error) {
  logMigrationError(error);
  process.exitCode = 1;
} finally {
  await closeDbClient(client);
}
