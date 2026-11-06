import { getTableConfig } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const postgres = vi.hoisted(() => ({
  closePostgresClient: vi.fn(async () => undefined),
  createDrizzlePostgres: vi.fn(() => ({ client: "client", db: "database" })),
  resolvePostgresConnectionString: vi.fn(),
}));

vi.mock("drizzle-postgres", () => postgres);

import {
  account,
  closeRuntimeDatabase,
  createRuntimeDatabase,
  householdCanaryRecord,
  session,
  user,
  verification,
} from "../src";

describe("authenticated runtime schema", () => {
  beforeEach(() => vi.clearAllMocks());

  it("commits the Better Auth user and session tables", () => {
    expect([user, session, account, verification].map((table) =>
      getTableConfig(table).name,
    )).toEqual(["user", "session", "account", "verification"]);
    expect(getTableConfig(session).indexes.map((index) => index.config.name)).toEqual([
      "session_user_id_idx",
    ]);
    expect(getTableConfig(account).indexes.map((index) => index.config.name)).toEqual([
      "account_user_id_idx",
    ]);
  });

  it("keeps the canary record synthetic and household-scoped", () => {
    const config = getTableConfig(householdCanaryRecord);
    expect(config.name).toBe("household_canary_record");
    expect(config.indexes.map((index) => index.config.name)).toEqual([
      "household_canary_record_owner_user_id_idx",
    ]);
    expect(config.columns.find((column) => column.name === "classification")?.default)
      .toBe("synthetic-only");
  });

  it("requires a database connection and delegates Drizzle lifecycle calls", async () => {
    postgres.resolvePostgresConnectionString.mockReturnValueOnce(undefined);
    expect(() => createRuntimeDatabase({})).toThrow(
      "No database connection configured",
    );

    postgres.resolvePostgresConnectionString.mockReturnValueOnce(
      "postgres://runtime.test/database",
    );
    expect(createRuntimeDatabase({ DATABASE_URL: "configured" })).toEqual({
      client: "client",
      db: "database",
    });
    expect(postgres.createDrizzlePostgres).toHaveBeenCalledWith(
      "postgres://runtime.test/database",
      expect.objectContaining({ user, session, account, verification }),
    );

    await closeRuntimeDatabase("client" as never);
    expect(postgres.closePostgresClient).toHaveBeenCalledWith("client");
  });
});
