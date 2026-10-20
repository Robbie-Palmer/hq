import { createReadStream, createWriteStream } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { adaptExtractedDatasetRecipe } from "recipe-parsing/dataset-recipe-adapter";

const projectRoot = new URL("../..", import.meta.url).pathname;
const outputs = `${projectRoot}/outputs`;
const productRecipesPath = `${outputs}/product-recipes.jsonl`;
const productRecipesTemporary = `${productRecipesPath}.part`;
const skippedRecipesPath = `${outputs}/product-adapter-skips.jsonl`;
const skippedRecipesTemporary = `${skippedRecipesPath}.part`;
const productRecipes = createWriteStream(productRecipesTemporary, {
  encoding: "utf8",
});
const skippedRecipes = createWriteStream(skippedRecipesTemporary, {
  encoding: "utf8",
});

const metrics = {
  inputRows: 0,
  adaptedRecipes: 0,
  ingredientOnlyRows: 0,
  unadaptableRows: 0,
  invalidExtractionRows: 0,
  rowsWithDiagnostics: 0,
  unmappedFields: {},
};

function increment(object, key) {
  object[key] = (object[key] ?? 0) + 1;
}

function sourceIdentity(value) {
  if (!value || typeof value !== "object") return {};
  const provenance = value.provenance;
  return provenance && typeof provenance === "object"
    ? {
        sourceDataset: provenance.dataset,
        sourceRecordId: provenance.recordId,
      }
    : {};
}

for await (const line of createInterface({
  input: createReadStream(`${outputs}/extracted-recipes.jsonl`),
  crlfDelay: Infinity,
})) {
  if (!line.trim()) continue;
  metrics.inputRows += 1;
  let source;
  try {
    source = JSON.parse(line);
    const adaptation = adaptExtractedDatasetRecipe(source);
    for (const field of adaptation.unmappedFields) {
      increment(metrics.unmappedFields, field);
    }
    if (adaptation.diagnostics.length) metrics.rowsWithDiagnostics += 1;
    if (adaptation.status === "adapted") {
      productRecipes.write(`${JSON.stringify(adaptation)}\n`);
      metrics.adaptedRecipes += 1;
    } else {
      skippedRecipes.write(`${JSON.stringify(adaptation)}\n`);
      if (adaptation.status === "ingredients-only") {
        metrics.ingredientOnlyRows += 1;
      } else {
        metrics.unadaptableRows += 1;
      }
    }
  } catch (error) {
    skippedRecipes.write(`${JSON.stringify({
      status: "invalid-extraction",
      ...sourceIdentity(source),
      diagnostics: [error instanceof Error ? error.message : String(error)],
    })}\n`);
    metrics.invalidExtractionRows += 1;
  }
}

await Promise.all([
  new Promise((resolve, reject) =>
    productRecipes.end((error) => (error ? reject(error) : resolve())),
  ),
  new Promise((resolve, reject) =>
    skippedRecipes.end((error) => (error ? reject(error) : resolve())),
  ),
]);
await rename(productRecipesTemporary, productRecipesPath);
await rename(skippedRecipesTemporary, skippedRecipesPath);
await writeFile(
  `${outputs}/product-adapter-metrics.json`,
  `${JSON.stringify({
    ...metrics,
    unmappedFields: Object.fromEntries(
      Object.entries(metrics.unmappedFields).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  }, null, 2)}\n`,
);
console.log(JSON.stringify(metrics, null, 2));
