import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  WeddingOperationsSnapshot,
  WeddingReadinessPreferences,
} from "wedding-planner-domain";
import { ReadinessDashboard } from "@/components/wedding-planner/readiness-dashboard";
import { toEditorState } from "@/lib/wedding-planner/editor-projection";
import { createSampleWeddingPlan } from "@/lib/wedding-planner/sample-plan";

const operations: WeddingOperationsSnapshot = {
  planning_case_id: "wedding-operations",
  planning_case_name: "Wedding operations",
  tasks: [
    {
      id: "book-band",
      title: "Book band",
      owner: "Robin",
      status: "blocked",
      due_on: "2026-09-01",
      href: "https://example.test/band",
    },
  ],
  unresolved_decisions: [],
  finances: [
    {
      currency: "GBP",
      planned: 10_000,
      committed: 8_000,
      paid: 2_000,
      refunded: 100,
      remaining: 8_100,
    },
  ],
  upcoming_payments: [
    {
      id: "venue:balance",
      title: "Venue balance",
      due_on: "2027-03-01",
      amount: 4_000,
      currency: "GBP",
      href: "/assettracker/cash-flow#cash-flow-venue",
    },
  ],
};

describe("readiness dashboard", () => {
  it("shows private operational and ledger summaries with resolvable links", async () => {
    const onNavigate = vi.fn();
    render(
      <ReadinessDashboard
        state={toEditorState(createSampleWeddingPlan())}
        onUpdate={vi.fn()}
        onNavigate={onNavigate}
        loadOperations={vi.fn().mockResolvedValue(operations)}
      />,
    );

    expect(await screen.findByText("Wedding costs")).toBeInTheDocument();
    expect(screen.getByText("Planned £10,000.00")).toBeInTheDocument();
    expect(screen.getByText("Refunded £100.00")).toBeInTheDocument();
    expect(screen.getAllByText("Venue balance")).toHaveLength(2);
    expect(
      screen.getAllByRole("link", { name: /Book band/ })[0],
    ).toHaveAttribute("href", "https://example.test/band");

    const guestWarning = screen.getAllByRole("button", {
      name: /Uma Hart/,
    })[0];
    if (!guestWarning) throw new Error("Expected a guest readiness warning");
    fireEvent.click(guestWarning);
    expect(onNavigate).toHaveBeenCalledWith("guests", "uma");
    expect(
      guestWarning.querySelector(".readiness-issue-area"),
    ).toHaveTextContent("guests");
  });

  it("lets the couple configure the checks used by a milestone", () => {
    const state = toEditorState(createSampleWeddingPlan());
    state.readiness = undefined;
    const onUpdate = vi.fn((change: (draft: typeof state) => void) =>
      change(state),
    );
    render(
      <ReadinessDashboard
        state={state}
        onUpdate={onUpdate}
        onNavigate={vi.fn()}
        loadOperations={vi.fn().mockResolvedValue(null)}
      />,
    );
    fireEvent.click(screen.getByText("Milestone checks"));
    fireEvent.change(screen.getByLabelText("Milestone name"), {
      target: { value: "One month out" },
    });
    fireEvent.change(screen.getByLabelText("Milestone due date"), {
      target: { value: "2027-05-01" },
    });
    fireEvent.change(screen.getByLabelText("Asset Tracker planning case ID"), {
      target: { value: " wedding-case " },
    });
    fireEvent.change(screen.getByLabelText("Required guest fields"), {
      target: { value: "email, custom_fields.meal" },
    });
    fireEvent.click(screen.getByLabelText("Guest responses"));
    fireEvent.click(screen.getByLabelText("Venue CSV"));
    fireEvent.click(screen.getByRole("button", { name: "Add milestone" }));

    expect(onUpdate).toHaveBeenCalledTimes(7);
    const readiness = state.readiness as
      | WeddingReadinessPreferences
      | undefined;
    expect(readiness).toMatchObject({
      planning_case_id: "wedding-case",
      active_milestone_id: expect.stringMatching(/^milestone-/),
    });
    expect(readiness?.milestones[0]).toMatchObject({
      name: "One month out",
      due_on: "2027-05-01",
      required_guest_fields: ["email", "custom_fields.meal"],
    });
    expect(readiness?.milestones[0]?.check_ids).not.toContain(
      "guest_responses",
    );
    expect(readiness?.milestones[0]?.required_seating_exports).not.toContain(
      "venue",
    );
    expect(readiness?.milestones).toHaveLength(2);
  });

  it("shows an all-clear state when a milestone has no enabled checks", async () => {
    const state = toEditorState(createSampleWeddingPlan());
    const milestone = state.readiness?.milestones[0];
    if (!milestone) throw new Error("Expected a readiness milestone");
    milestone.check_ids = [];
    render(
      <ReadinessDashboard
        state={state}
        onUpdate={vi.fn()}
        onNavigate={vi.fn()}
        loadOperations={vi.fn().mockResolvedValue(null)}
      />,
    );

    expect(await screen.findByText("Ready")).toBeVisible();
    expect(screen.getByText("No warnings for this milestone")).toBeVisible();
  });

  it("reports a ledger loading failure", async () => {
    render(
      <ReadinessDashboard
        state={toEditorState(createSampleWeddingPlan())}
        onUpdate={vi.fn()}
        onNavigate={vi.fn()}
        loadOperations={vi.fn().mockRejectedValue(new Error("Ledger offline"))}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Ledger offline");
    });
  });
});
