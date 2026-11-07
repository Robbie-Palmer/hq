import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSampleEditorPlan } from "@/app/_projects/wedding-planner/application/bootstrap";
import type { WeddingPlanRouteState } from "@/app/_projects/wedding-planner/components/use-wedding-plan";
import { fireEvent, render, screen, waitFor } from "@/tests/test-utils";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  useWeddingPlan: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/app/_projects/wedding-planner/components/use-wedding-plan", () => ({
  useWeddingPlan: mocks.useWeddingPlan,
}));
vi.mock(
  "@/app/_projects/wedding-planner/components/readiness-dashboard",
  () => ({
    ReadinessDashboard: ({
      onNavigate,
    }: {
      onNavigate(view: string, id: string): void;
    }) => (
      <button type="button" onClick={() => onNavigate("guests", "casey")}>
        Open guest
      </button>
    ),
  }),
);
vi.mock("@/app/_projects/wedding-planner/components/playlist-editor", () => ({
  PlaylistEditor: () => <h2>Music editor</h2>,
}));
vi.mock("@/app/_projects/wedding-planner/components/table-editor", () => ({
  TableEditor: ({ onCalculate }: { onCalculate(): Promise<void> }) => (
    <button type="button" onClick={() => void onCalculate()}>
      Calculate tables
    </button>
  ),
}));

import {
  ExportsWorkflow,
  MusicWorkflow,
  ReadinessWorkflow,
  SeatingWorkflow,
} from "@/app/_projects/wedding-planner/routes/feature-workflows";

function routeState(): WeddingPlanRouteState {
  const state = createSampleEditorPlan();
  return {
    state,
    loading: false,
    error: "",
    update: vi.fn(),
    loadSample: vi.fn(),
    importPlan: vi.fn(),
    exportPlan: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    application: {
      load: vi.fn(),
      save: vi.fn(),
      calculateRooms: vi.fn(),
      calculateTables: vi.fn().mockResolvedValue({ tables: [] }),
    },
  };
}

describe("route-owned wedding workflows", () => {
  beforeEach(() => {
    mocks.push.mockReset();
    mocks.useWeddingPlan.mockReturnValue(routeState());
  });

  it("navigates from readiness with a guest deep link", () => {
    render(<ReadinessWorkflow />);
    fireEvent.click(screen.getByRole("button", { name: "Open guest" }));
    expect(mocks.push).toHaveBeenCalledWith(
      "/wedding-planner/guests?guest=casey",
    );
  });

  it("keeps music and exports in independent route modules", () => {
    const { rerender } = render(<MusicWorkflow />);
    expect(screen.getByRole("heading", { name: "Music editor" })).toBeVisible();
    rerender(<ExportsWorkflow />);
    expect(screen.getByRole("heading", { name: "Exports" })).toBeVisible();
    expect(
      screen.getByRole("table", {
        name: "Data included in the current backup",
      }),
    ).toHaveTextContent("26 records");
  });

  it("flushes route state before calculating seating", async () => {
    const plan = routeState();
    mocks.useWeddingPlan.mockReturnValue(plan);
    render(<SeatingWorkflow />);
    fireEvent.click(screen.getByRole("button", { name: "Calculate tables" }));
    await waitFor(() => expect(plan.flush).toHaveBeenCalledOnce());
    expect(plan.application.calculateTables).toHaveBeenCalledWith(plan.state);
  });

  it("shows a seating calculation failure", async () => {
    const plan = routeState();
    plan.flush = vi.fn().mockRejectedValue(new Error("Save the plan first"));
    mocks.useWeddingPlan.mockReturnValue(plan);
    render(<SeatingWorkflow />);
    fireEvent.click(screen.getByRole("button", { name: "Calculate tables" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Save the plan first",
    );
    expect(plan.application.calculateTables).not.toHaveBeenCalled();
  });
});
