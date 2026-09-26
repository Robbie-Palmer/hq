import { numericQuantity } from "numeric-quantity";
import {
  CooklangParser,
  getQuantityValue,
  getQuantityUnit,
  ingredient_display_name,
  cookware_display_name,
  quantity_display,
} from "@cooklang/cooklang";
import type {
  Step,
  Ingredient as CkIngredient,
  CooklangRecipe as CkParsedRecipe,
} from "@cooklang/cooklang";
import {
  createIngredientGroupAccumulator,
  mergeIngredientIntoGroup,
} from "recipe-domain";
import { normalizeUnitToken } from "recipe-domain";
import type { ExtractionRecipe, Recipe } from "../schemas/ground-truth.js";
import type { RecipeIngredient } from "recipe-domain";
import type {
  CooklangFrontmatter,
  CooklangRecipe,
  StructuredTextRecipe,
} from "../schemas/stage-artifacts.js";
import { postprocessRecipeOutput } from "./recipe-postprocess.js";

const _cooklangParser = new CooklangParser();

// Regex patterns still used by parseIngredientLine (for structured text → cooklang conversion)
const INGREDIENT_WITH_QUANTITY_RE =
  /@(?<name>[^@#~\{\}\n]+?)\{(?<amount>[^%{}]+)?(?:%(?<unit>[^{}]+))?\}/g;
const INGREDIENT_BARE_RE =
  /@(?<name>[^@#~\{\}\n]+?)(?=[\s.,;:()!?]|$)/g;
const DEFAULT_INFERRED_SERVINGS = 1;

function parseFractionOrNumber(value: string): number | undefined {
  const result = numericQuantity(value);
  return Number.isFinite(result) ? result : undefined;
}

function normalizeIngredientName(name: string): string {
  return name.trim().replace(/\s+/g, "-").toLowerCase();
}

function toCooklangToken(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

interface TokenSpan {
  value: string;
  end: number;
}

function isAsciiDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

function isAsciiLetter(character: string | undefined): boolean {
  return (
    character !== undefined &&
    ((character >= "A" && character <= "Z") ||
      (character >= "a" && character <= "z"))
  );
}

function skipWhitespace(value: string, start: number): number {
  let index = start;
  while (index < value.length && /\s/u.test(value[index]!)) index++;
  return index;
}

function readAsciiWord(value: string, start: number): TokenSpan | undefined {
  if (!isAsciiLetter(value[start])) return undefined;
  let end = start + 1;
  while (isAsciiLetter(value[end])) end++;
  return { value: value.slice(start, end), end };
}

function readDigitsEnd(value: string, start: number): number {
  let end = start;
  while (isAsciiDigit(value[end])) end++;
  return end;
}

function readBasicAmountEnd(value: string, start: number): number {
  const integerEnd = readDigitsEnd(value, start);
  const delimiter = value[integerEnd];
  const hasDecimalOrFraction =
    (delimiter === "." || delimiter === "/") &&
    isAsciiDigit(value[integerEnd + 1]);
  return hasDecimalOrFraction
    ? readDigitsEnd(value, integerEnd + 1)
    : integerEnd;
}

function readCompoundFractionEnd(value: string, integerEnd: number): number {
  const fractionStart = skipWhitespace(value, integerEnd);
  if (fractionStart === integerEnd || !isAsciiDigit(value[fractionStart])) {
    return integerEnd;
  }
  const numeratorEnd = readDigitsEnd(value, fractionStart);
  if (value[numeratorEnd] !== "/" || !isAsciiDigit(value[numeratorEnd + 1])) {
    return integerEnd;
  }
  return readDigitsEnd(value, numeratorEnd + 1);
}

function readAmount(value: string, start: number): TokenSpan | undefined {
  if (!isAsciiDigit(value[start])) return undefined;
  const basicEnd = readBasicAmountEnd(value, start);
  const end = readCompoundFractionEnd(value, basicEnd);
  return { value: value.slice(start, end), end };
}

function isRangeSeparator(character: string | undefined): boolean {
  return character === "-" || character === "–" || character === "—";
}

function isRangeAmount(line: string, start: number, amount: TokenSpan): boolean {
  let left = start;
  while (left > 0 && /\s/u.test(line[left - 1]!)) left--;
  if (isRangeSeparator(line[left - 1])) {
    let previous = left - 1;
    while (previous > 0 && /\s/u.test(line[previous - 1]!)) previous--;
    if (isAsciiDigit(line[previous - 1])) return true;
  }

  let right = skipWhitespace(line, amount.end);
  if (!isRangeSeparator(line[right])) return false;
  right = skipWhitespace(line, right + 1);
  return isAsciiDigit(line[right]);
}

function formatInferredIngredient(
  name: string,
  amount: string,
  unit?: string,
  suffix?: string,
): string {
  const normalizedUnit = normalizeUnitToken(unit);
  const unitSuffix = normalizedUnit ? `%${normalizedUnit}` : "";
  const quantity = `{${amount}${unitSuffix}}`;
  const ingredientSuffix = suffix ? ` ${suffix}` : "";
  return `@${toCooklangToken(name)}${quantity}${ingredientSuffix}`;
}

function ingredientWithKnownUnit(
  line: string,
  amount: TokenSpan,
  unitSpan: TokenSpan | undefined,
): string | undefined {
  if (!unitSpan) return undefined;
  const unit = normalizeUnitToken(unitSpan.value);
  if (!unit) return undefined;
  const nameStart = skipWhitespace(line, unitSpan.end);
  if (nameStart === unitSpan.end || nameStart === line.length) {
    return undefined;
  }
  return formatInferredIngredient(line.slice(nameStart), amount.value, unit);
}

function inferLeadingAmount(line: string): string | undefined {
  const amount = readAmount(line, 0);
  if (!amount || isRangeAmount(line, 0, amount)) return undefined;

  const attachedUnitIngredient = ingredientWithKnownUnit(
    line,
    amount,
    readAsciiWord(line, amount.end),
  );
  if (attachedUnitIngredient) return attachedUnitIngredient;

  const nextStart = skipWhitespace(line, amount.end);
  if (nextStart === amount.end || nextStart === line.length) return undefined;
  const spacedUnitIngredient = ingredientWithKnownUnit(
    line,
    amount,
    readAsciiWord(line, nextStart),
  );
  if (spacedUnitIngredient) return spacedUnitIngredient;

  return formatInferredIngredient(line.slice(nextStart), amount.value);
}

function nameBeforeAmount(line: string, amountStart: number): string | undefined {
  let nameEnd = amountStart;
  while (nameEnd > 0 && /\s/u.test(line[nameEnd - 1]!)) nameEnd--;
  if ("-:,".includes(line[nameEnd - 1]!)) {
    nameEnd--;
    while (nameEnd > 0 && /\s/u.test(line[nameEnd - 1]!)) nameEnd--;
  } else if (nameEnd === amountStart) {
    return undefined;
  }
  return line.slice(0, nameEnd) || undefined;
}

function trailingQuantity(
  line: string,
  amount: TokenSpan,
): { unit?: string; suffix?: string } {
  const suffixStart = skipWhitespace(line, amount.end);
  const possibleUnit = readAsciiWord(line, suffixStart);
  const unit = normalizeUnitToken(possibleUnit?.value);
  let restStart = suffixStart;
  if (unit && possibleUnit) restStart = skipWhitespace(line, possibleUnit.end);
  return { unit, suffix: line.slice(restStart).trim() || undefined };
}

function inferTrailingAmount(line: string): string | undefined {
  for (let index = 1; index < line.length; index++) {
    const amount = readAmount(line, index);
    if (!amount || isRangeAmount(line, index, amount)) continue;
    const name = nameBeforeAmount(line, index);
    if (!name) continue;
    const { unit, suffix } = trailingQuantity(line, amount);
    return formatInferredIngredient(name, amount.value, unit, suffix);
  }
  return undefined;
}

export function inferCooklangIngredientLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return trimmed;
  if (trimmed.includes("@")) return trimmed;
  return (
    inferLeadingAmount(trimmed) ??
    inferTrailingAmount(trimmed) ??
    `@${toCooklangToken(trimmed)}{}`
  );
}

export function parseScalarTextNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const direct = Number(trimmed);
  if (Number.isFinite(direct)) return Math.round(direct);
  const match = trimmed.match(/^\d+/);
  return match ? Number.parseInt(match[0], 10) : undefined;
}

function normalizeInstructionLine(line: string): string {
  return line.replace(/^\s*\d+[.)]\s*/, "").trim();
}

function normalizeCookwareList(values: string[] | undefined): string[] {
  if (!values) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(trimmed);
  }
  return normalized;
}

function inferStructuredTextServings(
  value: string | undefined,
): { servings: number; diagnostic?: string } {
  const parsed = parseScalarTextNumber(value);
  if (parsed && parsed > 0) {
    return { servings: Math.floor(parsed) };
  }
  return {
    servings: DEFAULT_INFERRED_SERVINGS,
    diagnostic:
      value && value.trim().length > 0
        ? `Structured extraction inferred unparseable servings as ${DEFAULT_INFERRED_SERVINGS}.`
        : `Structured extraction inferred missing servings as ${DEFAULT_INFERRED_SERVINGS}.`,
  };
}

function ingredientToCooklang(item: RecipeIngredient): string {
  const name = item.ingredient.replace(/-/g, " ");
  let quantity = "";
  if (item.amount !== undefined || item.unit) {
    const amount = item.amount === undefined ? "" : String(item.amount);
    const unit = item.unit ? `%${item.unit}` : "";
    quantity = `{${amount}${unit}}`;
  }
  return `@${name}${quantity}`;
}

function appendCooklangInstructionLines(
  bodyLines: string[],
  instructions: string[],
): void {
  for (let i = 0; i < instructions.length; i++) {
    if (i > 0) bodyLines.push("");
    bodyLines.push(instructions[i]!);
  }
}

function groupToCooklangLines(recipe: Recipe): string[] {
  const lines: string[] = [];
  for (const group of recipe.ingredientGroups) {
    if (group.name) {
      lines.push(`== ${group.name} ==`);
    }
    for (const item of group.items) {
      lines.push(ingredientToCooklang(item));
    }
    lines.push("");
  }
  return lines;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
export function recipeToCooklang(recipe: Recipe): CooklangRecipe {
  // Build ingredientAnnotations from items that have preparation or note
  const ingredientAnnotations: Record<string, { preparation?: string; note?: string }> = {};
  for (const group of recipe.ingredientGroups) {
    for (const item of group.items) {
      if (item.preparation || item.note) {
        ingredientAnnotations[item.ingredient] = {
          ...(item.preparation ? { preparation: item.preparation } : {}),
          ...(item.note ? { note: item.note } : {}),
        };
      }
    }
  }

  const frontmatter: CooklangFrontmatter = {
    title: recipe.title,
    description: recipe.description,
    cuisine: recipe.cuisine,
    servings: recipe.servings,
    prepTime: recipe.prepTime,
    cookTime: recipe.cookTime,
    tags: [],
    ...(Object.keys(ingredientAnnotations).length > 0
      ? { ingredientAnnotations }
      : {}),
  };
  const instructionLines: string[] = [];
  // Separate instructions with blank lines so each becomes its own Cooklang step
  appendCooklangInstructionLines(instructionLines, recipe.instructions);
  const bodyLines = [
    ...groupToCooklangLines(recipe),
    ...instructionLines,
  ];
  return {
    frontmatter,
    body: bodyLines.join("\n").trim(),
    diagnostics: [],
    derived: (() => {
      const processed = postprocessRecipeOutput(recipe);
      return {
        ...processed,
        cookware: normalizeCookwareList(processed.cookware),
      };
    })(),
  };
}

export function buildCooklangDraftFromExtraction(
  extracted: ExtractionRecipe,
): CooklangRecipe {
  const frontmatter: CooklangFrontmatter = {
    title: extracted.title,
    description:
      extracted.description ??
      `Recipe for ${extracted.title}.`,
    cuisine: extracted.cuisine ?? [],
    servings: parseScalarTextNumber(extracted.servings) ?? DEFAULT_INFERRED_SERVINGS,
    prepTime: parseScalarTextNumber(extracted.prepTime),
    cookTime: parseScalarTextNumber(extracted.cookTime),
    tags: [],
  };

  const bodyLines: string[] = [];
  for (const group of extracted.ingredientGroups) {
    if (group.name) {
      bodyLines.push(`== ${group.name} ==`);
    }
    for (const line of group.lines) {
      bodyLines.push(inferCooklangIngredientLine(line));
    }
    bodyLines.push("");
  }
  appendCooklangInstructionLines(
    bodyLines,
    extracted.instructions.map(normalizeInstructionLine),
  );

  const cooklang: CooklangRecipe = {
    frontmatter,
    body: bodyLines.join("\n").trim(),
    diagnostics: [],
  };
  const derived = deriveRecipeFromCooklang(cooklang);
  if (!derived.derived) return derived;
  return {
    ...derived,
    derived: postprocessRecipeOutput({
      ...derived.derived,
      cookware: normalizeCookwareList(extracted.equipment),
    }),
  };
}

export function buildCooklangDraftFromStructuredText(
  extracted: StructuredTextRecipe,
): CooklangRecipe {
  const frontmatter: CooklangFrontmatter = {
    title: extracted.title,
    description: extracted.description,
    cuisine: extracted.cuisine ? [extracted.cuisine] : [],
    servings: parseScalarTextNumber(extracted.servingsText),
    prepTime: parseScalarTextNumber(extracted.prepTimeText),
    cookTime: parseScalarTextNumber(extracted.cookTimeText),
    tags: [],
  };
  const bodyLines: string[] = [];

  for (const section of extracted.ingredientSections) {
    if (section.name) {
      bodyLines.push(`== ${section.name} ==`);
    }
    for (const line of section.lines) {
      bodyLines.push(inferCooklangIngredientLine(line));
    }
    bodyLines.push("");
  }

  bodyLines.push(...extracted.instructionLines.map(normalizeInstructionLine));

  const cooklang: CooklangRecipe = {
    frontmatter,
    body: bodyLines.join("\n").trim(),
    diagnostics: [],
  };

  const derived = deriveRecipeFromCooklang(cooklang);
  if (!derived.derived) return derived;
  return {
    ...derived,
    derived: postprocessRecipeOutput({
      ...derived.derived,
      cookware: normalizeCookwareList(extracted.equipment),
    }),
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
export function deriveRecipeFromStructuredText(extracted: StructuredTextRecipe): {
  recipe: Recipe | null;
  diagnostics: string[];
} {
  const diagnostics: string[] = [];
  const ingredientGroups: Recipe["ingredientGroups"] = [];

  for (const section of extracted.ingredientSections) {
    const items: RecipeIngredient[] = [];
    for (const line of section.lines) {
      const parsedItems = parseIngredientLine(inferCooklangIngredientLine(line));
      if (parsedItems.length === 0) {
        diagnostics.push(`Could not normalize structured ingredient line: ${line}`);
        continue;
      }
      items.push(...parsedItems);
    }
    if (items.length > 0) {
      ingredientGroups.push({
        ...(section.name ? { name: section.name } : {}),
        items,
      });
    }
  }

  const instructions = extracted.instructionLines
    .map(normalizeInstructionLine)
    .filter((line) => line.length > 0);

  if (ingredientGroups.length === 0) {
    diagnostics.push("No ingredient groups could be derived from structured extraction.");
  }
  if (instructions.length === 0) {
    diagnostics.push("No instruction lines could be derived from structured extraction.");
  }

  const inferredServings = inferStructuredTextServings(extracted.servingsText);
  const recipe: Recipe | null =
    extracted.title &&
    ingredientGroups.length > 0 &&
    instructions.length > 0
      ? {
          title: extracted.title,
          description:
            extracted.description ??
            `Recipe imported from structured extraction for ${extracted.title}.`,
          cuisine: extracted.cuisine ? [extracted.cuisine] : [],
          servings: inferredServings.servings,
          prepTime: parseScalarTextNumber(extracted.prepTimeText),
          cookTime: parseScalarTextNumber(extracted.cookTimeText),
          ingredientGroups,
          instructions,
          cookware: normalizeCookwareList(extracted.equipment),
        }
      : null;

  if (!recipe) {
    diagnostics.push(
      "Structured extraction fallback could not produce a normalized recipe.",
    );
  } else if (inferredServings.diagnostic) {
    diagnostics.push(inferredServings.diagnostic);
  }

  return { recipe: recipe ? postprocessRecipeOutput(recipe) : null, diagnostics };
}

export function parseIngredientLine(line: string): RecipeIngredient[] {
  const items: RecipeIngredient[] = [];
  const seenNames = new Set<string>();
  const remainder = line.replaceAll(INGREDIENT_WITH_QUANTITY_RE, "");

  for (const match of line.matchAll(INGREDIENT_WITH_QUANTITY_RE)) {
    const name = match.groups?.name?.trim();
    if (!name) continue;
    const amountRaw = match.groups?.amount;
    const amount =
      amountRaw && amountRaw.trim().length > 0
        ? parseFractionOrNumber(amountRaw)
        : undefined;
    const unit = normalizeUnitToken(match.groups?.unit?.trim());
    const normalized = normalizeIngredientName(name);
    seenNames.add(normalized);
    items.push({
      ingredient: normalized,
      ...(amount !== undefined ? { amount } : {}),
      ...(unit ? { unit } : {}),
    });
  }
  for (const match of remainder.matchAll(INGREDIENT_BARE_RE)) {
    const name = match.groups?.name?.trim();
    if (!name) continue;
    const normalized = normalizeIngredientName(name);
    if (seenNames.has(normalized)) continue;
    items.push({
      ingredient: normalized,
    });
  }
  return items;
}

// ── Cooklang parser-based derivation ─────────────────────────────────────────

const STEP_PUNCTUATION_RE = /^[\s,;.]+$/;

function isIngredientOnlyStep(step: Step): boolean {
  let hasIngredient = false;
  for (const item of step.items) {
    if (item.type === "ingredient") {
      hasIngredient = true;
    } else if (item.type === "text") {
      if (!STEP_PUNCTUATION_RE.test(item.value)) return false;
    } else {
      return false;
    }
  }
  return hasIngredient;
}

function findDeclaredIngredientSlugs(parsed: CkParsedRecipe): Set<string> {
  const declaredSlugs = new Set<string>();
  for (const section of parsed.sections) {
    for (const content of section.content) {
      if (content.type !== "step" || !isIngredientOnlyStep(content.value)) {
        continue;
      }
      for (const item of content.value.items) {
        if (item.type !== "ingredient") continue;
        const ingredient = parsed.ingredients[item.index]!;
        declaredSlugs.add(normalizeIngredientName(ingredient.name));
      }
    }
  }
  return declaredSlugs;
}

function resolveQuantityValue(ingredient: CkIngredient): number | undefined {
  const value = getQuantityValue(ingredient.quantity);
  if (value !== null && !isNaN(value)) return value;
  // Fallback for fractions (getQuantityValue returns NaN for them)
  const inner = (ingredient.quantity as Record<string, unknown> | null)?.value;
  if (inner && typeof inner === "object" && "type" in inner) {
    const numObj = inner as { type: string; value: unknown };
    if (numObj.type === "number" && numObj.value && typeof numObj.value === "object") {
      const v = numObj.value as { type: string; value?: unknown };
      if (v.type === "fraction" && v.value && typeof v.value === "object") {
        const f = v.value as { whole: number; num: number; den: number };
        if (f.den !== 0) return f.whole + f.num / f.den;
      }
    }
  }
  return undefined;
}

function stepToInstructionText(step: Step, parsed: CkParsedRecipe): string {
  return step.items
    .map((item) => {
      switch (item.type) {
        case "text":
          return item.value;
        case "ingredient":
          return ingredient_display_name(parsed.ingredients[item.index]!);
        case "cookware":
          return cookware_display_name(parsed.cookware[item.index]!);
        case "timer": {
          const timer = parsed.timers[item.index]!;
          const amount = getQuantityValue(timer.quantity);
          const unit = getQuantityUnit(timer.quantity);
          return [
            amount != null && !Number.isNaN(amount) ? String(amount) : null,
            unit,
          ]
            .filter(Boolean)
            .join(" ");
        }
        case "inlineQuantity": {
          const qty = parsed.inlineQuantities[item.index];
          return qty ? quantity_display(qty) : "";
        }
        default:
          return "";
      }
    })
    .join("")
    .trim();
}

/**
 * Fix bare multi-word `@ingredient` references that are missing braces.
 * The cooklang parser only captures a single word for `@name` without braces,
 * so `@long grain rice` is parsed as just `@long`. We detect known multi-word
 * ingredients (those already defined with braces earlier in the body) and add
 * empty braces to bare back-references.
 */
function fixBareMultiWordIngredients(body: string): string {
  // Collect multi-word ingredient names defined with braces: @name{...}
  const definedNames = new Set<string>();
  for (const m of body.matchAll(/@([^@#~{}\n]{2,}?)\{/g)) {
    const name = m[1]!.trimEnd();
    if (name.includes(" ")) definedNames.add(name);
  }
  if (definedNames.size === 0) return body;

  // Sort longest-first so we match "long grain rice" before "long grain"
  const sorted = [...definedNames].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(
    `@(${sorted.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?=\\s|[.,;:()!?]|$)`,
    "g",
  );
  return body.replace(pattern, "@$1{}");
}

type IngredientGroupAccumulator = ReturnType<
  typeof createIngredientGroupAccumulator
>;

type IngredientAnnotation = NonNullable<
  CooklangRecipe["frontmatter"]["ingredientAnnotations"]
>[string];

function buildGroupIngredient(
  slug: string,
  ingredient: CkIngredient,
  annotation: IngredientAnnotation | undefined,
): RecipeIngredient {
  const amount = resolveQuantityValue(ingredient);
  const unit = normalizeUnitToken(
    getQuantityUnit(ingredient.quantity) ?? undefined,
  );
  return {
    ingredient: slug,
    ...(amount !== undefined ? { amount } : {}),
    ...(unit ? { unit } : {}),
    ...(annotation?.preparation
      ? { preparation: annotation.preparation }
      : {}),
    ...(annotation?.note ? { note: annotation.note } : {}),
  };
}

function collectStepIngredients(
  step: Step,
  parsed: CkParsedRecipe,
  annotations: CooklangRecipe["frontmatter"]["ingredientAnnotations"],
  groups: IngredientGroupAccumulator[],
  currentGroup: IngredientGroupAccumulator | null,
  declaredSlugs: Set<string>,
  isDeclaration: boolean,
): IngredientGroupAccumulator | null {
  let group = currentGroup;
  for (const item of step.items) {
    if (item.type !== "ingredient") continue;
    const ingredient = parsed.ingredients[item.index]!;
    const slug = normalizeIngredientName(ingredient.name);
    if (!isDeclaration && declaredSlugs.has(slug)) continue;

    if (!group) {
      group = createIngredientGroupAccumulator();
      groups.push(group);
    }

    mergeIngredientIntoGroup(
      group,
      buildGroupIngredient(slug, ingredient, annotations?.[slug]),
    );
  }
  return group;
}

function createDerivedRecipe(
  frontmatter: CooklangRecipe["frontmatter"],
  ingredientGroups: Recipe["ingredientGroups"],
  instructions: string[],
  cookware: string[],
): Recipe | undefined {
  if (!frontmatter.title || frontmatter.description == null) return undefined;
  if (!frontmatter.servings || ingredientGroups.length === 0) return undefined;
  if (instructions.length === 0) return undefined;

  return {
    title: frontmatter.title,
    description: frontmatter.description,
    cuisine: frontmatter.cuisine ?? [],
    servings: Math.round(frontmatter.servings),
    prepTime:
      frontmatter.prepTime == null
        ? undefined
        : Math.round(frontmatter.prepTime),
    cookTime:
      frontmatter.cookTime == null
        ? undefined
        : Math.round(frontmatter.cookTime),
    ingredientGroups,
    instructions,
    cookware,
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
export function deriveRecipeFromCooklang(cooklang: CooklangRecipe): CooklangRecipe {
  const diagnostics = [...cooklang.diagnostics];
  const fixedBody = fixBareMultiWordIngredients(cooklang.body);
  const [parsed] = _cooklangParser.parse(fixedBody);

  const groups: IngredientGroupAccumulator[] = [];
  const instructions: string[] = [];
  let currentGroup: ReturnType<typeof createIngredientGroupAccumulator> | null = null;
  const annotations = cooklang.frontmatter.ingredientAnnotations;
  // The registered name, not the display name: `#baking tray|tray{}` reads as
  // "tray" in the step but belongs to the recipe as a baking tray. Ingredients
  // already resolve their slug the same way.
  const cookware = normalizeCookwareList(parsed.cookware.map((item) => item.name));
  const declaredIngredientSlugs = findDeclaredIngredientSlugs(parsed);

  for (const section of parsed.sections) {
    if (section.name !== null) {
      currentGroup = createIngredientGroupAccumulator(section.name);
      groups.push(currentGroup);
    }

    for (const content of section.content) {
      if (content.type === "text") continue;
      const step = content.value;
      const isDeclaration = isIngredientOnlyStep(step);

      // Explicit declarations are authoritative for their own slugs, while
      // inline-only ingredients still join the current group.
      currentGroup = collectStepIngredients(
        step,
        parsed,
        annotations,
        groups,
        currentGroup,
        declaredIngredientSlugs,
        isDeclaration,
      );

      // Add instruction text for non-ingredient-only steps
      if (!isDeclaration) {
        const text = stepToInstructionText(step, parsed);
        if (text) instructions.push(text);
      }
    }
  }

  const ingredientGroups: Recipe["ingredientGroups"] = groups
    .filter((g) => g.items.length > 0)
    .map((g) => ({
      ...(g.name ? { name: g.name } : {}),
      items: g.items,
    }));

  if (ingredientGroups.length === 0) {
    diagnostics.push("No ingredient groups detected in Cooklang body.");
  }
  if (instructions.length === 0) {
    diagnostics.push("No instruction lines detected in Cooklang body.");
  }

  const derivedRecipe = createDerivedRecipe(
    cooklang.frontmatter,
    ingredientGroups,
    instructions,
    cookware,
  );

  if (!derivedRecipe) {
    diagnostics.push(
      "Derived normalized recipe is incomplete; title, description, servings, ingredients, and instructions are required.",
    );
  }

  const derived = derivedRecipe
    ? postprocessRecipeOutput(derivedRecipe)
    : undefined;

  return {
    ...cooklang,
    diagnostics,
    ...(derived ? { derived } : {}),
  };
}

/**
 * Extract unique ingredient slugs from a Cooklang body string.
 */
export function extractIngredientSlugsFromBody(body: string): string[] {
  const [parsed] = _cooklangParser.parse(fixBareMultiWordIngredients(body));
  return [...new Set(parsed.ingredients.map((i) => normalizeIngredientName(i.name)))];
}

/**
 * Extract unique cookware names from a Cooklang body string.
 */
export function extractCookwareFromBody(body: string): string[] {
  const [parsed] = _cooklangParser.parse(fixBareMultiWordIngredients(body));
  return [...new Set(parsed.cookware.map((c) => c.name))];
}
