"use client";

import { WorkflowErrorState } from "../components/workflow-patterns";

export function WeddingPlannerRouteError({
  error,
  reset,
}: Readonly<{ error: Error; reset: () => void }>) {
  return (
    <main id="wedding-planner-content" className="editor-main">
      <WorkflowErrorState message={error.message} onRetry={reset} />
    </main>
  );
}
