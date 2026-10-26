import { describe, expect, it } from "vitest";
import { parseWeddingPlan } from "../src";
import {
  chooseSeatingAlternative,
  compareSeatingAlternatives,
  exportAccessibleFloorPlanSvg,
  exportCateringSummaryCsv,
  exportSeatingAssignmentsCsv,
  removeSeatingAlternative,
  saveSeatingAlternative,
  type TableAllocation,
} from "../src/seating";

function allocation(tableId = "table-1"): TableAllocation {
  return {
    status: "optimal",
    score: { earned: 3, possible: 4 },
    tables: [
      {
        id: tableId,
        name: "Friends",
        capacity: 2,
        guest_ids: ["a"],
        fixed_guests: [],
        seats: [
          {
            index: 0,
            guest_id: "a",
            accessible: true,
            high_chair: false,
            locked: true,
          },
          {
            index: 1,
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
    explanations: [
      {
        guest_id: "a",
        table_id: tableId,
        seat_index: 0,
        factors: ["This assignment is locked"],
      },
    ],
    warnings: [],
  };
}

function plan() {
  return parseWeddingPlan({
    version: 2,
    guests: [
      {
        id: "a",
        name: "Alex Example",
        attendance: "yes",
        dietary_needs: ["vegan"],
        allergies: ["sesame"],
        custom_fields: {},
      },
    ],
    hosts: ["Robin"],
    accommodation: {},
    seating: {
      top_table_capacity: 2,
      table_capacities: [2],
      table_layout: {
        "table-1": {
          name: "Friends",
          x: 250,
          y: 300,
          accessible_seat_indexes: [0],
        },
      },
      venue_elements: [
        {
          id: "dance-floor",
          name: "Dance & floor",
          kind: "dance_floor",
          x: 500,
          y: 300,
          width: 240,
          height: 120,
          rotation: 0,
        },
      ],
    },
  });
}

describe("seating alternatives and handoff exports", () => {
  it("saves, chooses, compares, and removes alternatives without overwriting them", () => {
    const wedding = plan();
    const first = allocation();
    const second = allocation("top");
    second.score.earned = 4;
    saveSeatingAlternative(wedding, first, {
      id: "first",
      name: "First draft",
      created_at: "2026-10-18T12:00:00.000Z",
    });
    saveSeatingAlternative(wedding, second, {
      id: "second",
      name: "Second draft",
      created_at: "2026-10-18T13:00:00.000Z",
    });
    expect(wedding.seating.saved_plans).toHaveLength(2);
    expect(compareSeatingAlternatives(first, second)).toEqual({
      score_change: 1,
      moved_guest_ids: ["a"],
      unsatisfied_change: 0,
    });
    chooseSeatingAlternative(wedding, "second");
    expect(wedding.seating.chosen_plan_id).toBe("second");
    removeSeatingAlternative(wedding, "second");
    expect(wedding.seating.chosen_plan_id).toBe("first");
    expect(parseWeddingPlan(wedding)).toEqual(wedding);
  });

  it("exports assignments, catering counts, and an accessible SVG floor plan", () => {
    const wedding = plan();
    const result = allocation();
    const assignments = exportSeatingAssignmentsCsv(result, wedding.guests);
    expect(assignments).toContain(
      "Friends,1,Alex Example,true,false,true,vegan,sesame",
    );
    expect(exportCateringSummaryCsv(result, wedding.guests)).toContain(
      "Dietary: vegan,1",
    );
    const svg = exportAccessibleFloorPlanSvg(wedding.seating, result);
    expect(svg).toContain('role="img"');
    expect(svg).toContain("Dance &amp; floor");
    expect(svg).toContain("1 accessible");
  });
});
