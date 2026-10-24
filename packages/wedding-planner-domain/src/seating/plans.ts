import type { WeddingPlan } from "../plan";
import type { TableAllocation } from "./types";

export function saveSeatingAlternative(
  plan: WeddingPlan,
  allocation: TableAllocation,
  details: {
    id: string;
    name: string;
    created_at: string;
    event_id?: string;
  },
): void {
  if (!details.id.trim() || !details.name.trim())
    throw new Error("Saved plans need an ID and name");
  const savedPlan = {
    ...details,
    id: details.id.trim(),
    name: details.name.trim(),
    allocation: structuredClone(allocation),
  };
  plan.seating.saved_plans = [
    ...plan.seating.saved_plans.filter((item) => item.id !== savedPlan.id),
    savedPlan,
  ];
  plan.seating.chosen_plan_id ??= savedPlan.id;
}

export function chooseSeatingAlternative(
  plan: WeddingPlan,
  savedPlanId: string,
): void {
  if (!plan.seating.saved_plans.some((item) => item.id === savedPlanId))
    throw new Error("The saved seating plan does not exist");
  plan.seating.chosen_plan_id = savedPlanId;
}

export function removeSeatingAlternative(
  plan: WeddingPlan,
  savedPlanId: string,
): void {
  plan.seating.saved_plans = plan.seating.saved_plans.filter(
    (item) => item.id !== savedPlanId,
  );
  if (plan.seating.chosen_plan_id === savedPlanId)
    plan.seating.chosen_plan_id = plan.seating.saved_plans[0]?.id;
}

export function compareSeatingAlternatives(
  first: TableAllocation,
  second: TableAllocation,
) {
  const firstAssignments = new Map(
    first.tables.flatMap((table) =>
      table.guest_ids.map((guestId) => [guestId, table.id] as const),
    ),
  );
  const secondAssignments = new Map(
    second.tables.flatMap((table) =>
      table.guest_ids.map((guestId) => [guestId, table.id] as const),
    ),
  );
  const guestIds = new Set([
    ...firstAssignments.keys(),
    ...secondAssignments.keys(),
  ]);
  return {
    score_change: second.score.earned - first.score.earned,
    moved_guest_ids: [...guestIds]
      .filter(
        (guestId) =>
          firstAssignments.get(guestId) !== secondAssignments.get(guestId),
      )
      .sort((firstId, secondId) => firstId.localeCompare(secondId)),
    unsatisfied_change:
      second.unsatisfied_preferences.length -
      first.unsatisfied_preferences.length,
  };
}
