import type { RecipeIngredient } from "recipe-domain";
import { UNIT_LABELS } from "recipe-domain";

function formatScaled(value: number): string {
  return Number.parseFloat(value.toFixed(2)).toString();
}

/** Humanize a slug like "olive-oil" to "olive oil" */
export function humanizeSlug(slug: string): string {
  return slug.replaceAll("-", " ");
}

function scaledAmount(item: RecipeIngredient, scale: number): number | undefined {
  return item.amount == null ? undefined : item.amount * scale;
}

function unitLabel(
  item: RecipeIngredient,
  displayedAmount: number | undefined,
): { label: string; noSpace: boolean } | null {
  if (!item.unit) return null;
  const labels = UNIT_LABELS[item.unit];
  if (!labels) return null;
  const label =
    displayedAmount != null && displayedAmount !== 1
      ? labels.plural
      : labels.singular;
  return label ? { label, noSpace: labels.noSpace ?? false } : null;
}

export function formatAmount(item: RecipeIngredient, scale = 1): string {
  const amount = scaledAmount(item, scale);
  const amountText = amount == null ? "" : formatScaled(amount);
  const displayedAmount = amountText ? Number(amountText) : undefined;
  const unit = unitLabel(item, displayedAmount);
  if (!unit) return amountText;
  if (unit.noSpace && amountText) return `${amountText}${unit.label}`;
  return [amountText, unit.label].filter(Boolean).join(" ");
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
