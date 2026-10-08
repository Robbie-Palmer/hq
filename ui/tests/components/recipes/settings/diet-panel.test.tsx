import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DietPanel } from "@/components/recipes/settings/diet-panel";
import { recipeQueryKeys } from "@/lib/query/recipe-query-keys";
import { fireEvent, render, screen } from "@/tests/test-utils";

const apiMocks = vi.hoisted(() => ({
  getDietOptions: vi.fn(),
  getDietProfile: vi.fn(),
  saveDietProfile: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: { user: { id: "diet-user" } },
      isPending: false,
    }),
  },
}));

vi.mock("@/lib/api/diet", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/diet")>()),
  ...apiMocks,
}));

vi.mock("@/lib/api/recipe-bootstrap", () => ({
  getRecipeBootstrap: async () => ({
    recipeBox: { recipes: [], box: { completed: true, recipeSlugs: [] } },
    diet: {
      profile: await apiMocks.getDietProfile(),
      options: await apiMocks.getDietOptions(),
    },
    unreadNotificationCount: 0,
  }),
}));

describe("DietPanel", () => {
  beforeEach(() => {
    apiMocks.getDietProfile.mockResolvedValue({
      presetDietKeys: ["vegan"],
      excludedIngredientSlugs: [],
      excludedGroupKeys: [],
      recipeMatchMode: "hide",
    });
    apiMocks.getDietOptions.mockResolvedValue({
      presets: [
        {
          key: "vegan",
          label: "Vegan",
          sub: "No animal products",
          excludedGroupKeys: ["meat", "dairy"],
          excludedIngredientSlugs: [],
        },
      ],
      groups: [
        {
          key: "meat",
          label: "Meat",
          sub: "Meat ingredients",
          broaderGroupKeys: [],
          ingredientSlugs: ["bacon"],
        },
        {
          key: "poultry",
          label: "Poultry",
          sub: "Chicken, turkey, and related ingredients",
          broaderGroupKeys: [],
          ingredientSlugs: ["chicken-breast"],
        },
      ],
      ingredients: [{ slug: "bacon", name: "Bacon", category: "protein" }],
    });
    apiMocks.saveDietProfile.mockImplementation(async (profile) => profile);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("checks groups covered by a selected preset without adding custom state", async () => {
    render(<DietPanel />);

    const meat = await screen.findByRole("button", { name: /Meat/ });
    const poultry = screen.getByRole("button", { name: /Poultry/ });

    expect(meat).toHaveAttribute("aria-pressed", "true");
    expect(meat).toBeDisabled();
    expect(meat).toHaveTextContent("covered by preset");
    expect(poultry).toHaveAttribute("aria-pressed", "false");
    expect(poultry).not.toBeDisabled();
  });

  it("saves poultry as a custom group exclusion", async () => {
    const { queryClient } = render(<DietPanel />);
    const poultry = await screen.findByRole("button", { name: /Poultry/ });

    fireEvent.click(poultry);
    fireEvent.click(screen.getByRole("button", { name: "Save diet profile" }));

    expect(await screen.findByText("saved")).toBeInTheDocument();
    expect(
      queryClient.getQueryData(recipeQueryKeys.bootstrap("diet-user")),
    ).toEqual(
      expect.objectContaining({
        diet: expect.objectContaining({
          profile: expect.objectContaining({
            excludedGroupKeys: ["poultry"],
          }),
        }),
      }),
    );
  });

  it("saves an ingredient outside the canonical catalog as written", async () => {
    render(<DietPanel />);
    const input = await screen.findByLabelText(
      "Search or enter ingredients to exclude",
    );

    fireEvent.change(input, { target: { value: "Nightshade powder" } });
    fireEvent.click(
      screen.getByRole("button", {
        name: 'Save "Nightshade powder" as written',
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save diet profile" }));

    expect(await screen.findByText("saved")).toBeInTheDocument();
    expect(apiMocks.saveDietProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        excludedIngredientSlugs: ["Nightshade powder"],
      }),
    );
    expect(
      screen.getByText("saved as written, automatic matching unavailable"),
    ).toBeInTheDocument();
  });

  it("clears the delayed picker close when unmounted", async () => {
    const { unmount } = render(<DietPanel />);
    const input = await screen.findByLabelText(
      "Search or enter ingredients to exclude",
    );
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");

    fireEvent.focus(input);
    fireEvent.blur(input);
    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});
