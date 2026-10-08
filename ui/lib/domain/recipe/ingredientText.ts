import {
  pluralizeIngredientTerm,
  singularizeIngredientTerm,
} from "recipe-domain/pluralization";

export { formatRecipeIngredientText as formatIngredientStaticText } from "recipe-domain/serialization";

import type { RecipeIngredientView } from "./recipeViews";

type IngredientNameFields = Pick<RecipeIngredientView, "name" | "pluralName">;
type IngredientPluralizationFields = Pick<
  RecipeIngredientView,
  "name" | "pluralName" | "unit" | "amount"
>;

export function getDisplayedScaledAmount(
  amount: number | undefined,
  scale: number,
): number | undefined {
  if (amount == null) {
    return undefined;
  }

  const scaledAmount = amount * scale;
  if (!Number.isFinite(scaledAmount)) {
    return undefined;
  }

  return Number.parseFloat(scaledAmount.toPrecision(2));
}

export function pluralizeIngredientName(item: IngredientNameFields): string {
  if (item.pluralName) return item.pluralName;
  return pluralizeIngredientTerm(item.name);
}

// pluralName is a plural-only override, so singularization uses item.name.
function singularizeIngredientName(item: IngredientNameFields): string {
  return singularizeIngredientTerm(item.name);
}

const SINGULAR_EPSILON = 1e-9;

export function formatIngredientName(
  item: IngredientPluralizationFields,
  scale: number,
): string {
  if (item.unit !== "piece" || item.amount == null) {
    return item.name;
  }

  const scaledAmount = getDisplayedScaledAmount(item.amount, scale);
  if (scaledAmount == null) {
    return item.name;
  }

  if (Math.abs(scaledAmount - 1) < SINGULAR_EPSILON) {
    return singularizeIngredientName(item);
  }

  return pluralizeIngredientName(item);
}
