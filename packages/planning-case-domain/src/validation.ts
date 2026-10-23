import type { PlanningCase, PlanningChecklistItem } from "./model";

function indexItems(
  planningCase: PlanningCase,
): ReadonlyMap<string, PlanningChecklistItem> {
  const items = new Map<string, PlanningChecklistItem>();
  for (const item of planningCase.checklistItems) {
    if (items.has(item.id))
      throw new Error(
        `Planning case "${planningCase.name}" has duplicate checklist item ID "${item.id}"`,
      );
    items.set(item.id, item);
  }
  return items;
}

export function validatePlanningCaseChecklistStructure(
  planningCase: PlanningCase,
): void {
  const items = indexItems(planningCase);
  for (const item of items.values()) {
    for (const dependencyId of item.dependencyIds) {
      if (!items.has(dependencyId))
        throw new Error(
          `Checklist item "${item.title}" references unknown dependency "${dependencyId}"`,
        );
    }
  }
}
