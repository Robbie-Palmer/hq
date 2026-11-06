import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { account, session, user, verification } from "../src/runtime-schema";

describe("authenticated runtime schema", () => {
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
});
