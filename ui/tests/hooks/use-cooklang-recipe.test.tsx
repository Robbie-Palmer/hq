import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useCooklangRecipe } from "@/hooks/use-cooklang-recipe";

const { parsedRecipe } = vi.hoisted(() => ({
  parsedRecipe: { sections: [] },
}));

vi.mock("@cooklang/cooklang", () => ({
  CooklangParser: class {
    parse() {
      return [parsedRecipe];
    }
  },
}));

describe("useCooklangRecipe", () => {
  it("publishes the recipe and the inputs that produced it", async () => {
    const { result } = renderHook(() => useCooklangRecipe("@flour{100%g}", 2));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.recipe).toBe(parsedRecipe);
    expect(result.current.source).toEqual({
      cookBody: "@flour{100%g}",
      scale: 2,
    });
    expect(result.current.error).toBeNull();
  });
});
