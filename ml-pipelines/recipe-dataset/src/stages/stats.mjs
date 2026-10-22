import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";

const projectRoot = new URL("../..", import.meta.url).pathname;
const outputs = `${projectRoot}/outputs`;
await mkdir(outputs, { recursive: true });
const bySource = new Map();
const rejectsBySource = new Map();
const titleCounts = new Map();
const signatureCounts = new Map();
let recipes = 0;
let ingredientLines = 0;
let instructionSteps = 0;
let equipmentItems = 0;
let recipesWithEquipment = 0;
let gutenbergCandidates = 0;
let ingredientOnlyRecords = 0;
let extractedRecipes = 0;
let extractedCompleteRecipes = 0;
let extractedIngredientOnlyRecipes = 0;
let extractedWithEquipment = 0;
let extractedWithTimers = 0;
let extractedWithNutrition = 0;
let extractedWithAuthors = 0;
let extractedWithImages = 0;
let extractedWithAlternateYields = 0;
const seenSignatures = new Set();
const canonicalBySignature = new Map();

for await (const line of createInterface({ input: createReadStream(`${outputs}/recipes.jsonl`), crlfDelay: Infinity })) {
  if (!line.trim()) continue;
  const recipe = JSON.parse(line);
  recipes += 1;
  bySource.set(recipe.sourceDataset, (bySource.get(recipe.sourceDataset) || 0) + 1);
  const title = recipe.title.toLocaleLowerCase("en");
  titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
  signatureCounts.set(recipe.contentSignature, (signatureCounts.get(recipe.contentSignature) || 0) + 1);
  ingredientLines += recipe.ingredientGroups.reduce((sum, group) => sum + group.items.length, 0);
  instructionSteps += recipe.instructions.length;
  const equipment = Array.isArray(recipe.equipment) ? recipe.equipment : [];
  equipmentItems += equipment.length;
  if (equipment.length) recipesWithEquipment += 1;
  seenSignatures.add(recipe.contentSignature);
  const variant = {
    sourceDataset: recipe.sourceDataset,
    sourceRecordId: recipe.sourceRecordId,
    sourceUrl: recipe.sourceUrl,
    license: recipe.license,
    category: recipe.category,
  };
  const canonical = canonicalBySignature.get(recipe.contentSignature);
  if (!canonical) {
    canonicalBySignature.set(recipe.contentSignature, {
      ...recipe,
      categories: recipe.category ? [recipe.category] : [],
      sourceVariants: [variant],
    });
  } else {
    if (recipe.category && !canonical.categories.includes(recipe.category)) {
      canonical.categories.push(recipe.category);
    }
    if (!canonical.sourceVariants.some((item) =>
      item.sourceDataset === variant.sourceDataset && item.sourceRecordId === variant.sourceRecordId)) {
      canonical.sourceVariants.push(variant);
    }
    for (const item of recipe.equipment || []) {
      if (!canonical.equipment.includes(item)) canonical.equipment.push(item);
    }
  }
}
const deduplicatedPath = `${outputs}/recipes-deduplicated.jsonl.part`;
const deduplicated = createWriteStream(deduplicatedPath, { encoding: "utf8" });
for (const recipe of canonicalBySignature.values()) deduplicated.write(`${JSON.stringify(recipe)}\n`);
await new Promise((resolve, reject) => deduplicated.end((error) => error ? reject(error) : resolve()));
await rename(deduplicatedPath, `${outputs}/recipes-deduplicated.jsonl`);
let rejects = 0;
for await (const line of createInterface({ input: createReadStream(`${outputs}/rejects.jsonl`), crlfDelay: Infinity })) {
  if (!line.trim()) continue;
  rejects += 1;
  const reject = JSON.parse(line);
  rejectsBySource.set(reject.sourceDataset, (rejectsBySource.get(reject.sourceDataset) || 0) + 1);
}
for await (const line of createInterface({ input: createReadStream(`${outputs}/gutenberg-candidates.jsonl`), crlfDelay: Infinity })) {
  if (line.trim()) gutenbergCandidates += 1;
}
for await (const line of createInterface({ input: createReadStream(`${outputs}/ingredient-only.jsonl`), crlfDelay: Infinity })) {
  if (line.trim()) ingredientOnlyRecords += 1;
}
for await (const line of createInterface({ input: createReadStream(`${outputs}/extracted-recipes.jsonl`), crlfDelay: Infinity })) {
  if (!line.trim()) continue;
  const recipe = JSON.parse(line);
  extractedRecipes += 1;
  if (recipe.completeness === "complete") extractedCompleteRecipes += 1;
  if (recipe.completeness === "ingredients-only") extractedIngredientOnlyRecipes += 1;
  if (recipe.equipment?.length) extractedWithEquipment += 1;
  if (recipe.timers?.length) extractedWithTimers += 1;
  if (recipe.metadata?.nutrition) extractedWithNutrition += 1;
  if (recipe.metadata?.authors?.length) extractedWithAuthors += 1;
  if (recipe.metadata?.images?.length) extractedWithImages += 1;
  if (recipe.metadata?.yields?.length > 1) extractedWithAlternateYields += 1;
}
const duplicateTitles = [...titleCounts.values()].filter((count) => count > 1).length;
const duplicateContent = [...signatureCounts.values()].filter((count) => count > 1).length;
const cooklangAcceptedRecipes = [...bySource]
  .filter(([source]) => source.startsWith("cooklang-"))
  .reduce((sum, [, count]) => sum + count, 0);
const cooklangRejectedRecords = [...rejectsBySource]
  .filter(([source]) => source.startsWith("cooklang-"))
  .reduce((sum, [, count]) => sum + count, 0);
const metrics = {
  recipes,
  rejects,
  sources: Object.fromEntries([...bySource].sort(([left], [right]) => left.localeCompare(right))),
  rejectsBySource: Object.fromEntries([...rejectsBySource].sort(([left], [right]) => left.localeCompare(right))),
  cooklangSourceRecords: cooklangAcceptedRecipes + cooklangRejectedRecords,
  cooklangAcceptedRecipes,
  cooklangRejectedRecords,
  duplicateTitleGroups: duplicateTitles,
  duplicateContentGroups: duplicateContent,
  uniqueContentRecipes: seenSignatures.size,
  excessDuplicateRecords: recipes - seenSignatures.size,
  averageIngredientLines: recipes ? ingredientLines / recipes : 0,
  averageInstructionSteps: recipes ? instructionSteps / recipes : 0,
  recipesWithEquipment,
  equipmentItems,
  gutenbergCandidates,
  ingredientOnlyRecords,
  extractedRecipes,
  extractedCompleteRecipes,
  extractedIngredientOnlyRecipes,
  extractedWithEquipment,
  extractedWithTimers,
  extractedWithNutrition,
  extractedWithAuthors,
  extractedWithImages,
  extractedWithAlternateYields,
};
await writeFile(`${outputs}/metrics.json`, `${JSON.stringify(metrics, null, 2)}\n`);
await writeFile(`${outputs}/source-distribution.json`, `${JSON.stringify([...bySource].map(([source, count]) => ({ source, count })), null, 2)}\n`);
console.log(JSON.stringify(metrics, null, 2));
