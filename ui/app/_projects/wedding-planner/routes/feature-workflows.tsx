"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import type { TableAllocation, WeddingPlanDraft } from "../application/types";
import { DataControls } from "../components/data-controls";
import { PlaylistEditor } from "../components/playlist-editor";
import { ReadinessDashboard } from "../components/readiness-dashboard";
import { TableEditor } from "../components/table-editor";
import { useWeddingPlan } from "../components/use-wedding-plan";
import {
  WorkflowDataTable,
  WorkflowEmptyState,
  WorkflowErrorState,
  WorkflowFormSection,
  WorkflowLoadingState,
  WorkflowPage,
} from "../components/workflow-patterns";
import { workflowHref } from "./workflow-paths";

function WorkflowBoundary({
  children,
  loading,
  error,
  state,
  onLoadSample,
  onImport,
}: Readonly<{
  children: ReactNode;
  loading: boolean;
  error: string;
  state: WeddingPlanDraft | null;
  onLoadSample(): Promise<void>;
  onImport(file: File): Promise<void>;
}>) {
  if (loading) return <WorkflowLoadingState />;
  if (!state)
    return (
      <>
        {error && <WorkflowErrorState message={error} />}
        <WorkflowEmptyState
          title="No plan loaded"
          description="Plans stay in this browser. Start with fictional data or import a JSON backup."
          action={
            <>
              <Button className="mb-4" onClick={onLoadSample}>
                Use sample plan
              </Button>
              <DataControls
                hasData={false}
                onImport={onImport}
                onExport={() => {}}
              />
            </>
          }
        />
      </>
    );
  return (
    <>
      {error && <WorkflowErrorState message={error} />}
      {children}
    </>
  );
}

function RouteMain({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <main id="wedding-planner-content" className="editor-main">
      {children}
    </main>
  );
}

export function ReadinessWorkflow() {
  const plan = useWeddingPlan();
  const router = useRouter();
  return (
    <RouteMain>
      <WorkflowBoundary
        {...plan}
        onLoadSample={plan.loadSample}
        onImport={plan.importPlan}
      >
        {plan.state && (
          <ReadinessDashboard
            state={plan.state}
            onUpdate={plan.update}
            onNavigate={(destination, targetId) =>
              router.push(workflowHref(destination, targetId))
            }
          />
        )}
      </WorkflowBoundary>
    </RouteMain>
  );
}

export function MusicWorkflow() {
  const plan = useWeddingPlan();
  return (
    <RouteMain>
      <WorkflowBoundary
        {...plan}
        onLoadSample={plan.loadSample}
        onImport={plan.importPlan}
      >
        {plan.state && (
          <PlaylistEditor
            playlist={plan.state.playlist}
            onUpdate={plan.update}
          />
        )}
      </WorkflowBoundary>
    </RouteMain>
  );
}

export function SeatingWorkflow() {
  const plan = useWeddingPlan();
  const [allocation, setAllocation] = useState<TableAllocation | null>(null);
  const [busy, setBusy] = useState(false);
  const [calculationError, setCalculationError] = useState("");

  function update(
    change: (draft: WeddingPlanDraft) => void,
    layoutOnly = false,
  ) {
    if (!layoutOnly) {
      setAllocation(null);
      setCalculationError("");
    }
    plan.update(change);
  }

  async function calculate() {
    if (!plan.state) return;
    setBusy(true);
    setCalculationError("");
    try {
      await plan.flush();
      setAllocation(await plan.application.calculateTables(plan.state));
    } catch (cause) {
      setCalculationError(
        cause instanceof Error ? cause.message : "Could not calculate tables",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <RouteMain>
      <WorkflowBoundary
        {...plan}
        onLoadSample={plan.loadSample}
        onImport={plan.importPlan}
      >
        {calculationError && <WorkflowErrorState message={calculationError} />}
        {plan.state && (
          <TableEditor
            state={plan.state}
            allocation={allocation}
            onLayoutUpdate={(change) => update(change, true)}
            busy={busy}
            onUpdate={update}
            onCalculate={calculate}
          />
        )}
      </WorkflowBoundary>
    </RouteMain>
  );
}

export function ExportsWorkflow() {
  const plan = useWeddingPlan();
  return (
    <RouteMain>
      <WorkflowBoundary
        {...plan}
        onLoadSample={plan.loadSample}
        onImport={plan.importPlan}
      >
        {plan.state && (
          <WorkflowPage
            title="Exports"
            description="Move the private plan between browsers or prepare a handoff from the workflow that owns it."
          >
            <WorkflowFormSection
              title="Plan backup"
              description="The JSON backup contains the current guest, accommodation, seating, readiness, and music data."
            >
              <DataControls
                hasData
                onImport={plan.importPlan}
                onExport={plan.exportPlan}
              />
            </WorkflowFormSection>
            <WorkflowDataTable caption="Data included in the current backup">
              <thead>
                <tr>
                  <th scope="col">Workflow</th>
                  <th scope="col">Current data</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Guests</th>
                  <td>{plan.state.guests.length} records</td>
                </tr>
                <tr>
                  <th scope="row">Accommodation</th>
                  <td>
                    {plan.state.inventory?.properties.length ?? 0} properties
                  </td>
                </tr>
                <tr>
                  <th scope="row">Seating</th>
                  <td>
                    {plan.state.table_plan ? "Configured" : "Not configured"}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Music</th>
                  <td>{plan.state.playlist ? "Included" : "Not started"}</td>
                </tr>
              </tbody>
            </WorkflowDataTable>
            <p className="editor-hint mt-5">
              Venue, caterer, floor-plan, and DJ files stay with the seating and
              music workflows that produce them.{" "}
              <ArrowRight aria-hidden="true" size={14} />
            </p>
          </WorkflowPage>
        )}
      </WorkflowBoundary>
    </RouteMain>
  );
}
