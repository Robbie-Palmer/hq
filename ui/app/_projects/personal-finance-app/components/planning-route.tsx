"use client";

import type { ChecklistStatus } from "planning-case-domain";
import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAssetTracker } from "./asset-tracker-provider";
import { PortfolioGoal } from "./portfolio-goal";

const checklistStatuses: Array<{
  value: ChecklistStatus;
  label: string;
}> = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "complete", label: "Complete" },
  { value: "not_applicable", label: "Not applicable" },
];

function PlanningCaseChecklists() {
  const { planningCases, setPlanningChecklistItemStatus } = useAssetTracker();
  const [error, setError] = useState<string | null>(null);

  if (!planningCases?.length) return null;

  async function updateStatus(
    planningCaseId: string,
    itemId: string,
    status: ChecklistStatus,
  ) {
    setError(null);
    try {
      await setPlanningChecklistItemStatus({
        planningCaseId,
        itemId,
        status,
        changedBy: "asset-tracker-ui",
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not update the task",
      );
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Planning checklists</CardTitle>
        <CardDescription>
          Track the dated work behind larger financial plans.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {planningCases.map((planningCase) => (
          <section className="space-y-3" key={planningCase.id}>
            <div>
              <h3 className="font-semibold">{planningCase.name}</h3>
              {planningCase.targetDate ? (
                <p className="text-sm text-muted-foreground">
                  Target date: {planningCase.targetDate}
                </p>
              ) : null}
            </div>
            {planningCase.checklistItems.length ? (
              <ul className="divide-y rounded-lg border">
                {planningCase.checklistItems.map((item) => (
                  <li
                    className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_11rem] sm:items-center"
                    id={`task-${item.id}`}
                    key={item.id}
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{item.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {item.owner}
                        {item.schedule?.kind === "due_date"
                          ? ` · Due ${item.schedule.dueDate}`
                          : item.schedule?.kind === "date_range"
                            ? ` · ${item.schedule.startsOn} to ${item.schedule.endsOn}`
                            : ""}
                      </p>
                    </div>
                    <label className="grid gap-1 text-sm">
                      <span className="sr-only">Status for {item.title}</span>
                      <select
                        aria-label={`Status for ${item.title}`}
                        className="h-9 rounded-md border border-input bg-background px-3"
                        onChange={(event) => {
                          void updateStatus(
                            planningCase.id,
                            item.id,
                            event.target.value as ChecklistStatus,
                          );
                        }}
                        value={item.status}
                      >
                        {checklistStatuses.map((status) => (
                          <option key={status.value} value={status.value}>
                            {status.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No checklist tasks yet.
              </p>
            )}
          </section>
        ))}
      </CardContent>
    </Card>
  );
}

export function PlanningRoute() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-2 text-3xl font-bold sm:text-4xl">
          Financial independence
        </h1>
        <p className="text-lg text-muted-foreground">
          Track your FI target, runway, planned spending, and portfolio growth.
        </p>
      </div>
      <PortfolioGoal showIncomeTools={false} />
      <PlanningCaseChecklists />
    </div>
  );
}
