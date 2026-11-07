import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { weddingPlan } from "../src/schema";

describe("Wedding Planner schema contract", () => {
  it("keeps one revisioned aggregate per owner", () => {
    const config = getTableConfig(weddingPlan);

    expect(config.name).toBe("wedding_plan");
    expect(config.indexes.map((index) => index.config.name)).toContain(
      "wedding_plan_owner_uidx",
    );
    expect(config.checks.map((constraint) => constraint.name)).toEqual([
      "wedding_plan_owner_not_blank_check",
      "wedding_plan_revision_positive_check",
    ]);
  });
});
