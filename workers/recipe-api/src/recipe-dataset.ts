import { count, desc } from "drizzle-orm";
import type { Db } from "recipe-db";
import * as schema from "recipe-db/schema";
import { SavedRecipePayloadSchema } from "recipe-domain/serialization";
import { readableRecipeFilter } from "./recipe-access";

type DatasetInspectionOptions = {
  sampleSize: number;
  top: number;
};

type Frequency = {
  label: string;
  recipes: Set<string>;
};

type SavedRecipePayload = ReturnType<typeof SavedRecipePayloadSchema.parse>;

type RecipeSampleRow = {
  id: string;
  body: string | null;
};

function parseRecipeBody(body: string | null) {
  let decoded: unknown;
  try {
    decoded = body ? JSON.parse(body) : undefined;
  } catch {
    return undefined;
  }
  const payload = SavedRecipePayloadSchema.safeParse(decoded);
  return payload.success ? payload.data : undefined;
}

function recordFrequency(
  frequencies: Map<string, Frequency>,
  label: string,
  recipeId: string,
) {
  const trimmed = label.trim();
  if (!trimmed) return;
  const key = trimmed.toLocaleLowerCase("en-US");
  const frequency = frequencies.get(key) ?? {
    label: trimmed,
    recipes: new Set<string>(),
  };
  frequency.recipes.add(recipeId);
  frequencies.set(key, frequency);
}

function topFrequencies(
  frequencies: Map<string, Frequency>,
  limit: number,
  labelKey: "cuisine" | "ingredient",
) {
  return [...frequencies.values()]
    .map(({ label, recipes }) => ({
      [labelKey]: label,
      recipeCount: recipes.size,
    }))
    .sort(
      (left, right) =>
        right.recipeCount - left.recipeCount ||
        String(left[labelKey]).localeCompare(String(right[labelKey])),
    )
    .slice(0, limit);
}

function recordRecipeSample(
  aggregation: ReturnType<typeof createSampleAggregation>,
  recipeId: string,
  payload: SavedRecipePayload,
) {
  aggregation.parseQuality.validPayloads += 1;
  if (payload.recipe.instructionSdk) {
    aggregation.parseQuality.withInstructionSdk += 1;
  }
  if (payload.recipe.canonical) aggregation.provenance.withCanonicalUrl += 1;
  else aggregation.provenance.withoutCanonicalUrl += 1;

  const recipeIngredients = new Set(
    payload.recipe.ingredientGroups.flatMap((group) =>
      group.items.map((item) => item.ingredient),
    ),
  );
  if (recipeIngredients.size > 0) aggregation.coverage.withIngredients += 1;
  if (payload.recipe.cuisine.length > 0) aggregation.coverage.withCuisine += 1;
  if (payload.recipe.cookware.length > 0) aggregation.coverage.withCookware += 1;

  for (const ingredient of recipeIngredients) {
    recordFrequency(aggregation.ingredients, ingredient, recipeId);
  }
  for (const cuisine of new Set(payload.recipe.cuisine)) {
    recordFrequency(aggregation.cuisines, cuisine, recipeId);
  }
}

function createSampleAggregation() {
  return {
    parseQuality: {
      validPayloads: 0,
      invalidPayloads: 0,
      withInstructionSdk: 0,
    },
    provenance: { withCanonicalUrl: 0, withoutCanonicalUrl: 0 },
    coverage: {
      withCuisine: 0,
      withIngredients: 0,
      withCookware: 0,
    },
    ingredients: new Map<string, Frequency>(),
    cuisines: new Map<string, Frequency>(),
  };
}

function inspectRecipeSample(rows: RecipeSampleRow[]) {
  const aggregation = createSampleAggregation();
  for (const row of rows) {
    const payload = parseRecipeBody(row.body);
    if (!payload) {
      aggregation.parseQuality.invalidPayloads += 1;
      continue;
    }
    recordRecipeSample(aggregation, row.id, payload);
  }
  return aggregation;
}

export async function inspectRecipeDataset(
  db: Db,
  userId: string,
  options: DatasetInspectionOptions,
) {
  return db.transaction(
    async (tx) => {
      const visibilityFilter = await readableRecipeFilter(tx, userId);
      const visibilityRows = await tx
        .select({ visibility: schema.recipe.visibility, value: count() })
        .from(schema.recipe)
        .where(visibilityFilter)
        .groupBy(schema.recipe.visibility);
      const visibility = { public: 0, household: 0, private: 0 };
      for (const row of visibilityRows) {
        visibility[row.visibility] = Number(row.value);
      }
      const visibleRecipes = Object.values(visibility).reduce(
        (total, value) => total + value,
        0,
      );

      const rows = await tx
        .select({
          id: schema.recipe.id,
          body: schema.recipe.body,
        })
        .from(schema.recipe)
        .where(visibilityFilter)
        .orderBy(desc(schema.recipe.updatedAt), desc(schema.recipe.id))
        .limit(options.sampleSize);
      const { parseQuality, provenance, coverage, ingredients, cuisines } =
        inspectRecipeSample(rows);

      return {
        population: {
          visibleRecipes,
          sampledRecipes: rows.length,
          truncated: rows.length < visibleRecipes,
        },
        visibility,
        sample: {
          parseQuality,
          provenance,
          coverage,
          ingredients: {
            distinct: ingredients.size,
            top: topFrequencies(ingredients, options.top, "ingredient"),
          },
          cuisines: {
            distinct: cuisines.size,
            top: topFrequencies(cuisines, options.top, "cuisine"),
          },
        },
      };
    },
    { accessMode: "read only", isolationLevel: "repeatable read" },
  );
}
