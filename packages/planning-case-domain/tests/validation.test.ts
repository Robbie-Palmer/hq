import { describe, expect, it } from "vitest";
import { PlanningCaseSchema } from "../src/model";
import { validatePlanningCaseChecklistStructure } from "../src/validation";

function item(id: string, dependencyIds: string[] = []) {
  return {
    id,
    title: id,
    category: "General",
    owner: "Alex",
    dependencyIds,
    statusHistory: [
      {
        status: "not_started" as const,
        changedAt: "2026-08-01T09:00:00Z",
        changedBy: "Alex",
      },
    ],
  };
}

describe("planning case checklist validation", () => {
  it("accepts dependencies within the same case", () => {
    const planningCase = PlanningCaseSchema.parse({
      id: "case",
      name: "Case",
      checklistItems: [item("first"), item("second", ["first"])],
    });
    expect(() =>
      validatePlanningCaseChecklistStructure(planningCase),
    ).not.toThrow();
  });

  it("rejects duplicate item IDs and orphan dependencies", () => {
    const duplicate = PlanningCaseSchema.parse({
      id: "case",
      name: "Case",
      checklistItems: [item("same"), item("same")],
    });
    expect(() => validatePlanningCaseChecklistStructure(duplicate)).toThrow(
      /duplicate checklist item ID/,
    );

    const orphan = PlanningCaseSchema.parse({
      id: "case",
      name: "Case",
      checklistItems: [item("second", ["missing"])],
    });
    expect(() => validatePlanningCaseChecklistStructure(orphan)).toThrow(
      /unknown dependency/,
    );
  });
});
