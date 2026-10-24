import { describe, expect, it } from "vitest";
import { AssetTrackerDataSchema } from "@/app/_projects/personal-finance-app/domain/assetTrackerData";
import { buildWeddingOperationsSnapshot } from "@/lib/wedding-planner/readiness-finance";

function data() {
  return AssetTrackerDataSchema.parse({
    accounts: [
      {
        id: "wedding-fund",
        name: "Wedding fund",
        provider: "Bank",
        currency: "GBP",
        assetType: "cash",
        expectedAnnualReturn: 0,
        createdAt: "2026-01-01",
      },
    ],
    snapshots: [],
    planningCases: [
      {
        id: "wedding-operations",
        name: "Wedding operations",
        labels: ["wedding"],
        checklistItems: [
          {
            id: "book-venue",
            title: "Book venue",
            category: "Venue",
            owner: "Robin",
            schedule: { kind: "due_date", dueDate: "2027-02-01" },
            status: "in_progress",
            financialLinks: [
              { kind: "commitment", recordId: "venue-contract" },
            ],
            statusHistory: [
              {
                status: "in_progress",
                changedAt: "2026-10-01T12:00:00Z",
                changedBy: "robin@example.test",
              },
            ],
          },
        ],
      },
    ],
    futureCashFlows: [
      {
        id: "venue-contract",
        name: "Venue contract",
        planningCaseId: "wedding-operations",
        labels: [],
        currency: "GBP",
        kind: "commitment",
        status: "active",
        changeability: "fixed",
        refundable: true,
        stages: [
          {
            id: "venue-balance",
            name: "Balance",
            direction: "payment",
            fromAccountId: "wedding-fund",
            dueDate: "2027-04-01",
            amount: 5_000,
            actuals: [
              {
                id: "venue-deposit",
                date: "2026-10-01",
                amount: 1_000,
                direction: "payment",
              },
              {
                id: "venue-refund",
                date: "2026-10-02",
                amount: 100,
                direction: "refund",
              },
            ],
          },
        ],
      },
      {
        id: "band-choice",
        name: "Choose a band",
        planningCaseId: "wedding-operations",
        labels: [],
        currency: "GBP",
        kind: "decision",
        status: "considering",
        reversibility: "reversible",
        dependencyIds: [],
        alternativeToIds: [],
        stages: [
          {
            id: "band-fee",
            direction: "payment",
            fromAccountId: "wedding-fund",
            expectedDate: "2027-03-01",
            minimumAmount: 1_000,
            expectedAmount: 1_500,
            maximumAmount: 2_000,
            actuals: [],
          },
        ],
      },
    ],
  });
}

describe("wedding readiness finance adapter", () => {
  it("reads the planning case without copying money into the wedding plan", () => {
    const snapshot = buildWeddingOperationsSnapshot(data(), null);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.tasks).toEqual([
      expect.objectContaining({
        id: "book-venue",
        due_on: "2027-02-01",
        href: "/assettracker/planning#task-book-venue",
      }),
    ]);
    expect(snapshot?.finances).toEqual([
      {
        currency: "GBP",
        planned: 6_500,
        committed: 5_000,
        paid: 1_000,
        refunded: 100,
        remaining: 5_600,
      },
    ]);
    expect(snapshot?.upcoming_payments).toEqual([
      expect.objectContaining({
        title: "Venue contract: Balance",
        amount: 4_100,
        due_on: "2027-04-01",
      }),
    ]);
    expect(snapshot?.unresolved_decisions).toEqual([
      expect.objectContaining({ id: "band-choice", title: "Choose a band" }),
    ]);
  });

  it("returns null when the requested planning case does not exist", () => {
    expect(buildWeddingOperationsSnapshot(data(), "missing")).toBeNull();
  });
});
