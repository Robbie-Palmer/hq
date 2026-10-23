import {
  isRecipeAppRouteSlug,
  isRecipeSlug,
  RECIPE_SLUG_MAX_LENGTH,
  recipeSlugFromPathname,
} from "recipe-domain/slugs";
import { describe, expect, it } from "vitest";

describe("isRecipeSlug", () => {
  it.each(["lentil-soup", "recipe-2", "a"])(
    "accepts a canonical recipe slug: %s",
    (slug) => {
      expect(isRecipeSlug(slug)).toBe(true);
    },
  );

  it.each([
    null,
    undefined,
    "",
    "Lentil-Soup",
    "lentil--soup",
    "-lentil-soup",
    "lentil-soup-",
    "lentil soup",
    "lentil/soup",
    "a".repeat(RECIPE_SLUG_MAX_LENGTH + 1),
  ])("rejects a non-canonical recipe slug: %s", (slug) => {
    expect(isRecipeSlug(slug)).toBe(false);
  });
});

describe("isRecipeAppRouteSlug", () => {
  it.each(["kitchen", "log", "offline", "planning", "saved", "shopping"])(
    "reserves the app route: %s",
    (slug) => {
      expect(isRecipeAppRouteSlug(slug)).toBe(true);
    },
  );
});

describe("recipeSlugFromPathname", () => {
  it("extracts a recipe slug with or without a trailing slash", () => {
    expect(recipeSlugFromPathname("/recipes/lentil-soup")).toBe("lentil-soup");
    expect(recipeSlugFromPathname("/recipes/lentil-soup/")).toBe("lentil-soup");
  });

  it.each([
    "/recipes",
    "/recipes/",
    "/recipes/Lentil-Soup",
    "/recipes/kitchen/",
    "/recipes/log",
    "/recipes/offline",
    "/recipes/planning",
    "/recipes/lentil-soup/edit",
    "/projects/lentil-soup",
  ])("rejects a non-recipe pathname: %s", (pathname) => {
    expect(recipeSlugFromPathname(pathname)).toBeNull();
  });
});
