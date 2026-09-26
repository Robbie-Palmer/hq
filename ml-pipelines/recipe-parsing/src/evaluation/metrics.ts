import type {
  GroundTruthEntry,
  Recipe,
  PredictionEntry,
} from "recipe-parsing/schemas/ground-truth";
import { imageSetKey } from "../lib/image-key.js";
import { splitComparableWords } from "../lib/comparable-text.js";

export interface F1Scores {
  precision: number;
  recall: number;
  f1: number;
}

export interface TextFidelityMetrics {
  wordErrorRate: number;
  charErrorRate: number;
  rougeL: F1Scores;
}

export interface ScalarFieldScores {
  title: F1Scores;
  description: F1Scores;
  cuisine: F1Scores;
  servings: { accuracy: number };
  prepTime: { accuracy: number };
  cookTime: { accuracy: number };
}

export interface IngredientParsingScores extends F1Scores {
  fieldScores: {
    name: F1Scores;
    amount: { accuracy: number };
    unit: { accuracy: number };
    preparation: F1Scores;
  };
}

export interface EntryScores {
  images: string[];
  missingPrediction?: boolean;
  scores: {
    overall: number;
    scalarFields: number;
    ingredientParsing: number;
    instructions: number;
    equipmentParsing: number;
  };
  textFidelity?: TextFidelityMetrics;
}

export interface AggregateMetrics {
  overall: { score: number };
  byCategory: {
    scalarFields: ScalarFieldScores;
    ingredientParsing: IngredientParsingScores;
    instructions: F1Scores;
    equipmentParsing: F1Scores;
  };
  diagnostics?: {
    extractionText?: TextFidelityMetrics;
  };
  entryCount: number;
}

export type ScoreComponentKey =
  | "title"
  | "description"
  | "cuisine"
  | "servings"
  | "prepTime"
  | "cookTime"
  | "ingredientParsing"
  | "instructions"
  | "equipmentParsing";

export interface ScoringProfile {
  name: string;
  weights: Partial<Record<ScoreComponentKey, number>>;
}

export const FULL_RECIPE_SCORING_PROFILE: ScoringProfile = {
  name: "full-recipe",
  weights: {
    title: 1,
    description: 1,
    cuisine: 1,
    servings: 1,
    prepTime: 1,
    cookTime: 1,
    ingredientParsing: 6,
    instructions: 6,
    equipmentParsing: 6,
  },
};

// Profiles are intentionally stage-specific. Overall scores should only be
// compared within the same stage, because each stage is responsible for a
// different subset of recipe quality.
export const EXTRACTION_SCORING_PROFILE: ScoringProfile = {
  name: "extraction",
  weights: {
    title: 1,
    description: 1,
    cuisine: 1,
    servings: 1,
    prepTime: 1,
    cookTime: 1,
    ingredientParsing: 6,
    instructions: 6,
  },
};

// Normalization evaluates the fully derived recipe structure, including
// cookware extracted from Cooklang/body. It intentionally omits description,
// which is treated as part of extraction/frontmatter capture rather than a
// normalization concern.
export const NORMALIZATION_SCORING_PROFILE: ScoringProfile = {
  name: "normalization",
  weights: {
    title: 1,
    cuisine: 1,
    servings: 1,
    prepTime: 1,
    cookTime: 1,
    ingredientParsing: 6,
    instructions: 6,
    equipmentParsing: 6,
  },
};

// Canonicalization only scores the fields that this stage is expected to
// change, so its overall score is intentionally not comparable to extraction
// or normalization overall scores.
export const CANONICALIZATION_SCORING_PROFILE: ScoringProfile = {
  name: "canonicalization",
  weights: {
    cuisine: 1,
    ingredientParsing: 6,
    equipmentParsing: 3,
  },
};

export function splitWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

export function computeSetF1(
  predicted: Set<string>,
  expected: Set<string>,
): F1Scores {
  if (predicted.size === 0 && expected.size === 0) {
    return { precision: 1, recall: 1, f1: 1 };
  }
  const truePositives = [...predicted].filter((x) => expected.has(x)).length;
  const precision =
    predicted.size === 0 ? 0 : truePositives / predicted.size;
  const recall = expected.size === 0 ? 0 : truePositives / expected.size;
  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

const TIMER_UNIT_CANONICAL: Record<string, string> = {
  s: "seconds", sec: "seconds", secs: "seconds", second: "seconds",
  m: "minutes", min: "minutes", mins: "minutes", minute: "minutes",
  h: "hours", hr: "hours", hrs: "hours", hour: "hours",
};

export function normalizeTimerUnits(words: string[]): string[] {
  return words.map((w) => TIMER_UNIT_CANONICAL[w] ?? w);
}

export function computeWordOverlapF1(
  predicted: string,
  expected: string,
): F1Scores {
  const predWords = new Set(splitComparableWords(predicted));
  const expWords = new Set(splitComparableWords(expected));
  return computeSetF1(predWords, expWords);
}

function exactMatch(predicted: unknown, expected: unknown): number {
  return predicted === expected ? 1.0 : 0.0;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function weightedAverage(values: Array<{ value: number; weight: number }>): number {
  const active = values.filter(({ weight }) => weight > 0);
  if (active.length === 0) return 0;
  const totalWeight = active.reduce((sum, { weight }) => sum + weight, 0);
  if (totalWeight === 0) return 0;
  return active.reduce((sum, { value, weight }) => sum + value * weight, 0) / totalWeight;
}

function editDistance<T>(predicted: T[], expected: T[]): number {
  const dp = Array.from({ length: predicted.length + 1 }, () =>
    Array<number>(expected.length + 1).fill(0),
  );

  for (let i = 0; i <= predicted.length; i++) dp[i]![0] = i;
  for (let j = 0; j <= expected.length; j++) dp[0]![j] = j;

  for (let i = 1; i <= predicted.length; i++) {
    for (let j = 1; j <= expected.length; j++) {
      const substitutionCost = predicted[i - 1] === expected[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + substitutionCost,
      );
    }
  }

  return dp[predicted.length]![expected.length]!;
}

function longestCommonSubsequenceLength<T>(predicted: T[], expected: T[]): number {
  const dp = Array.from({ length: predicted.length + 1 }, () =>
    Array<number>(expected.length + 1).fill(0),
  );

  for (let i = 1; i <= predicted.length; i++) {
    for (let j = 1; j <= expected.length; j++) {
      dp[i]![j] =
        predicted[i - 1] === expected[j - 1]
          ? dp[i - 1]![j - 1]! + 1
          : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }

  return dp[predicted.length]![expected.length]!;
}

function normalizeLooseText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2012-\u2015\u2212]/g, "-") // normalize dashes (en/em/figure/etc) to hyphen
    .trim()
    .replace(/\s+/g, " ");
}

function avgF1(scores: F1Scores[]): F1Scores {
  if (scores.length === 0) return { precision: 0, recall: 0, f1: 0 };
  return {
    precision: avg(scores.map((s) => s.precision)),
    recall: avg(scores.map((s) => s.recall)),
    f1: avg(scores.map((s) => s.f1)),
  };
}

export function computeWordErrorRate(predicted: string, expected: string): number {
  const predWords = splitWords(predicted);
  const expWords = splitWords(expected);
  if (predWords.length === 0 && expWords.length === 0) return 0;
  return editDistance(predWords, expWords) / Math.max(expWords.length, 1);
}

export function computeCharErrorRate(predicted: string, expected: string): number {
  const predChars = [...normalizeLooseText(predicted)];
  const expChars = [...normalizeLooseText(expected)];
  if (predChars.length === 0 && expChars.length === 0) return 0;
  return editDistance(predChars, expChars) / Math.max(expChars.length, 1);
}

export function computeRougeL(predicted: string, expected: string): F1Scores {
  const predWords = splitWords(predicted);
  const expWords = splitWords(expected);
  if (predWords.length === 0 && expWords.length === 0) {
    return { precision: 1, recall: 1, f1: 1 };
  }

  const lcs = longestCommonSubsequenceLength(predWords, expWords);
  const precision = predWords.length === 0 ? 0 : lcs / predWords.length;
  const recall = expWords.length === 0 ? 0 : lcs / expWords.length;
  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);

  return { precision, recall, f1 };
}

export function computeBagF1(
  predicted: string[],
  expected: string[],
): F1Scores {
  if (predicted.length === 0 && expected.length === 0) {
    return { precision: 1, recall: 1, f1: 1 };
  }

  const predCounts = new Map<string, number>();
  for (const p of predicted) {
    predCounts.set(p, (predCounts.get(p) ?? 0) + 1);
  }

  const expCounts = new Map<string, number>();
  for (const e of expected) {
    expCounts.set(e, (expCounts.get(e) ?? 0) + 1);
  }

  let truePositives = 0;
  for (const [item, pCount] of predCounts) {
    const eCount = expCounts.get(item) ?? 0;
    truePositives += Math.min(pCount, eCount);
  }

  const precision =
    predicted.length === 0 ? 0 : truePositives / predicted.length;
  const recall = expected.length === 0 ? 0 : truePositives / expected.length;
  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

function normalizeEquipmentName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function evaluateScalarFields(
  predicted: Recipe,
  expected: Recipe,
): ScalarFieldScores {
  return {
    title: computeWordOverlapF1(predicted.title, expected.title),
    description: expected.description === ""
      ? { precision: 1, recall: 1, f1: 1 }
      : computeWordOverlapF1(predicted.description, expected.description),
    cuisine: computeSetF1(
      new Set(predicted.cuisine.map((c) => c.toLowerCase())),
      new Set(expected.cuisine.map((c) => c.toLowerCase())),
    ),
    servings: { accuracy: exactMatch(predicted.servings, expected.servings) },
    prepTime: { accuracy: exactMatch(predicted.prepTime, expected.prepTime) },
    cookTime: { accuracy: exactMatch(predicted.cookTime, expected.cookTime) },
  };
}

type IngredientFields = {
  amount?: number;
  unit?: string;
  preparation?: string;
};

function flattenIngredients(
  groups: Recipe["ingredientGroups"],
): Map<string, IngredientFields[]> {
  const map = new Map<string, IngredientFields[]>();
  for (const group of groups) {
    for (const item of group.items) {
      const existing = map.get(item.ingredient) ?? [];
      existing.push({
        amount: item.amount,
        unit: item.unit,
        preparation: item.preparation,
      });
      map.set(item.ingredient, existing);
    }
  }
  return map;
}

function ingredientSlugs(
  ingredients: Map<string, IngredientFields[]>,
): string[] {
  return [...ingredients].flatMap(([slug, items]) =>
    Array.from({ length: items.length }, () => slug),
  );
}

function ingredientSimilarity(
  predicted: IngredientFields,
  expected: IngredientFields,
): number {
  return exactMatch(predicted.amount, expected.amount) +
    exactMatch(predicted.unit, expected.unit) +
    computeWordOverlapF1(
      predicted.preparation ?? "",
      expected.preparation ?? "",
    ).f1;
}

function bestIngredientIndex(
  candidates: IngredientFields[],
  expected: IngredientFields,
): number {
  let bestIndex = 0;
  let bestScore = -1;
  for (let index = 0; index < candidates.length; index++) {
    const score = ingredientSimilarity(candidates[index]!, expected);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function scoreCommonIngredients(
  predicted: Map<string, IngredientFields[]>,
  expected: Map<string, IngredientFields[]>,
  commonSlugs: Set<string>,
): IngredientParsingScores["fieldScores"] {
  const amountAccuracies: number[] = [];
  const unitAccuracies: number[] = [];
  const preparationScores: F1Scores[] = [];
  let matchedCount = 0;

  for (const slug of commonSlugs) {
    const candidates = [...predicted.get(slug)!];
    const expectedItems = expected.get(slug)!;
    const pairCount = Math.min(candidates.length, expectedItems.length);

    // Greedily pair each expected entry with the most similar remaining
    // prediction so repeated ingredients do not depend on input order.
    for (let index = 0; index < pairCount; index++) {
      const expectedItem = expectedItems[index]!;
      const matchIndex = bestIngredientIndex(candidates, expectedItem);
      const predictedItem = candidates.splice(matchIndex, 1)[0]!;
      matchedCount += 1;
      amountAccuracies.push(exactMatch(predictedItem.amount, expectedItem.amount));
      unitAccuracies.push(exactMatch(predictedItem.unit, expectedItem.unit));
      preparationScores.push(
        computeWordOverlapF1(
          predictedItem.preparation ?? "",
          expectedItem.preparation ?? "",
        ),
      );
    }
  }

  return {
    name: avgF1(
      Array.from({ length: matchedCount }, () => ({
        precision: 1,
        recall: 1,
        f1: 1,
      })),
    ),
    amount: { accuracy: avg(amountAccuracies) },
    unit: { accuracy: avg(unitAccuracies) },
    preparation: avgF1(preparationScores),
  };
}

export function evaluateIngredientParsing(
  predicted: Recipe,
  expected: Recipe,
): IngredientParsingScores {
  const predIngredients = flattenIngredients(predicted.ingredientGroups);
  const expIngredients = flattenIngredients(expected.ingredientGroups);

  const idF1 = computeBagF1(
    ingredientSlugs(predIngredients),
    ingredientSlugs(expIngredients),
  );
  const commonSlugs = new Set(
    [...predIngredients.keys()].filter((k) => expIngredients.has(k)),
  );

  const fieldScores = scoreCommonIngredients(
    predIngredients,
    expIngredients,
    commonSlugs,
  );

  // Scale the identity F1 by field quality so that incorrect amounts, units,
  // and preparation text penalise the overall ingredient score.  Field quality
  // can reduce the score by up to half (FIELD_QUALITY_WEIGHT = 0.5).
  const FIELD_QUALITY_WEIGHT = 0.5;
  const fieldQuality = commonSlugs.size > 0
    ? avg([fieldScores.amount.accuracy, fieldScores.unit.accuracy, fieldScores.preparation.f1])
    : 1;
  const fieldScale = 1 - FIELD_QUALITY_WEIGHT + FIELD_QUALITY_WEIGHT * fieldQuality;

  return {
    precision: idF1.precision * fieldScale,
    recall: idF1.recall * fieldScale,
    f1: idF1.f1 * fieldScale,
    fieldScores,
  };
}

const STEP_COUNT_PENALTY_WEIGHT = 0.15;

export function evaluateInstructions(
  predicted: Recipe,
  expected: Recipe,
): F1Scores {
  const predWords = new Set(
    normalizeTimerUnits(splitComparableWords(predicted.instructions.join(" "))),
  );
  const expWords = new Set(
    normalizeTimerUnits(splitComparableWords(expected.instructions.join(" "))),
  );
  const content = computeSetF1(predWords, expWords);

  const predCount = predicted.instructions.length;
  const expCount = expected.instructions.length;
  let stepRatio = 1;
  if (predCount === 0 || expCount === 0) {
    stepRatio = predCount === expCount ? 1 : 0;
  } else {
    stepRatio = Math.min(predCount, expCount) / Math.max(predCount, expCount);
  }

  const scale = 1 - STEP_COUNT_PENALTY_WEIGHT * (1 - stepRatio);
  return {
    precision: content.precision * scale,
    recall: content.recall * scale,
    f1: content.f1 * scale,
  };
}

export function evaluateEquipmentParsing(
  predicted: Recipe,
  expected: Recipe,
): F1Scores {
  return computeBagF1(
    predicted.cookware.map(normalizeEquipmentName),
    expected.cookware.map(normalizeEquipmentName),
  );
}

export function computeEntryScores(
  scalar: ScalarFieldScores,
  ingredients: IngredientParsingScores,
  instructions: F1Scores,
  equipment: F1Scores,
  profile: ScoringProfile = FULL_RECIPE_SCORING_PROFILE,
): EntryScores["scores"] {
  const scalarScore = avg([
    scalar.title.f1,
    scalar.description.f1,
    scalar.cuisine.f1,
    scalar.servings.accuracy,
    scalar.prepTime.accuracy,
    scalar.cookTime.accuracy,
  ]);
  const overall = weightedAverage([
    { value: scalar.title.f1, weight: profile.weights.title ?? 0 },
    { value: scalar.description.f1, weight: profile.weights.description ?? 0 },
    { value: scalar.cuisine.f1, weight: profile.weights.cuisine ?? 0 },
    { value: scalar.servings.accuracy, weight: profile.weights.servings ?? 0 },
    { value: scalar.prepTime.accuracy, weight: profile.weights.prepTime ?? 0 },
    { value: scalar.cookTime.accuracy, weight: profile.weights.cookTime ?? 0 },
    { value: ingredients.f1, weight: profile.weights.ingredientParsing ?? 0 },
    { value: instructions.f1, weight: profile.weights.instructions ?? 0 },
    { value: equipment.f1, weight: profile.weights.equipmentParsing ?? 0 },
  ]);
  return {
    overall,
    scalarFields: scalarScore,
    ingredientParsing: ingredients.f1,
    instructions: instructions.f1,
    equipmentParsing: equipment.f1,
  };
}

export function makeMissingEntryScores(images: string[]): EntryScores {
  return {
    images,
    missingPrediction: true,
    scores: {
      overall: 0,
      scalarFields: 0,
      ingredientParsing: 0,
      instructions: 0,
      equipmentParsing: 0,
    },
  };
}

export function aggregateMetrics(
  predictions: PredictionEntry[],
  groundTruth: GroundTruthEntry[],
  profile: ScoringProfile = FULL_RECIPE_SCORING_PROFILE,
): { metrics: AggregateMetrics; perEntry: EntryScores[] } {
  const predictionsByImageKey = new Map<string, PredictionEntry>();
  for (const prediction of predictions) {
    const key = imageSetKey(prediction.images);
    const existing = predictionsByImageKey.get(key);
    if (existing) {
      throw new Error(
        `Duplicate prediction key encountered for images [${prediction.images.join(", ")}]. ` +
          `existingTitle="${existing.predicted.title}" duplicateTitle="${prediction.predicted.title}"`,
      );
    }
    predictionsByImageKey.set(key, prediction);
  }

  const allScalar: ScalarFieldScores[] = [];
  const allIngredients: IngredientParsingScores[] = [];
  const allInstructions: F1Scores[] = [];
  const allEquipment: F1Scores[] = [];
  const perEntry: EntryScores[] = [];
  const seenGroundTruthKeys = new Set<string>();

  for (const gt of groundTruth) {
    const key = imageSetKey(gt.images);
    if (seenGroundTruthKeys.has(key)) {
      throw new Error(
        `Duplicate ground-truth key encountered for images [${gt.images.join(", ")}]`,
      );
    }
    seenGroundTruthKeys.add(key);

    const pred = predictionsByImageKey.get(key);
    if (!pred) {
      // By-category aggregates exclude missing predictions by design; overall/per-entry
      // still include them via explicit zero scores to reflect completeness penalties.
      perEntry.push(makeMissingEntryScores(gt.images));
      continue;
    }

    const scalar = evaluateScalarFields(pred.predicted, gt.expected);
    const ingredients = evaluateIngredientParsing(pred.predicted, gt.expected);
    const instructions = evaluateInstructions(pred.predicted, gt.expected);
    const equipment = evaluateEquipmentParsing(pred.predicted, gt.expected);

    allScalar.push(scalar);
    allIngredients.push(ingredients);
    allInstructions.push(instructions);
    allEquipment.push(equipment);

    const scores = computeEntryScores(
      scalar,
      ingredients,
      instructions,
      equipment,
      profile,
    );
    perEntry.push({
      images: pred.images,
      scores,
    });
  }

  const groundTruthKeys = new Set(groundTruth.map((entry) => imageSetKey(entry.images)));
  const unmatchedPredictionKeys = [...predictionsByImageKey.keys()].filter(
    (key) => !groundTruthKeys.has(key),
  );
  if (unmatchedPredictionKeys.length > 0) {
    const sampleKeys = unmatchedPredictionKeys.slice(0, 3).join(", ");
    console.warn(
      `Found ${unmatchedPredictionKeys.length} prediction(s) without matching ground truth entries. Sample keys: ${sampleKeys}`,
    );
  }

  const scalarFields: ScalarFieldScores = {
    title: avgF1(allScalar.map((s) => s.title)),
    description: avgF1(allScalar.map((s) => s.description)),
    cuisine: avgF1(allScalar.map((s) => s.cuisine)),
    servings: { accuracy: avg(allScalar.map((s) => s.servings.accuracy)) },
    prepTime: { accuracy: avg(allScalar.map((s) => s.prepTime.accuracy)) },
    cookTime: { accuracy: avg(allScalar.map((s) => s.cookTime.accuracy)) },
  };

  const ingredientParsing: IngredientParsingScores = {
    ...avgF1(allIngredients),
    fieldScores: {
      name: avgF1(allIngredients.map((s) => s.fieldScores.name)),
      amount: {
        accuracy: avg(allIngredients.map((s) => s.fieldScores.amount.accuracy)),
      },
      unit: {
        accuracy: avg(allIngredients.map((s) => s.fieldScores.unit.accuracy)),
      },
      preparation: avgF1(
        allIngredients.map((s) => s.fieldScores.preparation),
      ),
    },
  };

  const instructions = avgF1(allInstructions);
  const equipmentParsing = avgF1(allEquipment);
  const overall: { score: number } = {
    score: avg(perEntry.map((e) => e.scores.overall)),
  };

  return {
    metrics: {
      overall,
      byCategory: {
        scalarFields,
        ingredientParsing,
        instructions,
        equipmentParsing,
      },
      entryCount: groundTruth.length,
    },
    perEntry,
  };
}
