import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CookingOutcomeDialog } from "@/components/recipes/cooking-outcome-dialog";

describe("CookingOutcomeDialog", () => {
  it("keeps the eaten and leftover portion counts coupled", () => {
    const onSave = vi.fn();
    render(
      <CookingOutcomeDialog
        recipeTitle="Household stew"
        servings={4}
        onBack={() => {}}
        onSave={onSave}
      />,
    );

    expect(screen.getByRole("dialog").tagName).toBe("DIALOG");
    expect(
      screen.getByText("3 portions eaten · 1 saved for later"),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Increase leftover portions" }),
    );
    expect(
      screen.getByText("2 portions eaten · 2 saved for later"),
    ).toBeTruthy();
    fireEvent.change(
      screen.getByRole("combobox", { name: "Leftover storage" }),
      { target: { value: "fridge" } },
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "Leftover audience" }),
      { target: { value: "household" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save leftovers" }));

    expect(onSave).toHaveBeenCalledWith({
      leftoverPortions: 2,
      leftoverStorage: "fridge",
      leftoverUseBy: expect.any(String),
      audience: "household",
    });
  });

  it("does not allow more leftovers than the recipe yield", () => {
    render(
      <CookingOutcomeDialog
        recipeTitle="One portion soup"
        servings={1}
        onBack={() => {}}
        onSave={() => {}}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Increase leftover portions" }),
    ).toBeDisabled();
    expect(
      screen.getByText("0 portions eaten · 1 saved for later"),
    ).toBeTruthy();
  });
});
