import type { PlanningCase, PlanningChecklistItem } from "./model";

export type ChecklistProgress = {
  name: string;
  completed: number;
  total: number;
};

export type PlanningCaseChecklistView = {
  id: string;
  name: string;
  completedItems: number;
  totalItems: number;
  notApplicableItems: number;
  overdueItems: PlanningChecklistItem[];
  blockedItems: PlanningChecklistItem[];
  upcomingDeadlines: PlanningChecklistItem[];
  progressByCategory: ChecklistProgress[];
  progressByOwner: ChecklistProgress[];
};

function itemDeadline(item: PlanningChecklistItem): string | null {
  if (item.schedule == null) return null;
  return item.schedule.kind === "due_date"
    ? item.schedule.dueDate
    : item.schedule.endsOn;
}

function isActionable(item: PlanningChecklistItem): boolean {
  return item.status !== "not_applicable";
}

function progress(
  items: readonly PlanningChecklistItem[],
  select: (item: PlanningChecklistItem) => string,
): ChecklistProgress[] {
  const groups = new Map<string, { completed: number; total: number }>();
  for (const item of items) {
    const name = select(item);
    const group = groups.get(name) ?? { completed: 0, total: 0 };
    group.total += 1;
    if (item.status === "complete") group.completed += 1;
    groups.set(name, group);
  }
  return Array.from(groups, ([name, counts]) => ({ name, ...counts })).sort(
    (left, right) => left.name.localeCompare(right.name),
  );
}

export function buildPlanningCaseChecklistView(
  planningCase: PlanningCase,
  asOfDate: string,
): PlanningCaseChecklistView {
  const actionable = planningCase.checklistItems.filter(isActionable);
  const incomplete = actionable.filter((item) => item.status !== "complete");
  const withDeadline = incomplete
    .map((item) => ({ item, deadline: itemDeadline(item) }))
    .filter(
      (entry): entry is { item: PlanningChecklistItem; deadline: string } =>
        entry.deadline != null,
    );
  return {
    id: planningCase.id,
    name: planningCase.name,
    completedItems: actionable.filter((item) => item.status === "complete")
      .length,
    totalItems: actionable.length,
    notApplicableItems: planningCase.checklistItems.length - actionable.length,
    overdueItems: withDeadline
      .filter(({ deadline }) => deadline < asOfDate)
      .sort((left, right) => left.deadline.localeCompare(right.deadline))
      .map(({ item }) => item),
    blockedItems: incomplete.filter((item) => item.status === "blocked"),
    upcomingDeadlines: withDeadline
      .filter(({ deadline }) => deadline >= asOfDate)
      .sort((left, right) => left.deadline.localeCompare(right.deadline))
      .map(({ item }) => item),
    progressByCategory: progress(actionable, (item) => item.category),
    progressByOwner: progress(actionable, (item) => item.owner),
  };
}
