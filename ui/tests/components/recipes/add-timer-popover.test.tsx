import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AddTimerPopover } from "@/components/recipes/add-timer-popover";
import { RecipeClientStateProvider } from "@/components/recipes/recipe-client-state-provider";

describe("AddTimerPopover", () => {
  it("renders its content above the cook-mode dialog (z-60) when opened", async () => {
    const user = userEvent.setup();
    render(
      <RecipeClientStateProvider>
        <AddTimerPopover
          trigger={
            <button type="button" aria-label="add timer">
              add
            </button>
          }
        />
      </RecipeClientStateProvider>,
    );

    await user.click(screen.getByRole("button", { name: "add timer" }));

    // The popover portals to <body> as a sibling of the full-screen opaque
    // cook-mode dialog (z-[60]); without a higher z-index it renders behind it
    // and tapping add-timer while cooking appears to do nothing.
    const content = document.querySelector('[data-slot="popover-content"]');
    expect(content).not.toBeNull();
    expect(content?.className).toContain("z-[90]");
  });
});
