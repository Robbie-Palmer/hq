import { pgTable, text } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  closePostgresClient,
  createDrizzlePostgres,
  resolvePostgresConnectionString,
} from "../src/index";

const schema = {
  example: pgTable("example", { id: text().primaryKey() }),
};

describe("PostgreSQL connection helpers", () => {
  it("prefers Hyperdrive and falls back to a direct URL", () => {
    expect(
      resolvePostgresConnectionString({
        HYPERDRIVE: { connectionString: "postgresql://hyperdrive" },
        DATABASE_URL: "postgresql://direct",
      }),
    ).toBe("postgresql://hyperdrive");
    expect(
      resolvePostgresConnectionString({ DATABASE_URL: "postgresql://direct" }),
    ).toBe("postgresql://direct");
    expect(resolvePostgresConnectionString({})).toBeUndefined();
  });

  it("creates and closes a lazy postgres.js Drizzle client", async () => {
    const created = createDrizzlePostgres(
      "postgresql://user:password@127.0.0.1:1/test",
      schema,
    );

    expect(created.db.$client).toBe(created.client);
    await expect(closePostgresClient(created.client)).resolves.toBeUndefined();
    await expect(closePostgresClient(undefined)).resolves.toBeUndefined();
  });
});
