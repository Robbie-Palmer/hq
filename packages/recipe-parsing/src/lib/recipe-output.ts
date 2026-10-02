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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function sanitizeIngredientAmounts(
  ingredientGroups: unknown,
  warnings: string[],
): void {
  if (!Array.isArray(ingredientGroups)) return;
  for (const group of ingredientGroups) {
    if (!isRecord(group) || !Array.isArray(group.items)) continue;
    for (const item of group.items) {
      if (!isRecord(item)) continue;
      sanitizeOptionalPositiveNumber(item, "amount", warnings);
    }
  }
}

export function sanitizeParsedRecipe(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const root = raw;
  const warnings: string[] = [];

  sanitizeOptionalPositiveNumber(root, "prepTime", warnings);
  sanitizeOptionalPositiveNumber(root, "cookTime", warnings);
  sanitizeIngredientAmounts(root.ingredientGroups, warnings);

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
