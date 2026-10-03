import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  EquipmentListNotice,
  EquipmentWarning,
} from "@/components/recipes/equipment-readiness-notice";
import { RecipeMatchCard } from "@/components/recipes/recipe-card";

vi.mock("@/lib/integrations/cloudflare-images", () => ({
  getImageUrl: (image: string) => image,
}));

describe("equipment readiness presentation", () => {
  const missingEquipment = [{ slug: "slow-cooker", name: "slow cooker" }];

  it("names missing equipment and links to the household inventory", () => {
    render(<EquipmentWarning match={{ matches: false, missingEquipment }} />);

    expect(screen.getByText("Missing equipment: slow cooker.")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Update household equipment" }),
    ).toHaveAttribute("href", "/recipes/settings?section=household");
  });

  it("keeps equipment separate from shopping-list ingredients", () => {
    render(
      <RecipeMatchCard
        recipe={{
          slug: "stew",
          title: "Stew",
          cuisine: [],
          ingredients: [{ slug: "stock", name: "stock" }],
          cookware: ["slow cooker"],
          haveCount: 1,
          missingCount: 0,
          totalCount: 1,
          matchRatio: 0.5,
          missingIngredients: [],
          equipmentHaveCount: 0,
          equipmentTotalCount: 1,
          missingEquipment,
          canCook: false,
        }}
        inList={false}
        onToggleList={vi.fn()}
      />,
    );

    expect(screen.getByText("+1")).toBeVisible();
    expect(screen.getByText(/Missing equipment:/)).toHaveTextContent(
      "Missing equipment: slow cooker",
    );
    expect(screen.queryByText(/Need:/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Update household equipment" }),
    ).toHaveAttribute("href", "/recipes/settings?section=household");
  });

  it("explains warning mode without a hidden-recipe action", () => {
    render(
      <EquipmentListNotice
        hiddenCount={0}
        mode="warn"
        showingHidden={false}
        onToggleHidden={vi.fn()}
      />,
    );

    expect(screen.getByText(/Recipes that need equipment/)).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("lets users reveal recipes hidden by the equipment preference", async () => {
    const user = userEvent.setup();
    const onToggleHidden = vi.fn();
    const view = render(
      <EquipmentListNotice
        hiddenCount={2}
        mode="hide"
        showingHidden={false}
        onToggleHidden={onToggleHidden}
      />,
    );

    expect(screen.getByText(/2 recipes need equipment/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Show anyway" }));
    expect(onToggleHidden).toHaveBeenCalledOnce();

    view.rerender(
      <EquipmentListNotice
        hiddenCount={2}
        mode="hide"
        showingHidden
        onToggleHidden={onToggleHidden}
      />,
    );
    expect(screen.getByRole("button", { name: "Hide again" })).toBeVisible();
  });

  it("renders nothing when hide mode has no mismatches", () => {
    const { container } = render(
      <EquipmentListNotice
        hiddenCount={0}
        mode="hide"
        showingHidden={false}
        onToggleHidden={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
