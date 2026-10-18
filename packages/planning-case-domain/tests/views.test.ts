import { describe, expect, it } from "vitest";
import { PlanningCaseSchema } from "../src/model";
import { buildPlanningCaseChecklistView } from "../src/views";

function statusHistory(status: string) {
  return [
    {
      status,
      changedAt: "2026-08-01T09:00:00Z",
      changedBy: "planner@example.test",
    },
  ];
}

describe("planning case checklist views", () => {
  it("projects differently named cases without domain-specific fields", () => {
    const wedding = PlanningCaseSchema.parse({
      id: "wedding-operations",
      name: "Wedding operations",
      checklistItems: [
        {
          id: "venue",
          title: "Confirm venue",
          category: "Venue",
          owner: "Alex",
          status: "complete",
          statusHistory: statusHistory("complete"),
          schedule: { kind: "due_date", dueDate: "2026-09-01" },
        },
        {
          id: "band",
          title: "Book band",
          category: "Music",
          owner: "Sam",
          status: "blocked",
          statusHistory: statusHistory("blocked"),
          schedule: {
            kind: "date_range",
            startsOn: "2026-09-10",
            endsOn: "2026-10-01",
          },
        },
        {
          id: "catering",
          title: "Confirm menu",
          category: "Catering",
          owner: "Alex",
          statusHistory: statusHistory("not_started"),
          schedule: { kind: "due_date", dueDate: "2026-09-10" },
        },
        {
          id: "unused",
          title: "Arrange shuttle",
          category: "Transport",
          owner: "Sam",
          status: "not_applicable",
          statusHistory: statusHistory("not_applicable"),
        },
      ],
    });
    const renovation = PlanningCaseSchema.parse({
      id: "kitchen-renovation",
      name: "Kitchen renovation",
      checklistItems: [
        {
          id: "worktop",
          title: "Measure worktop",
          category: "Joinery",
          owner: "Alex",
          statusHistory: statusHistory("not_started"),
        },
      ],
    });

    expect(buildPlanningCaseChecklistView(wedding, "2026-09-15")).toMatchObject(
      {
        completedItems: 1,
        totalItems: 3,
        notApplicableItems: 1,
        overdueItems: [{ id: "catering" }],
        blockedItems: [{ id: "band" }],
        upcomingDeadlines: [{ id: "band" }],
        progressByCategory: [
          { name: "Catering", completed: 0, total: 1 },
          { name: "Music", completed: 0, total: 1 },
          { name: "Venue", completed: 1, total: 1 },
        ],
        progressByOwner: [
          { name: "Alex", completed: 1, total: 2 },
          { name: "Sam", completed: 0, total: 1 },
        ],
      },
    );
    expect(
      buildPlanningCaseChecklistView(renovation, "2026-09-15"),
    ).toMatchObject({
      name: "Kitchen renovation",
      totalItems: 1,
      progressByCategory: [{ name: "Joinery", completed: 0, total: 1 }],
    });
  });
});
