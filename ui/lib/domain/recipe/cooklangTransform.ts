import type {
  Cookware,
  Ingredient,
  CooklangRecipe as ParsedCooklangRecipe,
  Quantity,
  Step,
  Timer,
} from "@cooklang/cooklang";
import {
  cookware_display_name,
  getQuantityUnit,
  getQuantityValue,
  ingredient_display_name,
  quantity_display,
} from "@cooklang/cooklang";
import type {
  IngredientGroupAccumulator,
  IngredientSlug,
} from "@/lib/domain/recipe/ingredient";
import {
  createIngredientGroupAccumulator,
  mergeIngredientIntoGroup,
  normalizeIngredientSlugForOutput,
} from "@/lib/domain/recipe/ingredient";
import { resolveDisplayedIngredientSlug } from "@/lib/domain/recipe/ingredientIdentity";
import type {
  IngredientGroup,
  RecipeContent,
  RecipeFrontmatter,
  RecipeIngredient,
  RecipeInstructionSdk,
} from "@/lib/domain/recipe/recipe";
import { RecipeContentSchema } from "@/lib/domain/recipe/recipe";
import {
  normalizeUnitToken,
  UNIT_LABELS,
  type Unit,
} from "@/lib/domain/recipe/unit";

type GroupAccumulator = IngredientGroupAccumulator;
type IngredientAnnotations = NonNullable<
  RecipeFrontmatter["ingredientAnnotations"]
>;

export type ScaledRecipeParts = {
  ingredientGroups: IngredientGroup[];
  instructions: string[];
  instructionSdk: RecipeInstructionSdk;
  cookware: string[];
};

/**
 * Per-ingredient amount/unit after unit-conversion recovery (see
 * resolveScaledIngredient). Threaded through the formatting helpers so the
 * recovery happens in one place.
 */
type ResolvedIngredient = {
  amount: number | undefined;
  unit: Unit | undefined;
};

function resolvedIngredientSlug(ingredient: Ingredient): IngredientSlug {
  return resolveDisplayedIngredientSlug(
    ingredient.name,
    ingredient_display_name(ingredient),
  );
}

export type UnitRecovery = {
  /** Result of parser.parse(body) — no scale — so we can read the unit the
   * user originally wrote. cooklang-rs only preserves user-written units when
   * no scale parameter is passed. */
  parsedOriginal: ParsedCooklangRecipe;
  scale: number;
};

/**
 * Resolve the (amount, unit) that should actually be displayed for a scaled
 * ingredient. When cooklang-rs has converted the user's written unit (e.g.
 * pint → c, tsp → tbsp), this restores the written unit using the equivalent
 * `writtenAmount * scale` value.
 *
 * Safe for `=` (fixed-quantity) ingredients: cooklang preserves both the
 * unit and the amount in that case, so the written/emitted units match and
 * the recovery branch is skipped — we trust cooklang's value.
 */
function resolveScaledIngredient(
  scaledIng: Ingredient,
  recovery: { written: Ingredient | undefined; scale: number } | undefined,
): ResolvedIngredient {
  const emittedUnit = normalizeUnitToken(
    getQuantityUnit(scaledIng.quantity) ?? undefined,
  );
  const scaledAmount = resolveQuantityValue(scaledIng.quantity);

  if (!recovery || !recovery.written) {
    return { amount: scaledAmount, unit: emittedUnit };
  }

  const writtenUnit = getQuantityUnit(recovery.written.quantity);
  if (!writtenUnit || writtenUnit === emittedUnit) {
    return { amount: scaledAmount, unit: emittedUnit };
  }

  const writtenAmount = resolveQuantityValue(recovery.written.quantity);
  if (writtenAmount === undefined) {
    return { amount: scaledAmount, unit: emittedUnit };
  }
  return {
    amount: writtenAmount * recovery.scale,
    unit: normalizeUnitToken(writtenUnit) ?? emittedUnit,
  };
}

// getQuantityValue returns NaN for fractions — resolve them from the raw structure.
function resolveQuantityValue(
  quantity: Ingredient["quantity"],
): number | undefined {
  const value = getQuantityValue(quantity);
  if (value !== null && !Number.isNaN(value)) return value;

  const inner = (quantity as Record<string, unknown> | null)?.value;
  if (inner && typeof inner === "object" && "type" in inner) {
    const numObj = inner as { type: string; value: unknown };
    if (
      numObj.type === "number" &&
      numObj.value &&
      typeof numObj.value === "object"
    ) {
      const v = numObj.value as { type: string; value?: unknown };
      if (v.type === "fraction" && v.value && typeof v.value === "object") {
        const f = v.value as { whole: number; num: number; den: number };
        if (f.den !== 0) return f.whole + f.num / f.den;
      }
    }
  }

  return undefined;
}

const PUNCTUATION_RE = /^[\s,;.]+$/;

function isIngredientOnlyStep(step: Step): boolean {
  let hasIngredient = false;
  for (const item of step.items) {
    if (item.type === "ingredient") {
      hasIngredient = true;
    } else if (item.type === "text") {
      if (!PUNCTUATION_RE.test(item.value)) return false;
    } else {
      return false;
    }
  }
  return hasIngredient;
}

function addDeclaredIngredientSlugs(
  step: Step,
  ingredients: Ingredient[],
  declaredSlugs: Set<IngredientSlug>,
): void {
  for (const item of step.items) {
    if (item.type !== "ingredient") continue;
    const ingredient = ingredients[item.index];
    if (!ingredient) continue;
    declaredSlugs.add(resolvedIngredientSlug(ingredient));
    // Cooklang references a declaration by its registered name, even when
    // the declaration uses a purchasing-specific display alias. Keep both
    // identities so a later `@butter{}` does not become an extra generic
    // item after `@butter|unsalted butter{}` was already declared.
    declaredSlugs.add(normalizeIngredientSlugForOutput(ingredient.name));
  }
}

function findDeclaredIngredientSlugs(
  sections: ParsedCooklangRecipe["sections"],
  ingredients: Ingredient[],
): Set<IngredientSlug> {
  const declaredSlugs = new Set<IngredientSlug>();
  for (const section of sections) {
    for (const content of section.content) {
      if (content.type !== "step" || !isIngredientOnlyStep(content.value)) {
        continue;
      }
      addDeclaredIngredientSlugs(content.value, ingredients, declaredSlugs);
    }
  }
  return declaredSlugs;
}

/**
 * The free-text form of a timer quantity (e.g. `~{package instructions}`),
 * which the cooklang parser keeps as a text value; null for numeric timers.
 */
function timerQuantityText(timer: Timer): string | null {
  const value = (timer.quantity as { value?: unknown } | null)?.value;
  if (value && typeof value === "object" && "type" in value) {
    const inner = value as { type: string; value?: unknown };
    if (inner.type === "text" && typeof inner.value === "string") {
      // Empty text falls through to the numeric path rather than blanking the
      // display (defensive — the parser rejects `~{}` before we get here).
      return inner.value.trim() || null;
    }
  }
  return null;
}

function formatTimerDisplay(timer: Timer): string {
  const text = timerQuantityText(timer);
  if (text !== null) return text;
  const qty = resolveQuantityValue(timer.quantity);
  const unit = getQuantityUnit(timer.quantity);
  return [qty !== undefined ? String(qty) : null, unit]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function timerDurationSeconds(timer: Timer): number | null {
  const qty = resolveQuantityValue(timer.quantity);
  if (qty === undefined) return null;
  const unit = getQuantityUnit(timer.quantity)?.toLowerCase();
  switch (unit) {
    case "s":
    case "sec":
    case "secs":
    case "second":
    case "seconds":
      return qty;
    case "m":
    case "min":
    case "mins":
    case "minute":
    case "minutes":
      return qty * 60;
    case "h":
    case "hr":
    case "hrs":
    case "hour":
    case "hours":
      return qty * 3600;
    default:
      return null;
  }
}

function formatCookwareDisplay(cookware: Cookware): string {
  return cookware_display_name(cookware);
}

function formatIngredientDisplay(ingredient: Ingredient): string {
  return ingredient_display_name(ingredient);
}

function formatInstructionIngredient(
  resolved: ResolvedIngredient,
  displayValue: string,
): string {
  const { amount, unit } = resolved;
  if (amount === undefined) return displayValue;

  if (unit === "piece") {
    return `${amount} ${displayValue}`;
  }

  if (unit) {
    const unitLabel = UNIT_LABELS[unit];
    const label = amount === 1 ? unitLabel.singular : unitLabel.plural;
    const separator = unitLabel.noSpace ? "" : " ";
    return `${amount}${separator}${label} of ${displayValue}`;
  }

  return `${amount} ${displayValue}`;
}

function formatInlineQuantityDisplay(quantity: Quantity): string {
  return quantity_display(quantity);
}

function buildIngredientGroupItem(
  ingredient: Ingredient,
  resolved: ResolvedIngredient,
  annotations: IngredientAnnotations,
): RecipeIngredient {
  const registeredSlug: IngredientSlug = normalizeIngredientSlugForOutput(
    ingredient.name,
  );
  const ingSlug = resolvedIngredientSlug(ingredient);
  const ann = annotations[ingSlug] ?? annotations[registeredSlug];

  return {
    ingredient: ingSlug,
    ...(resolved.amount !== undefined && { amount: resolved.amount }),
    ...(resolved.unit !== undefined && { unit: resolved.unit }),
    ...(ann?.preparation && { preparation: ann.preparation }),
    ...(ann?.note && { note: ann.note }),
  };
}

function collectStepIngredients(
  step: Step,
  ingredients: Ingredient[],
  resolved: ResolvedIngredient[],
  currentGroup: GroupAccumulator,
  annotations: IngredientAnnotations,
  declaredSlugs: Set<IngredientSlug>,
  isDeclaration: boolean,
): void {
  for (const item of step.items) {
    if (item.type !== "ingredient") continue;

    const ingredient = ingredients[item.index];
    const resolvedIngredient = resolved[item.index];
    if (!ingredient || !resolvedIngredient) continue;
    const ingredientSlug = resolvedIngredientSlug(ingredient);
    if (!isDeclaration && declaredSlugs.has(ingredientSlug)) continue;
    mergeIngredientIntoGroup(
      currentGroup,
      buildIngredientGroupItem(ingredient, resolvedIngredient, annotations),
    );
  }
}

function stepToText(
  step: Step,
  ingredients: Ingredient[],
  resolved: ResolvedIngredient[],
  cookware: Cookware[],
  inlineQuantities: string[],
  timers: Timer[],
): string {
  return step.items
    .map((item) => {
      switch (item.type) {
        case "text":
          return item.value;
        case "ingredient":
          return formatInstructionIngredient(
            resolved[item.index]!,
            formatIngredientDisplay(ingredients[item.index]!),
          );
        case "cookware":
          return formatCookwareDisplay(cookware[item.index]!);
        case "inlineQuantity":
          return inlineQuantities[item.index] ?? "";
        case "timer":
          return formatTimerDisplay(timers[item.index]!);
        default:
          return "";
      }
    })
    .join("")
    .trim();
}

// Runs in both Node (build time) and the browser (after WASM scaling), so
// keep the module free of fs / gray-matter / other Node-only imports.
export function buildScaledRecipeParts(
  parsed: ParsedCooklangRecipe,
  annotations: IngredientAnnotations = {},
  unitRecovery?: UnitRecovery,
): ScaledRecipeParts {
  const inlineQuantities = parsed.inlineQuantities.map(
    formatInlineQuantityDisplay,
  );
  const { sections, ingredients, cookware, timers } = parsed;

  const resolvedIngredients: ResolvedIngredient[] = ingredients.map(
    (ingredient, i) =>
      resolveScaledIngredient(
        ingredient,
        unitRecovery
          ? {
              written: unitRecovery.parsedOriginal.ingredients[i],
              scale: unitRecovery.scale,
            }
          : undefined,
      ),
  );

  const getOrCreateNamedGroup = (
    name: string,
    groups: GroupAccumulator[],
    namedGroups: Map<string, GroupAccumulator>,
  ): GroupAccumulator => {
    const existing = namedGroups.get(name);
    if (existing) return existing;

    const group = createIngredientGroupAccumulator(name);
    groups.push(group);
    namedGroups.set(name, group);
    return group;
  };

  let currentGroup: GroupAccumulator = createIngredientGroupAccumulator();
  const groups: GroupAccumulator[] = [currentGroup];
  const namedGroups = new Map<string, GroupAccumulator>();
  const instructions: string[] = [];
  const ingredientNames = ingredients.map((ingredient) =>
    resolvedIngredientSlug(ingredient).replaceAll("-", " "),
  );
  const ingredientDisplayValues = ingredients.map(formatIngredientDisplay);
  const ingredientAmounts = resolvedIngredients.map((r) => r.amount ?? null);
  const ingredientUnits = resolvedIngredients.map((r) => r.unit ?? null);
  // The registered name is the canonical one (`#baking tray|tray{}` → "baking
  // tray"); the display value is the alias shown inline ("tray"). The equipment
  // list uses the canonical name, steps keep the authored wording.
  const cookwareNames = cookware.map((item) => item.name);
  const cookwareDisplayValues = cookware.map(formatCookwareDisplay);
  const timerDisplayValues = timers.map(formatTimerDisplay);
  const timerDurations = timers.map(timerDurationSeconds);
  const declaredIngredientSlugs = findDeclaredIngredientSlugs(
    sections,
    ingredients,
  );

  for (const section of sections) {
    if (section.name !== null) {
      currentGroup = getOrCreateNamedGroup(section.name, groups, namedGroups);
    }

    for (const content of section.content) {
      if (content.type === "text") continue;

      const step = content.value;
      const isDeclaration = isIngredientOnlyStep(step);
      // Declared slugs are counted only from their declaration row; ingredients
      // without declarations are still collected from instruction steps.
      collectStepIngredients(
        step,
        ingredients,
        resolvedIngredients,
        currentGroup,
        annotations,
        declaredIngredientSlugs,
        isDeclaration,
      );

      if (isDeclaration) {
        continue;
      }

      const text = stepToText(
        step,
        ingredients,
        resolvedIngredients,
        cookware,
        inlineQuantities,
        timers,
      );
      if (text) instructions.push(text);
    }
  }

  const ingredientGroups: IngredientGroup[] = groups
    .filter((g) => g.items.length > 0)
    .map(
      ({ itemIndexByIngredient: _itemIndexByIngredient, ...group }) => group,
    );

  return {
    ingredientGroups,
    instructions,
    cookware: [...new Set(cookwareNames.map((v) => v.trim().toLowerCase()))],
    instructionSdk: {
      sections: sections.map((s) => ({
        ...s,
        content: s.content.filter(
          (c) => c.type !== "step" || !isIngredientOnlyStep(c.value),
        ),
      })),
      ingredientNames,
      ingredientDisplayValues,
      ingredientAmounts,
      ingredientUnits,
      cookwareDisplayValues,
      inlineQuantityDisplayValues: inlineQuantities,
      timerDisplayValues,
      timerDurationSeconds: timerDurations,
    },
  };
}

export function buildRecipeContentFromParsed(
  parsed: ParsedCooklangRecipe,
  frontmatter: RecipeFrontmatter,
  slug: string,
  cookBody: string,
): RecipeContent {
  const annotations = frontmatter.ingredientAnnotations ?? {};
  const parts = buildScaledRecipeParts(parsed, annotations);

  return RecipeContentSchema.parse({
    slug,
    cookBody,
    title: frontmatter.title,
    description: frontmatter.description,
    date: frontmatter.date,
    cuisine: frontmatter.cuisine,
    servings: frontmatter.servings,
    prepTime: frontmatter.prepTime,
    cookTime: frontmatter.cookTime,
    tags: frontmatter.tags ?? [],
    cookware: parts.cookware,
    image: frontmatter.image,
    imageAlt: frontmatter.imageAlt,
    canonical: frontmatter.canonical,
    ingredientGroups: parts.ingredientGroups,
    instructions: parts.instructions,
    instructionSdk: parts.instructionSdk,
  });
}
