"use client";

import { PortfolioGoal } from "./portfolio-goal";

export function PlanningRoute() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-2 text-4xl font-bold">Planning</h1>
        <p className="text-lg text-muted-foreground">
          Model financial independence, runway, planned spending, and portfolio
          growth.
        </p>
      </div>
      <PortfolioGoal showIncomeTools={false} />
    </div>
  );
}
