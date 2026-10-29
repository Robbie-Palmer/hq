import { describe, expect, it, vi } from "vitest";
import type { ParsedRecipe, RecipeIngredient } from "recipe-domain";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  diffEquipment,
  diffIngredients,
  ParsedRecipeDiff,
} from "../src/components/ParsedRecipeDiff";
import {
  IngredientRow,
  ParsedRecipeEditor,
  updateIngredientAt,
} from "../src/components/ParsedRecipeEditor";
import { buildComparisonRows, StatsView } from "../src/views/StatsView";
import { ExtractionDetailView } from "../src/views/ExtractionDetailView";
import { NormalizationDetailView } from "../src/views/NormalizationDetailView";
import { CanonicalizeDetailView } from "../src/views/CanonicalizeDetailView";
import {
  detailTitle,
  findCanonicalizationDecisions,
  findCanonicalizedPrediction,
  findExtractionPrediction,
  findNormalizationDetailData,
} from "../src/lib/detailData";
import {
  formatAmount,
  formatIngredient,
  formatTime,
  humanizeSlug,
} from "../src/lib/format";
import {
  handleDetailKeyDown,
  subscribeDetailKeyboard,
} from "../src/lib/detailNavigation";
import type {
  ExtractionRecipe,
  GroundTruthEntry,
  StageMetrics,
} from "../src/types/extraction";
import { endStreamError } from "../vite.config";

const BASE_RECIPE: ParsedRecipe = {
  title: "Tomato soup",
  description: "A simple soup",
  cuisine: ["Italian"],
  servings: 2,
  prepTime: 10,
  cookTime: 20,
  ingredientGroups: [
    {
      items: [
        { ingredient: "tomato", amount: 2, unit: "piece" },
        { ingredient: "olive-oil", amount: 1, unit: "tbsp" },
      ],
    },
  ],
  instructions: ["Simmer until tender."],
  cookware: ["Pot"],
};

const EXTRACTION: ExtractionRecipe = {
  title: "Tomato soup",
  ingredientGroups: [{ lines: ["2 tomatoes", "1 tbsp olive oil"] }],
  instructions: ["Simmer until tender."],
};

const GROUND_TRUTH: GroundTruthEntry = {
  images: ["soup-front.jpg", "soup-back.jpg"],
  expected: BASE_RECIPE,
  expectedExtraction: EXTRACTION,
};

function stageMetrics(overall: number, ingredient: number): StageMetrics {
  return {
    overall: { score: overall },
    byCategory: {
      scalarFields: { cuisine: { f1: overall } },
      ingredientParsing: {
        precision: ingredient,
        recall: ingredient,
        f1: ingredient,
        fieldScores: {
          amount: { accuracy: ingredient - 0.1 },
          unit: { accuracy: ingredient - 0.2 },
          preparation: { f1: ingredient - 0.3 },
        },
      },
      equipmentParsing: {
        precision: overall,
        recall: overall,
        f1: overall,
      },
      instructions: { precision: 1, recall: 1, f1: 1 },
    },
    entryCount: 1,
  };
}

describe("recipe visualization detail data", () => {
  it("renders each detail view's loading state without changing its contract", () => {
    const props = { entryIndex: 0, onBack: () => {}, onNavigate: () => {} };

    expect(
      renderToStaticMarkup(createElement(ExtractionDetailView, props)),
    ).toContain("Loading...");
    expect(
      renderToStaticMarkup(createElement(NormalizationDetailView, props)),
    ).toContain("Loading...");
    expect(
      renderToStaticMarkup(createElement(CanonicalizeDetailView, props)),
    ).toContain("Loading...");
  });

  it("matches extraction predictions by the complete image identity", () => {
    const matched = findExtractionPrediction(GROUND_TRUTH, {
      entries: [
        { images: ["other.jpg"], extracted: { ...EXTRACTION, title: "Other" } },
        { images: [...GROUND_TRUTH.images], extracted: EXTRACTION },
      ],
    });

    expect(matched).toEqual(EXTRACTION);
    expect(findExtractionPrediction(GROUND_TRUTH, { entries: [] })).toBeNull();
  });

  it("resolves normalization inputs without mixing entries", () => {
    const cooklang = {
      frontmatter: { title: "Tomato soup", tags: [] },
      body: "Add @tomato{2}.",
      diagnostics: [],
    };
    const detail = findNormalizationDetailData(
      GROUND_TRUTH,
      { entries: [{ images: [...GROUND_TRUTH.images], predicted: BASE_RECIPE }] },
      { entries: [{ images: [...GROUND_TRUTH.images], extracted: EXTRACTION }] },
      { entries: [{ images: [...GROUND_TRUTH.images], cooklang }] },
    );

    expect(detail).toEqual({
      normalizedFallback: BASE_RECIPE,
      extraction: EXTRACTION,
      cooklang,
    });
  });

  it("keeps canonical predictions and decisions on the selected recipe", () => {
    const prediction = { ...BASE_RECIPE, cuisine: ["italian"] };
    const decision = {
      originalSlug: "tomatoes",
      baseSlug: "tomatoes",
      canonicalSlug: "tomato",
      method: "exact" as const,
      candidates: [],
    };

    expect(
      findCanonicalizedPrediction(GROUND_TRUTH, {
        entries: [{ images: [...GROUND_TRUTH.images], predicted: prediction }],
      }),
    ).toEqual(prediction);
    expect(
      findCanonicalizationDecisions(GROUND_TRUTH, {
        entries: [{ images: [...GROUND_TRUTH.images], decisions: [decision] }],
      }),
    ).toEqual([decision]);
    expect(detailTitle(null, "Fallback title")).toBe("Fallback title");
  });
});

describe("recipe visualization edits and comparisons", () => {
  it("updates one ingredient immutably", () => {
    const updated = updateIngredientAt(BASE_RECIPE, 0, 1, {
      ingredient: "extra-virgin-olive-oil",
      amount: 2,
      unit: "tbsp",
    });

    expect(updated.ingredientGroups[0].items[1]).toMatchObject({
      ingredient: "extra-virgin-olive-oil",
      amount: 2,
    });
    expect(BASE_RECIPE.ingredientGroups[0].items[1].ingredient).toBe("olive-oil");
    expect(updated.ingredientGroups[0].items[0]).toBe(
      BASE_RECIPE.ingredientGroups[0].items[0],
    );
  });

  it("renders standard and canonical ingredient edit variants", () => {
    const callbacks = {
      onChange: vi.fn(),
      onRemove: vi.fn(),
      onToggle: vi.fn(),
      onStartAdding: vi.fn(),
      onStopAdding: vi.fn(),
    };
    const standardMarkup = renderToStaticMarkup(
      createElement(IngredientRow, {
        item: {
          ingredient: "red-onion",
          amount: 2,
          unit: "piece",
          preparation: "diced",
          note: "divided",
        },
        isExpanded: false,
        adding: false,
        normSlug: null,
        decision: null,
        ...callbacks,
      }),
    );
    const canonicalMarkup = renderToStaticMarkup(
      createElement(IngredientRow, {
        item: {
          ingredient: "tomato-puree",
          amount: 1.5,
          unit: "cup",
          preparation: "strained",
          note: "optional",
        },
        isExpanded: true,
        adding: true,
        normSlug: "tomatoes",
        decision: {
          originalSlug: "tomatoes",
          baseSlug: "tomatoes",
          canonicalSlug: "tomato",
          method: "fuzzy",
          score: 0.92,
          candidates: [],
        },
        canonicalization: {
          canonicalSlugs: new Set<string>(),
          categories: new Map<string, string>(),
          normalizationSource: BASE_RECIPE,
          decisions: [],
          onAddCanonicalIngredient: vi.fn(),
        },
        ...callbacks,
      }),
    );

    expect(standardMarkup).toContain("red-onion");
    expect(standardMarkup).toContain("diced");
    expect(standardMarkup).toContain("divided");
    expect(canonicalMarkup).toContain("tomato-puree");
    expect(canonicalMarkup).toContain("tomato");
    expect(canonicalMarkup).toContain("0.92");
    expect(canonicalMarkup).toContain("was:");
    expect(canonicalMarkup).toContain("Add to canonical ontology");
    expect(canonicalMarkup).toContain("Preparation");
  });

  it("routes edit shortcuts and entry navigation", () => {
    const onSave = vi.fn();
    const onNavigate = vi.fn();
    const preventDefault = vi.fn();
    const saveEvent = {
      metaKey: false,
      ctrlKey: true,
      key: "s",
      target: null,
      preventDefault,
    } as unknown as KeyboardEvent;
    const rightEvent = {
      metaKey: false,
      ctrlKey: false,
      key: "ArrowRight",
      target: null,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;
    const leftEvent = {
      ...rightEvent,
      key: "ArrowLeft",
    } as unknown as KeyboardEvent;

    handleDetailKeyDown(saveEvent, {
      dirty: true,
      entryIndex: 1,
      totalEntries: 3,
      onBack: vi.fn(),
      onNavigate,
      onSave,
    });
    handleDetailKeyDown(rightEvent, {
      entryIndex: 1,
      totalEntries: 3,
      onBack: vi.fn(),
      onNavigate,
    });
    handleDetailKeyDown(leftEvent, {
      entryIndex: 1,
      totalEntries: 3,
      onBack: vi.fn(),
      onNavigate,
    });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledOnce();
    expect(onNavigate).toHaveBeenCalledWith(2);
    expect(onNavigate).toHaveBeenCalledWith(0);
  });

  it("subscribes detail shortcuts and ignores form controls", () => {
    class FakeInput {}
    class FakeTextArea {}
    class FakeSelect {}
    vi.stubGlobal("HTMLInputElement", FakeInput);
    vi.stubGlobal("HTMLTextAreaElement", FakeTextArea);
    vi.stubGlobal("HTMLSelectElement", FakeSelect);
    const onNavigate = vi.fn();
    const listeners = new Set<(event: KeyboardEvent) => void>();
    const target = {
      addEventListener: (_type: "keydown", listener: (event: KeyboardEvent) => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: "keydown", listener: (event: KeyboardEvent) => void) => {
        listeners.delete(listener);
      },
    };
    const unsubscribe = subscribeDetailKeyboard(
      {
        entryIndex: 0,
        totalEntries: 2,
        onBack: vi.fn(),
        onNavigate,
      },
      target,
    );
    const listener = [...listeners][0];
    for (const targetElement of [
      new FakeInput(),
      new FakeTextArea(),
      new FakeSelect(),
    ]) {
      listener({
        metaKey: false,
        ctrlKey: false,
        key: "ArrowRight",
        target: targetElement,
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent);
    }

    expect(onNavigate).not.toHaveBeenCalled();
    unsubscribe();
    expect(listeners).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it("handles shortcut boundaries and clean saves", () => {
    const onBack = vi.fn();
    const onNavigate = vi.fn();
    const onSave = vi.fn();
    const preventDefault = vi.fn();
    const options = {
      dirty: false,
      entryIndex: 0,
      totalEntries: 1,
      onBack,
      onNavigate,
      onSave,
    };

    handleDetailKeyDown(
      {
        metaKey: true,
        ctrlKey: false,
        key: "s",
        target: null,
        preventDefault,
      } as unknown as KeyboardEvent,
      options,
    );
    handleDetailKeyDown(
      {
        metaKey: false,
        ctrlKey: false,
        key: "Escape",
        target: null,
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent,
      options,
    );
    for (const key of ["ArrowLeft", "ArrowRight"]) {
      handleDetailKeyDown(
        {
          metaKey: false,
          ctrlKey: false,
          key,
          target: null,
          preventDefault: vi.fn(),
        } as unknown as KeyboardEvent,
        options,
      );
    }

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
    expect(onBack).toHaveBeenCalledOnce();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("maps Vite stream failures to stable HTTP responses", () => {
    const notFound = {
      headersSent: false,
      statusCode: 200,
      end: vi.fn(),
      destroy: vi.fn(),
    };
    const failed = {
      headersSent: false,
      statusCode: 200,
      end: vi.fn(),
      destroy: vi.fn(),
    };
    const streaming = {
      headersSent: true,
      statusCode: 200,
      end: vi.fn(),
      destroy: vi.fn(),
    };
    const missingError = Object.assign(new Error("missing"), { code: "ENOENT" });
    const readError = Object.assign(new Error("denied"), { code: "EACCES" });

    endStreamError(notFound as never, missingError);
    endStreamError(failed as never, readError);
    endStreamError(streaming as never, readError);

    expect(notFound.statusCode).toBe(404);
    expect(notFound.end).toHaveBeenCalledWith("Not found");
    expect(failed.statusCode).toBe(500);
    expect(failed.end).toHaveBeenCalledWith("Failed to read file");
    expect(streaming.destroy).toHaveBeenCalledWith(readError);
    expect(streaming.end).not.toHaveBeenCalled();
  });

  it("preserves amount and diff display contracts", () => {
    expect(formatAmount({ ingredient: "salt", amount: 2, unit: "g" }, 0.5)).toBe("1g");
    expect(formatAmount({ ingredient: "water", amount: 250, unit: "ml" })).toBe("250ml");
    expect(diffEquipment([" Pot ", "Blender"], ["pot", "Whisk"])).toEqual({
      matched: [" Pot "],
      missing: ["Blender"],
      extra: ["Whisk"],
    });
    expect(
      diffIngredients(
        [{ ingredient: "tomato", amount: 2, unit: "piece" }],
        [{ ingredient: "tomato", amount: 3 }],
      ).expectedRows[0].status,
    ).toBe("amount-mismatch");
    expect(
      diffIngredients(
        [
          { ingredient: "tomato", amount: 1, unit: "piece" },
          { ingredient: "tomato", amount: 1, unit: "g" },
        ],
        [
          { ingredient: "tomato", amount: 1 },
          { ingredient: "tomato", amount: 1, unit: "ml" },
        ],
      ).expectedRows.map((row) => row.status),
    ).toEqual(["matched", "unit-mismatch"]);
  });

  it("renders representative diff and canonical edit states", () => {
    const predicted: ParsedRecipe = {
      ...BASE_RECIPE,
      cuisine: ["Italian", "French"],
      ingredientGroups: [
        {
          items: [
            { ingredient: "tomato", amount: 3, unit: "piece" },
            { ingredient: "carrot", amount: 1, unit: "piece" },
          ],
        },
      ],
      instructions: ["Boil until tender."],
    };
    const diffMarkup = renderToStaticMarkup(
      createElement(ParsedRecipeDiff, {
        expected: BASE_RECIPE,
        predicted,
      }),
    );
    const editorMarkup = renderToStaticMarkup(
      createElement(ParsedRecipeEditor, {
        identity: "soup",
        value: BASE_RECIPE,
        onChange: () => {},
        canonicalization: {
          canonicalSlugs: new Set(["tomato", "olive-oil"]),
          categories: new Map([["tomato", "vegetable"]]),
          normalizationSource: BASE_RECIPE,
          decisions: [],
          onAddCanonicalIngredient: () => {},
        },
      }),
    );
    const standardEditorMarkup = renderToStaticMarkup(
      createElement(ParsedRecipeEditor, {
        identity: "standard-soup",
        value: BASE_RECIPE,
        onChange: () => {},
      }),
    );

    expect(diffMarkup).toContain("1 missing");
    expect(diffMarkup).toContain("1 extra");
    expect(diffMarkup).toContain("Instructions");
    expect(editorMarkup).toContain("Expected Canonicalized Ground Truth");
    expect(editorMarkup).toContain("vegetable");
    expect(standardEditorMarkup).toContain("Prep (min)");
    expect(standardEditorMarkup).toContain("Instructions (from normalization)");
  });

  it("omits disabled and empty diff sections", () => {
    const recipe: ParsedRecipe = {
      ...BASE_RECIPE,
      description: "",
      cuisine: [],
      prepTime: undefined,
      cookTime: undefined,
      cookware: [],
    };
    const markup = renderToStaticMarkup(
      createElement(ParsedRecipeDiff, {
        expected: recipe,
        predicted: recipe,
        scalarFields: [],
        showInstructions: false,
      }),
    );

    expect(markup).toContain("Ingredients");
    expect(markup).not.toContain("Expected</span>");
    expect(markup).not.toContain("Equipment");
    expect(markup).not.toContain("Instructions");
  });

  it("renders equal text and explicit equipment overrides without badges", () => {
    const emptyRecipe: ParsedRecipe = {
      ...BASE_RECIPE,
      description: "",
      cuisine: [],
      prepTime: undefined,
      cookTime: undefined,
    };
    const equalMarkup = renderToStaticMarkup(
      createElement(ParsedRecipeDiff, {
        expected: emptyRecipe,
        predicted: emptyRecipe,
        expectedCookware: ["Pan"],
        predictedCookware: [" pan "],
      }),
    );
    const changedCuisineMarkup = renderToStaticMarkup(
      createElement(ParsedRecipeDiff, {
        expected: BASE_RECIPE,
        predicted: { ...BASE_RECIPE, cuisine: ["Mexican"] },
        scalarFields: ["cuisine"],
        showInstructions: false,
      }),
    );

    expect(equalMarkup).toContain("Pan");
    expect(equalMarkup).not.toContain("missing words");
    expect(equalMarkup).not.toContain("extra words");
    expect(changedCuisineMarkup).toContain("Mexican");
  });

  it("keeps human-readable formatting stable", () => {
    expect(humanizeSlug("extra-virgin-olive-oil")).toBe(
      "extra virgin olive oil",
    );
    expect(formatAmount({ ingredient: "salt", unit: "pinch" })).toBe("pinch");
    expect(formatAmount({ ingredient: "salt" })).toBe("");
    expect(formatIngredient({ ingredient: "tomato", unit: "piece" })).toBe(
      "tomato",
    );
    expect(
      formatAmount({
        ingredient: "tomato",
        amount: 1,
        unit: "unknown-unit",
      } as RecipeIngredient),
    ).toBe("1");
    expect(
      formatIngredient({
        ingredient: "red-onion",
        amount: 2,
        unit: "piece",
        preparation: "diced",
        note: "divided",
      }),
    ).toBe("2 red onion (diced) – divided");
    expect(formatTime(45)).toBe("45 min");
    expect(formatTime(120)).toBe("2h");
    expect(formatTime(135)).toBe("2h 15m");
  });

  it("builds canonicalization statistics with nullable metrics", () => {
    const rows = buildComparisonRows(stageMetrics(0.7, 0.6), stageMetrics(0.8, 0.75));

    expect(rows.find((row) => row.key === "overall")).toMatchObject({
      normalization: 0.7,
      canonicalization: 0.8,
    });
    expect(rows.find((row) => row.key === "overall")?.delta).toBeCloseTo(0.1);
    expect(rows.find((row) => row.key === "ingredientParsing")?.delta).toBeCloseTo(0.15);
    expect(buildComparisonRows(null, stageMetrics(0.8, 0.75))).toEqual([]);
  });

  it("keeps sparse statistics nullable instead of inventing scores", () => {
    const sparse = stageMetrics(0.7, 0.6);
    sparse.byCategory.equipmentParsing = undefined;
    sparse.byCategory.ingredientParsing.fieldScores = undefined;
    sparse.byCategory.scalarFields = {
      cuisine: { accuracy: 0.55 },
    };
    const rows = buildComparisonRows(sparse, sparse);
    const complete = stageMetrics(0.8, 0.75);
    const sparseBaselineRows = buildComparisonRows(sparse, complete);
    const sparseCanonicalRows = buildComparisonRows(complete, sparse);

    expect(rows.find((row) => row.key === "equipmentParsing")).toMatchObject({
      normalization: null,
      canonicalization: null,
      delta: null,
    });
    expect(rows.find((row) => row.key === "ingredientAmount")?.delta).toBeNull();
    expect(rows.find((row) => row.key === "ingredientUnit")?.delta).toBeNull();
    expect(
      rows.find((row) => row.key === "ingredientPreparation")?.delta,
    ).toBeNull();
    expect(rows.find((row) => row.key === "cuisine")?.normalization).toBe(0.55);
    expect(
      sparseBaselineRows.find((row) => row.key === "equipmentParsing")?.delta,
    ).toBeNull();
    expect(
      sparseCanonicalRows.find((row) => row.key === "equipmentParsing")?.delta,
    ).toBeNull();
  });

  it("renders the statistics dashboard before datasets load", () => {
    const markup = renderToStaticMarkup(
      createElement(StatsView, { onSelectCanonicalizeEntry: () => {} }),
    );

    expect(markup).toContain("Recipe Parsing Pipeline");
    expect(markup).toContain("Extraction");
    expect(markup).toContain("Canonicalization");
  });
});
