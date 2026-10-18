import { migrate } from "drizzle-orm/postgres-js/migrator";
import { requiredEnv } from "node-base/env";
import { closeDbClient, createDb } from "recipe-db";
import { safeMigrationErrorChain } from "./migration-error";

function logMigrationError(error: unknown): void {
  console.error("Database migration failed.");
  for (const details of safeMigrationErrorChain(error)) {
    console.error(details);
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
