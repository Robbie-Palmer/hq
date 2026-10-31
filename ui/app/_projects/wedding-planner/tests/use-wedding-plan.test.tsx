import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { PlannerApplication } from "@/app/_projects/wedding-planner/application/application";
import { createSampleEditorPlan } from "@/app/_projects/wedding-planner/application/bootstrap";
import { useWeddingPlan } from "@/app/_projects/wedding-planner/components/use-wedding-plan";
import { fireEvent, render, screen, waitFor } from "@/tests/test-utils";

function PlanProbe({
  application,
}: Readonly<{ application: PlannerApplication }>) {
  const plan = useWeddingPlan(application);
  const [importError, setImportError] = useState("");
  if (plan.loading) return <p>Loading</p>;
  return (
    <div>
      <p>
        {plan.error ||
          importError ||
          `${plan.state?.guests.length ?? 0} guests`}
      </p>
      <button
        type="button"
        onClick={() =>
          plan.update((draft) => {
            if (draft.guests[0]) draft.guests[0].name = "Updated guest";
          })
        }
      >
        Update guest
      </button>
      <button
        type="button"
        onClick={() =>
          plan.update(() => {
            throw new Error("Invalid change");
          })
        }
      >
        Reject change
      </button>
      <button type="button" onClick={() => void plan.loadSample()}>
        Load sample
      </button>
      <button type="button" onClick={plan.exportPlan}>
        Export plan
      </button>
      <input
        aria-label="Import probe"
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file)
            void plan
              .importPlan(file)
              .catch((error: Error) => setImportError(error.message));
        }}
      />
    </div>
  );
}

function application(
  overrides: Partial<PlannerApplication> = {},
): PlannerApplication {
  return {
    load: vi.fn().mockResolvedValue(createSampleEditorPlan()),
    save: vi.fn().mockResolvedValue(undefined),
    calculateRooms: vi.fn(),
    calculateTables: vi.fn(),
    ...overrides,
  };
}

describe("useWeddingPlan", () => {
  it("loads and saves route-owned plan changes", async () => {
    const app = application();
    render(<PlanProbe application={app} />);
    expect(await screen.findByText("26 guests")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Update guest" }));
    await waitFor(() => expect(app.save).toHaveBeenCalled());
    expect(vi.mocked(app.save).mock.lastCall?.[0].guests[0]?.name).toBe(
      "Updated guest",
    );

    fireEvent.click(screen.getByRole("button", { name: "Reject change" }));
    expect(await screen.findByText("Invalid change")).toBeVisible();
  });

  it("can start an empty route with the sample plan", async () => {
    const app = application({ load: vi.fn().mockResolvedValue(null) });
    render(<PlanProbe application={app} />);
    expect(await screen.findByText("0 guests")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Load sample" }));
    expect(await screen.findByText("26 guests")).toBeVisible();
    expect(app.save).toHaveBeenCalled();
  });

  it("reports load and import failures without discarding the route", async () => {
    const failed = application({
      load: vi.fn().mockRejectedValue(new Error("Storage disabled")),
    });
    const { rerender } = render(<PlanProbe application={failed} />);
    expect(await screen.findByText("Storage disabled")).toBeVisible();

    const app = application({ load: vi.fn().mockResolvedValue(null) });
    rerender(<PlanProbe application={app} />);
    const invalid = Object.assign(new File(["{}"], "invalid.json"), {
      text: async () => "{}",
    });
    fireEvent.change(await screen.findByLabelText("Import probe"), {
      target: { files: [invalid] },
    });
    expect(
      await screen.findByText(/not a compatible wedding planner plan/),
    ).toBeVisible();
  });

  it("imports a valid plan and exports the current route state", async () => {
    const app = application({ load: vi.fn().mockResolvedValue(null) });
    const createObjectURL = vi.fn(() => "blob:wedding-plan");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    render(<PlanProbe application={app} />);
    await screen.findByText("0 guests");
    fireEvent.click(screen.getByRole("button", { name: "Export plan" }));
    expect(createObjectURL).not.toHaveBeenCalled();

    const state = createSampleEditorPlan();
    const valid = Object.assign(
      new File([JSON.stringify(state)], "plan.json"),
      { text: async () => JSON.stringify(state) },
    );
    fireEvent.change(screen.getByLabelText("Import probe"), {
      target: { files: [valid] },
    });
    expect(await screen.findByText("26 guests")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Export plan" }));
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(anchorClick).toHaveBeenCalledOnce();
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledOnce());
    anchorClick.mockRestore();
  });

  it("shows a queued save failure", async () => {
    const app = application({
      save: vi.fn().mockRejectedValue(new Error("Storage full")),
    });
    render(<PlanProbe application={app} />);
    await screen.findByText("26 guests");
    fireEvent.click(screen.getByRole("button", { name: "Update guest" }));
    expect(await screen.findByText("Storage full")).toBeVisible();
  });
});
