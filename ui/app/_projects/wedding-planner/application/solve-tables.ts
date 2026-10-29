import { Model, type Solution, sum, type Var } from "@bubblyworld/highs-ts";
import {
  type SeatingGuest as Guest,
  type TablePair as Pair,
  prepareTableProblem,
  type TableAllocation,
  type TableInput,
} from "wedding-planner-domain/seating";

function assignGroups(
  model: Model,
  groups: Guest[][],
  capacities: number[],
  forcedTableByGuest: Map<string, string>,
): Var[][] {
  return groups.map((group, index) => {
    const options = capacities.map((capacity, table) => {
      const variable = model.boolVar(`guest_${index}_table_${table}`);
      if (group.length > capacity) model.addConstraint(variable.eq(0));
      const forcedTable = group
        .map((guest) => forcedTableByGuest.get(guest.id))
        .find(Boolean);
      if (forcedTable)
        model.addConstraint(
          variable.eq(forcedTable === `table-${table + 1}` ? 1 : 0),
        );
      return variable;
    });
    model.addConstraint(sum(options).eq(1));
    return options;
  });
}

function addPairRules(
  model: Model,
  pairs: Pair[],
  top: Set<string>,
  groupIndex: Map<string, number>,
  assignments: Var[][],
): { variable: Var; pair: Pair }[] {
  const preferences: { variable: Var; pair: Pair }[] = [];
  for (const [index, pair] of pairs.entries()) {
    const firstTop = top.has(pair.first.id);
    const secondTop = top.has(pair.second.id);
    if (firstTop || secondTop) continue;
    const first = groupIndex.get(pair.first.id)!;
    const second = groupIndex.get(pair.second.id)!;
    if (first === second) continue;
    assignments[first]!.forEach((a, table) => {
      const b = assignments[second]![table]!;
      if (pair.decision === "no") {
        model.addConstraint(a.plus(b).leq(1));
      } else {
        const together = model.boolVar(`pair_${index}_table_${table}`);
        model.addConstraint(together.minus(a).leq(0));
        model.addConstraint(together.minus(b).leq(0));
        model.addConstraint(together.minus(a).minus(b).geq(-1));
        preferences.push({ variable: together, pair });
      }
    });
  }
  return preferences;
}

function tablePreference(
  guest: Guest,
  plan: TableInput["plan"],
): { tableIds: string[]; description: string; weight: number }[] {
  return [
    ...guest.wedding_roles.flatMap((role) => {
      const tableIds = plan.role_table_preferences?.[role] ?? [];
      return tableIds.length
        ? [
            {
              tableIds,
              description: `Preferred table for the ${role.replaceAll("_", " ")} role`,
              weight: 2,
            },
          ]
        : [];
    }),
    ...(guest.relationship_groups ?? []).flatMap((group) => {
      const tableIds = plan.relationship_group_table_preferences?.[group] ?? [];
      return tableIds.length
        ? [
            {
              tableIds,
              description: `Preferred table for the ${group} group`,
              weight: 1,
            },
          ]
        : [];
    }),
  ];
}

function requireFeatureCapacity(
  model: Model,
  groups: Guest[][],
  assignments: Var[][],
  input: TableInput,
  feature: "accessible" | "high_chair",
) {
  input.plan.table_capacities.forEach((_, table) => {
    const tableId = `table-${table + 1}`;
    const appearance = input.plan.table_layout?.[tableId];
    const indexes =
      feature === "accessible"
        ? appearance?.accessible_seat_indexes
        : appearance?.high_chair_seat_indexes;
    const required = groups.map((group, groupIndex) =>
      assignments[groupIndex]![table]!.times(
        group.filter((guest) =>
          feature === "accessible"
            ? guest.seating_constraints?.requires_accessible_seat
            : guest.requires_high_chair,
        ).length,
      ),
    );
    if (required.length)
      model.addConstraint(sum(required).leq(indexes?.length ?? 0));
  });
}

function seatGuests(
  table: TableAllocation["tables"][number],
  input: TableInput,
  guests: Map<string, Guest>,
  reservedSeats = 0,
) {
  const appearance = input.plan.table_layout?.[table.id];
  const accessible = new Set(appearance?.accessible_seat_indexes ?? []);
  const highChairs = new Set(appearance?.high_chair_seat_indexes ?? []);
  const lockedAssignments = input.plan.locked_assignments ?? {};
  const seats = Array.from({ length: table.capacity }, (_, index) => ({
    index,
    accessible: accessible.has(index),
    high_chair: highChairs.has(index),
    locked: false,
  })) as TableAllocation["tables"][number]["seats"];
  const used = new Set<number>();
  for (let index = 0; index < reservedSeats; index++) used.add(index);
  const place = (guestId: string, requested?: number) => {
    const guest = guests.get(guestId)!;
    const fits = (index: number) =>
      !used.has(index) &&
      (!guest.seating_constraints?.requires_accessible_seat ||
        accessible.has(index)) &&
      (!guest.requires_high_chair || highChairs.has(index));
    const index = requested ?? seats.find((seat) => fits(seat.index))?.index;
    if (index === undefined || !fits(index))
      throw new Error(
        `${guest.name}: no suitable seat remains at ${table.name}. Add an accessible or high-chair position, or change the lock.`,
      );
    seats[index]!.guest_id = guestId;
    seats[index]!.locked = requested !== undefined;
    used.add(index);
  };
  const ordered = [...table.guest_ids].sort((first, second) => {
    const firstGuest = guests.get(first)!;
    const secondGuest = guests.get(second)!;
    const firstPriority =
      Number(firstGuest.seating_constraints?.requires_accessible_seat) * 2 +
      Number(firstGuest.requires_high_chair);
    const secondPriority =
      Number(secondGuest.seating_constraints?.requires_accessible_seat) * 2 +
      Number(secondGuest.requires_high_chair);
    return secondPriority - firstPriority || first.localeCompare(second);
  });
  for (const guestId of ordered.filter(
    (id) => lockedAssignments[id]?.seat_index !== undefined,
  ))
    place(guestId, lockedAssignments[guestId]!.seat_index);
  for (const guestId of ordered.filter(
    (id) => lockedAssignments[id]?.seat_index === undefined,
  ))
    place(guestId);
  table.seats = seats;
}

function explainAssignment(
  guestId: string,
  table: TableAllocation["tables"][number],
  guests: Map<string, Guest>,
  forcedTableByGuest: Map<string, string>,
  metPairs: Pair[],
  metTablePreferences: {
    guest: Guest;
    preference: ReturnType<typeof tablePreference>[number];
  }[],
) {
  const guest = guests.get(guestId)!;
  const factors: string[] = [];
  if (forcedTableByGuest.has(guestId))
    factors.push("This assignment is locked");
  if (guest.partner_id && table.guest_ids.includes(guest.partner_id)) {
    const partner = guests.get(guest.partner_id);
    factors.push(`Seated with partner ${partner?.name ?? guest.partner_id}`);
  }
  for (const pair of metPairs) {
    if (pair.first.id === guestId || pair.second.id === guestId)
      factors.push(pair.reason);
  }
  for (const item of metTablePreferences) {
    if (item.guest.id === guestId) factors.push(item.preference.description);
  }
  if (guest.seating_constraints?.requires_accessible_seat)
    factors.push("Assigned an accessible seat");
  if (guest.requires_high_chair) factors.push("Assigned a high-chair position");
  const uniqueFactors = [...new Set(factors)];
  return {
    guest_id: guestId,
    table_id: table.id,
    seat_index:
      table.seats.find((seat) => seat.guest_id === guestId)?.index ?? 0,
    factors: uniqueFactors.length
      ? uniqueFactors
      : ["Placed here to balance table sizes"],
  };
}

function ensureOptimal(solution: Solution): void {
  if (solution.status === "infeasible")
    throw new Error(
      "No table plan fits these capacities, couples and keep-apart rules. Add tables or seats, or review the table preferences.",
    );
  if (solution.status !== "optimal")
    throw new Error(
      `Could not finish table optimization: ${solution.status}. Try a smaller table setup.`,
    );
}

export async function solveTables(input: TableInput): Promise<TableAllocation> {
  const { plan, fixed_top_guests } = input;
  const { unknown, top, groups, groupIndex, pairs, forcedTableByGuest } =
    prepareTableProblem(input);
  const model = new Model();
  const assignments = assignGroups(
    model,
    groups,
    plan.table_capacities,
    forcedTableByGuest,
  );
  const pairTerms = addPairRules(model, pairs, top, groupIndex, assignments);
  const tableTerms = groups.flatMap((group, groupIndex) =>
    group.flatMap((guest) =>
      tablePreference(guest, plan).flatMap((preference) =>
        plan.table_capacities.flatMap((_, table) =>
          preference.tableIds.includes(`table-${table + 1}`)
            ? [
                {
                  variable: assignments[groupIndex]![table]!,
                  guest,
                  preference,
                },
              ]
            : [],
        ),
      ),
    ),
  );
  const preferences = sum([
    ...pairTerms.map((term) => term.variable.times(term.pair.weight)),
    ...tableTerms.map((term) => term.variable.times(term.preference.weight)),
  ]);
  const loads = plan.table_capacities.map((seats, table) => {
    const load = sum(
      assignments.map((options, group) =>
        options[table]!.times(groups[group]!.length),
      ),
    );
    model.addConstraint(load.leq(seats));
    return load;
  });
  // Tables with the same capacity are interchangeable. Ordered loads reduce
  // equivalent solutions without changing which guest combinations can fit.
  loads.forEach((load, table) => {
    if (
      table > 0 &&
      plan.table_capacities[table] === plan.table_capacities[table - 1]
    )
      model.addConstraint(loads[table - 1]!.minus(load).geq(0));
  });
  requireFeatureCapacity(model, groups, assignments, input, "accessible");
  requireFeatureCapacity(model, groups, assignments, input, "high_chair");

  const tables: TableAllocation["tables"] = [
    {
      id: "top",
      name: plan.table_layout?.top?.name?.trim() || "Top table",
      capacity: plan.top_table_capacity,
      guest_ids: [...top],
      fixed_guests: [...fixed_top_guests],
      seats: [],
      locked: Boolean(plan.locked_table_guest_ids?.top),
    },
    ...plan.table_capacities.map((seats, index) => ({
      id: `table-${index + 1}`,
      name:
        plan.table_layout?.[`table-${index + 1}`]?.name?.trim() ||
        `Table ${index + 1}`,
      capacity: seats,
      guest_ids: [] as string[],
      fixed_guests: [] as string[],
      seats: [],
      locked: Boolean(plan.locked_table_guest_ids?.[`table-${index + 1}`]),
    })),
  ];
  if (groups.length) {
    model.maximize(preferences);
    let solution = await model.solve();
    ensureOptimal(solution);
    model.addConstraint(
      preferences.eq(Math.round(solution.getValue(preferences) ?? 0)),
    );
    const maxLoad = model.intVar(
      0,
      Math.max(...plan.table_capacities),
      "largest_table",
    );
    for (const load of loads) model.addConstraint(load.minus(maxLoad).leq(0));
    model.minimize(maxLoad);
    solution = await model.solve();
    ensureOptimal(solution);
    assignments.forEach((options, group) => {
      options.forEach((variable, table) => {
        if ((solution.getValue(variable) ?? 0) > 0.5)
          tables[table + 1]!.guest_ids.push(
            ...groups[group]!.map((guest) => guest.id),
          );
      });
    });
  }
  const guestToTable = new Map(
    tables.flatMap((table) => table.guest_ids.map((id) => [id, table.id])),
  );
  const wanted = pairs.filter((pair) => pair.decision === "yes");
  const unmet = wanted.filter(
    (pair) =>
      guestToTable.get(pair.first.id) !== guestToTable.get(pair.second.id),
  );
  const guests = new Map(input.guests.map((guest) => [guest.id, guest]));
  for (const table of tables)
    seatGuests(
      table,
      input,
      guests,
      table.id === "top" ? fixed_top_guests.length : 0,
    );
  const metPairs = wanted.filter(
    (pair) =>
      guestToTable.get(pair.first.id) === guestToTable.get(pair.second.id),
  );
  const earnedPairScore = metPairs.reduce(
    (total, pair) => total + pair.weight,
    0,
  );
  const possiblePairScore = wanted.reduce(
    (total, pair) => total + pair.weight,
    0,
  );
  const allTablePreferences = input.guests.flatMap((guest) =>
    tablePreference(guest, plan).map((preference) => ({ guest, preference })),
  );
  const metTablePreferences = allTablePreferences.filter(
    ({ guest, preference }) =>
      preference.tableIds.includes(guestToTable.get(guest.id) ?? ""),
  );
  const earnedTableScore = metTablePreferences.reduce(
    (total, item) => total + item.preference.weight,
    0,
  );
  const possibleTableScore = allTablePreferences.reduce(
    (total, item) => total + item.preference.weight,
    0,
  );
  const explanations = tables.flatMap((table) =>
    table.guest_ids.map((guestId) =>
      explainAssignment(
        guestId,
        table,
        guests,
        forcedTableByGuest,
        metPairs,
        metTablePreferences,
      ),
    ),
  );
  return {
    status: unknown.length ? "provisional" : "optimal",
    score: {
      earned: earnedPairScore + earnedTableScore,
      possible: possiblePairScore + possibleTableScore,
    },
    tables,
    preferences_met: wanted.length - unmet.length,
    preferences_total: wanted.length,
    unmet_preferences: unmet.map((pair) => [pair.first.id, pair.second.id]),
    unsatisfied_preferences: [
      ...unmet.map((pair) => ({
        guest_ids: [pair.first.id, pair.second.id],
        description: pair.reason,
        weight: pair.weight,
      })),
      ...allTablePreferences
        .filter((item) => !metTablePreferences.includes(item))
        .map(({ guest, preference }) => ({
          guest_ids: [guest.id],
          description: preference.description,
          weight: preference.weight,
        })),
    ],
    explanations,
    warnings: unknown.length
      ? [
          `${unknown.length} wedding attendance decisions still open. These guests are excluded from this draft.`,
        ]
      : [],
  };
}
