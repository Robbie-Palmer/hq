"use client";

import { PortfolioGoal } from "./portfolio-goal";

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
    </div>
  );
}
