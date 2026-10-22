import { canonicalEquipment } from "./canonical-equipment-data.js";
import { canonicalIngredients } from "./canonical-ingredients-data.js";
import {
  canonicalizeCookwareList,
  type EquipmentCanonicalizationDecision,
} from "./equipment-canonicalization.js";
import {
  canonicalizeRecipeIngredients,
  type IngredientCanonicalizationDecision,
} from "./ingredient-canonicalization.js";
import { buildOntology, buildOntologyIndex } from "./slug-matching.js";
import type { DatasetRecipeAdaptation } from "../schemas/extracted-dataset-recipe.js";

export type AdaptedDatasetRecipe = Extract<
  DatasetRecipeAdaptation,
  { status: "adapted" }
>;

export interface DatasetProductCanonicalization {
  adaptation: AdaptedDatasetRecipe;
  ingredientDecisions: IngredientCanonicalizationDecision[];
  equipmentDecisions: EquipmentCanonicalizationDecision[];
}

const ingredientOntology = buildOntology(
  canonicalIngredients.ingredients,
  "ingredient",
);
const ingredientIndex = buildOntologyIndex(ingredientOntology);
const equipmentOntology = buildOntology(
  canonicalEquipment.equipment,
  "equipment",
);
const equipmentIndex = buildOntologyIndex(equipmentOntology);

export function canonicalizeDatasetRecipe(
  adaptation: AdaptedDatasetRecipe,
): DatasetProductCanonicalization {
  const ingredients = canonicalizeRecipeIngredients(
    adaptation.recipe,
    ingredientOntology,
    ingredientIndex,
  );
  const equipment = canonicalizeCookwareList(
    ingredients.recipe.cookware,
    equipmentOntology,
    equipmentIndex,
  );
  const recipe = {
    ...ingredients.recipe,
    cookware: equipment.cookware,
  };

  return {
    adaptation: {
      ...adaptation,
      recipe,
      cooklang: {
        ...adaptation.cooklang,
        derived: recipe,
      },
    },
    ingredientDecisions: ingredients.decisions,
    equipmentDecisions: equipment.decisions,
  };
}
