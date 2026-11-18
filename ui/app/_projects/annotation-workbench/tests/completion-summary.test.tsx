import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CompletionSummary } from "../components/completion-summary";
import type { ReviewSummary } from "../domain/review-summary";

const summary: ReviewSummary = {
  reviewed: 12,
  approved: 6,
  needsCorrection: 5,
  rejected: 0,
  notNuclei: 1,
  unsure: 0,
  proposalSelections: [
    { name: "SAM 2.1 small", count: 5 },
    { name: "CellSAM general", count: 4 },
  ],
  correctionQueue: [
    {
      itemId: "item-7",
      itemIndex: 6,
      proposalName: "SAM 2.1 small",
      note: "The bounding box misses the lower edge",
      needsNewBoundary: false,
    },
  ],
};

describe("annotation review completion", () => {
  it("shows saved totals and opens a flagged review", async () => {
    const user = userEvent.setup();
    const openItem = vi.fn();
    render(
      <CompletionSummary
        summary={summary}
        totalItems={12}
        onOpenItem={openItem}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Review complete" }),
    ).toBeVisible();
    expect(screen.getByText("All 12 of 12 decisions are saved.")).toBeVisible();
    expect(screen.getByText("SAM 2.1 small 5")).toBeVisible();
    expect(screen.getByText("CellSAM general 4")).toBeVisible();
    expect(screen.getByText("SAM 2.1 small needs correction")).toBeVisible();
    expect(
      screen.getByText("The bounding box misses the lower edge"),
    ).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Review first flagged item" }),
    );
    expect(openItem).toHaveBeenCalledWith(6);
  });

  it("omits the correction queue when every usable mask is approved", async () => {
    const user = userEvent.setup();
    const openItem = vi.fn();
    render(
      <CompletionSummary
        summary={{
          ...summary,
          needsCorrection: 0,
          correctionQueue: [],
        }}
        totalItems={12}
        onOpenItem={openItem}
      />,
    );

    expect(screen.queryByText("Correction queue")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Review all decisions" }),
    );
    expect(openItem).toHaveBeenCalledWith(0);
  });
});
