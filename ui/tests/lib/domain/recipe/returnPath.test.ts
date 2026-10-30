import { describe, expect, it } from "vitest";
import {
  recipeSaveReturnPath,
  safeRecipeReturnPath,
} from "@/lib/domain/recipe/returnPath";

const ORIGIN = "https://recipes.example.test";

describe("safeRecipeReturnPath", () => {
  it("keeps same-origin recipe paths, queries, and fragments", () => {
    expect(
      safeRecipeReturnPath("/recipes/onboarding?step=box#choices", ORIGIN),
    ).toBe("/recipes/onboarding?step=box#choices");
  });

  it.each([
    null,
    "https://attacker.example/recipes/onboarding",
    "//attacker.example/recipes/onboarding",
    "/recipes/../attacker.example",
    "/recipes/..//attacker.example",
    "/projects/recipe-site",
  ])("rejects unsafe return target %s", (value) => {
    expect(safeRecipeReturnPath(value, ORIGIN)).toBeNull();
  });
});

describe("recipeSaveReturnPath", () => {
  it("adds the saved recipe to an onboarding return while preserving state", () => {
    expect(
      recipeSaveReturnPath(
        "/recipes/onboarding?step=box#choices",
        "lentil-soup",
        ORIGIN,
      ),
    ).toBe("/recipes/onboarding?step=box&authored=lentil-soup#choices");
  });

  it("leaves other safe recipe returns unchanged", () => {
    expect(
      recipeSaveReturnPath("/recipes/kitchen?tab=mine", "lentil-soup", ORIGIN),
    ).toBe("/recipes/kitchen?tab=mine");
  });

  it("rejects unsafe return targets", () => {
    expect(
      recipeSaveReturnPath(
        "https://attacker.example/recipes/onboarding",
        "lentil-soup",
        ORIGIN,
      ),
    ).toBeNull();
  });
});
