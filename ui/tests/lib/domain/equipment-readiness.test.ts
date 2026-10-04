import { describe, expect, it } from "vitest";
import {
  applyEquipmentRecipeVisibility,
  buildEquipmentRecipeMatches,
  type EffectiveEquipmentReadiness,
  matchRecipeToEquipment,
} from "@/lib/domain/equipment-readiness";

function readiness(
  mode: "hide" | "warn" | "disabled",
): EffectiveEquipmentReadiness {
  return {
    active: true,
    householdId: "household-1",
    householdName: "Park Road",
    mode,
    ownedSlugs: new Set(["frying-pan"]),
    equipmentNames: new Map([
      ["frying-pan", "frying pan"],
      ["slow-cooker", "slow cooker"],
    ]),
  };
}

describe("equipment readiness", () => {
  it("does not restrict recipes without a household inventory", () => {
    expect(
      matchRecipeToEquipment(
        { cookware: ["slow cooker"] },
        {
          ...readiness("hide"),
          active: false,
          householdId: null,
          householdName: null,
        },
      ),
    ).toEqual({ matches: true, missingEquipment: [] });
  });

  it("names required equipment that the household does not own", () => {
    expect(
      matchRecipeToEquipment(
        { cookware: ["frying pan", "slow cooker"] },
        readiness("warn"),
      ),
    ).toEqual({
      matches: false,
      missingEquipment: [{ slug: "slow-cooker", name: "slow cooker" }],
    });
  });

  it("hides equipment mismatches only in hide mode", () => {
    const recipes = [
      { slug: "stir-fry", cookware: ["frying pan"] },
      { slug: "stew", cookware: ["slow cooker"] },
    ];
    const equipment = readiness("hide");
    const matches = buildEquipmentRecipeMatches(
      recipes,
      equipment,
      (recipe) => recipe,
    );

    expect(
      applyEquipmentRecipeVisibility(recipes, matches, equipment, false),
    ).toEqual({ visibleRecipes: [recipes[0]], hiddenCount: 1 });
    expect(
      applyEquipmentRecipeVisibility(recipes, matches, equipment, true),
    ).toEqual({ visibleRecipes: recipes, hiddenCount: 1 });
    expect(
      applyEquipmentRecipeVisibility(
        recipes,
        matches,
        { ...equipment, mode: "warn" },
        false,
      ),
    ).toEqual({ visibleRecipes: recipes, hiddenCount: 0 });
    expect(
      applyEquipmentRecipeVisibility(
        recipes,
        matches,
        { ...equipment, active: false, mode: "disabled" },
        false,
      ),
    ).toEqual({ visibleRecipes: recipes, hiddenCount: 0 });
  });
});
