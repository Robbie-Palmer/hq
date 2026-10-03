import { describe, expect, it, vi } from "vitest";
import {
  accommodationState,
  confirmCoupleSharingBed,
  createWeddingPlannerApplication,
  markNotCouple,
  parseWeddingPlan,
  setAttendance,
  setCouple,
  setTablePairDecision,
  setTopTableGuest,
  setWeddingRoles,
  seatAttendingWeddingParty,
  isWeddingPartyMember,
  tableInput,
  type WeddingPlan,
  type WeddingPlanRepository,
} from "../src";
import {
  buildInput,
  setOwnBed,
  type AccommodationSetup,
  type RoomAllocator,
} from "../src/accommodation";
import { prepareTableProblem, type TableAllocator } from "../src/seating";

function plan(): WeddingPlan {
  return parseWeddingPlan({
    version: 2,
    guests: ["a", "b", "c"].map((id) => ({ id, name: id, attendance: "yes" })),
    hosts: ["Alex", "Sam"],
    accommodation: {
      guests: {
        a: { overnight: "yes", free_stay_reasons: ["immediate_family"] },
        b: { overnight: "yes" },
      },
    },
    seating: { top_table_capacity: 4, table_capacities: [2, 2] },
  });
}

function setup(): AccommodationSetup {
  return {
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
}

describe("shared wedding domain", () => {
  it("preserves table appearance through validation and copies it into solver input", () => {
    const wedding = parseWeddingPlan({
      ...plan(),
      seating: {
        ...plan().seating,
        table_layout: {
          top: {
            name: "Wedding party",
            shape: "long",
            x: 500,
            y: 110,
            rotation: 35.5,
          },
          "table-1": { name: "Dublin", shape: "round" },
        },
      },
    });
    const input = tableInput(wedding);
    expect(input.plan.table_layout).toEqual(wedding.seating.table_layout);
    expect(input.plan.table_layout).not.toBe(wedding.seating.table_layout);
    if (input.plan.table_layout?.top)
      input.plan.table_layout.top.name = "Changed";
    expect(wedding.seating.table_layout?.top?.name).toBe("Wedding party");
    expect(() =>
      parseWeddingPlan({
        ...wedding,
        seating: {
          ...wedding.seating,
          table_layout: { top: { rotation: 360 } },
        },
      }),
    ).toThrow();
  });

  it.each([
    ["10", "2"],
    ["\u00e9", "e\u0301"],
  ])(
    "keeps opaque IDs %s and %s in one couple regardless of selection order",
    (first, second) => {
      const wedding = parseWeddingPlan({
        ...plan(),
        guests: [first, second].map((id) => ({
          id,
          name: id,
          attendance: "yes",
        })),
        accommodation: {},
      });
      setCouple(wedding, first, second);
      const couple = structuredClone(wedding.couples[0]);
      setCouple(wedding, second, first);
      expect(wedding.couples).toEqual([couple]);
      const groups = prepareTableProblem(tableInput(wedding)).groups;
      expect(groups).toHaveLength(1);
      expect(groups[0]?.map((guest) => guest.id)).toEqual([first, second]);
    },
  );
  it("records multiple roles independently of accommodation and top-table seats", () => {
    const wedding = plan();
    const originalAccommodation = structuredClone(wedding.accommodation);
    setWeddingRoles(wedding, "a", ["bridesmaid", "parent_of_groom"]);
    expect(wedding.guests[0]?.wedding_roles).toEqual([
      "bridesmaid",
      "parent_of_groom",
    ]);
    expect(isWeddingPartyMember(wedding.guests[0]!)).toBe(true);
    expect(wedding.seating.top_table_guest_ids).toEqual([]);
    expect(wedding.accommodation).toEqual(originalAccommodation);
    setTopTableGuest(wedding, "a", true);
    setAttendance(wedding, "a", "no");
    expect(wedding.guests[0]?.wedding_roles).toEqual([
      "bridesmaid",
      "parent_of_groom",
    ]);
    expect(wedding.seating.top_table_guest_ids).toEqual([]);
  });

  it("adds attending wedding-party members without losing manually selected parents", () => {
    const wedding = plan();
    setWeddingRoles(wedding, "a", ["parent_of_bride"]);
    setWeddingRoles(wedding, "b", ["groomsman"]);
    setWeddingRoles(wedding, "c", ["maid_of_honour"]);
    setAttendance(wedding, "c", "unknown");
    setTopTableGuest(wedding, "a", true);
    seatAttendingWeddingParty(wedding);
    seatAttendingWeddingParty(wedding);
    expect(wedding.seating.top_table_guest_ids).toEqual(["a", "b"]);
    expect(isWeddingPartyMember(wedding.guests[0]!)).toBe(false);
  });

  it("rejects duplicate roles and leaves the guest's existing roles intact", () => {
    const wedding = plan();
    setWeddingRoles(wedding, "a", ["best_man"]);
    expect(() =>
      setWeddingRoles(wedding, "a", ["bridesmaid", "bridesmaid"]),
    ).toThrow("unique");
    expect(wedding.guests[0]?.wedding_roles).toEqual(["best_man"]);
    expect(() =>
      parseWeddingPlan({
        ...wedding,
        guests: [{ ...wedding.guests[0], wedding_roles: ["invented_role"] }],
      }),
    ).toThrow("wedding_roles");
  });

  it("keeps a couple together at a table when their accommodation uses separate beds", () => {
    const wedding = plan();
    setCouple(wedding, "a", "b");
    const roomInput = buildInput(accommodationState(wedding), setup()).input;
    expect(roomInput.parties.map((party) => party.id)).toEqual(["a", "b"]);
    expect(
      prepareTableProblem(tableInput(wedding)).groups.map((group) =>
        group.map((guest) => guest.id),
      ),
    ).toEqual([["a", "b"], ["c"]]);
    expect(wedding.accommodation.guests.a?.fixed_bed_group_id).toBe("");
    expect(tableInput(wedding).guests[0]).not.toHaveProperty(
      "fixed_bed_group_id",
    );
  });

  it("preserves couple identity when a shared bed is split", () => {
    const wedding = plan();
    confirmCoupleSharingBed(wedding, "a", "b");
    const rooms = accommodationState(wedding);
    setOwnBed(rooms, "a", true);
    expect(rooms.guests.map((guest) => guest.fixed_bed_group_id)).toEqual([
      "",
      "",
      "",
    ]);
    expect(rooms.guests[0]?.requires_own_bed).toBe(true);
    expect(wedding.couples[0]?.guest_ids).toEqual(["a", "b"]);
  });

  it("covers a recorded partner even when they are in another bed group", () => {
    const wedding = plan();
    setCouple(wedding, "a", "b");
    const input = buildInput(accommodationState(wedding), setup()).input;
    expect(
      input.parties.find((party) => party.id === "b")?.free_guest_indexes,
    ).toEqual([0]);
    wedding.accommodation.guests.a!.include_partner_in_free_stay = false;
    expect(
      buildInput(accommodationState(wedding), setup()).input.parties.find(
        (party) => party.id === "b",
      )?.free_guest_indexes,
    ).toEqual([]);
  });

  it("allows a partner to sit elsewhere when the other is fixed at the top table", () => {
    const wedding = plan();
    setCouple(wedding, "a", "b");
    setTopTableGuest(wedding, "a", true);
    expect(
      prepareTableProblem(tableInput(wedding)).groups.map((group) =>
        group.map((guest) => guest.id),
      ),
    ).toEqual([["b"], ["c"]]);
  });

  it("removes a wedding party seat when attendance changes", () => {
    const wedding = plan();
    setTopTableGuest(wedding, "a", true);
    setAttendance(wedding, "a", "unknown");
    expect(wedding.seating.top_table_guest_ids).toEqual([]);
    expect(() => setTopTableGuest(wedding, "a", true)).toThrow("Confirm");
    expect(
      prepareTableProblem(tableInput(wedding)).unknown.map((guest) => guest.id),
    ).toEqual(["a"]);
  });

  it("rejects contradictory keep-apart rules on couples and the fixed top table", () => {
    const wedding = plan();
    setCouple(wedding, "a", "b");
    setTablePairDecision(wedding, "a", "b", "no");
    expect(() => prepareTableProblem(tableInput(wedding))).toThrow(
      "confirmed couple",
    );
    setTopTableGuest(wedding, "a", true);
    setTopTableGuest(wedding, "b", true);
    expect(() => prepareTableProblem(tableInput(wedding))).toThrow(
      "both fixed at the top table",
    );
  });

  it("updates seating preferences symmetrically without changing accommodation", () => {
    const wedding = plan();
    const original = structuredClone(wedding.accommodation);
    setTablePairDecision(wedding, "a", "b", "yes");
    setTablePairDecision(wedding, "a", "b", "no");
    expect(wedding.seating.preferences.a).toEqual({
      prefer_table_with: [],
      avoid_table_with: ["b"],
    });
    expect(wedding.seating.preferences.b).toEqual({
      prefer_table_with: [],
      avoid_table_with: ["a"],
    });
    setTablePairDecision(wedding, "a", "b", "unset");
    expect(wedding.seating.preferences.a?.avoid_table_with).toEqual([]);
    expect(wedding.accommodation).toEqual(original);
  });

  it("rejects overlapping relationships before altering the existing couple", () => {
    const wedding = plan();
    setCouple(wedding, "a", "b");
    expect(() => setCouple(wedding, "c", "b")).toThrow("already has a partner");
    expect(wedding.couples).toHaveLength(1);
    markNotCouple(wedding, "a", "b", true);
    expect(wedding.couples).toEqual([]);
    setCouple(wedding, "a", "b");
    expect(wedding.reviewed_non_couples).toEqual([]);
  });

  it.each([
    { couples: [{ id: "ab", guest_ids: ["a", "missing"] }] },
    { couples: [{ id: "aa", guest_ids: ["a", "a"] }] },
    {
      couples: [
        { id: "ab", guest_ids: ["a", "b"] },
        { id: "bc", guest_ids: ["b", "c"] },
      ],
    },
    {
      seating: {
        top_table_capacity: 4,
        table_capacities: [2],
        top_table_guest_ids: ["missing"],
      },
    },
    {
      seating: {
        top_table_capacity: 4,
        table_capacities: [2],
        preferences: { a: { avoid_table_with: ["missing"] } },
      },
    },
  ])("rejects invalid references in canonical plans: %j", (invalid) => {
    expect(() => parseWeddingPlan({ ...plan(), ...invalid })).toThrow();
  });

  it("rejects asymmetric couples supplied directly to a seating allocator", () => {
    const input = tableInput(plan());
    input.guests[0]!.partner_id = "b";
    expect(() => prepareTableProblem(input)).toThrow("mutual partner");
  });
});

describe("wedding application ports", () => {
  it("uses injected persistence and both allocators with feature-specific inputs", async () => {
    const wedding = plan();
    setCouple(wedding, "a", "b");
    const repository: WeddingPlanRepository = {
      load: vi.fn().mockResolvedValue(wedding),
      save: vi.fn().mockResolvedValue(undefined),
    };
    const rooms: RoomAllocator = {
      solve: vi.fn().mockResolvedValue({
        status: "optimal",
        stages: [],
        rooms: {},
        shared_beds: [],
        single_bed_assignments: [],
        outside_parties: ["a", "b"],
        booked_cottages: [],
      }),
    };
    const tables: TableAllocator = {
      solve: vi.fn().mockResolvedValue({
        status: "optimal",
        tables: [],
        preferences_met: 0,
        preferences_total: 0,
        unmet_preferences: [],
        warnings: [],
      }),
    };
    const application = createWeddingPlannerApplication(
      repository,
      setup(),
      rooms,
      tables,
    );
    expect(await application.load()).toEqual(wedding);
    await application.save(wedding);
    expect(repository.save).toHaveBeenCalledWith(wedding);
    await application.calculateTables(wedding);
    expect(tables.solve).toHaveBeenCalledWith(tableInput(wedding));
    expect(rooms.solve).not.toHaveBeenCalled();
    await application.calculateRooms(wedding);
    expect(rooms.solve).toHaveBeenCalledWith(
      expect.objectContaining({
        parties: expect.arrayContaining([
          expect.objectContaining({ id: "a" }),
          expect.objectContaining({ id: "b" }),
        ]),
      }),
    );
  });

  it("can calculate seating without satisfying accommodation requirements", async () => {
    const inventory = setup();
    inventory.fixedNights = 2;
    const rooms: RoomAllocator = { solve: vi.fn() };
    const tables: TableAllocator = {
      solve: vi.fn().mockResolvedValue({
        status: "optimal",
        tables: [],
        preferences_met: 0,
        preferences_total: 0,
        unmet_preferences: [],
        warnings: [],
      }),
    };
    const application = createWeddingPlannerApplication(
      { load: async () => null, save: async () => {} },
      inventory,
      rooms,
      tables,
    );
    await application.calculateTables(plan());
    expect(tables.solve).toHaveBeenCalledOnce();
    await expect(application.calculateRooms(plan())).rejects.toThrow("2 night");
    expect(rooms.solve).not.toHaveBeenCalled();
  });
});
