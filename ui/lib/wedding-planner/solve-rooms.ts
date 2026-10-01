import { Model, type Solution, sum, type Var } from "@bubblyworld/highs-ts";
import { incrementalCottagePrice } from "./prices";
import type { Party, Placement, PlannerInput, Property, Room } from "./types";

type Assignment = { party: string; room: string; variable: Var };
type BedShare = { first: string; second: string; room: string; variable: Var };
type SingleUse = { party: string; room: string; variable: Var };
type Solver = {
  input: PlannerInput;
  model: Model;
  properties: Map<string, Property>;
  rooms: Map<string, Room>;
  parties: Map<string, Party>;
  assignments: Assignment[];
  outside: Map<string, Var>;
  candidates: Map<string, Var>;
  singleUses: SingleUse[];
  bedShares: BedShare[];
  booked: Map<string, Var>;
};

const key = (party: string, room: string) => `${party}\u0000${room}`;

function createSolver(input: PlannerInput): Solver {
  return {
    input,
    model: new Model(),
    properties: new Map(
      input.properties.map((property) => [property.id, property]),
    ),
    rooms: new Map(input.rooms.map((room) => [room.id, room])),
    parties: new Map(input.parties.map((party) => [party.id, party])),
    assignments: [],
    outside: new Map(),
    candidates: new Map(),
    singleUses: [],
    bedShares: [],
    booked: new Map(),
  };
}

function canUseRoom(party: Party, room: Room, property: Property): boolean {
  if (property.availability === "unavailable") return false;
  if (party.fixed_room_id && party.fixed_room_id !== room.id) return false;
  if (
    party.allowed_room_ids?.length &&
    !party.allowed_room_ids.includes(room.id)
  )
    return false;
  if (
    party.allowed_property_ids?.length &&
    !party.allowed_property_ids.includes(property.id)
  )
    return false;
  return true;
}

function assignParties(solver: Solver): void {
  const { input, model, properties, assignments, outside, candidates } = solver;
  for (const party of input.parties) {
    const options: Var[] = [];
    for (const room of input.rooms) {
      if (!canUseRoom(party, room, properties.get(room.property_id)!)) continue;
      const variable = model.boolVar(`a${assignments.length}`);
      assignments.push({ party: party.id, room: room.id, variable });
      candidates.set(key(party.id, room.id), variable);
      options.push(variable);
    }
    if (!party.fixed_room_id) {
      const variable = model.boolVar(`o${outside.size}`);
      outside.set(party.id, variable);
      options.push(variable);
    }
    if (!options.length)
      throw new Error(`${party.guests.join(" & ")} has no allowed room`);
    model.addConstraint(sum(options).eq(1));
  }
}

function addSingleBeds(solver: Solver): void {
  const { model, assignments, parties, rooms, singleUses } = solver;
  for (const assignment of assignments) {
    const party = parties.get(assignment.party)!;
    const room = rooms.get(assignment.room)!;
    if (
      party.guests.length !== 1 ||
      party.requires_double_bed ||
      !room.single_beds
    )
      continue;
    const variable = model.boolVar(`s${singleUses.length}`);
    singleUses.push({ party: assignment.party, room: room.id, variable });
    model.addConstraint(variable.minus(assignment.variable).leq(0));
  }
}

function addBedShareForRoom(
  solver: Solver,
  first: string,
  second: string,
  room: Room,
): void {
  const { model, candidates, singleUses, bedShares } = solver;
  const firstAssignment = candidates.get(key(first, room.id));
  const secondAssignment = candidates.get(key(second, room.id));
  if (!firstAssignment || !secondAssignment) return;
  const variable = model.boolVar(`b${bedShares.length}`);
  bedShares.push({ first, second, room: room.id, variable });
  model.addConstraint(variable.minus(firstAssignment).leq(0));
  model.addConstraint(variable.minus(secondAssignment).leq(0));
  for (const single of singleUses.filter(
    (item) =>
      item.room === room.id && (item.party === first || item.party === second),
  )) {
    model.addConstraint(variable.plus(single.variable).leq(1));
  }
}

function addBedShares(solver: Solver): void {
  const { input, model, parties, bedShares } = solver;
  const partyIds = input.parties.map((party) => party.id);
  for (const [index, first] of partyIds.entries()) {
    const firstParty = parties.get(first)!;
    for (const second of partyIds.slice(index + 1)) {
      if (!firstParty.can_share_bed_with?.includes(second)) continue;
      for (const room of input.rooms)
        addBedShareForRoom(solver, first, second, room);
    }
  }
  for (const id of partyIds) {
    model.addConstraint(
      sum(
        bedShares
          .filter((share) => share.first === id || share.second === id)
          .map((share) => share.variable),
      ).leq(1),
    );
  }
}

function addRoomCapacity(solver: Solver): void {
  const { input, model, assignments, bedShares, singleUses } = solver;
  for (const room of input.rooms) {
    const occupants = assignments.filter((item) => item.room === room.id);
    const shared = bedShares.filter((item) => item.room === room.id);
    const singles = singleUses.filter((item) => item.room === room.id);
    model.addConstraint(
      sum(singles.map((item) => item.variable)).leq(room.single_beds ?? 0),
    );
    model.addConstraint(
      sum(occupants.map((item) => item.variable))
        .minus(sum(shared.map((item) => item.variable)))
        .minus(sum(singles.map((item) => item.variable)))
        .leq(room.double_beds),
    );
  }
}

function conflictsAtProperty(first: Party, second: Party): boolean {
  return (
    !first.can_share_cottage ||
    !second.can_share_cottage ||
    Boolean(
      first.avoid_cottage_with?.includes(second.id) ||
        second.avoid_cottage_with?.includes(first.id),
    ) ||
    Boolean(
      first.allowed_cottage_mates &&
        !first.allowed_cottage_mates.includes(second.id),
    ) ||
    Boolean(
      second.allowed_cottage_mates &&
        !second.allowed_cottage_mates.includes(first.id),
    )
  );
}

function roomConflict(
  first: Party,
  second: Party,
): { absolute: boolean; separateBeds: boolean } {
  return {
    absolute: Boolean(
      first.avoid_room_with?.includes(second.id) ||
        second.avoid_room_with?.includes(first.id),
    ),
    separateBeds:
      !first.can_share_room ||
      !second.can_share_room ||
      Boolean(
        first.allowed_room_mates &&
          !first.allowed_room_mates.includes(second.id),
      ) ||
      Boolean(
        second.allowed_room_mates &&
          !second.allowed_room_mates.includes(first.id),
      ),
  };
}

function excludeCottagePair(solver: Solver, first: Party, second: Party): void {
  if (!conflictsAtProperty(first, second)) return;
  const { input, model, assignments, rooms } = solver;
  for (const property of input.properties.filter(
    (item) => item.kind === "cottage",
  )) {
    const inProperty = (id: string) =>
      assignments.filter(
        (item) =>
          item.party === id &&
          rooms.get(item.room)?.property_id === property.id,
      );
    const firstIn = inProperty(first.id);
    const secondIn = inProperty(second.id);
    if (firstIn.length && secondIn.length)
      model.addConstraint(
        sum([...firstIn, ...secondIn].map((item) => item.variable)).leq(1),
      );
  }
}

function excludeRoomPair(solver: Solver, first: Party, second: Party): void {
  const conflict = roomConflict(first, second);
  if (!conflict.absolute && !conflict.separateBeds) return;
  const { input, model, candidates, bedShares } = solver;
  for (const room of input.rooms) {
    const firstVar = candidates.get(key(first.id, room.id));
    const secondVar = candidates.get(key(second.id, room.id));
    if (!firstVar || !secondVar) continue;
    const bedShare = bedShares.find(
      (share) =>
        share.first === first.id &&
        share.second === second.id &&
        share.room === room.id,
    );
    const allowance = !conflict.absolute && bedShare ? bedShare.variable : 0;
    model.addConstraint(firstVar.plus(secondVar).minus(allowance).leq(1));
  }
}

function addSharingRules(solver: Solver): void {
  const { input, parties } = solver;
  const ids = input.parties.map((party) => party.id);
  for (const [index, id] of ids.entries()) {
    const first = parties.get(id)!;
    for (const secondId of ids.slice(index + 1)) {
      const second = parties.get(secondId)!;
      excludeCottagePair(solver, first, second);
      excludeRoomPair(solver, first, second);
    }
  }
}

function addCottageBookings(solver: Solver): void {
  const { input, model, assignments, rooms, booked } = solver;
  for (const property of input.properties.filter(
    (item) => item.kind === "cottage",
  )) {
    const variable = model.boolVar(`c${booked.size}`);
    booked.set(property.id, variable);
    const occupants = assignments.filter(
      (item) => rooms.get(item.room)?.property_id === property.id,
    );
    for (const occupant of occupants)
      model.addConstraint(occupant.variable.minus(variable).leq(0));
    model.addConstraint(
      variable.minus(sum(occupants.map((item) => item.variable))).leq(0),
    );
    if (property.already_booked) model.addConstraint(variable.eq(1));
  }
}

async function optimize(
  solver: Solver,
  expression: ReturnType<typeof sum>,
  maximize: boolean,
  label: string,
  stages: Placement["stages"],
): Promise<Solution> {
  const { model } = solver;
  if (maximize) model.maximize(expression);
  else model.minimize(expression);
  const solution = await model.solve();
  if (solution.status !== "optimal")
    throw new Error(`No allocation found at ${label}: ${solution.status}`);
  const value = solution.getValue(expression);
  if (value === undefined) throw new Error(`Missing solution for ${label}`);
  model.addConstraint(expression.eq(Math.round(value)));
  stages.push({ stage: label, status: "OPTIMAL" });
  return solution;
}

async function runObjectives(
  solver: Solver,
): Promise<{ solution: Solution; stages: Placement["stages"] }> {
  const {
    input,
    model,
    booked,
    outside,
    properties,
    parties,
    assignments,
    rooms,
    bedShares,
    singleUses,
  } = solver;
  const cottageCost = sum(
    [...booked].map(([id, variable]) =>
      variable.times(
        incrementalCottagePrice(properties.get(id)!, input.nights) ?? 0,
      ),
    ),
  );
  const budget =
    input.max_cottage_spend_gbp === null
      ? null
      : Number(input.max_cottage_spend_gbp) * 100;
  if (budget !== null) model.addConstraint(cottageCost.leq(budget));
  const outsideCost = sum(
    [...outside].map(([id, variable]) =>
      variable.times(Number(parties.get(id)?.outside_cost_gbp ?? 0) * 100),
    ),
  );
  const stages: Placement["stages"] = [];
  let solution: Solution | null = null;
  const lowestPrice = input.optimization_mode === "lowest_total_price";
  if (lowestPrice) {
    if ([...outside].some(([id]) => parties.get(id)?.outside_cost_gbp === null))
      throw new Error(
        "Set outside estimates for every party before using lowest price mode",
      );
    solution = await optimize(
      solver,
      cottageCost.plus(outsideCost),
      false,
      "lowest additional lodging price",
      stages,
    );
  }
  const priorities = [
    ...new Set(input.parties.map((party) => party.priority)),
  ].sort((a, b) => b - a);
  for (const priority of priorities) {
    const inVenue = assignments.filter(
      (item) =>
        parties.get(item.party)?.priority === priority &&
        properties.get(rooms.get(item.room)?.property_id ?? "")?.kind ===
          "venue",
    );
    solution = await optimize(
      solver,
      sum(inVenue.map((item) => item.variable)),
      true,
      `venue priority ${priority}`,
      stages,
    );
  }
  for (const priority of priorities) {
    const inCottage = assignments.filter(
      (item) =>
        parties.get(item.party)?.priority === priority &&
        properties.get(rooms.get(item.room)!.property_id)?.kind === "cottage",
    );
    solution = await optimize(
      solver,
      sum(inCottage.map((item) => item.variable)),
      true,
      `cottage priority ${priority}`,
      stages,
    );
  }
  if (!lowestPrice)
    solution = await optimize(
      solver,
      cottageCost.plus(outsideCost),
      false,
      "known additional lodging price",
      stages,
    );
  const preference = sum(
    assignments.map((item) =>
      item.variable.times(
        Number(
          parties
            .get(item.party)
            ?.preferred_property_ids?.includes(
              rooms.get(item.room)!.property_id,
            ) ?? false,
        ),
      ),
    ),
  );
  await optimize(solver, preference, true, "building preferences", stages);
  await optimize(
    solver,
    sum(bedShares.map((item) => item.variable)),
    false,
    "unnecessary bed sharing",
    stages,
  );
  solution = await optimize(
    solver,
    sum(singleUses.map((item) => item.variable)),
    false,
    "single beds only when needed",
    stages,
  );
  return { solution, stages };
}

function chosen(solution: Solution, variable: Var | undefined): boolean {
  return Boolean(variable && (solution.getValue(variable) ?? 0) > 0.5);
}

function readPlacement(
  solver: Solver,
  solution: Solution,
  stages: Placement["stages"],
): Placement {
  const { input, assignments, bedShares, singleUses, outside, booked } = solver;
  const placed = Object.fromEntries(
    input.rooms.map((room) => [room.id, [] as string[]]),
  );
  for (const item of assignments)
    if (chosen(solution, item.variable)) placed[item.room]!.push(item.party);
  return {
    status: "optimal",
    stages,
    rooms: placed,
    shared_beds: bedShares
      .filter((item) => chosen(solution, item.variable))
      .map((item) => ({
        room_id: item.room,
        parties: [item.first, item.second],
      })),
    single_bed_assignments: singleUses
      .filter((item) => chosen(solution, item.variable))
      .map((item) => ({ room_id: item.room, party_id: item.party })),
    outside_parties: [...outside]
      .filter(([, variable]) => chosen(solution, variable))
      .map(([id]) => id),
    booked_cottages: [...booked]
      .filter(([, variable]) => chosen(solution, variable))
      .map(([id]) => id),
  };
}

export async function solveRooms(input: PlannerInput): Promise<Placement> {
  const solver = createSolver(input);
  assignParties(solver);
  addSingleBeds(solver);
  addBedShares(solver);
  addRoomCapacity(solver);
  addSharingRules(solver);
  addCottageBookings(solver);
  const { solution, stages } = await runObjectives(solver);
  return readPlacement(solver, solution, stages);
}
