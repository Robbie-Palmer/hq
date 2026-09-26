import type { RecipeIngredient } from "recipe-domain";
import { UNIT_LABELS } from "recipe-domain";

function formatScaled(value: number): string {
  return parseFloat(value.toFixed(2)).toString();
}

/** Humanize a slug like "olive-oil" to "olive oil" */
export function humanizeSlug(slug: string): string {
  return slug.replace(/-/g, " ");
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
export function formatAmount(item: RecipeIngredient, scale = 1): string {
  const parts: string[] = [];

  if (item.amount != null) {
    parts.push(formatScaled(item.amount * scale));
  }

  if (item.unit) {
    const labels = UNIT_LABELS[item.unit];
    if (labels) {
      const scaledAmount =
        item.amount != null ? item.amount * scale : undefined;
      const displayedAmount =
        scaledAmount != null ? Number(formatScaled(scaledAmount)) : undefined;
      const label =
        displayedAmount != null && displayedAmount !== 1
          ? labels.plural
          : labels.singular;
      if (label) {
        if (labels.noSpace && parts.length > 0) {
          parts[parts.length - 1] += label;
        } else {
          parts.push(label);
        }
      }
    }
  }

  return parts.join(" ");
}

function formatIngredientAmount(
  item: RecipeIngredient,
  scale: number,
): string {
  if (item.unit !== "piece") return formatAmount(item, scale);
  if (item.amount == null) return "";
  return formatScaled(item.amount * scale);
}

export function formatIngredient(item: RecipeIngredient, scale = 1): string {
  const amount = formatIngredientAmount(item, scale);

  const parts: string[] = [];

  if (amount) {
    parts.push(amount);
  }

  parts.push(humanizeSlug(item.ingredient));

  if (item.preparation) {
    parts.push(`(${item.preparation})`);
  }

  if (item.note) {
    parts.push(`\u2013 ${item.note}`);
  }

  return parts.join(" ");
}

export function formatTime(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
