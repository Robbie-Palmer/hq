/**
 * Client-side ingredient display formatting shared by the recipe read view
 * and cook mode: scaling + unit-system conversion + annotation resolution,
 * rendered down to plain strings.
 */

import { normalizeSlug } from "ts-base/strings";
import {
  formatIngredientName,
  getDisplayedScaledAmount,
} from "@/lib/domain/recipe/ingredientText";
import type { InstructionDisplayToken } from "@/lib/domain/recipe/instructionTokens";
import type {
  IngredientGroupView,
  RecipeIngredientView,
} from "@/lib/domain/recipe/recipeViews";
import {
  convertToSystem,
  type MeasurementPreference,
  normalizeUnitToken,
  UNIT_LABELS,
} from "@/lib/domain/recipe/unit";

export type IngredientAnnotation = Pick<
  RecipeIngredientView,
  "preparation" | "note"
>;

/**
 * Record an annotation under a key. If a different annotation already exists
 * for that key (the same ingredient listed twice with conflicting prep/note),
 * mark the key ambiguous with an empty annotation rather than letting one row's
 * note leak onto the other.
 */
function setAnnotation(
  annotations: Map<string, IngredientAnnotation>,
  key: string,
  annotation: IngredientAnnotation,
): void {
  const existing = annotations.get(key);
  if (!existing) {
    annotations.set(key, annotation);
    return;
  }
  if (
    existing.preparation !== annotation.preparation ||
    existing.note !== annotation.note
  ) {
    annotations.set(key, {});
  }
}

export function buildIngredientAnnotationMap(
  ingredientGroups: IngredientGroupView[],
): Map<string, IngredientAnnotation> {
  const annotations = new Map<string, IngredientAnnotation>();

  for (const group of ingredientGroups) {
    for (const item of group.items) {
      const annotation = {
        preparation: item.preparation,
        note: item.note,
      };
      setAnnotation(annotations, item.ingredient, annotation);
      const normalized = normalizeSlug(item.name);
      if (normalized && normalized !== item.ingredient) {
        setAnnotation(annotations, normalized, annotation);
      }
    }
  }

  return annotations;
}

function hasAnnotation(a: IngredientAnnotation): boolean {
  return a.preparation != null || a.note != null;
}

export function resolveIngredientAnnotation(
  item: RecipeIngredientView,
  annotations: Map<string, IngredientAnnotation>,
): IngredientAnnotation {
  const fromIngredientSlug = annotations.get(item.ingredient);
  if (fromIngredientSlug && hasAnnotation(fromIngredientSlug)) {
    return fromIngredientSlug;
  }

  const parsedNameSlug = normalizeSlug(item.name);
  const fromParsedName = annotations.get(parsedNameSlug);
  if (fromParsedName && hasAnnotation(fromParsedName)) {
    return fromParsedName;
  }

  return {};
}

function formatScaled(value: number): string {
  return getDisplayedScaledAmount(value, 1)?.toString() ?? "";
}

const SINGULAR_EPSILON = 1e-9;

/** Apply scale + system conversion, returning the best display (amount, unit). */
function resolveDisplay(
  item: Pick<RecipeIngredientView, "amount" | "unit">,
  scale: number,
  system: MeasurementPreference,
): { amount: number | undefined; unit: RecipeIngredientView["unit"] } {
  const scaledAmount = item.amount == null ? undefined : item.amount * scale;
  if (scaledAmount != null && item.unit) {
    const converted = convertToSystem(scaledAmount, item.unit, system);
    if (converted) return converted;
  }
  return { amount: scaledAmount, unit: item.unit };
}

/** The pluralised unit label to render after the amount, if the unit has one. */
function unitLabelFor(
  amount: number | undefined,
  unit: RecipeIngredientView["unit"],
): { label: string; noSpace: boolean } | null {
  if (!unit) return null;
  const labels = UNIT_LABELS[unit];
  if (!labels) return null;
  const isPlural = amount != null && Math.abs(amount) > 1 + SINGULAR_EPSILON;
  const label = isPlural ? labels.plural : labels.singular;
  if (!label) return null;
  return { label, noSpace: Boolean(labels.noSpace) };
}

function formatAmount(
  item: Pick<RecipeIngredientView, "amount" | "unit">,
  scale: number,
  system: MeasurementPreference,
): string {
  const { amount, unit } = resolveDisplay(item, scale, system);
  const parts: string[] = [];

  if (amount != null) {
    parts.push(formatScaled(amount));
  }

  const unitLabel = unitLabelFor(amount, unit);
  if (unitLabel) {
    if (unitLabel.noSpace && parts.length > 0) {
      parts[parts.length - 1] += unitLabel.label;
    } else {
      parts.push(unitLabel.label);
    }
  }

  return parts.join(" ");
}

/** Convert a note that consists solely of a measurement, leaving prose alone. */
function formatMeasurementNote(
  note: string,
  system: MeasurementPreference,
): string {
  const trimmed = note.trim();
  const amountMatch = /^\d+(?:\.\d+)?/.exec(trimmed);
  if (!amountMatch) return note;
  const amount = Number(amountMatch[0]);
  const unit = normalizeUnitToken(trimmed.slice(amountMatch[0].length).trim());
  if (!Number.isFinite(amount) || !unit) return note;
  const converted = convertToSystem(amount, unit, system);
  if (!converted) return note;
  return formatAmount({ amount, unit }, 1, system);
}

function hasRenderedUnitLabel(
  item: Pick<RecipeIngredientView, "amount" | "unit">,
  scale: number,
  system: MeasurementPreference,
): boolean {
  const { amount, unit } = resolveDisplay(item, scale, system);
  if (!unit || unit === "piece") return false;
  return unitLabelFor(amount, unit) !== null;
}

/**
 * The rendered amount prefix: "piece" quantities are bare scaled numbers,
 * everything else goes through unit conversion and labelling.
 */
function amountText(
  item: Pick<RecipeIngredientView, "amount" | "unit">,
  scale: number,
  system: MeasurementPreference,
): string {
  if (item.unit !== "piece") {
    return formatAmount(item, scale, system);
  }
  if (item.amount == null) return "";
  return formatScaled(item.amount * scale);
}

/**
 * The rendered amount + unit for an ingredient, without the trailing name or
 * annotations (e.g. "500g", "2 tins", "3 cloves", "2"). Used by the shopping
 * list to show the quantity as a distinct, bold chip ahead of the name.
 */
export function formatIngredientAmount(
  item: Pick<RecipeIngredientView, "amount" | "unit">,
  scale: number,
  system: MeasurementPreference,
): string {
  return amountText(item, scale, system);
}

export function formatIngredient(
  item: RecipeIngredientView,
  scale: number,
  system: MeasurementPreference,
  annotation?: IngredientAnnotation,
): string {
  const amount = amountText(item, scale, system);
  const parts: string[] = [];

  if (amount) {
    parts.push(amount);
    if (hasRenderedUnitLabel(item, scale, system)) {
      parts.push("of");
    }
  }

  parts.push(formatIngredientName(item, scale));

  const effectivePreparation = item.preparation ?? annotation?.preparation;
  const effectiveNote = item.note ?? annotation?.note;

  if (effectivePreparation) {
    parts.push(`(${effectivePreparation})`);
  }

  if (effectiveNote) {
    parts.push(`– ${formatMeasurementNote(effectiveNote, system)}`);
  }

  return parts.join(" ");
}

export function formatInstructionIngredientToken(
  token: Extract<InstructionDisplayToken, { type: "ingredient" }>,
  scale: number,
  system: MeasurementPreference,
): string {
  const item = {
    ingredient: token.canonicalName,
    name: token.value,
    unit: token.unit as RecipeIngredientView["unit"],
    amount: token.amount ?? undefined,
  } satisfies RecipeIngredientView;
  const amount = amountText(item, scale, system);
  const parts: string[] = [];

  if (amount) {
    parts.push(amount);
    if (hasRenderedUnitLabel(item, scale, system)) {
      parts.push("of");
    }
  }

  parts.push(formatIngredientName(item, scale));
  return parts.join(" ");
}
