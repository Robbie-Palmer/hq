import { createReadStream, createWriteStream } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { canonicalizeDatasetRecipe } from "recipe-parsing/dataset-product-canonicalization";
import { canonicalIngredients } from "recipe-parsing/canonical-ingredients-data";
import { canonicalEquipment } from "recipe-parsing/canonical-equipment-data";

const projectRoot = new URL("../..", import.meta.url).pathname;
const outputs = `${projectRoot}/outputs`;
const inputPath = `${outputs}/product-recipes.jsonl`;
const recipesPath = `${outputs}/product-recipes-canonicalized.jsonl`;
const recipesTemporary = `${recipesPath}.part`;
const decisionsPath = `${outputs}/product-canonicalization-decisions.jsonl`;
const decisionsTemporary = `${decisionsPath}.part`;
const recipes = createWriteStream(recipesTemporary, { encoding: "utf8" });

const ingredientRegistry = new Set(
  canonicalIngredients.ingredients.map(({ slug }) => slug),
);
const equipmentRegistry = new Set(
  canonicalEquipment.equipment.map(({ slug }) => slug),
);
const terms = new Map();

const metrics = {
  inputRecipes: 0,
  canonicalizedRecipes: 0,
  ingredientRegistrySize: ingredientRegistry.size,
  equipmentRegistrySize: equipmentRegistry.size,
  ingredientOccurrences: 0,
  equipmentOccurrences: 0,
  ingredientRewrites: 0,
  equipmentRewrites: 0,
  ingredientMethods: { exact: 0, fuzzy: 0, none: 0 },
  equipmentMethods: { exact: 0, fuzzy: 0, none: 0 },
};

function termKey(kind, baseSlug) {
  return `${kind}\u0000${baseSlug}`;
}

function recordDecision(kind, decision, provenance, seenInRecipe) {
  const key = termKey(kind, decision.baseSlug);
  const existing = terms.get(key) ?? {
    kind,
    baseSlug: decision.baseSlug,
    canonicalSlug: decision.canonicalSlug,
    method: decision.method,
    ...(decision.reason ? { reason: decision.reason } : {}),
    occurrences: 0,
    recipes: 0,
    authoredExamples: [],
    sourceExamples: [],
  };
  existing.occurrences += 1;
  if (!seenInRecipe.has(key)) {
    existing.recipes += 1;
    seenInRecipe.add(key);
  }
  const authored =
    kind === "ingredient" ? decision.originalSlug : decision.originalName;
  if (!existing.authoredExamples.includes(authored)) {
    existing.authoredExamples.push(authored);
    existing.authoredExamples.sort();
    existing.authoredExamples = existing.authoredExamples.slice(0, 5);
  }
  const source = `${provenance.dataset}:${provenance.recordId}`;
  if (!existing.sourceExamples.includes(source)) {
    existing.sourceExamples.push(source);
    existing.sourceExamples.sort();
    existing.sourceExamples = existing.sourceExamples.slice(0, 5);
  }
  terms.set(key, existing);
}

for await (const line of createInterface({
  input: createReadStream(inputPath),
  crlfDelay: Infinity,
})) {
  if (!line.trim()) continue;
  metrics.inputRecipes += 1;
  const adaptation = JSON.parse(line);
  if (adaptation.status !== "adapted") {
    throw new Error(`Expected adapted product recipe, received ${adaptation.status}`);
  }
  const canonicalized = canonicalizeDatasetRecipe(adaptation);
  const seenInRecipe = new Set();

  for (const decision of canonicalized.ingredientDecisions) {
    metrics.ingredientOccurrences += 1;
    metrics.ingredientMethods[decision.method] += 1;
    if (decision.canonicalSlug !== decision.baseSlug) {
      metrics.ingredientRewrites += 1;
    }
    recordDecision(
      "ingredient",
      decision,
      adaptation.provenance,
      seenInRecipe,
    );
  }
  for (const decision of canonicalized.equipmentDecisions) {
    metrics.equipmentOccurrences += 1;
    metrics.equipmentMethods[decision.method] += 1;
    if (decision.canonicalSlug !== decision.baseSlug) {
      metrics.equipmentRewrites += 1;
    }
    recordDecision("equipment", decision, adaptation.provenance, seenInRecipe);
  }

  recipes.write(`${JSON.stringify(canonicalized.adaptation)}\n`);
  metrics.canonicalizedRecipes += 1;
}

await new Promise((resolve, reject) =>
  recipes.end((error) => (error ? reject(error) : resolve())),
);
await rename(recipesTemporary, recipesPath);

const orderedTerms = [...terms.values()].sort(
  (left, right) =>
    left.kind.localeCompare(right.kind) ||
    left.baseSlug.localeCompare(right.baseSlug),
);
const decisions = createWriteStream(decisionsTemporary, { encoding: "utf8" });
for (const row of orderedTerms) {
  if (row.method === "none" || row.canonicalSlug !== row.baseSlug) {
    decisions.write(`${JSON.stringify(row)}\n`);
  }
}
await new Promise((resolve, reject) =>
  decisions.end((error) => (error ? reject(error) : resolve())),
);
await rename(decisionsTemporary, decisionsPath);

function coverage(kind, registry) {
  const rows = orderedTerms.filter((row) => row.kind === kind);
  const literalMisses = rows.filter((row) => !registry.has(row.baseSlug));
  const resolvedOutsideRegistry = literalMisses.filter(
    (row) => row.method !== "none",
  );
  const unresolved = rows.filter((row) => row.method === "none");
  const total = (values, field) =>
    values.reduce((sum, row) => sum + row[field], 0);
  return {
    distinctTerms: rows.length,
    literalMisses: literalMisses.length,
    resolvedOutsideRegistry: resolvedOutsideRegistry.length,
    unresolvedDistinctTerms: unresolved.length,
    unresolvedOccurrences: total(unresolved, "occurrences"),
    unresolvedRecipeTermPairs: total(unresolved, "recipes"),
    unresolvedByReason: Object.fromEntries(
      [...new Set(unresolved.map((row) => row.reason ?? "unknown"))]
        .sort()
        .map((reason) => [
          reason,
          unresolved.filter((row) => (row.reason ?? "unknown") === reason)
            .length,
        ]),
    ),
    topUnresolved: unresolved
      .toSorted(
        (left, right) =>
          right.occurrences - left.occurrences ||
          left.baseSlug.localeCompare(right.baseSlug),
      )
      .slice(0, 20)
      .map(({ baseSlug, occurrences, recipes, reason }) => ({
        baseSlug,
        occurrences,
        recipes,
        reason,
      })),
  };
}

const finalMetrics = {
  ...metrics,
  ingredientCoverage: coverage("ingredient", ingredientRegistry),
  equipmentCoverage: coverage("equipment", equipmentRegistry),
};
await writeFile(
  `${outputs}/product-canonicalization-metrics.json`,
  `${JSON.stringify(finalMetrics, null, 2)}\n`,
);
console.log(JSON.stringify(finalMetrics, null, 2));
