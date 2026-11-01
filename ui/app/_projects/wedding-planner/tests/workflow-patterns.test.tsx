import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  WorkflowDataTable,
  WorkflowEmptyState,
  WorkflowErrorState,
  WorkflowFormSection,
  WorkflowLoadingState,
  WorkflowPage,
} from "@/app/_projects/wedding-planner/components/workflow-patterns";
import { render, screen } from "@/tests/test-utils";

describe("wedding workflow patterns", () => {
  it("provides one page, form, and responsive table structure", () => {
    render(
      <WorkflowPage title="Exports" description="Private plan backup">
        <WorkflowFormSection title="Backup" description="JSON plan">
          <button type="button">Export</button>
        </WorkflowFormSection>
        <WorkflowDataTable caption="Backup contents">
          <tbody>
            <tr>
              <th scope="row">Guests</th>
              <td>26 records</td>
            </tr>
          </tbody>
        </WorkflowDataTable>
      </WorkflowPage>,
    );

    expect(screen.getByRole("heading", { name: "Exports" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Backup" })).toBeVisible();
    expect(
      screen.getByRole("table", { name: "Backup contents" }),
    ).toHaveTextContent("26 records");
    expect(screen.getByRole("button", { name: "Export" })).toBeVisible();
  });

  it("announces loading, empty, and error states", async () => {
    const retry = vi.fn();
    const { rerender } = render(<WorkflowLoadingState />);
    expect(
      screen.getByRole("status", { name: "Loading saved wedding plan" }),
    ).toHaveTextContent("Loading saved plan");

    rerender(
      <WorkflowEmptyState
        title="No plan loaded"
        description="Import a backup"
        action={<button type="button">Import</button>}
      />,
    );
    expect(screen.getByText("No plan loaded")).toBeVisible();
    expect(screen.getByRole("button", { name: "Import" })).toBeVisible();

    rerender(<WorkflowErrorState message="Storage disabled" onRetry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Storage disabled");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
