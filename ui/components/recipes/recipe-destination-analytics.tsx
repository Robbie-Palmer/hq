"use client";

import { useEffect } from "react";
import { captureRecipeEvent } from "@/lib/analytics/recipe-product";

export function RecipeDestinationAnalytics({
  destination,
}: Readonly<{ destination: "planning" | "shopping" }>) {
  useEffect(() => {
    captureRecipeEvent("recipe_destination_viewed", { destination });
  }, [destination]);
  return null;
}
