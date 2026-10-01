import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResultPlan } from "@/components/wedding-planner/result-plan";
import { browserPlannerSource } from "@/lib/wedding-planner/browser-source";
import { calculateRooms } from "@/lib/wedding-planner/calculate";
import type { AccommodationSetup } from "@/lib/wedding-planner/setup";
import {
  markNotCouple,
  pairDecision,
  setOwnBed,
  setPairDecision,
  setPartner,
  setShareMode,
} from "@/lib/wedding-planner/sharing";
import { buildInput, parseState } from "@/lib/wedding-planner/state";
import type { Guest, State } from "@/lib/wedding-planner/types";

function guest(id: string, changes: Partial<Guest> = {}): Guest {
  return {
    id,
    name: id,
    source_party: "",
    tags: "",
    overnight: "yes",
    fixed_bed_group_id: "",
    requires_own_bed: false,
    safe_for_our_booking: true,
    may_share_bed_with: [],
    avoid_bed_with: [],
    can_share_room: false,
    room_share_mode: "none",
    may_share_room_with: [],
    can_share_cottage: true,
    cottage_share_mode: "any",
    may_share_cottage_with: [],
    avoid_room_with: [],
    avoid_cottage_with: [],
    priority: 3,
    fixed_room_id: "",
    preferred_property_ids: [],
    outside_cost_gbp: "",
    charge_cap_exempt: false,
    free_stay_reasons: [],
    include_partner_in_free_stay: true,
    ...changes,
  };
}

function plan(guests: Guest[], changes: Partial<State> = {}): State {
  return {
    nights: 1,
    guests,
    payment_modes: {
      venue: "couple",
      black_sheep: "guests",
      river_side: "guests",
      linen: "guests",
    },
    cottage_options: {
      black_sheep: { availability: "unavailable", booking_by: "couple" },
      river_side: { availability: "unavailable", booking_by: "couple" },
    },
    cottage_paid_by_us_gbp: { black_sheep: "0", river_side: "0", linen: "150" },
    reservations: {
      linen_1: {
        guest_ids: ["linen-a", "linen-b"],
        approved_guest_ids: [],
      },
    },
    reviewed_non_couples: [],
    suite_billing_modes: {},
    guest_charge_cap_gbp: "",
    max_cottage_spend_gbp: "",
    default_outside_cost_gbp: "",
    optimization_mode: "priority_first",
    ...changes,
  };
}

function linenCouple(): Guest[] {
  return [
    guest("linen-a", {
      fixed_bed_group_id: "linen-a",
      fixed_room_id: "linen_1",
      free_stay_reasons: ["immediate_family"],
    }),
    guest("linen-b", {
      fixed_bed_group_id: "linen-a",
      fixed_room_id: "linen_1",
    }),
  ];
}

describe("wedding planner accommodation", () => {
  it("allocates and prices an injected inventory with different property IDs", async () => {
    const setup: AccommodationSetup = {
      input: {
        nights: 1,
        venue_lodging_value_gbp: null,
        venue_suite_package_value_gbp: null,
        max_cottage_spend_gbp: null,
        guest_charge_cap_gbp: null,
        optimization_mode: "priority_first",
        properties: [
          {
            id: "hall",
            name: "Hall rooms",
            kind: "venue",
            booking_cost_gbp: 0,
          },
          {
            id: "annex",
            name: "Annex",
            kind: "cottage",
            rate_per_night_gbp: 321,
          },
        ],
        rooms: [
          {
            id: "hall-room",
            name: "Hall room",
            property_id: "hall",
            double_beds: 1,
            rate_per_night_gbp: 123,
          },
          { id: "annex-room", property_id: "annex", double_beds: 1 },
        ],
        parties: [],
      },
    };
    const state = plan(
      [guest("a", { priority: 4 }), guest("b", { priority: 3 })],
      {
        nights: 2,
        payment_modes: { hall: "guests", annex: "guests" },
        cottage_options: {
          annex: { availability: "available", booking_by: "couple" },
        },
        cottage_paid_by_us_gbp: { annex: "0" },
        reservations: {},
      },
    );

    const { result } = await calculateRooms(state, setup);

    expect(result.rooms["hall-room"]).toEqual(["a"]);
    expect(result.rooms["annex-room"]).toEqual(["b"]);
    expect(result.billing.by_property.hall?.quoted_pence).toBe(24_600);
    expect(result.billing.by_property.annex?.quoted_pence).toBe(64_200);
    const html = renderToStaticMarkup(
      createElement(ResultPlan, {
        allocation: result,
        parties: [
          { id: "a", guests: ["a"], free_guest_indexes: [] },
          { id: "b", guests: ["b"], free_guest_indexes: [] },
        ],
        report: "",
        setup,
      }),
    );
    expect(html).toContain("Hall rooms");
    expect(html).toContain("Hall room");
    expect(html).toContain("Annex");
  });

  it("names both unknown cottage and outside costs in the result", async () => {
    const setup: AccommodationSetup = {
      input: {
        nights: 1,
        venue_lodging_value_gbp: null,
        venue_suite_package_value_gbp: null,
        max_cottage_spend_gbp: null,
        guest_charge_cap_gbp: null,
        optimization_mode: "priority_first",
        properties: [{ id: "annex", name: "Annex", kind: "cottage" }],
        rooms: [{ id: "annex-room", property_id: "annex", double_beds: 1 }],
        parties: [],
      },
    };
    const state = plan(
      [
        guest("a", { name: "Avery", priority: 4 }),
        guest("b", { name: "Beryl", priority: 3 }),
      ],
      {
        payment_modes: { annex: "guests" },
        cottage_options: {
          annex: { availability: "available", booking_by: "couple" },
        },
        cottage_paid_by_us_gbp: { annex: "0" },
        reservations: {},
      },
    );
    const { result, parties } = await calculateRooms(state, setup);
    expect(result.unknown_costs).toEqual([
      { kind: "cottage", id: "annex" },
      { kind: "outside", id: "b" },
    ]);
    const html = renderToStaticMarkup(
      createElement(ResultPlan, {
        allocation: result,
        parties,
        report: "",
        setup,
      }),
    );
    expect(html).toContain("Prices still needed for: Annex, Beryl");
    expect(html).not.toContain("annex cottage booking");
  });

  it("copies a saved wedding rooms plan to the wedding planner key", async () => {
    const legacy = {
      ...plan(linenCouple()),
      reservations: undefined,
      linen_guest_ids: ["linen-a", "linen-b"],
      linen_approved_guest_ids: [],
    };
    window.localStorage.clear();
    try {
      window.localStorage.setItem(
        "wedding-rooms:plan:v1",
        JSON.stringify(legacy),
      );
      expect(await browserPlannerSource.load()).toEqual(parseState(legacy));
      expect(
        JSON.parse(
          window.localStorage.getItem("wedding-planner:plan:v1") ?? "null",
        ),
      ).toEqual(parseState(legacy));
    } finally {
      window.localStorage.clear();
    }
  });

  it("explains why an unrelated JSON file cannot be imported", () => {
    expect(() => parseState({})).toThrow(
      "not a compatible wedding planner plan",
    );
  });

  it("rejects unsupported saved choices before building a plan", () => {
    const state = plan(linenCouple());
    expect(() =>
      parseState({
        ...state,
        suite_billing_modes: { riverside_double_1: "per_person" },
      }),
    ).toThrow("suite_billing_modes");
    expect(() =>
      parseState({ ...state, optimization_mode: "nearest_first" }),
    ).toThrow("optimization_mode");
    expect(() =>
      parseState({ ...state, payment_modes: { venue: "family" } }),
    ).toThrow("payment_modes");
  });

  it.each(["10.005", "100000000000.005", "-1", "abc"])(
    "rejects invalid money %s before allocation",
    (amount) => {
      expect(() =>
        parseState(
          plan([
            ...linenCouple(),
            guest("visitor", { outside_cost_gbp: amount }),
          ]),
        ),
      ).toThrow("two decimal places");
    },
  );

  it("validates optional cost limits when loading a plan", () => {
    const state = plan(linenCouple());
    expect(() =>
      parseState({ ...state, default_outside_cost_gbp: "10.005" }),
    ).toThrow("Default outside cost");
    expect(() =>
      parseState({ ...state, max_cottage_spend_gbp: "abc" }),
    ).toThrow("Maximum cottage spend");
    expect(() => parseState({ ...state, guest_charge_cap_gbp: "-1" })).toThrow(
      "Guest charge cap",
    );
  });

  it("gives a free guest's bed partner a free stay by default", () => {
    const { input } = buildInput(plan(linenCouple()));
    expect(
      input.parties.find((party) => party.id === "linen-a")?.free_guest_indexes,
    ).toEqual([0, 1]);
  });

  it("requires both singles to agree to share a bed", () => {
    const secondSingle = guest("b");
    const guests = [
      ...linenCouple(),
      guest("a", { may_share_bed_with: ["b"] }),
      secondSingle,
    ];
    expect(
      buildInput(plan(guests)).input.parties.find((party) => party.id === "a")
        ?.can_share_bed_with,
    ).toEqual([]);
    secondSingle.may_share_bed_with = ["a"];
    expect(
      buildInput(plan(guests)).input.parties.find((party) => party.id === "a")
        ?.can_share_bed_with,
    ).toEqual(["b"]);
  });

  it("splits a booked cottage by occupied bedroom and accounts for its deposit", async () => {
    const guests = [
      ...linenCouple(),
      guest("visitor", { fixed_room_id: "linen_2" }),
    ];
    const state = plan(guests, {
      reservations: {
        linen_1: {
          guest_ids: ["linen-a", "linen-b"],
          approved_guest_ids: ["visitor"],
        },
      },
    });
    const result = await calculateRooms(parseState(state));
    expect(result.result.billing.by_property.linen).toEqual({
      quoted_pence: 22500,
      guest_pence: 11250,
      covered_pence: 11250,
    });
    expect(result.result.cash_flow.by_property.linen).toEqual({
      rent_pence: 22500,
      already_paid_pence: 15000,
      still_to_pay_pence: 7500,
      guest_reimbursements_pence: 11250,
      our_final_cost_pence: 11250,
    });
  });

  it("keeps selected sharing choices limited to each agreed bed group", () => {
    const state = plan([
      ...linenCouple(),
      guest("a", { room_share_mode: "selected", can_share_room: true }),
      guest("b", { room_share_mode: "selected", can_share_room: true }),
      guest("c", { room_share_mode: "selected", can_share_room: true }),
    ]);
    setPairDecision(state, "room", "a", "b", "yes");
    expect(
      pairDecision(
        state,
        { id: "a", name: "a", guestIds: ["a"] },
        { id: "b", name: "b", guestIds: ["b"] },
        "room",
      ),
    ).toBe("yes");
    expect(
      pairDecision(
        state,
        { id: "a", name: "a", guestIds: ["a"] },
        { id: "c", name: "c", guestIds: ["c"] },
        "room",
      ),
    ).toBe("unset");
    expect(
      buildInput(state).input.parties.find((party) => party.id === "a")
        ?.allowed_room_mates,
    ).toEqual(["b"]);
    setShareMode(state, "a", "room", "none");
    expect(
      state.guests.find((member) => member.id === "b")?.may_share_room_with,
    ).toEqual([]);
  });

  it("requires reciprocal sharing and clears bed links for an own-bed guest", () => {
    const state = plan([
      ...linenCouple(),
      guest("a", { may_share_bed_with: ["b"] }),
      guest("b", { may_share_bed_with: ["a"] }),
      guest("not-staying", { overnight: "no" }),
    ]);
    const a = { id: "a", name: "a", guestIds: ["a"] };
    const b = { id: "b", name: "b", guestIds: ["b"] };

    expect(pairDecision(state, a, b, "bed")).toBe("yes");
    setOwnBed(state, "not-staying", true);
    expect(
      state.guests.find((person) => person.id === "not-staying")
        ?.requires_own_bed,
    ).toBe(false);
    setOwnBed(state, "a", true);
    expect(pairDecision(state, a, b, "bed")).toBe("unset");
    expect(
      state.guests.find((person) => person.id === "b")?.may_share_bed_with,
    ).toEqual([]);
    setPairDecision(state, "bed", "a", "b", "yes");
    expect(pairDecision(state, a, b, "bed")).toBe("unset");
    setOwnBed(state, "a", false);
    setPairDecision(state, "bed", "a", "b", "no");
    expect(pairDecision(state, a, b, "bed")).toBe("no");
    setPairDecision(state, "bed", "a", "b", "unset");
    expect(pairDecision(state, a, b, "bed")).toBe("unset");
  });

  it("updates Linen approvals from the cottage sharing map", () => {
    const state = plan([...linenCouple(), guest("visitor"), guest("other")]);
    const linen = {
      id: "linen-a",
      name: "Linen",
      guestIds: ["linen-a", "linen-b"],
    };
    const visitor = { id: "visitor", name: "visitor", guestIds: ["visitor"] };

    setPairDecision(state, "cottage", "visitor", "linen-a", "yes");
    expect(state.reservations.linen_1?.approved_guest_ids).toEqual(["visitor"]);
    expect(pairDecision(state, linen, visitor, "cottage")).toBe("yes");
    setPairDecision(state, "cottage", "linen-a", "visitor", "no");
    expect(state.reservations.linen_1?.approved_guest_ids).toEqual([]);
    expect(pairDecision(state, linen, visitor, "cottage")).toBe("no");
    setPairDecision(state, "cottage", "linen-a", "visitor", "yes");
    setShareMode(state, "visitor", "cottage", "none");
    expect(state.reservations.linen_1?.approved_guest_ids).toEqual([]);
    expect(pairDecision(state, linen, visitor, "cottage")).toBe("unset");
  });

  it("pairs and unpairs guests while respecting own-bed choices", () => {
    const state = plan([
      ...linenCouple(),
      guest("a", { may_share_bed_with: ["b"] }),
      guest("b", { may_share_bed_with: ["a"] }),
      guest("c", { requires_own_bed: true }),
    ]);
    markNotCouple(state, "a", "b", true);
    setPartner(state, "a", "c");
    expect(
      state.guests.find((person) => person.id === "a")?.fixed_bed_group_id,
    ).toBe("");
    setPartner(state, "a", "b");
    expect(
      state.guests.filter((person) => person.fixed_bed_group_id === "a"),
    ).toHaveLength(2);
    expect(state.reviewed_non_couples).toEqual([]);
    expect(
      state.guests.find((person) => person.id === "b")?.may_share_bed_with,
    ).toEqual([]);
    setPartner(state, "a", "");
    expect(
      state.guests.find((person) => person.id === "a")?.fixed_bed_group_id,
    ).toBe("");
    expect(
      state.guests.find((person) => person.id === "b")?.fixed_bed_group_id,
    ).toBe("");
  });

  it("uses the Black Sheep single bed for two singles in its third bedroom", async () => {
    const state = plan(
      [
        ...linenCouple(),
        guest("one", {
          fixed_room_id: "black_sheep_3",
          room_share_mode: "any",
          can_share_room: true,
        }),
        guest("two", {
          fixed_room_id: "black_sheep_3",
          room_share_mode: "any",
          can_share_room: true,
        }),
      ],
      {
        cottage_options: {
          black_sheep: { availability: "available", booking_by: "couple" },
          river_side: { availability: "unavailable", booking_by: "couple" },
        },
      },
    );
    const result = await calculateRooms(state);
    expect(result.result.rooms.black_sheep_3).toEqual(
      expect.arrayContaining(["one", "two"]),
    );
    expect(result.result.single_bed_assignments).toHaveLength(1);
    expect(result.result.billing.by_property.black_sheep?.quoted_pence).toBe(
      40500,
    );
  });
});
