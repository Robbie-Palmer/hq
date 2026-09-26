import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, Check, ChevronLeft, ChevronRight, Copy, FileDown, RotateCcw, Save } from "lucide-react";
import {
  imageUrl,
  loadCanonicalization,
  loadCanonicalIngredients,
  loadCanonicalizedPredictions,
  loadGroundTruth,
  saveCanonicalIngredients,
  saveGroundTruth,
} from "../lib/data";
import { deriveNormalizedRecipe } from "../lib/cooklang";
import type { GroundTruthDataset, PredictionsDataset } from "../types/extraction";
import type { CanonicalizationFile, CanonicalIngredientsData } from "../types/canonicalization";
import { ParsedRecipeSchema, type ParsedRecipe } from "recipe-domain";
import { ImageViewer } from "../components/ImageViewer";
import { ParsedRecipeEditor } from "../components/ParsedRecipeEditor";
import { RecipePanel } from "../components/RecipePanel";
import { ParsedRecipeDiff } from "../components/ParsedRecipeDiff";
import { ScoresPanel } from "../components/ScoresPanel";
import { computeCanonicalizationDetailScores } from "../lib/detailScores";

interface CanonicalizeDetailViewProps {
  entryIndex: number;
  onBack: () => void;
  onNavigate: (index: number) => void;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
export function CanonicalizeDetailView({
  entryIndex,
  onBack,
  onNavigate,
}: Readonly<CanonicalizeDetailViewProps>) {
  const [groundTruth, setGroundTruth] = useState<GroundTruthDataset | null>(null);
  const [canonicalizedPredictions, setCanonicalizedPredictions] = useState<PredictionsDataset | null>(null);
  const [canonicalizationFile, setCanonicalizationFile] = useState<CanonicalizationFile | null>(null);
  const [canonicalData, setCanonicalData] = useState<CanonicalIngredientsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edited, setEdited] = useState<ParsedRecipe | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const resetEntryKeyRef = useRef<string | null>(null);

  useEffect(() => {
    loadGroundTruth().then(setGroundTruth).catch((e) => setError(String(e)));
    loadCanonicalizedPredictions().then(setCanonicalizedPredictions).catch(() => {});
    loadCanonicalization().then(setCanonicalizationFile).catch(() => {});
    loadCanonicalIngredients().then(setCanonicalData).catch(() => {});
  }, []);

  const gtEntry = groundTruth?.entries[entryIndex];
  const predictionKey = gtEntry?.images.join("\0");

  const predictedCanonicalized: ParsedRecipe | null =
    predictionKey == null
      ? null
      : canonicalizedPredictions?.entries.find((e) => e.images.join("\0") === predictionKey)
          ?.predicted ?? null;

  const expectedNormalized = useMemo(() => {
    if (!gtEntry?.expectedNormalization) return null;
    return deriveNormalizedRecipe(gtEntry.expectedNormalization).recipe;
  }, [gtEntry?.expectedNormalization]);

  // Canonical ontology data
  const canonicalSlugs = useMemo(() => {
    if (!canonicalData) return new Set<string>();
    return new Set(canonicalData.ingredients.map((i) => i.slug));
  }, [canonicalData]);

  const canonicalCategories = useMemo(() => {
    if (!canonicalData) return new Map<string, string>();
    return new Map(canonicalData.ingredients.map((i) => [i.slug, i.category]));
  }, [canonicalData]);

  // Decisions for current entry
  const entryDecisions = useMemo(() => {
    if (!canonicalizationFile || !predictionKey) return [];
    const entry = canonicalizationFile.entries.find(
      (e) => e.images.join("\0") === predictionKey,
    );
    return entry?.decisions ?? [];
  }, [canonicalizationFile, predictionKey]);

  const handleAddCanonicalIngredient = useCallback(
    async (slug: string, category: string) => {
      if (!canonicalData) return;
      const existing = canonicalData.ingredients.find((e) => e.slug === slug);
      const ingredients = existing
        ? canonicalData.ingredients.map((e) =>
            e.slug === slug ? { slug, category } : e,
          )
        : [...canonicalData.ingredients, { slug, category }];
      const updated: CanonicalIngredientsData = {
        ingredients: ingredients.sort((a, b) => a.slug.localeCompare(b.slug)),
      };
      try {
        await saveCanonicalIngredients(updated);
        setCanonicalData(updated);
      } catch (e) {
        console.error("Failed to save canonical ingredients:", e);
      }
    },
    [canonicalData],
  );

  useEffect(() => {
    if (!gtEntry || !predictionKey || resetEntryKeyRef.current === predictionKey) {
      return;
    }
    resetEntryKeyRef.current = predictionKey;
    setEdited(structuredClone(gtEntry.expected));
    setDirty(false);
    setSaveStatus("idle");
    setSaveMessage(null);
  }, [gtEntry, predictionKey]);

  const validationResult = useMemo(() => {
    if (!edited) return null;
    return ParsedRecipeSchema.safeParse(edited);
  }, [edited]);

  const validationDiagnostics = useMemo(() => {
    if (!validationResult || validationResult.success) return [];
    return validationResult.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`;
    });
  }, [validationResult]);

  const expectedCanonicalized = validationResult?.success ? validationResult.data : null;

  const scoreBreakdown = useMemo(() => {
    if (!expectedCanonicalized || !predictedCanonicalized) return null;
    return computeCanonicalizationDetailScores(
      predictedCanonicalized,
      expectedCanonicalized,
    );
  }, [expectedCanonicalized, predictedCanonicalized]);

  const handleSave = useCallback(async () => {
    if (!groundTruth || !edited) return;
    const parsed = ParsedRecipeSchema.safeParse(edited);
    if (!parsed.success) {
      setSaveStatus("error");
      setSaveMessage("Fix validation issues before saving.");
      return;
    }
    setSaveStatus("saving");
    setSaveMessage(null);
    try {
      const updated = structuredClone(groundTruth);
      updated.entries[entryIndex].expected = parsed.data;
      const result = await saveGroundTruth(updated);
      setGroundTruth(updated);
      setEdited(structuredClone(parsed.data));
      setDirty(false);
      setSaveStatus("saved");
      setSaveMessage(result.message ?? null);
    } catch (e) {
      console.error("Save failed:", e);
      setSaveStatus("error");
      setSaveMessage("Failed to save ground truth.");
    }
  }, [edited, entryIndex, groundTruth]);

  const handleKeyDown = useCallback(
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
    (e: KeyboardEvent) => {
      const totalEntries = groundTruth?.entries.length ?? 0;
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (dirty) handleSave();
        return;
      }
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (e.key === "Escape") {
        onBack();
      } else if (e.key === "ArrowLeft" && entryIndex > 0) {
        onNavigate(entryIndex - 1);
      } else if (e.key === "ArrowRight" && entryIndex < totalEntries - 1) {
        onNavigate(entryIndex + 1);
      }
    },
    [dirty, entryIndex, groundTruth, handleSave, onBack, onNavigate],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6">
        <p className="text-red-700">{error}</p>
      </div>
    );
  }

  if (!groundTruth || !gtEntry) {
    return <div className="text-gray-400 py-12 text-center">Loading...</div>;
  }

  if (!edited) {
    return <div className="text-gray-400 py-12 text-center">Preparing editor...</div>;
  }

  const totalEntries = groundTruth.entries.length;
  const saveButtonContent = (() => {
    if (saveStatus === "saving") return "Saving...";
    if (saveStatus === "saved") {
      return <><Check className="h-3.5 w-3.5" /> Saved</>;
    }
    if (saveStatus === "error") {
      return <><AlertCircle className="h-3.5 w-3.5" /> Error</>;
    }
    return <><Save className="h-3.5 w-3.5" /> Save</>;
  })();
  const diffContent = (() => {
    if (expectedCanonicalized && predictedCanonicalized) {
      return (
        <ParsedRecipeDiff
          expected={expectedCanonicalized}
          predicted={predictedCanonicalized}
          scalarFields={["cuisine"]}
          showInstructions={false}
        />
      );
    }
    if (expectedCanonicalized) {
      return (
        <div className="bg-white rounded-lg border border-dashed border-gray-300 p-8 text-center text-gray-500">
          No canonicalized prediction available.
        </div>
      );
    }
    return (
      <div className="bg-white rounded-lg border border-dashed border-gray-300 p-8 text-center text-gray-500">
        Fix validation issues to preview the diff.
      </div>
    );
  })();

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <div className="flex-1">
          <h2 className="font-semibold">{edited?.title || gtEntry.expected.title}</h2>
          <p className="text-xs text-gray-400">
            Entry {entryIndex + 1} of {totalEntries}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {expectedNormalized && (
            <button
              type="button"
              onClick={() => {
                if (dirty && !window.confirm("This will replace all edited fields with the normalization ground truth. Continue?")) {
                  return;
                }
                setEdited(structuredClone(expectedNormalized));
                setDirty(true);
                setSaveStatus("idle");
                setSaveMessage(null);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-gray-200 rounded hover:bg-gray-50"
            >
              <FileDown className="h-3.5 w-3.5" />
              From Normalization
            </button>
          )}
          {predictedCanonicalized && (
            <button
              type="button"
              onClick={() => {
                if (dirty && !window.confirm("This will replace all edited fields with the prediction. Continue?")) {
                  return;
                }
                setEdited(structuredClone(predictedCanonicalized));
                setDirty(true);
                setSaveStatus("idle");
                setSaveMessage(null);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-gray-200 rounded hover:bg-gray-50"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy Prediction
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setEdited(structuredClone(gtEntry.expected));
              setDirty(false);
              setSaveStatus("idle");
              setSaveMessage(null);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-gray-200 rounded hover:bg-gray-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saveStatus === "saving"}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded font-medium ${
              dirty
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-gray-100 text-gray-400 cursor-not-allowed"
            }`}
          >
            {saveButtonContent}
          </button>
          <button
            type="button"
            onClick={() => onNavigate(entryIndex - 1)}
            disabled={entryIndex === 0}
            className="p-1 rounded text-gray-500 hover:text-gray-900 disabled:text-gray-300 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => onNavigate(entryIndex + 1)}
            disabled={entryIndex >= totalEntries - 1}
            className="p-1 rounded text-gray-500 hover:text-gray-900 disabled:text-gray-300 disabled:cursor-not-allowed"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>

      {saveMessage && (
        <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2 text-sm text-amber-800">
          {saveMessage}
        </div>
      )}

      {viewerIndex != null && (
        <ImageViewer
          sources={gtEntry.images.map((img) => imageUrl(`data/recipe-images/${img}`))}
          initialIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      )}

      {/* 3-column layout */}
      <div className="grid grid-cols-[1fr_1.25fr_1.1fr] gap-4 items-start">
        {/* Left: normalized ground truth context */}
        <div className="sticky top-4 self-start">
          {expectedNormalized ? (
            <RecipePanel
              recipe={expectedNormalized}
              label="Normalized Ground Truth (Context)"
            />
          ) : (
            <div className="bg-white rounded-lg border border-dashed border-gray-300 p-8 text-center text-gray-500">
              No normalized ground truth annotated.
            </div>
          )}
        </div>

        {/* Middle: editable ground truth */}
        <div>
          <ParsedRecipeEditor
            identity={predictionKey ?? `entry-${entryIndex}`}
            value={edited}
            diagnostics={validationDiagnostics}
            onChange={(next) => {
              setEdited(next);
              setDirty(true);
              setSaveStatus("idle");
              setSaveMessage(null);
            }}
            canonicalization={{
              canonicalSlugs,
              categories: canonicalCategories,
              normalizationSource: expectedNormalized,
              decisions: entryDecisions,
              onAddCanonicalIngredient: handleAddCanonicalIngredient,
            }}
          />
        </div>

        {/* Right: diff */}
        <div className="space-y-4">
          {scoreBreakdown && <ScoresPanel scores={scoreBreakdown} />}
          {diffContent}
        </div>
      </div>
    </div>
  );
}
