import { Model, type Solution, sum, type Var } from "@bubblyworld/highs-ts";
import type {
  SeatingGuest as Guest,
  TableAllocation,
  TableInput,
} from "wedding-planner-domain/seating";
import {
  type TablePair as Pair,
  prepareTableProblem,
} from "wedding-planner-domain/seating";

function assignGroups(
  model: Model,
  groups: Guest[][],
  capacities: number[],
): Var[][] {
  return groups.map((group, index) => {
    if (group.length > 2)
      throw new Error(
        `${group.map((guest) => guest.name).join(" & ")}: a confirmed couple has more than two guests.`,
      );
    const options = capacities.map((capacity, table) => {
      const variable = model.boolVar(`guest_${index}_table_${table}`);
      if (group.length > capacity) model.addConstraint(variable.eq(0));
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
): Var[] {
  const preferences: Var[] = [];
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
        preferences.push(together);
      }
    });
  }
  return preferences;
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
  const { unknown, top, groups, groupIndex, pairs } =
    prepareTableProblem(input);
  const model = new Model();
  const assignments = assignGroups(model, groups, plan.table_capacities);
  const preferences = sum(
    addPairRules(model, pairs, top, groupIndex, assignments),
  );
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

  const tables: TableAllocation["tables"] = [
    {
      id: "top",
      name: "Top table",
      capacity: plan.top_table_capacity,
      guest_ids: [...top],
      fixed_guests: [...fixed_top_guests],
    },
    ...plan.table_capacities.map((seats, index) => ({
      id: `table-${index + 1}`,
      name: `Table ${index + 1}`,
      capacity: seats,
      guest_ids: [] as string[],
      fixed_guests: [] as string[],
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
  return {
    status: unknown.length ? "provisional" : "optimal",
    tables,
    preferences_met: wanted.length - unmet.length,
    preferences_total: wanted.length,
    unmet_preferences: unmet.map((pair) => [pair.first.id, pair.second.id]),
    warnings: unknown.length
      ? [
          `${unknown.length} wedding attendance decisions still open. These guests are excluded from this draft.`,
        ]
      : [],
  };
}
