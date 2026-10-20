import { normalizeSlug } from "recipe-domain/slugs";
import type { RecipeIngredient } from "recipe-domain";
import {
  pluralizeIngredientTerm,
  singularizeIngredientTerm,
} from "recipe-domain/pluralization";
import type { PredictionEntry, Recipe } from "../schemas/ground-truth.js";
import {
  applyIngredientTokenFixups,
  EXACT_ALIASES,
} from "./ingredient-normalization-rules.js";
import { normalizeCuisineLabels } from "./cuisine-normalization.js";
import {
  canonicalizeCookwareList,
  type EquipmentCanonicalizationDecision,
} from "./equipment-canonicalization.js";
import {
  buildOntologyIndex,
  detokenize,
  matchSlug,
  tokenize,
  uniqueSlugs,
  type CandidateScore,
  type CanonicalizationMethod,
  type CanonicalizationReason,
  type OntologyIndex,
} from "./slug-matching.js";

export interface IngredientCanonicalizationDecision {
  originalSlug: string;
  baseSlug: string;
  canonicalSlug: string;
  method: CanonicalizationMethod;
  reason?: CanonicalizationReason;
  score?: number;
  threshold?: number;
  margin?: number;
  candidates: CandidateScore[];
}

export interface EntryCanonicalizationDecisions {
  images: string[];
  decisions: IngredientCanonicalizationDecision[];
  cookwareDecisions?: EquipmentCanonicalizationDecision[];
}

export interface CanonicalizationOntologies {
  ingredients: Set<string>;
  ingredientIndex?: OntologyIndex;
  equipment: Set<string>;
  equipmentIndex?: OntologyIndex;
}

const MODIFIER_TOKENS = new Set([
  "fresh",
  "freshly",
  "dried",
  "dry",
  "frozen",
  "light",
  "extra",
  "medium",
  "semi",
  "skimmed",
  "hot",
  "large",
  "small",
  "fat",
  "white",
  "ground",
  "minced",
  "melted",
  "softened",
  "grated",
  "chopped",
  "diced",
  "distilled",
  "flaked",
  "sliced",
  "crushed",
  "finely",
  "coarsely",
  "packed",
  "shredded",
  "unsweetened",
  "beaten",
  "boiling",
  "boneless",
  "cold",
  "crumbled",
  "half",
  "halves",
  "juiced",
  "skinless",
  "warm",
]);

const NOISE_TOKENS = new Set([
  "of",
  "slice",
  "slices",
  "cooked",
  "to",
  "taste",
  "needed",
  "optional",
  "divided",
  "more",
  "as",
  "or",
  "stalk",
  "stalks",
]);

const MEASUREMENT_UNIT_TOKENS = new Set([
  "g",
  "kg",
  "oz",
  "ounce",
  "ounces",
  "lb",
  "lbs",
  "pound",
  "pounds",
  "ml",
  "l",
  "litre",
  "litres",
  "liter",
  "liters",
  "tsp",
  "teaspoon",
  "teaspoons",
  "tbsp",
  "tablespoon",
  "tablespoons",
  "cup",
  "cups",
  "pint",
  "pints",
  "qt",
  "quart",
  "quarts",
  "gal",
  "gallon",
  "gallons",
  "pinch",
  "pinches",
  "handful",
  "handfuls",
  "package",
  "packages",
  "can",
  "cans",
]);

const COMBINED_INGREDIENT_NOISE = new Set([
  "as",
  "coarsely",
  "cracked",
  "fresh",
  "freshly",
  "ground",
  "needed",
  "optional",
  "or",
  "taste",
  "to",
]);

export function normalizeIngredientSlug(slug: string): string {
  return normalizeSlug(slug);
}

function withoutToken(tokens: string[], unwanted: string): string[] {
  return tokens.length > 2 && tokens.includes(unwanted)
    ? tokens.filter((token) => token !== unwanted)
    : [];
}

function withoutLeadingMeasurements(tokens: string[]): string[] {
  let index = 0;
  let sawAmount = false;
  let sawUnit = false;

  while (index < tokens.length) {
    const token = tokens.at(index);
    if (!token) break;
    if (/^(?:\d+(?:dot\d+)?|dot\d+)$/.test(token)) {
      sawAmount = true;
      index += 1;
      continue;
    }
    if (sawAmount && MEASUREMENT_UNIT_TOKENS.has(token)) {
      sawUnit = true;
      index += 1;
      continue;
    }
    if (sawUnit && (token === "and" || token === "of")) {
      index += 1;
      continue;
    }
    break;
  }

  return sawUnit && index < tokens.length ? tokens.slice(index) : [];
}

function ingredientStems(base: string): string[] {
  const tokens = applyIngredientTokenFixups(tokenize(base));
  const withoutNoise = tokens.filter((token) => !NOISE_TOKENS.has(token));
  const withoutMeasurements = withoutLeadingMeasurements(tokens);
  const measurementVariants = withoutMeasurements.length
    ? [
        withoutMeasurements,
        withoutMeasurements.filter((token) => !MODIFIER_TOKENS.has(token)),
        withoutMeasurements.filter((token) => !NOISE_TOKENS.has(token)),
        withoutMeasurements.filter(
          (token) => !MODIFIER_TOKENS.has(token) && !NOISE_TOKENS.has(token),
        ),
      ]
    : [];

  const stems = [
    [base],
    tokens,
    tokens.length === 2 ? [...tokens].reverse() : [],
    tokens.filter((token) => !MODIFIER_TOKENS.has(token)),
    withoutNoise,
    tokens.filter(
      (token) => !MODIFIER_TOKENS.has(token) && !NOISE_TOKENS.has(token),
    ),
    withoutToken(tokens, "and"),
    withoutToken(withoutNoise, "and"),
    ...measurementVariants,
  ].map(detokenize);

  return uniqueSlugs(
    stems.flatMap((stem) =>
      stem.endsWith("-cheese") ? [stem, stem.replace(/-cheese$/, "")] : [stem],
    ),
  );
}

function splitCombinedIngredient(item: RecipeIngredient): RecipeIngredient[] {
  if (item.amount !== undefined || item.unit !== undefined) return [item];
  const base = detokenize(
    tokenize(normalizeSlug(item.ingredient)).filter(
      (token) => !COMBINED_INGREDIENT_NOISE.has(token),
    ),
  );
  if (base !== "salt-and-pepper" && base !== "salt-and-black-pepper") {
    return [item];
  }
  return ["salt", "black-pepper"].map((ingredient) => ({
    ...item,
    ingredient,
  }));
}

function generateDeterministicCandidates(base: string): string[] {
  const forms = ingredientStems(base).flatMap((stem) => {
    const phrase = stem.replaceAll("-", " ");
    return [
      stem,
      normalizeSlug(singularizeIngredientTerm(phrase)),
      normalizeSlug(pluralizeIngredientTerm(phrase)),
    ];
  });

  return uniqueSlugs([
    ...forms,
    ...forms.map((form) => EXACT_ALIASES[form] ?? ""),
  ]);
}

export function canonicalizeIngredientSlug(params: {
  rawSlug: string;
  ontology: Set<string>;
  ontologyIndex?: OntologyIndex;
}): IngredientCanonicalizationDecision {
  const baseSlug = normalizeSlug(params.rawSlug);
  const match = matchSlug({
    baseSlug,
    candidateSlugs: generateDeterministicCandidates(baseSlug),
    ontology: params.ontology,
    ontologyIndex: params.ontologyIndex,
  });

  return { originalSlug: params.rawSlug, ...match };
}

export function canonicalizeRecipeIngredients(
  recipe: Recipe,
  ontology: Set<string>,
  ontologyIndex?: OntologyIndex,
): { recipe: Recipe; decisions: IngredientCanonicalizationDecision[] } {
  const decisions: IngredientCanonicalizationDecision[] = [];
  const index = ontologyIndex ?? buildOntologyIndex(ontology);

  const canonicalizedRecipe: Recipe = {
    ...recipe,
    ingredientGroups: recipe.ingredientGroups.map((group) => ({
      ...group,
      items: group.items.flatMap((item) =>
        splitCombinedIngredient(item).map((splitItem) => {
          const decision = canonicalizeIngredientSlug({
            rawSlug: splitItem.ingredient,
            ontology,
            ontologyIndex: index,
          });
          decisions.push(decision);
          return {
            ...splitItem,
            ingredient: decision.canonicalSlug,
          };
        }),
      ),
    })),
  };

  return { recipe: canonicalizedRecipe, decisions };
}

export function canonicalizePredictionEntry(
  entry: PredictionEntry,
  ontologies: CanonicalizationOntologies,
): {
  entry: PredictionEntry;
  decisions: IngredientCanonicalizationDecision[];
  cookwareDecisions: EquipmentCanonicalizationDecision[];
} {
  const canonicalized = canonicalizeRecipeIngredients(
    entry.predicted,
    ontologies.ingredients,
    ontologies.ingredientIndex,
  );
  const canonicalizedCookware = canonicalizeCookwareList(
    canonicalized.recipe.cookware,
    ontologies.equipment,
    ontologies.equipmentIndex,
  );
  return {
    entry: {
      ...entry,
      predicted: {
        ...canonicalized.recipe,
        cuisine: normalizeCuisineLabels(canonicalized.recipe.cuisine),
        cookware: canonicalizedCookware.cookware,
      },
    },
    decisions: canonicalized.decisions,
    cookwareDecisions: canonicalizedCookware.decisions,
  };
}
