import { describe, expect, it } from "vitest";
import { PlanningCaseSchema, PlanningChecklistItemSchema } from "../src/model";

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: "confirm-venue",
    title: "Confirm venue",
    category: "Venue",
    owner: "Alex",
    statusHistory: [
      {
        status: "not_started",
        changedAt: "2026-08-01T09:00:00Z",
        changedBy: "alex@example.test",
      },
    ],
    ...overrides,
  };
}

describe("planning case model", () => {
  it("normalizes reusable cases and checklist defaults", () => {
    const planningCase = PlanningCaseSchema.parse({
      id: "wedding-operations",
      name: "Wedding operations",
      labels: ["private", "private"],
      checklistItems: [
        item({ dependencyIds: ["sign-contract", "sign-contract"] }),
      ],
    });

    expect(planningCase.labels).toEqual(["private"]);
    expect(planningCase.checklistItems[0]).toMatchObject({
      priority: "normal",
      status: "not_started",
      dependencyIds: ["sign-contract"],
      financialLinks: [],
    });
    expect(PlanningCaseSchema.parse({ id: "empty", name: "Empty" })).toEqual({
      id: "empty",
      name: "Empty",
      labels: [],
      checklistItems: [],
    });
  });

  it("accepts due dates, date ranges, external links, and financial links", () => {
    expect(
      PlanningChecklistItemSchema.parse(
        item({
          schedule: {
            kind: "date_range",
            startsOn: "2026-08-01",
            endsOn: "2026-08-31",
          },
          externalLink: "https://example.test/venue",
          financialLinks: [
            { kind: "commitment", recordId: "venue-contract" },
            { kind: "decision", recordId: "band-choice" },
            { kind: "payment_action", recordId: "deposit-paid" },
            { kind: "reconciliation", recordId: "tasting-review" },
          ],
        }),
      ),
    ).toMatchObject({
      schedule: { kind: "date_range", endsOn: "2026-08-31" },
      externalLink: "https://example.test/venue",
    });
    expect(
      PlanningChecklistItemSchema.parse(
        item({ schedule: { kind: "due_date", dueDate: "2026-08-31" } }),
      ).schedule,
    ).toEqual({ kind: "due_date", dueDate: "2026-08-31" });
  });

  it("rejects invalid schedules, dependencies, and status histories", () => {
    expect(() =>
      PlanningChecklistItemSchema.parse(
        item({
          schedule: {
            kind: "date_range",
            startsOn: "2026-09-01",
            endsOn: "2026-08-01",
          },
        }),
      ),
    ).toThrow(/end on or after/);
    expect(() =>
      PlanningChecklistItemSchema.parse(
        item({ dependencyIds: ["confirm-venue"] }),
      ),
    ).toThrow(/depend on itself/);
    expect(() =>
      PlanningChecklistItemSchema.parse(item({ status: "complete" })),
    ).toThrow(/latest status history/);
    expect(() =>
      PlanningChecklistItemSchema.parse(
        item({
          status: "complete",
          statusHistory: [
            {
              status: "not_started",
              changedAt: "2026-08-02T09:00:00Z",
              changedBy: "Alex",
            },
            {
              status: "complete",
              changedAt: "2026-08-01T09:00:00Z",
              changedBy: "Sam",
            },
          ],
        }),
      ),
    ).toThrow(/chronological/);
  });

  it("orders status history by instant across offsets and fractional seconds", () => {
    expect(() =>
      PlanningChecklistItemSchema.parse(
        item({
          status: "complete",
          statusHistory: [
            {
              status: "not_started",
              changedAt: "2026-08-01T10:00:00+02:00",
              changedBy: "Alex",
            },
            {
              status: "complete",
              changedAt: "2026-08-01T09:00:00Z",
              changedBy: "Sam",
            },
          ],
        }),
      ),
    ).not.toThrow();
    expect(() =>
      PlanningChecklistItemSchema.parse(
        item({
          status: "complete",
          statusHistory: [
            {
              status: "not_started",
              changedAt: "2026-08-01T09:00:00.500Z",
              changedBy: "Alex",
            },
            {
              status: "complete",
              changedAt: "2026-08-01T09:00:00Z",
              changedBy: "Sam",
            },
          ],
        }),
      ),
    ).toThrow(/chronological/);
  });
});
