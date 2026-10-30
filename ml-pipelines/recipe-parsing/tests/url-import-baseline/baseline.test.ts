import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSchemaOrgRecipeHtml } from "recipe-parsing/schema-org";
import type { Recipe } from "recipe-parsing/schemas/ground-truth";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main as evaluateStage } from "../../src/stages/evaluate-url-import-baseline.js";
import {
  computeCacheKey,
  evaluateBaseline,
  evaluateBaselineWithCache,
} from "../../src/url-import-baseline/evaluate.js";
import {
  evaluateRegressionGate,
  loadRegressionConfig,
} from "../../src/url-import-baseline/gate.js";
import {
  classifyFailures,
  countFieldValues,
  emptyFieldMetricAccumulator,
  finalizeFieldMetrics,
  recordRecipeFieldMetrics,
} from "../../src/url-import-baseline/metrics.js";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const CORPUS_ROOT = path.join(
  PROJECT_ROOT,
  "data/url-import-corpus/synthetic/v1",
);
const CONFIG_FILE = path.join(
  PROJECT_ROOT,
  "config/url-import-deterministic-baseline.json",
);
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "recipe-url-baseline-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    title: "Soup",
    description: "A soup.",
    cuisine: ["British"],
    servings: 2,
    prepTime: 5,
    cookTime: 20,
    ingredientGroups: [
      {
        items: [{ ingredient: "onion", amount: 1, unit: "g" }],
      },
    ],
    instructions: ["Chop the onion.", "Cook the onion."],
    cookware: [],
    ...overrides,
  };
}

describe("URL-import baseline metrics", () => {
  it("counts duplicate field values as a multiset", () => {
    const counts = { truePositives: 0, falsePositives: 0, falseNegatives: 0 };
    countFieldValues(counts, ["onion", "onion", "garlic"], ["onion", "leek"]);
    expect(counts).toEqual({
      truePositives: 1,
      falsePositives: 2,
      falseNegatives: 1,
    });
  });

  it("reports precision and recall for scalar and parsed ingredient fields", () => {
    const accumulator = emptyFieldMetricAccumulator();
    recordRecipeFieldMetrics(
      accumulator,
      recipe({
        ingredientGroups: [
          { items: [{ ingredient: "onion", amount: 2, unit: "g" }] },
        ],
      }),
      recipe(),
    );
    const metrics = finalizeFieldMetrics(accumulator);

    expect(metrics.title).toMatchObject({ precision: 1, recall: 1 });
    expect(metrics.ingredientName).toMatchObject({ precision: 1, recall: 1 });
    expect(metrics.ingredientQuantity).toMatchObject({
      truePositives: 0,
      falsePositives: 1,
      falseNegatives: 1,
      precision: 0,
      recall: 0,
    });
  });
});

describe("URL-import baseline failure classification", () => {
  const context = {
    fixtureId: "fixture",
    partition: "development" as const,
    sourceGroup: "publisher",
  };

  it("distinguishes extraction failures from unexpected recipes", () => {
    expect(
      classifyFailures({
        context,
        expectedStatus: "success",
        extractionSucceeded: false,
        predicted: null,
        expected: recipe(),
        unmatchedOntologyTerms: [],
      }).map(({ category }) => category),
    ).toEqual(["extraction-missed-recipe"]);

    expect(
      classifyFailures({
        context,
        expectedStatus: "no-recipe",
        extractionSucceeded: true,
        predicted: recipe(),
        expected: null,
        unmatchedOntologyTerms: [],
      }).map(({ category }) => category),
    ).toEqual(["extraction-unexpected-recipe"]);
  });

  it("classifies field, parsing, segmentation, and ontology failures", () => {
    const predicted = recipe({
      title: "Stew",
      ingredientGroups: [
        { items: [{ ingredient: "leek", amount: 2, unit: "ml" }] },
      ],
      instructions: ["Cook everything."],
    });
    const categories = classifyFailures({
      context,
      expectedStatus: "success",
      extractionSucceeded: true,
      predicted,
      expected: recipe(),
      unmatchedOntologyTerms: ["leek"],
    }).map(({ category }) => category);

    expect(categories).toEqual([
      "scalar-field-mismatch",
      "ingredient-name-mismatch",
      "quantity-mismatch",
      "unit-mismatch",
      "step-segmentation-mismatch",
      "step-content-mismatch",
      "ontology-unmatched",
    ]);
  });
});

describe("URL-import baseline reproducibility and cache", () => {
  it("produces byte-equivalent reports from the fixed routine partitions", async () => {
    const first = await evaluateBaseline(CORPUS_ROOT, "sha256:test");
    const second = await evaluateBaseline(CORPUS_ROOT, "sha256:test");

    expect(second).toEqual(first);
    expect(first.report.partitions).toEqual(["train", "development"]);
    expect(first.report.pipelineStages).toEqual([
      "schema-org-extraction",
      "dom-heuristics",
      "normalization",
      "quantity-unit-parsing",
      "step-segmentation",
      "ontology-matching",
    ]);
  });

  it("changes cache keys when a dependency changes", () => {
    const directory = temporaryDirectory();
    const firstFile = path.join(directory, "first.txt");
    const secondFile = path.join(directory, "second.txt");
    fs.writeFileSync(firstFile, "first");
    fs.writeFileSync(secondFile, "second");

    const firstKey = computeCacheKey(directory, ["first.txt", "second.txt"]);
    expect(computeCacheKey(directory, ["second.txt", "first.txt"])).toBe(
      firstKey,
    );
    fs.writeFileSync(secondFile, "changed");
    expect(computeCacheKey(directory, ["first.txt", "second.txt"])).not.toBe(
      firstKey,
    );
  });

  it("reuses matching cache entries and invalidates them after an input change", async () => {
    const directory = temporaryDirectory();
    const dependency = path.join(directory, "dependency.txt");
    const cacheFile = path.join(directory, "cache.json");
    fs.writeFileSync(dependency, "v1");
    const options = {
      root: directory,
      corpusRoot: CORPUS_ROOT,
      dependencyEntries: [dependency],
      cacheFile,
    };

    const first = await evaluateBaselineWithCache(options);
    const cached = structuredClone(first);
    cached.report.summary.usableImports = 999;
    fs.writeFileSync(cacheFile, JSON.stringify(cached));
    expect(
      (await evaluateBaselineWithCache(options)).report.summary.usableImports,
    ).toBe(999);

    fs.writeFileSync(dependency, "v2");
    expect(
      (await evaluateBaselineWithCache(options)).report.summary.usableImports,
    ).toBe(4);
  });

  it("hashes evaluated corpus inputs but excludes the regression partition", async () => {
    const directory = temporaryDirectory();
    const corpusRoot = path.join(directory, "corpus");
    const cacheFile = path.join(directory, "cache.json");
    fs.cpSync(CORPUS_ROOT, corpusRoot, { recursive: true });
    const options = {
      root: directory,
      corpusRoot,
      dependencyEntries: [],
      cacheFile,
    };

    const first = await evaluateBaselineWithCache(options);
    const cached = structuredClone(first);
    cached.report.summary.usableImports = 999;
    fs.writeFileSync(cacheFile, JSON.stringify(cached));
    fs.appendFileSync(
      path.join(corpusRoot, "snapshots/regression/item-list-steps.html"),
      " ",
    );
    expect(
      (await evaluateBaselineWithCache(options)).report.summary.usableImports,
    ).toBe(999);

    fs.appendFileSync(
      path.join(corpusRoot, "snapshots/development/malformed-jsonld.html"),
      " ",
    );
    await expect(evaluateBaselineWithCache(options)).rejects.toThrow(
      "changed since review",
    );
  });

  it("bypasses cache reads and writes for custom parsers", async () => {
    const directory = temporaryDirectory();
    const cacheFile = path.join(directory, "cache.json");
    const parser = vi.fn(parseSchemaOrgRecipeHtml);
    const options = {
      root: directory,
      corpusRoot: CORPUS_ROOT,
      dependencyEntries: [],
      cacheFile,
      parser,
    };

    await evaluateBaselineWithCache(options);
    await evaluateBaselineWithCache(options);

    expect(parser).toHaveBeenCalledTimes(10);
    expect(fs.existsSync(cacheFile)).toBe(false);
  });

  it("blocks fetch while evaluating from saved snapshots", async () => {
    const directory = temporaryDirectory();
    const dependency = path.join(directory, "dependency.txt");
    fs.writeFileSync(dependency, "offline");
    const parser = vi.fn(async (html: string, url?: string) => {
      await expect(fetch("https://network.invalid")).rejects.toThrow(
        "Network access is disabled",
      );
      return parseSchemaOrgRecipeHtml(html, url);
    });

    const result = await evaluateBaselineWithCache({
      root: directory,
      corpusRoot: CORPUS_ROOT,
      dependencyEntries: [dependency],
      cacheFile: path.join(directory, "cache.json"),
      parser,
    });

    expect(parser).toHaveBeenCalledTimes(5);
    expect(result.report.offline).toBe(true);
    expect(result.report.summary.usableImportRate).toBe(1);
  });
});

describe("URL-import regression gate", () => {
  it("passes the declared reference and rejects budget overruns", async () => {
    const current = (await evaluateBaseline(CORPUS_ROOT, "sha256:test")).report;
    const config = loadRegressionConfig(CONFIG_FILE);
    expect(evaluateRegressionGate(current, config)).toMatchObject({
      passed: true,
      violations: [],
    });

    const regressed = structuredClone(current);
    regressed.summary.usableImportRate = 0.75;
    regressed.fieldMetrics.ingredientUnit.recall = 0.8;
    regressed.failureCounts["unit-mismatch"] = 1;
    const gate = evaluateRegressionGate(regressed, config);

    expect(gate.passed).toBe(false);
    expect(gate.violations.map(({ metric }) => metric)).toEqual([
      "summary.usableImportRate",
      "fieldMetrics.ingredientUnit.recall",
      "failureCounts.unit-mismatch",
    ]);
  });
});

describe("URL-import baseline stage", () => {
  it("writes all reports and a passing gate with one invocation", async () => {
    const directory = temporaryDirectory();
    const report = path.join(directory, "baseline.json");
    const failures = path.join(directory, "failures.json");
    const gate = path.join(directory, "gate.json");

    await evaluateStage([
      "node",
      "evaluate-url-import-baseline.ts",
      "--corpus",
      CORPUS_ROOT,
      "--config",
      CONFIG_FILE,
      "--report",
      report,
      "--failures",
      failures,
      "--gate",
      gate,
      "--cache",
      path.join(directory, "cache.json"),
    ]);

    expect(JSON.parse(fs.readFileSync(report, "utf8"))).toMatchObject({
      offline: true,
      partitions: ["train", "development"],
      summary: { usableImportRate: 1 },
    });
    expect(JSON.parse(fs.readFileSync(failures, "utf8"))).toMatchObject({
      counts: { "ontology-unmatched": 3 },
    });
    expect(JSON.parse(fs.readFileSync(gate, "utf8"))).toMatchObject({
      passed: true,
      violations: [],
    });
  });
});
