import {
  parseWeddingPlan,
  type WeddingPlan,
  type WeddingRole,
} from "wedding-planner-domain";

function sampleOvernight(
  id: string,
  dayGuests: Set<string>,
  uncertain: Set<string>,
) {
  if (dayGuests.has(id)) return "no";
  if (uncertain.has(id)) return "unknown";
  return "yes";
}

function samplePriority(
  id: string,
  roles: WeddingRole[],
  parents: Set<string>,
) {
  if (parents.has(id)) return 5;
  if (roles.length) return 4;
  return 2;
}

function sampleSharingPair(
  id: string,
  first: string,
  second: string,
): string[] {
  if (id === first) return [second];
  if (id === second) return [first];
  return [];
}

/** Fictional guests for trying both planners, with no personal guest information. */
export function createSampleWeddingPlan(): WeddingPlan {
  const people: [string, string, WeddingRole[]][] = [
    ["alex", "Alex Bennett", ["parent_of_bride"]],
    ["blair", "Blair Bennett", ["parent_of_bride"]],
    ["chris", "Chris Ellis", ["parent_of_groom"]],
    ["dana", "Dana Ellis", ["parent_of_groom"]],
    ["casey", "Casey Brooks", ["bridesmaid"]],
    ["drew", "Drew Lane", []],
    ["ellis", "Ellis Reed", ["groomsman"]],
    ["finley", "Finley Park", []],
    ["georgie", "Georgie Wells", ["maid_of_honour"]],
    ["harper", "Harper Stone", []],
    ["indigo", "Indigo Gray", ["best_man"]],
    ["jordan", "Jordan Fox", []],
    ["kai", "Kai Wood", []],
    ["logan", "Logan West", []],
    ["milo", "Milo King", []],
    ["nico", "Nico Bell", []],
    ["oak", "Oak Hall", []],
    ["parker", "Parker Lake", []],
    ["quinn", "Quinn Dale", []],
    ["riley", "Riley Ross", []],
    ["sasha", "Sasha Green", []],
    ["taylor", "Taylor Snow", []],
    ["uma", "Uma Hart", []],
    ["vale", "Vale Moss", []],
    ["wren", "Wren Cole", []],
    ["yara", "Yara Finch", []],
  ];
  const couples: [string, string][] = [
    ["alex", "blair"],
    ["chris", "dana"],
    ["casey", "drew"],
    ["ellis", "finley"],
    ["georgie", "harper"],
    ["indigo", "jordan"],
    ["kai", "logan"],
    ["milo", "nico"],
    ["quinn", "riley"],
  ];
  const sharedBeds = couples.filter(
    ([first]) => !["casey", "quinn"].includes(first),
  );
  const uncertain = new Set(["uma", "vale", "yara"]);
  const dayGuests = new Set(["milo", "nico", "taylor", "wren"]);
  const parents = new Set(["alex", "blair", "chris", "dana"]);
  const top = [
    "alex",
    "blair",
    "chris",
    "dana",
    "casey",
    "ellis",
    "georgie",
    "indigo",
  ];
  const guests = people.map(([id, name, wedding_roles]) => ({
    id,
    name,
    wedding_roles,
    attendance:
      id === "wren" ? "no" : ["uma", "vale"].includes(id) ? "unknown" : "yes",
    source_party:
      couples.find((pair) => pair.includes(id))?.[0] ??
      (["oak", "parker"].includes(id) ? "friends-oak-parker" : id),
    tags: parents.has(id) ? "Family" : "Friends",
  }));
  return parseWeddingPlan({
    version: 2,
    guests,
    hosts: ["You", "Your fiancé"],
    couples: couples.map((guest_ids) => ({
      id: guest_ids.join("-"),
      guest_ids,
    })),
    reviewed_non_couples: [["oak", "parker"]],
    accommodation: {
      nights: 1,
      guests: Object.fromEntries(
        people.map(([id, , roles]) => [
          id,
          {
            overnight: sampleOvernight(id, dayGuests, uncertain),
            fixed_bed_group_id:
              sharedBeds.find((pair) => pair.includes(id))?.[0] ?? "",
            fixed_room_id: ["alex", "blair"].includes(id) ? "linen_1" : "",
            requires_own_bed: ["casey", "drew", "quinn", "riley"].includes(id),
            safe_for_our_booking: !uncertain.has(id),
            priority: samplePriority(id, roles, parents),
            can_share_room: true,
            room_share_mode: "any",
            may_share_room_with: sampleSharingPair(id, "kai", "sasha"),
            can_share_cottage: true,
            cottage_share_mode: "any",
            may_share_cottage_with: sampleSharingPair(id, "drew", "sasha"),
            free_stay_reasons: parents.has(id)
              ? ["immediate_family"]
              : roles.length
                ? ["wedding_party"]
                : [],
            may_share_bed_with: sampleSharingPair(id, "oak", "parker"),
          },
        ]),
      ),
      reservations: {
        linen_1: {
          guest_ids: ["alex", "blair"],
          approved_guest_ids: ["kai", "logan"],
        },
      },
      payment_modes: {
        venue: "couple",
        black_sheep: "guests",
        river_side: "guests",
        linen: "guests",
      },
      cottage_options: {
        black_sheep: { availability: "available", booking_by: "couple" },
        river_side: { availability: "available", booking_by: "guests" },
      },
      cottage_paid_by_us_gbp: {
        linen: "150",
        black_sheep: "0",
        river_side: "0",
      },
      guest_charge_cap_gbp: "85",
      default_outside_cost_gbp: "90",
    },
    seating: {
      top_table_capacity: 10,
      top_table_guest_ids: top,
      table_capacities: [6, 6, 6],
      preferences: {
        drew: { prefer_table_with: ["finley", "harper"] },
        finley: { prefer_table_with: ["drew", "jordan"] },
        kai: { prefer_table_with: ["oak", "parker"] },
        sasha: { prefer_table_with: ["taylor", "quinn"] },
        taylor: { prefer_table_with: ["sasha"], avoid_table_with: ["oak"] },
        nico: { avoid_table_with: ["parker"] },
      },
    },
    extensions: { sample_plan: true },
  });
}
