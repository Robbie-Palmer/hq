import posthog from "posthog-js";
import { isPreviewDeployment } from "@/lib/preview-environment";

export const RECIPE_PRODUCT_EVENT = "recipe_product_used";
export const RECIPE_VALUE_EVENT = "recipe_value_reached";

export type RecipeProductActivity =
  | "cook_mode_started"
  | "recipe_cooked"
  | "kitchen_ingredient_added"
  | "recipe_viewed"
  | "shopping_item_checked"
  | "shopping_trip_completed"
  | "shopping_recipe_added"
  | "timer_started";

export type RecipeValueMoment = "recipe_cooked" | "shopping_trip_completed";

type RecipeAnalyticsProperties = Record<
  string,
  boolean | number | string | null | undefined
>;

export function recipeAnalyticsEnvironment(
  hostname = globalThis.location?.hostname,
): "development" | "preview" | "production" {
  if (process.env.NODE_ENV !== "production") return "development";
  return hostname && isPreviewDeployment(hostname) ? "preview" : "production";
}

function baseProperties(): RecipeAnalyticsProperties {
  return {
    app_area: "recipes",
    environment: recipeAnalyticsEnvironment(),
  };
}

export function captureRecipeEvent(
  event: string,
  properties: RecipeAnalyticsProperties = {},
): void {
  posthog.capture(event, { ...properties, ...baseProperties() });
}

export function captureRecipeProductActivity(
  activity: RecipeProductActivity,
  properties: RecipeAnalyticsProperties = {},
): void {
  captureRecipeEvent(RECIPE_PRODUCT_EVENT, { ...properties, activity });
}

/**
 * Record an outcome where the recipe product has delivered value, while also
 * including that outcome in the broader product-usage metrics.
 */
export function captureRecipeValue(
  valueMoment: RecipeValueMoment,
  properties: RecipeAnalyticsProperties = {},
): void {
  const productProperties = { ...properties };
  delete productProperties.value_moment;
  captureRecipeEvent(RECIPE_VALUE_EVENT, {
    ...properties,
    value_moment: valueMoment,
  });
  captureRecipeProductActivity(valueMoment, productProperties);
}
