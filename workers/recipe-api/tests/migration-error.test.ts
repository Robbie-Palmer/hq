import { describe, expect, it } from "vitest";
import { safeMigrationErrorChain } from "../scripts/migration-error";

describe("safeMigrationErrorChain", () => {
  it("keeps diagnostics while excluding PostgreSQL values", () => {
    const error = {
      name: "DrizzleQueryError",
      message: "Failed query: ALTER TABLE example",
      cause: {
        name: "PostgresError",
        message: "duplicate key value violates unique constraint",
        code: "23505",
        detail: "Key (email)=(private@example.com) already exists.",
        parameters: ["private@example.com"],
        constraint: "example_email_unique",
      },
    };

    expect(safeMigrationErrorChain(error)).toEqual([
      {
        name: "DrizzleQueryError",
        message: "Failed query: ALTER TABLE example",
      },
      {
        name: "PostgresError",
        message: "duplicate key value violates unique constraint",
        code: "23505",
        constraint: "example_email_unique",
      },
    ]);
  });
});
