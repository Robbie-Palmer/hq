import { describe, expect, it, vi } from "vitest";
import type { ParsedRecipe } from "recipe-domain";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  diffEquipment,
  diffIngredients,
  ParsedRecipeDiff,
} from "../components/ParsedRecipeDiff";
import {
  ParsedRecipeEditor,
  updateIngredientAt,
} from "../components/ParsedRecipeEditor";
import { buildComparisonRows, StatsView } from "../views/StatsView";
import { ExtractionDetailView } from "../views/ExtractionDetailView";
import { NormalizationDetailView } from "../views/NormalizationDetailView";
import { CanonicalizeDetailView } from "../views/CanonicalizeDetailView";
import {
  detailTitle,
  findCanonicalizationDecisions,
  findCanonicalizedPrediction,
  findExtractionPrediction,
  findNormalizationDetailData,
} from "./detailData";
import {
  formatAmount,
  formatIngredient,
  formatTime,
  humanizeSlug,
} from "./format";
import {
  handleDetailKeyDown,
  subscribeDetailKeyboard,
} from "./detailNavigation";
import type {
  ExtractionRecipe,
  GroundTruthEntry,
  StageMetrics,
} from "../types/extraction";

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
    vi.stubGlobal("HTMLInputElement", FakeInput);
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
    listener({
      metaKey: false,
      ctrlKey: false,
      key: "ArrowRight",
      target: new FakeInput(),
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent);

    expect(onNavigate).not.toHaveBeenCalled();
    unsubscribe();
    expect(listeners).toHaveLength(0);
    vi.unstubAllGlobals();
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
  });

  it("renders representative diff and canonical edit states", () => {
    const predicted: ParsedRecipe = {
      ...BASE_RECIPE,
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

  it("keeps human-readable formatting stable", () => {
    expect(humanizeSlug("extra-virgin-olive-oil")).toBe(
      "extra virgin olive oil",
    );
    expect(formatAmount({ ingredient: "salt", unit: "pinch" })).toBe("pinch");
    expect(formatAmount({ ingredient: "salt" })).toBe("");
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

  it("renders the statistics dashboard before datasets load", () => {
    const markup = renderToStaticMarkup(
      createElement(StatsView, { onSelectCanonicalizeEntry: () => {} }),
    );

    expect(markup).toContain("Recipe Parsing Pipeline");
    expect(markup).toContain("Extraction");
    expect(markup).toContain("Canonicalization");
  });
});
