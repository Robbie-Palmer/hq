import { WorkflowLoadingState } from "@/app/_projects/wedding-planner/components/workflow-patterns";

export default function WeddingPlannerLoading() {
  return (
    <main id="wedding-planner-content" className="editor-main">
      <WorkflowLoadingState />
    </main>
  );
}
