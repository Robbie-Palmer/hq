import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Recipe } from "recipe-parsing/schemas/ground-truth";
import type {
  CooklangRecipe,
  ExtractionPredictionEntry,
} from "recipe-parsing/schemas/stage-artifacts";

const mocks = vi.hoisted(() => ({
  buildCooklangDraftFromExtraction: vi.fn(),
  deriveRecipeFromCooklang: vi.fn(),
  normalizeExtractionToCooklang: vi.fn(),
  loadPredictions: vi.fn(),
  loadCooklangPredictions: vi.fn(),
  loadNormalizeFailures: vi.fn(),
}));

vi.mock("recipe-parsing/cooklang", () => ({
  buildCooklangDraftFromExtraction: mocks.buildCooklangDraftFromExtraction,
  deriveRecipeFromCooklang: mocks.deriveRecipeFromCooklang,
}));
vi.mock("recipe-parsing/openrouter", () => ({
  normalizeExtractionToCooklang: mocks.normalizeExtractionToCooklang,
}));
vi.mock("../../src/lib/io", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/io")>()),
  loadPredictions: mocks.loadPredictions,
  loadCooklangPredictions: mocks.loadCooklangPredictions,
  loadNormalizeFailures: mocks.loadNormalizeFailures,
}));

const {
  collectNormalizationOutputs,
  mergeExistingNormalizationOutputs,
  normalizeEntryWithRetries,
  runNormalizationWorkers,
  selectNormalizationEntries,
} = await import("../../src/stages/normalize.js");

const recipe: Recipe = {
  title: "Soup",
  description: "A soup.",
  cuisine: [],
  servings: 2,
  ingredientGroups: [{ items: [{ ingredient: "potato" }] }],
  instructions: ["Cook."],
  cookware: [],
};

function cooklang(
  diagnostics: string[] = [],
  derived: Recipe | null = recipe,
): CooklangRecipe {
  return {
    frontmatter: { title: "Soup", description: "A soup.", servings: 2 },
    body: "@potato{}\n\nCook.",
    diagnostics,
    ...(derived ? { derived } : {}),
  };
}

function entry(images = ["soup.jpg"]): ExtractionPredictionEntry {
  return {
    images,
    extracted: {
      title: "Soup",
      ingredientGroups: [{ lines: ["1 potato"] }],
      instructions: ["Cook."],
      equipment: [],
    },
  };
}

const params = {
  apiKey: "test-key",
  entry: entry(),
  model: "test-model",
  requestTimeoutMs: 1_000,
  maxRetries: 0,
  backoffBaseDelayMs: 0,
  backoffMaxDelayMs: 0,
};

describe("normalization stage", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("returns the recipe derived from normalized Cooklang", async () => {
    const draft = cooklang(["draft"]);
    const normalized = cooklang([], null);
    const derived = cooklang(["normalized"]);
    mocks.buildCooklangDraftFromExtraction.mockReturnValue(draft);
    mocks.normalizeExtractionToCooklang.mockResolvedValue({ value: normalized });
    mocks.deriveRecipeFromCooklang.mockReturnValue(derived);

    const result = await normalizeEntryWithRetries(params);

    expect(result).toEqual({
      ok: true,
      prediction: { images: ["soup.jpg"], predicted: recipe },
      cooklang: { images: ["soup.jpg"], cooklang: derived },
    });
  });

  it("uses the deterministic recipe when normalized Cooklang cannot derive", async () => {
    const draft = cooklang(["draft"]);
    const incomplete = cooklang(["missing instructions"], null);
    mocks.buildCooklangDraftFromExtraction.mockReturnValue(draft);
    mocks.normalizeExtractionToCooklang.mockResolvedValue({ value: incomplete });
    mocks.deriveRecipeFromCooklang.mockReturnValue(incomplete);

    const result = await normalizeEntryWithRetries(params);

    expect(result).toMatchObject({
      ok: true,
      prediction: { predicted: recipe },
      cooklang: {
        cooklang: {
          diagnostics: [
            "missing instructions",
            "LLM cooklang derivation failed; using deterministic draft.",
          ],
        },
      },
    });
  });

  it("uses the deterministic draft after a provider failure", async () => {
    mocks.buildCooklangDraftFromExtraction.mockReturnValue(cooklang(["draft"]));
    mocks.normalizeExtractionToCooklang.mockRejectedValue(
      Object.assign(new Error("invalid request"), { status: 400 }),
    );

    const result = await normalizeEntryWithRetries(params);

    expect(result).toMatchObject({
      ok: true,
      cooklang: {
        cooklang: {
          diagnostics: [
            "draft",
            "Normalization LLM failed after 1 attempts; using deterministic draft.",
          ],
        },
      },
    });
  });

  it("records a failure when neither normalized nor draft Cooklang derives", async () => {
    const incomplete = cooklang(["incomplete"], null);
    mocks.buildCooklangDraftFromExtraction.mockReturnValue(incomplete);
    mocks.normalizeExtractionToCooklang.mockResolvedValue({ value: incomplete });
    mocks.deriveRecipeFromCooklang.mockReturnValue(incomplete);

    const result = await normalizeEntryWithRetries(params);

    expect(result).toMatchObject({
      ok: false,
      failure: {
        stage: "normalize",
        attemptCount: 0,
        errorMessage: "incomplete",
      },
      cooklang: { cooklang: incomplete },
    });
  });

  it("selects an exact target image set and rejects an unknown set", () => {
    const entries = [entry(["a.jpg", "b.jpg"]), entry(["c.jpg"])];

    const all = selectNormalizationEntries(entries, undefined);
    expect(all.entries).toBe(entries);
    expect(all.targetKeys.size).toBe(0);

    const selected = selectNormalizationEntries(entries, ["b.jpg", "a.jpg"]);
    expect(selected.entries).toEqual([entries[0]]);
    expect(selected.targetKeys.size).toBe(1);

    expect(() => selectNormalizationEntries(entries, ["missing.jpg"])).toThrow(
      "No entry matched NORMALIZE_TARGET_IMAGES=missing.jpg",
    );
  });

  it("runs workers and collects successful, partial, and failed outputs", async () => {
    mocks.buildCooklangDraftFromExtraction.mockReturnValue(cooklang());
    mocks.normalizeExtractionToCooklang.mockResolvedValue({
      value: cooklang([], null),
    });
    mocks.deriveRecipeFromCooklang.mockReturnValue(cooklang());

    const workerResults = await runNormalizationWorkers(
      [entry(["a.jpg"]), entry(["b.jpg"])],
      2,
      {
        apiKey: params.apiKey,
        model: params.model,
        requestTimeoutMs: params.requestTimeoutMs,
        maxRetries: params.maxRetries,
        backoffBaseDelayMs: params.backoffBaseDelayMs,
        backoffMaxDelayMs: params.backoffMaxDelayMs,
      },
    );
    const failure = {
      images: ["failed.jpg"],
      stage: "normalize" as const,
      attemptCount: 1,
      errorType: "Error",
      errorMessage: "failed",
      attemptErrors: [],
    };
    const outputs = collectNormalizationOutputs([
      ...workerResults,
      undefined,
      {
        ok: false,
        prediction: { images: ["partial.jpg"], predicted: recipe },
        cooklang: { images: ["partial.jpg"], cooklang: cooklang() },
        failure,
      },
    ]);

    expect(outputs.predictions.entries).toHaveLength(3);
    expect(outputs.cooklangPredictions.entries).toHaveLength(3);
    expect(outputs.failures.entries).toEqual([failure]);
  });

  it("merges targeted results with existing outputs", async () => {
    mocks.loadPredictions.mockResolvedValue({
      entries: [{ images: ["old.jpg"], predicted: recipe }],
    });
    mocks.loadCooklangPredictions.mockResolvedValue({
      entries: [{ images: ["old.jpg"], cooklang: cooklang() }],
    });
    mocks.loadNormalizeFailures.mockResolvedValue({ entries: [] });
    const outputs = collectNormalizationOutputs([
      {
        ok: true,
        prediction: { images: ["new.jpg"], predicted: recipe },
        cooklang: { images: ["new.jpg"], cooklang: cooklang() },
      },
    ]);

    await mergeExistingNormalizationOutputs(outputs, new Set(["new.jpg"]));

    expect(outputs.predictions.entries.map(({ images }) => images)).toEqual([
      ["old.jpg"],
      ["new.jpg"],
    ]);
    expect(outputs.cooklangPredictions.entries).toHaveLength(2);
    expect(outputs.failures.entries).toEqual([]);
    await mergeExistingNormalizationOutputs(outputs, new Set());
  });
});
