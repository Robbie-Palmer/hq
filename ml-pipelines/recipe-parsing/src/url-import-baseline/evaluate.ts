import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  canonicalEquipment,
} from "recipe-parsing/canonical-equipment-data";
import {
  canonicalIngredients,
} from "recipe-parsing/canonical-ingredients-data";
import {
  canonicalizeCookwareList,
} from "recipe-parsing/equipment-canonicalization";
import {
  canonicalizeRecipeIngredients,
  type IngredientCanonicalizationDecision,
} from "recipe-parsing/ingredient-canonicalization";
import {
  deriveRecipeFromCooklang,
} from "recipe-parsing/cooklang";
import {
  parseSchemaOrgRecipeHtml,
  type SchemaOrgRecipeImport,
} from "recipe-parsing/schema-org";
import {
  buildOntology,
  buildOntologyIndex,
} from "recipe-parsing/slug-matching";
import type { Recipe } from "recipe-parsing/schemas/ground-truth";
import {
  loadPartitionManifest,
  sha256,
  writeJson,
} from "../url-import-corpus/corpus.js";
import type {
  CorpusFixture,
  ExpectedRecipe,
} from "../url-import-corpus/schema.js";
import {
  classifyFailures,
  emptyFailureCounts,
  emptyFieldMetricAccumulator,
  finalizeFieldMetrics,
  isUsableImport,
  recordRecipeFieldMetrics,
} from "./metrics.js";
import type {
  BaselineReport,
  CachedEvaluation,
  Failure,
  FailureReport,
  SourceStratum,
} from "./schema.js";
import {
  EVALUATED_PARTITIONS,
  PIPELINE_STAGES,
} from "./schema.js";

type EvaluatedPartition = (typeof EVALUATED_PARTITIONS)[number];

type EvaluatedFixture = {
  fixture: CorpusFixture;
  partition: EvaluatedPartition;
  expectedRecipe: Recipe | null;
  predictedRecipe: Recipe | null;
  extractionSucceeded: boolean;
  decisions: IngredientCanonicalizationDecision[];
  failures: Failure[];
  usable: boolean;
};

const ingredientOntology = buildOntology(
  canonicalIngredients.ingredients,
  "ingredient",
);
const ingredientOntologyIndex = buildOntologyIndex(ingredientOntology);
const equipmentOntology = buildOntology(
  canonicalEquipment.equipment,
  "equipment",
);
const equipmentOntologyIndex = buildOntologyIndex(equipmentOntology);

function expectedImport(recipe: ExpectedRecipe): SchemaOrgRecipeImport {
  return { ...recipe };
}

function normalizeAndMatch(imported: SchemaOrgRecipeImport): {
  recipe: Recipe | null;
  decisions: IngredientCanonicalizationDecision[];
} {
  const normalized = deriveRecipeFromCooklang({
    frontmatter: {
      title: imported.title,
      description: imported.description,
      cuisine: imported.cuisine ? [imported.cuisine] : [],
      servings: imported.servings,
      prepTime: imported.prepTime,
      cookTime: imported.cookTime,
      tags: [],
    },
    body: imported.source,
    diagnostics: [],
  }).derived;
  if (!normalized) return { recipe: null, decisions: [] };

  const ingredients = canonicalizeRecipeIngredients(
    normalized,
    ingredientOntology,
    ingredientOntologyIndex,
  );
  const equipment = canonicalizeCookwareList(
    ingredients.recipe.cookware,
    equipmentOntology,
    equipmentOntologyIndex,
  );
  return {
    recipe: { ...ingredients.recipe, cookware: equipment.cookware },
    decisions: ingredients.decisions,
  };
}

function readFixtureHtml(corpusRoot: string, fixture: CorpusFixture): string {
  const file = path.resolve(corpusRoot, fixture.artifact.path);
  const root = path.resolve(corpusRoot);
  if (!file.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${fixture.id} leaves the corpus root`);
  }
  const html = fs.readFileSync(file, "utf8");
  if (sha256(html) !== fixture.artifact.sha256) {
    throw new Error(`${fixture.id} changed since review`);
  }
  return html;
}

async function evaluateFixture(
  corpusRoot: string,
  partition: EvaluatedPartition,
  fixture: CorpusFixture,
  parser: typeof parseSchemaOrgRecipeHtml,
): Promise<EvaluatedFixture> {
  const html = readFixtureHtml(corpusRoot, fixture);
  const extracted = await parser(html, fixture.retrieval.sourceUrl);
  const predicted = extracted
    ? normalizeAndMatch(extracted)
    : { recipe: null, decisions: [] };
  const expectedRecipe =
    fixture.expected.status === "success"
      ? normalizeAndMatch(expectedImport(fixture.expected.recipe)).recipe
      : null;
  if (fixture.expected.status === "success" && !expectedRecipe) {
    throw new Error(`${fixture.id} ground truth cannot be normalized`);
  }
  const context = {
    fixtureId: fixture.id,
    partition,
    sourceGroup: fixture.sourceGroup,
  };
  const failures = classifyFailures({
    context,
    expectedStatus: fixture.expected.status,
    extractionSucceeded: extracted !== null,
    predicted: predicted.recipe,
    expected: expectedRecipe,
    unmatchedOntologyTerms: predicted.decisions
      .filter(({ method }) => method === "none")
      .map(({ originalSlug }) => originalSlug),
  });
  return {
    fixture,
    partition,
    expectedRecipe,
    predictedRecipe: predicted.recipe,
    extractionSucceeded: extracted !== null,
    decisions: predicted.decisions,
    failures,
    usable:
      fixture.expected.status === "success" && isUsableImport(failures),
  };
}

function safeRatio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function sourceStrata(fixtures: EvaluatedFixture[]): SourceStratum[] {
  const groups = new Map<string, EvaluatedFixture[]>();
  for (const fixture of fixtures) {
    const group = groups.get(fixture.fixture.sourceGroup) ?? [];
    group.push(fixture);
    groups.set(fixture.fixture.sourceGroup, group);
  }

  return [...groups]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([sourceGroup, group]) => {
      const first = group[0];
      if (!first) throw new Error(`Source stratum ${sourceGroup} is empty`);
      const failureCounts = emptyFailureCounts();
      for (const { failures } of group) {
        for (const { category } of failures) failureCounts[category] += 1;
      }
      const expectedImports = group.filter(
        ({ fixture }) => fixture.expected.status === "success",
      ).length;
      const usableImports = group.filter(({ usable }) => usable).length;
      return {
        sourceGroup,
        publisherProfile: first.fixture.publisherProfile,
        patternFamilies: [
          ...new Set(group.map(({ fixture }) => fixture.patternFamily)),
        ].sort((left, right) => left.localeCompare(right)),
        fixtures: group.length,
        expectedImports,
        usableImports,
        usableImportRate: safeRatio(usableImports, expectedImports),
        failureCounts,
      };
    });
}

export async function evaluateBaseline(
  corpusRoot: string,
  cacheKey: string,
  parser: typeof parseSchemaOrgRecipeHtml = parseSchemaOrgRecipeHtml,
): Promise<CachedEvaluation> {
  const inputs = EVALUATED_PARTITIONS.flatMap((partition) =>
    loadPartitionManifest(corpusRoot, partition).fixtures.map((fixture) => ({
      fixture,
      partition,
    })),
  );
  const fixtures = await Promise.all(
    inputs.map(({ fixture, partition }) =>
      evaluateFixture(corpusRoot, partition, fixture, parser),
    ),
  );

  const fieldAccumulator = emptyFieldMetricAccumulator();
  const failures: Failure[] = [];
  const failureCounts = emptyFailureCounts();
  for (const fixture of fixtures) {
    recordRecipeFieldMetrics(
      fieldAccumulator,
      fixture.predictedRecipe,
      fixture.expectedRecipe,
    );
    for (const item of fixture.failures) {
      failures.push(item);
      failureCounts[item.category] += 1;
    }
  }

  const expectedImports = fixtures.filter(
    ({ fixture }) => fixture.expected.status === "success",
  ).length;
  const expectedNoRecipe = fixtures.length - expectedImports;
  const usableImports = fixtures.filter(({ usable }) => usable).length;
  const correctNoRecipe = fixtures.filter(
    ({ fixture, extractionSucceeded }) =>
      fixture.expected.status === "no-recipe" && !extractionSucceeded,
  ).length;
  const decisions = fixtures.flatMap(({ decisions: value }) => value);
  const exact = decisions.filter(({ method }) => method === "exact").length;
  const fuzzy = decisions.filter(({ method }) => method === "fuzzy").length;
  const unmatched = decisions.filter(({ method }) => method === "none").length;

  const corpusVersion = loadPartitionManifest(corpusRoot, "train").corpusVersion;
  const report: BaselineReport = {
    schemaVersion: 1,
    recordType: "recipe-url-import-deterministic-baseline",
    corpusVersion,
    corpusKind: "project-authored-synthetic",
    evaluationScope: "deterministic-regression",
    supportsRealWorldGeneralizationClaims: false,
    partitions: [...EVALUATED_PARTITIONS],
    offline: true,
    pipelineStages: [...PIPELINE_STAGES],
    cacheKey,
    summary: {
      fixtures: fixtures.length,
      expectedImports,
      expectedNoRecipe,
      usableImports,
      usableImportRate: safeRatio(usableImports, expectedImports),
      correctNoRecipe,
      noRecipeAccuracy: safeRatio(correctNoRecipe, expectedNoRecipe),
    },
    fieldMetrics: finalizeFieldMetrics(fieldAccumulator),
    ontology: {
      mentions: decisions.length,
      matched: exact + fuzzy,
      coverage: safeRatio(exact + fuzzy, decisions.length),
      methods: { exact, fuzzy, unmatched },
    },
    sourceStrata: sourceStrata(fixtures),
    failureCounts,
  };
  const failureReport: FailureReport = {
    schemaVersion: 1,
    recordType: "recipe-url-import-deterministic-failures",
    corpusVersion,
    partitions: [...EVALUATED_PARTITIONS],
    cacheKey,
    counts: failureCounts,
    failures,
  };
  return {
    schemaVersion: 1,
    cacheKey,
    report,
    failures: failureReport,
  };
}

function filesWithin(entry: string): string[] {
  const stat = fs.statSync(entry);
  if (stat.isFile()) return [entry];
  return fs
    .readdirSync(entry, { withFileTypes: true })
    .flatMap((child) => filesWithin(path.join(entry, child.name)));
}

export function computeCacheKey(root: string, entries: string[]): string {
  const resolvedRoot = path.resolve(root);
  const files = entries
    .flatMap((entry) => filesWithin(path.resolve(resolvedRoot, entry)))
    .sort((left, right) => left.localeCompare(right));
  const hash = createHash("sha256");
  for (const file of files) {
    const relative = path.relative(resolvedRoot, file).split(path.sep).join("/");
    hash.update(relative);
    hash.update("\0");
    hash.update(fs.readFileSync(file));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function isCachedEvaluation(value: unknown, cacheKey: string): value is CachedEvaluation {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CachedEvaluation>;
  return (
    candidate.schemaVersion === 1 &&
    candidate.cacheKey === cacheKey &&
    candidate.report?.cacheKey === cacheKey &&
    candidate.failures?.cacheKey === cacheKey
  );
}

export function readEvaluationCache(
  cacheFile: string,
  cacheKey: string,
): CachedEvaluation | undefined {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    return isCachedEvaluation(value, cacheKey) ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function withNetworkDisabled<T>(work: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Network access is disabled for URL-import baseline evaluation");
  };
  try {
    return await work();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

export async function evaluateBaselineWithCache(options: {
  root: string;
  corpusRoot: string;
  dependencyEntries: string[];
  cacheFile: string;
  parser?: typeof parseSchemaOrgRecipeHtml;
}): Promise<CachedEvaluation> {
  const cacheKey = computeCacheKey(options.root, options.dependencyEntries);
  const cached = readEvaluationCache(options.cacheFile, cacheKey);
  if (cached) return cached;
  const evaluated = await withNetworkDisabled(() =>
    evaluateBaseline(options.corpusRoot, cacheKey, options.parser),
  );
  writeJson(options.cacheFile, evaluated);
  return evaluated;
}
