import { describe, expect, it } from "vitest";
import {
  buildWeddingReadiness,
  parseWeddingPlan,
  type WeddingPlan,
} from "../src";

function plan(): WeddingPlan {
  return parseWeddingPlan({
    version: 2,
    guests: [
      {
        id: "alex",
        name: "Alex",
        attendance: "yes",
        email: "",
        dietary_needs: ["vegetarian"],
        transport: { status: "needed" },
        private_notes: ["Do not expose this note"],
      },
      { id: "casey", name: "Casey", attendance: "unknown" },
    ],
    hosts: ["Robin", "Sam"],
    accommodation: {
      guests: {
        alex: { overnight: "no" },
        casey: { overnight: "yes" },
      },
      inventory: {
        properties: [
          {
            id: "hotel",
            name: "Town Hotel",
            kind: "hotel",
            check_in_on: "2027-06-04",
            check_out_on: "2027-06-06",
            booking_deadline: "2027-03-01",
            booking: {
              status: "booked",
              payer: { kind: "couple" },
              cancellation_state: "requested",
              refund_state: "pending",
            },
          },
        ],
      },
    },
    seating: {
      top_table_capacity: 4,
      table_capacities: [4],
      saved_plans: [
        {
          id: "final-plan",
          name: "Final plan",
          created_at: "2027-01-01T12:00:00Z",
          allocation: {
            status: "optimal",
            score: { earned: 1, possible: 1 },
            tables: [
              {
                id: "table-1",
                name: "Table 1",
                capacity: 4,
                guest_ids: ["alex"],
                fixed_guests: [],
                seats: [
                  {
                    index: 0,
                    guest_id: "alex",
                    accessible: false,
                    high_chair: false,
                    locked: false,
                  },
                ],
                locked: false,
              },
            ],
            preferences_met: 1,
            preferences_total: 1,
            unmet_preferences: [],
            unsatisfied_preferences: [],
            explanations: [],
            warnings: ["Table capacity needs review"],
          },
        },
      ],
      chosen_plan_id: "final-plan",
    },
    readiness: {
      active_milestone_id: "final-details",
      milestones: [
        {
          id: "final-details",
          name: "Final details",
          due_on: "2027-04-01",
          required_guest_fields: ["email"],
          required_seating_exports: ["venue", "caterer"],
        },
      ],
    },
  });
}

describe("wedding readiness", () => {
  it("removes retired cross-project readiness settings from saved plans", () => {
    const legacy = JSON.parse(JSON.stringify(plan()));
    legacy.readiness.planning_case_id = "wedding";
    legacy.readiness.milestones[0].check_ids = [
      "checklist",
      "finances",
      "guest_responses",
    ];

    const migrated = parseWeddingPlan(legacy);

    expect(migrated.readiness.milestones[0]?.check_ids).toEqual([
      "guest_responses",
    ]);
    expect(migrated.readiness).not.toHaveProperty("planning_case_id");
  });

  it("combines guest, accommodation, seating, and export readiness", () => {
    const readiness = buildWeddingReadiness(plan(), "2027-03-01");
    expect(readiness.guests).toMatchObject({
      attending: 1,
      awaiting_response: 1,
      missing_required_metadata: 2,
      follow_up: 1,
    });
    expect(readiness.accommodation).toMatchObject({
      unassigned: 1,
      unresolved_payments: 1,
    });
    expect(readiness.seating).toMatchObject({
      eligible: 1,
      seated: 1,
      unseated: 0,
      infeasible_constraints: 1,
      unlocked: 1,
      stale_exports: 2,
    });
    expect(readiness.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "guest-dietary:alex" }),
        expect.objectContaining({
          id: "accommodation-payment:hotel",
          detail: "Refund is still pending",
        }),
        expect.objectContaining({ id: "seating-warning:0" }),
      ]),
    );
    expect(readiness.issues.every((item) => item.href.length > 0)).toBe(true);
    expect(JSON.stringify(readiness)).not.toContain("Do not expose this note");
  });

  it("uses the checks enabled for a milestone", () => {
    const wedding = plan();
    wedding.readiness.milestones[0]!.check_ids = ["guest_responses"];
    const readiness = buildWeddingReadiness(wedding, "2027-02-01");
    expect(readiness.issues).toEqual([
      expect.objectContaining({
        id: "guest-response:casey",
        check_id: "guest_responses",
      }),
    ]);
  });

});
