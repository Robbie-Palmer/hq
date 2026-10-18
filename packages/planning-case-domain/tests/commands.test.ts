import { describe, expect, it } from "vitest";
import {
  createPlanningChecklistItem,
  setPlanningChecklistItemStatus,
} from "../src/commands";
import { PlanningCaseSchema } from "../src/model";

describe("planning checklist commands", () => {
  it("creates an item with an attributable initial status", () => {
    expect(
      createPlanningChecklistItem(
        "confirm-venue",
        {
          title: "Confirm venue",
          category: "Venue",
          owner: "Alex",
          priority: "high",
          changedBy: "alex@example.test",
        },
        "2026-08-01T09:00:00Z",
      ),
    ).toMatchObject({
      id: "confirm-venue",
      status: "not_started",
      statusHistory: [
        {
          status: "not_started",
          changedAt: "2026-08-01T09:00:00Z",
          changedBy: "alex@example.test",
        },
      ],
    });
  });

  it("records status changes and leaves repeated status commands unchanged", () => {
    const item = createPlanningChecklistItem(
      "confirm-venue",
      {
        title: "Confirm venue",
        category: "Venue",
        owner: "Alex",
        changedBy: "Alex",
      },
      "2026-08-01T09:00:00Z",
    );
    const planningCase = PlanningCaseSchema.parse({
      id: "wedding",
      name: "Wedding",
      checklistItems: [item],
    });
    const completed = setPlanningChecklistItemStatus(
      planningCase,
      {
        itemId: item.id,
        status: "complete",
        changedBy: "Sam",
      },
      "2026-08-02T09:00:00Z",
    );

    expect(completed.checklistItems[0]).toMatchObject({
      status: "complete",
      statusHistory: [
        { status: "not_started", changedBy: "Alex" },
        { status: "complete", changedBy: "Sam" },
      ],
    });
    expect(
      setPlanningChecklistItemStatus(
        completed,
        { itemId: item.id, status: "complete", changedBy: "Sam" },
        "2026-08-03T09:00:00Z",
      ),
    ).toBe(completed);
  });

  it("rejects status changes for an unknown item", () => {
    const planningCase = PlanningCaseSchema.parse({ id: "case", name: "Case" });
    expect(() =>
      setPlanningChecklistItemStatus(
        planningCase,
        { itemId: "missing", status: "blocked", changedBy: "Alex" },
        "2026-08-01T09:00:00Z",
      ),
    ).toThrow(/No checklist item/);
  });
});
