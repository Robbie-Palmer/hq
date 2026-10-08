import type { ParsedRecipe, RecipeIngredient } from "recipe-domain";
import { formatIngredient, formatTime } from "../lib/format";
import {
  normalizeComparableText,
  splitComparableWords,
} from "../../../../src/lib/comparable-text.js";
import { normalizeTimerUnits } from "../../../../src/evaluation/metrics.js";

type ScalarField = "title" | "description" | "cuisine" | "servings" | "prepTime" | "cookTime";

interface ParsedRecipeDiffProps {
  expected: ParsedRecipe;
  predicted: ParsedRecipe;
  expectedCookware?: string[];
  predictedCookware?: string[];
  /** Scalar fields to display. When omitted, all fields are shown. */
  scalarFields?: ScalarField[];
  /** Whether to show the instructions diff section. Defaults to true. */
  showInstructions?: boolean;
}

function ScalarRow({
  label,
  expected,
  predicted,
  match: matchOverride,
}: Readonly<{
  label: string;
  expected: string | number | undefined | null;
  predicted: string | number | undefined | null;
  match?: boolean;
}>) {
  const match =
    matchOverride ??
    (normalizeComparableText(String(expected ?? "")) ===
      normalizeComparableText(String(predicted ?? "")));
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className="text-gray-400 w-24 shrink-0 text-xs">{label}</span>
      <span className="flex-1">
        {expected != null && expected !== ""
          ? String(expected)
          : <span className="text-gray-300">&mdash;</span>}
      </span>
      <span
        className={`flex-1 ${!match ? "bg-red-50 text-red-800 px-1 rounded" : ""}`}
      >
        {predicted != null && predicted !== ""
          ? String(predicted)
          : <span className="text-gray-300">&mdash;</span>}
      </span>
    </div>
  );
}

function setsEqual(a: string[], b: string[]): boolean {
  const normalize = (s: string) => s.toLowerCase().trim();
  const setA = new Set(a.map(normalize));
  const setB = new Set(b.map(normalize));
  if (setA.size !== setB.size) return false;
  for (const v of setA) {
    if (!setB.has(v)) return false;
  }
  return true;
}

function flattenIngredients(recipe: ParsedRecipe): RecipeIngredient[] {
  return recipe.ingredientGroups.flatMap((g) => g.items);
}

type IngredientDiffStatus = "matched" | "missing" | "extra" | "amount-mismatch" | "unit-mismatch";

interface IngredientDiffRow {
  ingredient: RecipeIngredient;
  status: IngredientDiffStatus;
  side: "expected" | "predicted";
}

/** Normalize unit for comparison: treat "piece" and undefined as equivalent since
 *  formatIngredient displays both identically (just the number, no unit label). */
function normalizeUnit(unit: string | undefined): string | undefined {
  return unit === "piece" ? undefined : unit;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
function diffIngredients(
  expected: RecipeIngredient[],
  predicted: RecipeIngredient[],
): { expectedRows: IngredientDiffRow[]; predictedRows: IngredientDiffRow[] } {
  const expectedRows: IngredientDiffRow[] = [];
  const predictedRows: IngredientDiffRow[] = [];
  const usedPredicted = new Set<number>();

  for (const exp of expected) {
    let matchIdx = -1;
    let matchType: IngredientDiffStatus = "missing";

    for (let i = 0; i < predicted.length; i++) {
      if (usedPredicted.has(i)) continue;
      if (predicted[i].ingredient === exp.ingredient) {
        matchIdx = i;
        if (predicted[i].amount !== exp.amount) {
          matchType = "amount-mismatch";
        } else if (normalizeUnit(predicted[i].unit) !== normalizeUnit(exp.unit)) {
          matchType = "unit-mismatch";
        } else {
          matchType = "matched";
        }
        break;
      }
    }

    if (matchIdx >= 0) {
      usedPredicted.add(matchIdx);
      expectedRows.push({ ingredient: exp, status: matchType, side: "expected" });
      predictedRows.push({ ingredient: predicted[matchIdx], status: matchType, side: "predicted" });
    } else {
      expectedRows.push({ ingredient: exp, status: "missing", side: "expected" });
      predictedRows.push({ ingredient: exp, status: "missing", side: "predicted" });
    }
  }

  for (let i = 0; i < predicted.length; i++) {
    if (!usedPredicted.has(i)) {
      predictedRows.push({ ingredient: predicted[i], status: "extra", side: "predicted" });
    }
  }

  return { expectedRows, predictedRows };
}

const DIFF_STYLES: Record<IngredientDiffStatus, string> = {
  matched: "",
  missing: "bg-red-50 text-red-800",
  extra: "bg-yellow-50 text-yellow-800",
  "amount-mismatch": "bg-amber-50 text-amber-800",
  "unit-mismatch": "bg-amber-50 text-amber-800",
};

function diffInstructionWords(
  expected: string[],
  predicted: string[],
): { missingWords: string[]; extraWords: string[] } {
  const expectedTokens = new Set(
    normalizeTimerUnits(expected.flatMap((s) => splitComparableWords(s))),
  );
  const predictedTokens = new Set(
    normalizeTimerUnits(predicted.flatMap((s) => splitComparableWords(s))),
  );

  const missingWords = [...expectedTokens].filter((w) => !predictedTokens.has(w));
  const extraWords = [...predictedTokens].filter((w) => !expectedTokens.has(w));
  return { missingWords, extraWords };
}

function highlightText(
  text: string,
  words: string[],
  className: string,
) {
  if (words.length === 0) return text;
  const normalizeToken = (s: string) =>
    normalizeComparableText(s);
  const wordSet = new Set(words.map(normalizeToken).filter(Boolean));
  const tokens = text.split(/(\s+)/);
  return tokens.map((token, i) => {
    if (wordSet.has(normalizeToken(token))) {
      return (
        <mark key={i} className={className}>
          {token}
        </mark>
      );
    }
    return token;
  });
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
export function ParsedRecipeDiff({
  expected,
  predicted,
  expectedCookware,
  predictedCookware,
  scalarFields,
  showInstructions = true,
}: Readonly<ParsedRecipeDiffProps>) {
  const showScalar = (field: ScalarField) => !scalarFields || scalarFields.includes(field);
  const expectedEquipment = expectedCookware ?? expected.cookware;
  const predictedEquipment = predictedCookware ?? predicted.cookware;
  const expectedIngredients = flattenIngredients(expected);
  const predictedIngredients = flattenIngredients(predicted);
  const { expectedRows, predictedRows } = diffIngredients(expectedIngredients, predictedIngredients);
  const { missingWords, extraWords } = showInstructions
    ? diffInstructionWords(expected.instructions, predicted.instructions)
    : { missingWords: [], extraWords: [] };

  const missingCount = expectedRows.filter((r) => r.status === "missing").length;
  const extraCount = predictedRows.filter((r) => r.status === "extra").length;

  return (
    <div className="space-y-4">
      {/* Scalar fields */}
      {(showScalar("title") || showScalar("description") || showScalar("cuisine") || showScalar("servings") || showScalar("prepTime") || showScalar("cookTime")) && (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex gap-2 text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">
          <span className="w-24 shrink-0" />
          <span className="flex-1">Expected</span>
          <span className="flex-1">Predicted</span>
        </div>
        <div className="space-y-1.5">
          {showScalar("title") && <ScalarRow label="Title" expected={expected.title} predicted={predicted.title} />}
          {showScalar("description") && <ScalarRow label="Description" expected={expected.description} predicted={predicted.description} match={expected.description === "" ? true : undefined} />}
          {showScalar("cuisine") && <ScalarRow label="Cuisine" expected={expected.cuisine.join(", ") || undefined} predicted={predicted.cuisine.join(", ") || undefined} match={setsEqual(expected.cuisine, predicted.cuisine)} />}
          {showScalar("servings") && <ScalarRow label="Servings" expected={expected.servings} predicted={predicted.servings} />}
          {showScalar("prepTime") && <ScalarRow label="Prep Time" expected={expected.prepTime != null ? formatTime(expected.prepTime) : undefined} predicted={predicted.prepTime != null ? formatTime(predicted.prepTime) : undefined} />}
          {showScalar("cookTime") && <ScalarRow label="Cook Time" expected={expected.cookTime != null ? formatTime(expected.cookTime) : undefined} predicted={predicted.cookTime != null ? formatTime(predicted.cookTime) : undefined} />}
        </div>
      </div>
      )}

      {/* Ingredients diff */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="font-semibold text-sm">Ingredients</h3>
          {missingCount > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700">
              {missingCount} missing
            </span>
          )}
          {extraCount > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700">
              {extraCount} extra
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
              Expected
            </div>
            <ul className="space-y-0.5">
              {expectedRows.map((row, i) => (
                <li
                  key={i}
                  className={`text-sm flex items-start gap-1.5 px-2 py-0.5 rounded ${DIFF_STYLES[row.status]}`}
                >
                  <span className="text-gray-300 mt-1.5 h-1 w-1 rounded-full bg-current shrink-0" />
                  <span className="flex-1">
                    {row.status === "missing" && row.side === "predicted"
                      ? <span className="text-gray-300 italic">-- not predicted</span>
                      : formatIngredient(row.ingredient)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
              Predicted
            </div>
            <ul className="space-y-0.5">
              {predictedRows.map((row, i) => (
                <li
                  key={i}
                  className={`text-sm flex items-start gap-1.5 px-2 py-0.5 rounded ${DIFF_STYLES[row.status]}`}
                >
                  <span className="text-gray-300 mt-1.5 h-1 w-1 rounded-full bg-current shrink-0" />
                  <span className="flex-1">
                    {row.status === "missing"
                      ? <span className="text-gray-300 italic">-- not predicted</span>
                      : formatIngredient(row.ingredient)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Equipment diff */}
      {(expectedEquipment.length || predictedEquipment.length) ? (() => {
        const normalize = (value: string) => value.trim().toLowerCase();
        const predictedByKey = new Map(
          predictedEquipment.map((item) => [normalize(item), item]),
        );
        const matched: string[] = [];
        const missing: string[] = [];
        for (const item of expectedEquipment) {
          const key = normalize(item);
          if (predictedByKey.has(key)) {
            matched.push(item);
            predictedByKey.delete(key);
          } else {
            missing.push(item);
          }
        }
        const extra = [...predictedByKey.values()];
        return (
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="font-semibold text-sm">Equipment</h3>
              {missing.length > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                  {missing.length} missing
                </span>
              )}
              {extra.length > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700">
                  {extra.length} extra
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
                  Expected
                </div>
                <ul className="space-y-0.5">
                  {matched.map((c) => (
                    <li key={c} className="text-sm px-2 py-0.5">{c}</li>
                  ))}
                  {missing.map((c) => (
                    <li key={c} className="text-sm px-2 py-0.5 rounded bg-red-50 text-red-800">{c}</li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
                  Predicted
                </div>
                <ul className="space-y-0.5">
                  {matched.map((c) => (
                    <li key={c} className="text-sm px-2 py-0.5">{c}</li>
                  ))}
                  {extra.map((c) => (
                    <li key={c} className="text-sm px-2 py-0.5 rounded bg-yellow-50 text-yellow-800">{c}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        );
      })() : null}

      {/* Instructions diff */}
      {showInstructions && (
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="font-semibold text-sm mb-3">
          Instructions
          {expected.instructions.length !== predicted.instructions.length && (
            <span className="ml-2 text-xs font-normal px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
              {expected.instructions.length} vs {predicted.instructions.length} steps
            </span>
          )}
          {missingWords.length > 0 && (
            <span className="ml-2 text-xs font-normal text-red-400">
              ({missingWords.length} missing words)
            </span>
          )}
          {extraWords.length > 0 && (
            <span className="ml-2 text-xs font-normal text-yellow-600">
              ({extraWords.length} extra words)
            </span>
          )}
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
              Expected
            </div>
            <ol className="space-y-1">
              {expected.instructions.map((step, i) => (
                <li key={i} className="text-sm leading-relaxed pl-1">
                  <span className="text-gray-400 mr-1.5">{i + 1}.</span>
                  {highlightText(step, missingWords, "bg-red-200 text-red-900 rounded px-0.5")}
                </li>
              ))}
            </ol>
          </div>
          <div>
            <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
              Predicted
            </div>
            <ol className="space-y-1">
              {predicted.instructions.map((step, i) => (
                <li key={i} className="text-sm leading-relaxed pl-1">
                  <span className="text-gray-400 mr-1.5">{i + 1}.</span>
                  {highlightText(step, extraWords, "bg-yellow-200 text-yellow-900 rounded px-0.5")}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
