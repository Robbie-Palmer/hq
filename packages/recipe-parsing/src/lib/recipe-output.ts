import { RecipeSchema, type Recipe } from "../schemas/ground-truth.js";

export function stripJsonCodeFence(value: string): string {
  const result = value.trim();
  if (!(result.startsWith("```") && result.endsWith("```"))) return result;

  let content = result.slice(3, -3).trim();
  if (content.slice(0, 4).toLowerCase() === "json") {
    content = content.slice(4).trim();
  }
  return content;
}

function sanitizeOptionalPositiveNumber(
  obj: Record<string, unknown>,
  key: string,
  warnings: string[],
): void {
  const value = obj[key];
  if (value === undefined || value === null) return;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return;
  warnings.push(`${key}=${String(value)}`);
  delete obj[key];
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
export function sanitizeParsedRecipe(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") {
    return raw;
  }
  const root = raw as Record<string, unknown>;
  const warnings: string[] = [];

  sanitizeOptionalPositiveNumber(root, "prepTime", warnings);
  sanitizeOptionalPositiveNumber(root, "cookTime", warnings);

  const ingredientGroups = root.ingredientGroups;
  if (Array.isArray(ingredientGroups)) {
    for (const group of ingredientGroups) {
      if (!group || typeof group !== "object") continue;
      const groupObj = group as Record<string, unknown>;
      const items = groupObj.items;
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        sanitizeOptionalPositiveNumber(item as Record<string, unknown>, "amount", warnings);
      }
    }
  }

  if (warnings.length > 0) {
    console.warn(
      `Sanitized non-finite or non-positive optional numeric fields (e.g. prepTime/cookTime) from model output: ${warnings.join(", ")}`,
    );
  }
  return root;
}

export function parseRecipeJsonFromText(raw: string | null | undefined): Recipe {
  if (!raw) {
    throw new Error("Model returned empty content");
  }
  const withoutFence = stripJsonCodeFence(raw);
  const parsed = JSON.parse(withoutFence);
  return RecipeSchema.parse(sanitizeParsedRecipe(parsed));
}
