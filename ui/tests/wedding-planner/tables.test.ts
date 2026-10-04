import { describe, expect, it } from "vitest";
import { createPlannerApplication } from "@/lib/wedding-planner/application";
import { createBrowserWeddingPlanRepository } from "@/lib/wedding-planner/browser-repository";
import {
  editorStateToPlan,
  toEditorState,
} from "@/lib/wedding-planner/editor-projection";
import type { AccommodationSetup } from "@/lib/wedding-planner/setup";
import { solveTables } from "@/lib/wedding-planner/solve-tables";
import { parseState } from "@/lib/wedding-planner/state";
import {
  buildTableInput,
  getTablePlan,
  setTablePairDecision,
} from "@/lib/wedding-planner/table-state";
import type {
  Guest,
  TableAllocation,
  TableInput,
  WeddingPlanDraft,
} from "@/lib/wedding-planner/types";

function guest(id: string, changes: Partial<Guest> = {}): Guest {
  const state = parseState(
    {
      guests: [{ id, name: id, overnight: "unknown" }],
      payment_modes: {},
      cottage_options: {},
      cottage_paid_by_us_gbp: {},
    },
    emptySetup,
  );
  return { ...state.guests[0]!, ...changes };
}

const emptySetup: AccommodationSetup = {
  input: {
    nights: 1,
    venue_lodging_value_gbp: null,
    venue_suite_package_value_gbp: null,
    max_cottage_spend_gbp: null,
    guest_charge_cap_gbp: null,
    optimization_mode: "priority_first",
    properties: [],
    rooms: [],
    parties: [],
  },
};

function input(
  guests: Guest[],
  capacities = [2, 2],
  top: string[] = [],
): TableInput {
  return {
    guests: guests.map((person) => ({
      ...person,
      attendance: person.attendance ?? "unknown",
      wedding_roles: person.wedding_roles ?? [],
      prefer_table_with: person.prefer_table_with ?? [],
      avoid_table_with: person.avoid_table_with ?? [],
    })),
    plan: {
      top_table_capacity: 4,
      top_table_guest_ids: top,
      table_capacities: capacities,
    },
    fixed_top_guests: ["You", "Your fiancé"],
  };
}

function tableFor(result: TableAllocation, id: string): string | undefined {
  return result.tables.find((table) => table.guest_ids.includes(id))?.id;
}

function expectFits(result: TableAllocation, attending: string[]) {
  expect(result.tables.flatMap((table) => table.guest_ids).sort()).toEqual(
    [...attending].sort(),
  );
  for (const table of result.tables)
    expect(
      table.guest_ids.length + table.fixed_guests.length,
    ).toBeLessThanOrEqual(table.capacity);
}

describe("table allocation", () => {
  it("matches an exhaustive optimum while preserving capacity and couple constraints", async () => {
    const guests = [
      guest("a", {
        attendance: "yes",
        partner_id: "b",
        prefer_table_with: ["c", "e"],
      }),
      guest("b", {
        attendance: "yes",
        partner_id: "a",
        prefer_table_with: ["d"],
      }),
      guest("c", {
        attendance: "yes",
        avoid_table_with: ["d"],
        prefer_table_with: ["e"],
      }),
      guest("d", { attendance: "yes", prefer_table_with: ["f"] }),
      guest("e", { attendance: "yes", prefer_table_with: ["f"] }),
      guest("f", { attendance: "yes" }),
    ];
    const wanted = [
      [0, 2],
      [0, 4],
      [1, 3],
      [2, 4],
      [3, 5],
      [4, 5],
    ] as const;
    let best = 0;
    for (let mask = 0; mask < 64; mask++) {
      const placement = guests.map((_, index) => (mask >> index) & 1);
      if (
        placement.filter(Boolean).length !== 3 ||
        placement[0] !== placement[1] ||
        placement[2] === placement[3]
      )
        continue;
      best = Math.max(
        best,
        wanted.filter(
          ([first, second]) => placement[first] === placement[second],
        ).length,
      );
    }
    const result = await solveTables(input(guests, [3, 3]));
    expectFits(
      result,
      guests.map((person) => person.id),
    );
    expect(result.preferences_met).toBe(best);
  });

  it("keeps confirmed couples together, honours one-sided avoid rules, and maximizes preferred pairs", async () => {
    const guests = [
      guest("a", { attendance: "yes", partner_id: "b" }),
      guest("b", { attendance: "yes", partner_id: "a" }),
      guest("c", { attendance: "yes" }),
      guest("d", {
        attendance: "yes",
        prefer_table_with: ["c"],
        avoid_table_with: ["a"],
      }),
    ];
    const result = await solveTables(input(guests));
    expectFits(result, ["a", "b", "c", "d"]);
    expect(tableFor(result, "a")).toBe(tableFor(result, "b"));
    expect(tableFor(result, "c")).toBe(tableFor(result, "d"));
    expect(tableFor(result, "a")).not.toBe(tableFor(result, "d"));
    expect(result.preferences_met).toBe(1);
  });

  it("fixes the top table and seats its members' partners elsewhere", async () => {
    const guests = [
      guest("a", {
        attendance: "yes",
        partner_id: "b",
        prefer_table_with: ["b"],
      }),
      guest("b", { attendance: "yes", partner_id: "a" }),
      guest("c", { attendance: "yes", prefer_table_with: ["a"] }),
    ];
    const result = await solveTables(input(guests, [1], ["a", "c"]));
    expectFits(result, ["a", "b", "c"]);
    expect(result.tables[0]?.fixed_guests).toEqual(["You", "Your fiancé"]);
    expect(tableFor(result, "a")).toBe("top");
    expect(tableFor(result, "c")).toBe("top");
    expect(tableFor(result, "b")).toBe("table-1");
    expect(result.preferences_met).toBe(1);
    expect(result.unmet_preferences).toEqual([["a", "b"]]);
  });

  it("uses wedding attendance independently of overnight choices", async () => {
    const guests = [
      guest("day", { attendance: "yes", overnight: "no" }),
      guest("not-coming", { attendance: "no", overnight: "yes" }),
      guest("undecided", { overnight: "yes" }),
    ];
    const result = await solveTables(input(guests, [1]));
    expectFits(result, ["day"]);
    expect(result.status).toBe("provisional");
    expect(result.warnings[0]).toContain("1 wedding attendance");
  });

  it("reports unmet preferences without weakening hard rules", async () => {
    const guests = [
      guest("a", { attendance: "yes", prefer_table_with: ["b", "c"] }),
      guest("b", {
        attendance: "yes",
        prefer_table_with: ["a"],
        avoid_table_with: ["c"],
      }),
      guest("c", { attendance: "yes" }),
    ];
    const result = await solveTables(input(guests));
    expect(result.preferences_total).toBe(2);
    expect(result.preferences_met).toBe(1);
    expect(result.unmet_preferences).toHaveLength(1);
    expect(tableFor(result, "b")).not.toBe(tableFor(result, "c"));
  });

  it("respects unequal capacities and improves preferred seating when capacity changes", async () => {
    const guests = [
      guest("a", {
        attendance: "yes",
        partner_id: "b",
        prefer_table_with: ["c"],
      }),
      guest("b", { attendance: "yes", partner_id: "a" }),
      guest("c", { attendance: "yes" }),
    ];
    const small = await solveTables(input(guests, [1, 2]));
    expectFits(small, ["a", "b", "c"]);
    expect(tableFor(small, "a")).toBe("table-2");
    expect(small.preferences_met).toBe(0);
    const larger = await solveTables(input(guests, [1, 3]));
    expectFits(larger, ["a", "b", "c"]);
    expect(larger.preferences_met).toBe(1);
  });

  it("handles a top-table-only wedding", async () => {
    const result = await solveTables(
      input([guest("a", { attendance: "yes" })], [], ["a"]),
    );
    expectFits(result, ["a"]);
    expect(result.tables).toHaveLength(1);
  });

  it("balances guest table sizes without sacrificing preferences", async () => {
    const guests = Array.from({ length: 8 }, (_, index) =>
      guest(String(index), { attendance: "yes" }),
    );
    const result = await solveTables(input(guests, [8, 8, 8]));
    expect(
      result.tables
        .slice(1)
        .map((table) => table.guest_ids.length)
        .sort(),
    ).toEqual([2, 3, 3]);
  });

  it.each([
    {
      name: "not enough seats",
      guests: [
        guest("a", { attendance: "yes" }),
        guest("b", { attendance: "yes" }),
      ],
      capacities: [1],
      top: [],
      message: "only 1",
    },
    {
      name: "couple cannot fit",
      guests: [
        guest("a", { attendance: "yes", partner_id: "b" }),
        guest("b", { attendance: "yes", partner_id: "a" }),
      ],
      capacities: [1, 1],
      top: [],
      message: "No table plan fits",
    },
    {
      name: "conflicting top table",
      guests: [
        guest("a", { attendance: "yes" }),
        guest("b", { attendance: "yes", avoid_table_with: ["a"] }),
      ],
      capacities: [],
      top: ["a", "b"],
      message: "both fixed at the top table",
    },
    {
      name: "conflicting couple",
      guests: [
        guest("a", { attendance: "yes", partner_id: "b" }),
        guest("b", {
          attendance: "yes",
          partner_id: "a",
          avoid_table_with: ["a"],
        }),
      ],
      capacities: [2],
      top: [],
      message: "confirmed couple with a keep-apart rule",
    },
    {
      name: "keep-apart rules need more tables",
      guests: [
        guest("a", { attendance: "yes" }),
        guest("b", { attendance: "yes", avoid_table_with: ["a"] }),
      ],
      capacities: [2],
      top: [],
      message: "No table plan fits",
    },
    {
      name: "top table attendance undecided",
      guests: [guest("a")],
      capacities: [2],
      top: ["a"],
      message: "Confirm a is attending",
    },
  ])("explains $name", async ({ guests, capacities, top, message }) => {
    await expect(solveTables(input(guests, capacities, top))).rejects.toThrow(
      message,
    );
  });

  it("counts the wedding couple against top table capacity", async () => {
    const plan = input(
      [
        guest("a", { attendance: "yes" }),
        guest("b", { attendance: "yes" }),
        guest("c", { attendance: "yes" }),
      ],
      [],
      ["a", "b", "c"],
    );
    await expect(solveTables(plan)).rejects.toThrow(
      "exceeds the top table capacity",
    );
  });
});

describe("shared table state", () => {
  function state(): WeddingPlanDraft {
    return parseState(
      {
        guests: [
          { id: "a", name: "a", overnight: "yes" },
          { id: "b", name: "b", overnight: "no" },
        ],
        payment_modes: {},
        cottage_options: {},
        cottage_paid_by_us_gbp: {},
      },
      emptySetup,
    );
  }

  it("opens older plans without assuming overnight attendance or table preferences", () => {
    const legacy = state();
    expect(
      legacy.guests.every((person) => person.attendance === undefined),
    ).toBe(true);
    expect(legacy.table_plan).toBeUndefined();
    expect(getTablePlan(legacy).table_capacities).toEqual([8]);
    expect(buildTableInput(legacy).guests.map((person) => person.id)).toEqual(
      legacy.guests.map((person) => person.id),
    );
  });

  it("saves and reloads seating choices alongside accommodation", async () => {
    const plan = state();
    plan.guests[0]!.attendance = "yes";
    plan.table_plan = {
      top_table_capacity: 3,
      top_table_guest_ids: ["a"],
      table_capacities: [6, 8],
      table_layout: {
        top: {
          name: "Wedding party",
          shape: "long",
          x: 450,
          y: 120,
          rotation: 90,
        },
        "table-1": { name: "Dublin", shape: "round", x: 250, y: 400 },
      },
    };
    setTablePairDecision(plan, "a", "b", "yes");
    const source = createPlannerApplication(
      createBrowserWeddingPlanRepository(
        window.localStorage,
        "table-test",
        [],
        emptySetup,
      ),
      emptySetup,
    );
    try {
      await source.save(plan);
      const reloaded = await source.load();
      expect(reloaded).toEqual(toEditorState(editorStateToPlan(plan)));
      expect(reloaded?.table_plan?.table_layout).toEqual(
        plan.table_plan.table_layout,
      );
      setTablePairDecision(plan, "a", "b", "no");
      expect(plan.guests[0]?.prefer_table_with).toEqual([]);
      expect(plan.guests[1]?.avoid_table_with).toEqual(["a"]);
    } finally {
      window.localStorage.removeItem("table-test");
    }
  });

  it("rejects malformed table plans and unknown or self-referencing guest links", () => {
    const plan = state();
    plan.table_plan = {
      top_table_capacity: 4,
      top_table_guest_ids: ["missing"],
      table_capacities: [8],
    };
    expect(() => parseState(plan, emptySetup)).toThrow("unknown guest");
    plan.table_plan.top_table_guest_ids = ["a", "a"];
    expect(() => parseState(plan, emptySetup)).toThrow("unique");
    plan.table_plan.top_table_guest_ids = [];
    plan.table_plan.table_capacities = [0];
    expect(() => parseState(plan, emptySetup)).toThrow("not a compatible");
    delete plan.table_plan;
    plan.guests[0]!.prefer_table_with = ["a"];
    expect(() => parseState(plan, emptySetup)).toThrow("invalid guest");
  });
});
