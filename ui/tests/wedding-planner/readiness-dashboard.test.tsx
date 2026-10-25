import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WeddingReadinessPreferences } from "wedding-planner-domain";
import { ReadinessDashboard } from "@/components/wedding-planner/readiness-dashboard";
import { toEditorState } from "@/lib/wedding-planner/editor-projection";
import { createSampleWeddingPlan } from "@/lib/wedding-planner/sample-plan";

describe("readiness dashboard", () => {
  it("shows wedding readiness with resolvable links", () => {
    const onNavigate = vi.fn();
    render(
      <ReadinessDashboard
        state={toEditorState(createSampleWeddingPlan())}
        onUpdate={vi.fn()}
        onNavigate={onNavigate}
      />,
    );

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
      />,
    );
    fireEvent.click(screen.getByText("Milestone checks"));
    fireEvent.change(screen.getByLabelText("Milestone name"), {
      target: { value: "One month out" },
    });
    fireEvent.change(screen.getByLabelText("Milestone due date"), {
      target: { value: "2027-05-01" },
    });
    fireEvent.change(screen.getByLabelText("Required guest fields"), {
      target: { value: "email, custom_fields.meal" },
    });
    fireEvent.click(screen.getByLabelText("Guest responses"));
    fireEvent.click(screen.getByLabelText("Venue CSV"));
    fireEvent.click(screen.getByRole("button", { name: "Add milestone" }));

    expect(onUpdate).toHaveBeenCalledTimes(6);
    const readiness = state.readiness as
      | WeddingReadinessPreferences
      | undefined;
    expect(readiness).toMatchObject({
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

  it("shows an all-clear state when a milestone has no enabled checks", () => {
    const state = toEditorState(createSampleWeddingPlan());
    const milestone = state.readiness?.milestones[0];
    if (!milestone) throw new Error("Expected a readiness milestone");
    milestone.check_ids = [];
    render(
      <ReadinessDashboard
        state={state}
        onUpdate={vi.fn()}
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.getByText("Ready")).toBeVisible();
    expect(screen.getByText("No warnings for this milestone")).toBeVisible();
  });
});
