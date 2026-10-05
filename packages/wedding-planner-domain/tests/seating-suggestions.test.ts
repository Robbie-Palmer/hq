import { describe, expect, it } from "vitest";
import {
  accommodationSeatingSuggestions,
  acceptAccommodationSeatingSuggestions,
  parseWeddingPlan,
  setCouple,
  setTablePairDecision,
  tableInput,
} from "../src";

function plan() {
  return parseWeddingPlan({
    version: 2,
    guests: ["a", "b", "c"].map((id) => ({ id, name: id, attendance: "yes" })),
    hosts: ["Alex", "Sam"],
    accommodation: {
      guests: {
        a: {
          can_share_room: true,
          room_share_mode: "selected",
          may_share_room_with: ["b"],
        },
        b: { can_share_room: true, room_share_mode: "any" },
        c: {},
      },
    },
    seating: { top_table_capacity: 2, table_capacities: [3] },
  });
}

describe("accommodation seating suggestions", () => {
  it("suggests explicit sharing choices with their source without changing seating", () => {
    const wedding = plan();
    wedding.accommodation.guests.b!.may_share_cottage_with = ["a"];
    const seating = structuredClone(wedding.seating);
    expect(accommodationSeatingSuggestions(wedding)).toEqual([
      { guest_ids: ["a", "b"], sources: ["room", "cottage"] },
    ]);
    expect(wedding.seating).toEqual(seating);
    expect(
      tableInput(wedding).guests.every(
        (guest) => !guest.prefer_table_with.length,
      ),
    ).toBe(true);
  });

  it("does not infer preferences from general sharing, bed pairings, or room assignments", () => {
    const wedding = plan();
    wedding.accommodation.guests.a!.may_share_room_with = [];
    for (const guest of Object.values(wedding.accommodation.guests)) {
      guest.room_share_mode = "any";
      guest.fixed_room_id = "same-room";
      guest.fixed_bed_group_id = "same-bed";
    }
    expect(accommodationSeatingSuggestions(wedding)).toEqual([]);
  });

  it.each(["avoid", "disabled", "none"])(
    "respects an opposing %s room choice without creating a seating prohibition",
    (choice) => {
      const wedding = plan();
      const second = wedding.accommodation.guests.b!;
      if (choice === "avoid") second.avoid_room_with = ["a"];
      if (choice === "disabled") second.can_share_room = false;
      if (choice === "none") second.room_share_mode = "none";
      expect(accommodationSeatingSuggestions(wedding)).toEqual([]);
      expect(
        tableInput(wedding).guests.every(
          (guest) => !guest.avoid_table_with.length,
        ),
      ).toBe(true);
    },
  );

  it("leaves explicit seating choices and couples in control", () => {
    const wedding = plan();
    setCouple(wedding, "a", "b");
    expect(accommodationSeatingSuggestions(wedding)).toEqual([]);
    setCouple(wedding, "a", null);
    wedding.seating.preferences.b = {
      prefer_table_with: [],
      avoid_table_with: ["a"],
    };
    acceptAccommodationSeatingSuggestions(wedding);
    expect(wedding.seating.preferences.b.avoid_table_with).toEqual(["a"]);
    expect(wedding.seating.preferences.a).toBeUndefined();
    setTablePairDecision(wedding, "b", "a", "yes");
    expect(accommodationSeatingSuggestions(wedding)).toEqual([]);
  });

  it("accepts suggestions as symmetric soft preferences and retains manual neutrality after reload", () => {
    const wedding = plan();
    const accommodation = structuredClone(wedding.accommodation);
    acceptAccommodationSeatingSuggestions(wedding, ["b", "a"]);
    expect(wedding.seating.preferences.a?.prefer_table_with).toEqual(["b"]);
    expect(wedding.seating.preferences.b?.prefer_table_with).toEqual(["a"]);
    expect(wedding.accommodation).toEqual(accommodation);
    setTablePairDecision(wedding, "b", "a", "unset");
    const reloaded = parseWeddingPlan(JSON.parse(JSON.stringify(wedding)));
    reloaded.accommodation.guests.a!.may_share_cottage_with = ["b", "c"];
    acceptAccommodationSeatingSuggestions(reloaded);
    expect(reloaded.seating.preferences.a?.prefer_table_with).toEqual(["c"]);
    expect(reloaded.seating.preferences.b?.prefer_table_with).toEqual([]);
    expect(reloaded.seating.dismissed_accommodation_suggestions).toEqual([
      ["b", "a"],
    ]);
  });

  it("validates persisted dismissals and defaults older plans to no dismissals", () => {
    const wedding = plan();
    expect(wedding.seating.dismissed_accommodation_suggestions).toEqual([]);
    for (const pair of [
      ["a", "missing"],
      ["a", "a"],
    ]) {
      expect(() =>
        parseWeddingPlan({
          ...wedding,
          seating: {
            ...wedding.seating,
            dismissed_accommodation_suggestions: [pair],
          },
        }),
      ).toThrow("invalid guest");
    }
  });
});
