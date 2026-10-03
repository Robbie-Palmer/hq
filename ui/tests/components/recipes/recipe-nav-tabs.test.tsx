import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/recipes",
  selectedRecipeCount: 0,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));

vi.mock("@/hooks/use-shopping-list", () => ({
  useSelectedRecipeCount: () => mocks.selectedRecipeCount,
}));

import { RecipeNavTabs } from "@/components/recipes/recipe-nav-tabs";

describe("RecipeNavTabs", () => {
  beforeEach(() => {
    mocks.pathname = "/recipes";
    mocks.selectedRecipeCount = 0;
  });

  it("orders sections by priority and marks the current section", () => {
    mocks.pathname = "/recipes/kitchen";

    render(<RecipeNavTabs />);

    const navigation = screen.getByRole("navigation", {
      name: "Recipe sections",
    });
    expect(
      within(navigation)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Recipes", "Shopping", "Kitchen", "Log", "Discover"]);
    expect(
      within(navigation).getByRole("link", {
        name: "Kitchen",
        current: "page",
      }),
    ).toHaveAttribute("href", "/recipes/kitchen");
  });

  it("keeps the shopping count with its navigation item", () => {
    mocks.selectedRecipeCount = 2;

    render(<RecipeNavTabs />);

    expect(
      screen.getByRole("link", {
        name: /Shopping.*2 recipes selected/,
      }),
    ).toHaveAttribute("href", "/recipes/shopping");
  });
});
