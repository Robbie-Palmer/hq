import { describe, expect, it } from "vitest";
import {
  applyAddPlanningChecklistItem,
  applyCreatePlanningCase,
  applySetPlanningChecklistItemStatus,
} from "@/lib/domain/assettracker/assetTrackerCommands";
import {
  type AssetTrackerData,
  AssetTrackerDataSchema,
} from "@/lib/domain/assettracker/assetTrackerData";
import { buildRepository } from "@/lib/domain/assettracker/assetTrackerRepository";
import {
  buildPlanningCaseView,
  PlanningCaseSchema,
  validateAssetTrackerPlanningCaseChecklist,
} from "@/lib/domain/assettracker/planningChecklist";

function data(): AssetTrackerData {
  return AssetTrackerDataSchema.parse({
    accounts: [
      {
        id: "wedding-fund",
        name: "Wedding fund",
        provider: "Bank",
        currency: "GBP",
        assetType: "cash",
        expectedAnnualReturn: 0,
        createdAt: "2025-01-01",
      },
    ],
    snapshots: [],
    futureCashFlows: [
      {
        id: "venue-contract",
        name: "Venue contract",
        kind: "commitment",
        status: "active",
        changeability: "fixed",
        refundable: false,
        labels: [],
        currency: "GBP",
        stages: [
          {
            id: "venue-balance",
            direction: "payment",
            fromAccountId: "wedding-fund",
            dueDate: "2027-04-01",
            amount: 5_000,
            actuals: [
              {
                id: "venue-deposit-paid",
                date: "2026-09-01",
                amount: 1_000,
                direction: "payment",
              },
            ],
          },
        ],
      },
      {
        id: "band-choice",
        name: "Band choice",
        kind: "decision",
        status: "selected",
        reversibility: "partly-reversible",
        dependencyIds: [],
        alternativeToIds: [],
        labels: [],
        currency: "GBP",
        stages: [
          {
            id: "band-payment",
            direction: "payment",
            fromAccountId: "wedding-fund",
            expectedDate: "2027-05-01",
            minimumAmount: 1_500,
            expectedAmount: 2_000,
            maximumAmount: 2_500,
            actuals: [
              {
                id: "band-hold-paid",
                date: "2026-09-10",
                amount: 500,
                direction: "payment",
              },
            ],
          },
        ],
      },
    ],
    decisionRecords: [
      {
        id: "catering-reconciliation",
        kind: "tracked",
        question: "Which catering package should we use?",
        decisionDate: "2026-08-01",
        selectedScenario: { id: "standard", label: "Standard package" },
        rationale: "Fits the guest list",
        action: "Reconcile the tasting payment",
        forecast: {
          capturedAt: "2026-08-01T12:00:00Z",
          calculationVersion: "1",
          lineage: [
            {
              id: "fact",
              kind: "financial-fact",
              label: "Guest count",
              value: "80",
              source: "Planner",
              validAt: "2026-08-01",
            },
            {
              id: "rate",
              kind: "rate",
              label: "Price per guest",
              value: "3.75",
              source: "Quote",
              validAt: "2026-08-01",
            },
            {
              id: "tax",
              kind: "tax-rule",
              label: "VAT",
              value: "Included",
              source: "Quote",
              validAt: "2026-08-01",
            },
            {
              id: "assumption",
              kind: "assumption",
              label: "Attendance",
              value: "80 guests",
              source: "Planner",
              validAt: "2026-08-01",
            },
          ],
          checkpoints: [
            {
              id: "tasting",
              label: "Tasting",
              dueDate: "2026-09-15",
              expectedAmount: 300,
              currency: "GBP",
            },
          ],
        },
        observations: [
          {
            id: "tasting-observed",
            checkpointId: "tasting",
            observedAt: "2026-09-16T12:00:00Z",
            actualAmount: 250,
            note: "Final card charge",
            divergenceSources: [],
          },
        ],
        interpretations: [],
      },
    ],
  });
}

describe("planning case checklists", () => {
  it("uses one checklist model for differently named planning cases", () => {
    let next = applyCreatePlanningCase(data(), {
      name: "Wedding operations",
      labels: ["private"],
    });
    next = applyCreatePlanningCase(next, {
      name: "Kitchen renovation",
      labels: ["private"],
    });
    next = applyAddPlanningChecklistItem(
      next,
      {
        planningCaseId: "wedding-operations",
        title: "Confirm venue",
        description: "Return the signed agreement",
        category: "Venue",
        owner: "Alex",
        schedule: { kind: "due_date", dueDate: "2026-09-01" },
        priority: "critical",
        notes: "Ask about supplier access",
        externalLink: "https://example.test/venue",
        financialLinks: [
          { kind: "commitment", recordId: "venue-contract" },
          { kind: "payment_action", recordId: "venue-deposit-paid" },
        ],
        changedBy: "alex@example.test",
      },
      "2026-08-01T09:00:00Z",
    );
    next = applyAddPlanningChecklistItem(
      next,
      {
        planningCaseId: "wedding-operations",
        title: "Book band",
        category: "Music",
        owner: "Sam",
        schedule: {
          kind: "date_range",
          startsOn: "2026-09-10",
          endsOn: "2026-10-01",
        },
        priority: "high",
        dependencyIds: ["confirm-venue"],
        financialLinks: [{ kind: "decision", recordId: "band-choice" }],
        changedBy: "sam@example.test",
      },
      "2026-08-02T09:00:00Z",
    );
    next = applyAddPlanningChecklistItem(
      next,
      {
        planningCaseId: "wedding-operations",
        title: "Reconcile catering tasting",
        category: "Catering",
        owner: "Alex",
        schedule: { kind: "due_date", dueDate: "2026-09-10" },
        financialLinks: [
          { kind: "reconciliation", recordId: "catering-reconciliation" },
        ],
        changedBy: "alex@example.test",
      },
      "2026-08-03T09:00:00Z",
    );
    next = applyAddPlanningChecklistItem(
      next,
      {
        planningCaseId: "kitchen-renovation",
        title: "Measure worktop",
        category: "Joinery",
        owner: "Alex",
        changedBy: "alex@example.test",
      },
      "2026-08-04T09:00:00Z",
    );
    next = applySetPlanningChecklistItemStatus(
      next,
      {
        planningCaseId: "wedding-operations",
        itemId: "confirm-venue",
        status: "complete",
        changedBy: "sam@example.test",
      },
      "2026-09-02T10:00:00Z",
    );
    next = applySetPlanningChecklistItemStatus(
      next,
      {
        planningCaseId: "wedding-operations",
        itemId: "book-band",
        status: "blocked",
        changedBy: "alex@example.test",
      },
      "2026-09-03T10:00:00Z",
    );

    const repository = buildRepository(next);
    const wedding = repository.planningCases.find(
      ({ id }) => id === "wedding-operations",
    );
    const renovation = repository.planningCases.find(
      ({ id }) => id === "kitchen-renovation",
    );
    expect(wedding?.checklistItems[0]).toMatchObject({
      title: "Confirm venue",
      category: "Venue",
      owner: "Alex",
      priority: "critical",
      status: "complete",
      externalLink: "https://example.test/venue",
      statusHistory: [
        {
          status: "not_started",
          changedAt: "2026-08-01T09:00:00Z",
          changedBy: "alex@example.test",
        },
        {
          status: "complete",
          changedAt: "2026-09-02T10:00:00Z",
          changedBy: "sam@example.test",
        },
      ],
    });
    expect(wedding?.checklistItems[1]?.dependencyIds).toEqual([
      "confirm-venue",
    ]);
    expect(renovation?.checklistItems[0]).toMatchObject({
      title: "Measure worktop",
      category: "Joinery",
      owner: "Alex",
    });
    expect(JSON.stringify(wedding?.checklistItems)).not.toContain('"amount"');

    if (wedding == null) throw new Error("Wedding case was not created");
    if (renovation == null) throw new Error("Renovation case was not created");
    const view = buildPlanningCaseView(
      wedding,
      repository.futureCashFlows,
      repository.decisionRecords,
      "2026-09-15",
    );
    expect(view).toMatchObject({
      completedItems: 1,
      totalItems: 3,
      notApplicableItems: 0,
      progressByCategory: [
        { name: "Catering", completed: 0, total: 1 },
        { name: "Music", completed: 0, total: 1 },
        { name: "Venue", completed: 1, total: 1 },
      ],
      progressByOwner: [
        { name: "Alex", completed: 1, total: 2 },
        { name: "Sam", completed: 0, total: 1 },
      ],
      financialSummary: [
        {
          currency: "GBP",
          direction: "payment",
          planned: 7_300,
          committed: 5_000,
          paid: 1_750,
          remaining: 5_550,
        },
      ],
    });
    expect(view.blockedItems.map(({ id }) => id)).toEqual(["book-band"]);
    expect(view.overdueItems.map(({ id }) => id)).toEqual([
      "reconcile-catering-tasting",
    ]);
    expect(view.upcomingDeadlines.map(({ id }) => id)).toEqual(["book-band"]);
    expect(view.blockedItems[0]?.status).toBe("blocked");
    expect(
      buildPlanningCaseView(
        renovation,
        repository.futureCashFlows,
        repository.decisionRecords,
        "2026-09-15",
      ),
    ).toMatchObject({
      name: "Kitchen renovation",
      completedItems: 0,
      totalItems: 1,
      progressByCategory: [{ name: "Joinery", completed: 0, total: 1 }],
    });
  });

  it("rejects orphan dependencies and financial links", () => {
    const next = applyCreatePlanningCase(data(), {
      name: "Wedding operations",
      labels: [],
    });
    expect(() =>
      applyAddPlanningChecklistItem(
        next,
        {
          planningCaseId: "wedding-operations",
          title: "Pay supplier",
          category: "Venue",
          owner: "Alex",
          dependencyIds: ["missing-task"],
          financialLinks: [{ kind: "commitment", recordId: "missing" }],
          changedBy: "alex@example.test",
        },
        "2026-08-01T09:00:00Z",
      ),
    ).toThrow(/unknown dependency/);
    expect(() =>
      applyAddPlanningChecklistItem(
        next,
        {
          planningCaseId: "wedding-operations",
          title: "Pay supplier",
          category: "Venue",
          owner: "Alex",
          financialLinks: [{ kind: "commitment", recordId: "missing" }],
          changedBy: "alex@example.test",
        },
        "2026-08-01T09:00:00Z",
      ),
    ).toThrow(/unknown commitment/);
  });

  it("validates every Asset Tracker financial-link kind", () => {
    const repository = buildRepository(data());
    const linkedCase = PlanningCaseSchema.parse({
      id: "wedding-operations",
      name: "Wedding operations",
      checklistItems: [
        {
          id: "pay-supplier",
          title: "Pay supplier",
          category: "Venue",
          owner: "Alex",
          statusHistory: [
            {
              status: "not_started",
              changedAt: "2026-08-01T09:00:00Z",
              changedBy: "Alex",
            },
          ],
        },
      ],
    });
    const withLink = (
      kind: "commitment" | "decision" | "payment_action" | "reconciliation",
      recordId: string,
    ) => ({
      ...linkedCase,
      checklistItems: linkedCase.checklistItems.map((item) => ({
        ...item,
        financialLinks: [{ kind, recordId }],
      })),
    });

    expect(() =>
      validateAssetTrackerPlanningCaseChecklist(
        withLink("payment_action", "missing-payment"),
        repository.futureCashFlows,
        repository.decisionRecords,
      ),
    ).toThrow(/unknown payment action/);
    expect(() =>
      validateAssetTrackerPlanningCaseChecklist(
        withLink("reconciliation", "missing-reconciliation"),
        repository.futureCashFlows,
        repository.decisionRecords,
      ),
    ).toThrow(/unknown reconciliation/);
    expect(() =>
      validateAssetTrackerPlanningCaseChecklist(
        withLink("commitment", "band-choice"),
        repository.futureCashFlows,
        repository.decisionRecords,
      ),
    ).toThrow(/unknown commitment/);
    expect(() =>
      validateAssetTrackerPlanningCaseChecklist(
        withLink("decision", "missing-decision"),
        repository.futureCashFlows,
        repository.decisionRecords,
      ),
    ).toThrow(/unknown decision/);
  });

  it("summarizes receipts, reversals, and inactive records without double counting", () => {
    const base = data();
    const repository = buildRepository(
      AssetTrackerDataSchema.parse({
        ...base,
        futureCashFlows: [
          ...base.futureCashFlows,
          {
            id: "cancelled-supplier",
            name: "Cancelled supplier",
            kind: "commitment",
            status: "cancelled",
            changeability: "fixed",
            refundable: true,
            labels: [],
            currency: "GBP",
            stages: [
              {
                id: "cancelled-supplier-payment",
                direction: "payment",
                fromAccountId: "wedding-fund",
                dueDate: "2027-04-01",
                amount: 400,
                actuals: [
                  {
                    id: "cancelled-supplier-paid",
                    date: "2026-09-01",
                    amount: 150,
                    direction: "payment",
                  },
                  {
                    id: "cancelled-supplier-refund",
                    date: "2026-09-02",
                    amount: 25,
                    direction: "refund",
                  },
                ],
              },
            ],
          },
          {
            id: "gift-receipt",
            name: "Family gift",
            kind: "commitment",
            status: "active",
            changeability: "fixed",
            refundable: false,
            labels: [],
            currency: "GBP",
            stages: [
              {
                id: "gift-receipt-stage",
                direction: "receipt",
                toAccountId: "wedding-fund",
                dueDate: "2027-01-01",
                amount: 1_000,
                actuals: [
                  {
                    id: "gift-received",
                    date: "2026-09-01",
                    amount: 300,
                    direction: "receipt",
                  },
                  {
                    id: "gift-returned",
                    date: "2026-09-02",
                    amount: 50,
                    direction: "return",
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    const planningCase = PlanningCaseSchema.parse({
      id: "wedding-operations",
      name: "Wedding operations",
      checklistItems: [
        {
          id: "settle-finances",
          title: "Settle finances",
          category: "Finance",
          owner: "Alex",
          financialLinks: [
            { kind: "commitment", recordId: "cancelled-supplier" },
            { kind: "payment_action", recordId: "cancelled-supplier-paid" },
            { kind: "commitment", recordId: "cancelled-supplier" },
            { kind: "commitment", recordId: "gift-receipt" },
            { kind: "payment_action", recordId: "gift-received" },
          ],
          statusHistory: [
            {
              status: "not_started",
              changedAt: "2026-08-01T09:00:00Z",
              changedBy: "Alex",
            },
          ],
        },
      ],
    });

    expect(
      buildPlanningCaseView(
        planningCase,
        repository.futureCashFlows,
        repository.decisionRecords,
        "2026-09-15",
      ).financialSummary,
    ).toEqual([
      {
        currency: "GBP",
        direction: "payment",
        planned: 0,
        committed: 0,
        paid: 125,
        remaining: 0,
      },
      {
        currency: "GBP",
        direction: "receipt",
        planned: 1_000,
        committed: 1_000,
        paid: 250,
        remaining: 750,
      },
    ]);
  });
});
