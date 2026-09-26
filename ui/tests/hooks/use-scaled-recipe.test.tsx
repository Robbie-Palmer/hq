import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCooklangRecipe } from "@/hooks/use-cooklang-recipe";
import { useScaledRecipe } from "@/hooks/use-scaled-recipe";
import { buildScaledRecipeParts } from "@/lib/domain/recipe/cooklangTransform";
import type { RecipeDetailView } from "@/lib/domain/recipe/recipeViews";

vi.mock("@/hooks/use-cooklang-recipe", () => ({
  useCooklangRecipe: vi.fn(),
}));

vi.mock("@/lib/domain/recipe/cooklangTransform", () => ({
  buildScaledRecipeParts: vi.fn(),
}));

const recipe: RecipeDetailView = {
  slug: "test-recipe",
  title: "Test Recipe",
  description: "A recipe used in tests.",
  date: "2026-05-23",
  cuisine: ["Test"],
  tags: [],
  servings: 2,
  cookBody: "@flour{100%g}\n",
  cookware: ["bowl"],
  ingredientGroups: [
    {
      items: [{ ingredient: "flour", name: "Flour", amount: 100, unit: "g" }],
    },
  ],
  instructions: ["Add flour to bowl."],
};

describe("useScaledRecipe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears a previous transform failure when a new scale request starts", async () => {
    const transformFailure = new Error("Transient transform failure");
    const parsedOriginal = { id: "original" };
    const parsedScaledTwo = { id: "scaled-2" };
    const parsedScaledThree = { id: "scaled-3" };
    const scaledParts = {
      cookware: ["bowl"],
      ingredientGroups: [
        { items: [{ ingredient: "flour", amount: 150, unit: "g" }] },
      ],
      instructions: ["Add 150g of flour to the bowl."],
      instructionSdk: undefined,
    };

    let scaledPhase: "initial" | "retry-loading" | "retry-ready" = "initial";

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
    vi.mocked(useCooklangRecipe).mockImplementation((cookBody, scale) => {
      if (!cookBody) {
        return { recipe: null, source: null, loading: false, error: null };
      }

      if (scale === undefined) {
        return {
          recipe: parsedOriginal as never,
          source: { cookBody, scale: undefined },
          loading: false,
          error: null,
        };
      }

      if (scale === 2) {
        return {
          recipe: parsedScaledTwo as never,
          source: { cookBody, scale: 2 },
          loading: false,
          error: null,
        };
      }

      if (scale === 3 && scaledPhase === "retry-loading") {
        return {
          recipe: parsedScaledTwo as never,
          source: { cookBody, scale: 2 },
          loading: true,
          error: null,
        };
      }

      if (scale === 3) {
        return {
          recipe: parsedScaledThree as never,
          source: { cookBody, scale: 3 },
          loading: false,
          error: null,
        };
      }

      throw new Error(`Unexpected scale ${scale}`);
    });

    vi.mocked(buildScaledRecipeParts)
      .mockImplementationOnce(() => {
        throw transformFailure;
      })
      .mockReturnValue(scaledParts as never);

    const { result, rerender } = renderHook(
      ({ scale }) => useScaledRecipe(recipe, scale),
      {
        initialProps: { scale: 2 },
      },
    );

    await waitFor(() => {
      expect(result.current.isScaling).toBe(false);
      expect(result.current.error).toBe(transformFailure);
    });

    scaledPhase = "retry-loading";
    rerender({ scale: 3 });

    expect(result.current.isScaling).toBe(true);
    expect(result.current.error).toBeNull();

    scaledPhase = "retry-ready";
    rerender({ scale: 3 });

    await waitFor(() => {
      expect(result.current.isScaling).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.scaleMultiplier).toBe(1);
      expect(result.current.view.instructions).toEqual(
        scaledParts.instructions,
      );
    });
  });
});
