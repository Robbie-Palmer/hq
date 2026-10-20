import type { ExtractionRecipe } from "../schemas/stage-artifacts.js";
import { ParsedRecipeSchema, type ParsedRecipe } from "recipe-domain";
import {
  DatasetRecipeAdaptationSchema,
  ExtractedDatasetRecipeSchema,
  type DatasetRecipeAdaptation,
  type ExtractedDatasetRecipe,
} from "../schemas/extracted-dataset-recipe.js";
import {
  buildCooklangDraftFromExtraction,
  deriveRecipeFromStructuredText,
  parseScalarTextNumber,
  recipeToCooklang,
} from "./cooklang.js";
import { splitEquipmentAlternatives } from "./equipment-canonicalization.js";

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function productServings(recipe: ExtractedDatasetRecipe): string | undefined {
  return recipe.metadata.servings ?? recipe.metadata.yields?.[0];
}

function extractionRecipe(recipe: ExtractedDatasetRecipe): ExtractionRecipe {
  return {
    title: recipe.title,
    description: recipe.description,
    cuisine: recipe.metadata.cuisines,
    servings: productServings(recipe),
    prepTime: recipe.metadata.prepTime,
    cookTime: recipe.metadata.cookTime,
    ingredientGroups: recipe.ingredientSections.map((section) => ({
      ...(section.name ? { name: section.name } : {}),
      lines: section.items.map((item) => item.text),
    })),
    instructions: recipe.instructionSections.flatMap((section) =>
      section.items.map((item) => item.text),
    ),
    equipment: recipe.equipment.flatMap((item) =>
      splitEquipmentAlternatives(item.name ?? item.text),
    ),
  };
}

function hasDetailedEquipment(recipe: ExtractedDatasetRecipe): boolean {
  return recipe.equipment.some(
    (item) =>
      item.quantity !== undefined ||
      item.unit !== undefined ||
      item.note !== undefined,
  );
}

function unmappedFields(recipe: ExtractedDatasetRecipe): string[] {
  const metadata = recipe.metadata;
  const optionalFields: Record<string, boolean> = {
    "equipment.details": hasDetailedEquipment(recipe),
    "instructionSections.name": recipe.instructionSections.some(
      (section) => Boolean(section.name),
    ),
    "metadata.authors": Boolean(metadata.authors?.length),
    "metadata.categories": Boolean(metadata.categories?.length),
    "metadata.datePublished": Boolean(metadata.datePublished),
    "metadata.difficulty": Boolean(metadata.difficulty),
    "metadata.images": Boolean(metadata.images?.length),
    "metadata.notes": Boolean(metadata.notes?.length),
    "metadata.nutrition": Boolean(metadata.nutrition),
    "metadata.publishers": Boolean(metadata.publishers?.length),
    "metadata.rating": Boolean(metadata.rating),
    "metadata.sourceMetadata": Boolean(metadata.sourceMetadata),
    "metadata.sourceOrganizations": Boolean(
      metadata.sourceOrganizations?.length,
    ),
    "metadata.totalTime": Boolean(metadata.totalTime),
    "metadata.yields": Boolean(metadata.yields?.length),
    timers: Boolean(recipe.timers.length),
  };
  return [
    "contentSignature",
    "provenance",
    ...Object.entries(optionalFields).flatMap(([field, present]) =>
      present ? [field] : [],
    ),
  ].sort((left, right) => left.localeCompare(right));
}

function parseDiagnostics(recipe: ExtractedDatasetRecipe): string[] {
  const diagnostics: string[] = [];
  const servings = productServings(recipe);
  if (servings && parseScalarTextNumber(servings) === undefined) {
    diagnostics.push(`Could not parse servings: ${servings}`);
  }
  if (
    recipe.metadata.prepTime &&
    parseScalarTextNumber(recipe.metadata.prepTime) === undefined
  ) {
    diagnostics.push(`Could not parse prep time: ${recipe.metadata.prepTime}`);
  }
  if (
    recipe.metadata.cookTime &&
    parseScalarTextNumber(recipe.metadata.cookTime) === undefined
  ) {
    diagnostics.push(`Could not parse cook time: ${recipe.metadata.cookTime}`);
  }
  return diagnostics;
}

function baseAdaptation(recipe: ExtractedDatasetRecipe) {
  return {
    provenance: recipe.provenance,
    contentSignature: recipe.contentSignature,
    unmappedFields: unmappedFields(recipe),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeProductRecipe(recipe: ParsedRecipe): {
  recipe: ParsedRecipe;
  diagnostics: string[];
} {
  const diagnostics: string[] = [];
  const ingredientGroups = recipe.ingredientGroups
    .map((group) => ({
      ...group,
      items: group.items.flatMap((item) => {
        if (!item.ingredient.trim()) {
          diagnostics.push("Dropped an ingredient with an empty normalized name.");
          return [];
        }
        if (item.amount !== undefined && item.amount <= 0) {
          diagnostics.push(
            `Dropped non-positive amount from ingredient: ${item.ingredient}`,
          );
          const { amount: _amount, ...withoutAmount } = item;
          return [withoutAmount];
        }
        return [item];
      }),
    }))
    .filter((group) => group.items.length > 0);
  return {
    recipe: { ...recipe, ingredientGroups },
    diagnostics: unique(diagnostics),
  };
}

function fallbackCooklang(recipe: ExtractedDatasetRecipe) {
  const fallback = deriveRecipeFromStructuredText({
    title: recipe.title,
    description: recipe.description,
    cuisine: recipe.metadata.cuisines?.[0],
    servingsText: productServings(recipe),
    prepTimeText: recipe.metadata.prepTime,
    cookTimeText: recipe.metadata.cookTime,
    ingredientSections: recipe.ingredientSections.map((section) => ({
      ...(section.name ? { name: section.name } : {}),
      lines: section.items.map((item) => item.text),
    })),
    instructionLines: recipe.instructionSections.flatMap((section) =>
      section.items.map((item) => item.text),
    ),
    notes: recipe.metadata.notes ?? [],
    equipment: recipe.equipment.flatMap((item) =>
      splitEquipmentAlternatives(item.name ?? item.text),
    ),
    timers: recipe.timers.map((timer) => ({
      text: timer.text,
      ...(timer.name ? { name: timer.name } : {}),
      ...(typeof timer.quantity === "number"
        ? { quantity: timer.quantity }
        : {}),
      ...(timer.unit ? { unit: timer.unit } : {}),
    })),
  });
  if (!fallback.recipe) {
    return { diagnostics: fallback.diagnostics };
  }

  const productRecipe = {
    ...fallback.recipe,
    cuisine: recipe.metadata.cuisines ?? [],
  };
  return {
    recipe: productRecipe,
    cooklang: recipeToCooklang(productRecipe),
    diagnostics: fallback.diagnostics,
  };
}

export function adaptExtractedDatasetRecipe(
  input: unknown,
): DatasetRecipeAdaptation {
  const recipe = ExtractedDatasetRecipeSchema.parse(input);
  const base = baseAdaptation(recipe);
  if (recipe.completeness === "ingredients-only") {
    return DatasetRecipeAdaptationSchema.parse({
      ...base,
      status: "ingredients-only",
      diagnostics: ["Product recipes require at least one instruction."],
    });
  }

  const diagnostics = parseDiagnostics(recipe);
  const adaptationFailures: string[] = [];
  try {
    const cooklang = buildCooklangDraftFromExtraction(extractionRecipe(recipe));
    if (cooklang.derived) {
      const sanitized = sanitizeProductRecipe(cooklang.derived);
      const productRecipe = ParsedRecipeSchema.safeParse(sanitized.recipe);
      if (productRecipe.success) {
        return {
          ...base,
          status: "adapted",
          recipe: productRecipe.data,
          cooklang: {
            ...cooklang,
            derived: productRecipe.data,
            frontmatter: {
              ...cooklang.frontmatter,
              tags: unique(recipe.metadata.tags ?? []),
              canonical: recipe.provenance.url,
            },
          },
          diagnostics: unique([
            ...diagnostics,
            ...cooklang.diagnostics,
            ...sanitized.diagnostics,
          ]),
        };
      }
      adaptationFailures.push(
        `Cooklang-derived recipe failed product validation: ${productRecipe.error.message}`,
      );
    } else {
      adaptationFailures.push(
        ...cooklang.diagnostics,
        "Cooklang conversion did not produce a product recipe.",
      );
    }
  } catch (error) {
    adaptationFailures.push(
      `Cooklang draft derivation failed: ${errorMessage(error)}`,
    );
  }

  try {
    const fallback = fallbackCooklang(recipe);
    if (fallback.recipe && fallback.cooklang) {
      const sanitized = sanitizeProductRecipe(fallback.recipe);
      const productRecipe = ParsedRecipeSchema.safeParse(sanitized.recipe);
      if (productRecipe.success) {
        return {
          ...base,
          status: "adapted",
          recipe: productRecipe.data,
          cooklang: {
            ...fallback.cooklang,
            derived: productRecipe.data,
            frontmatter: {
              ...fallback.cooklang.frontmatter,
              tags: unique(recipe.metadata.tags ?? []),
              canonical: recipe.provenance.url,
            },
          },
          diagnostics: unique([
            ...diagnostics,
            ...adaptationFailures,
            ...fallback.diagnostics,
            ...sanitized.diagnostics,
            "Used structured-text fallback for product adaptation.",
          ]),
        };
      }
      adaptationFailures.push(
        `Structured-text fallback failed product validation: ${productRecipe.error.message}`,
      );
    } else {
      adaptationFailures.push(...fallback.diagnostics);
    }
  } catch (error) {
    adaptationFailures.push(
      `Structured-text fallback failed: ${errorMessage(error)}`,
    );
  }

  return DatasetRecipeAdaptationSchema.parse({
    ...base,
    status: "unadaptable",
    diagnostics: unique([...diagnostics, ...adaptationFailures]),
  });
}
