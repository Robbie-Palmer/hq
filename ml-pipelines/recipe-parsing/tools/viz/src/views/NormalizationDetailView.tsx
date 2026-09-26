import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, Check, ChevronLeft, ChevronRight, Copy, Save } from "lucide-react";
import {
  imageUrl,
  loadCooklangPredictions,
  loadExtractionPredictions,
  loadGroundTruth,
  loadPredictions,
  saveGroundTruth,
} from "../lib/data";
import { deriveNormalizedRecipe } from "../lib/cooklang";
import { extractCookwareFromBody } from "recipe-parsing/cooklang";
import type {
  CooklangPredictionsDataset,
  CooklangRecipe,
  ExtractionPredictionsDataset,
  ExtractionRecipe,
  GroundTruthDataset,
  PredictionsDataset,
} from "../types/extraction";
import { CooklangEditor } from "../components/CooklangEditor";
import { ImageViewer } from "../components/ImageViewer";
import { ParsedRecipeDiff } from "../components/ParsedRecipeDiff";
import { RecipePanel } from "../components/RecipePanel";
import { ScoresPanel } from "../components/ScoresPanel";
import { computeNormalizationDetailScores } from "../lib/detailScores";

interface NormalizationDetailViewProps {
  entryIndex: number;
  onBack: () => void;
  onNavigate: (index: number) => void;
}

const EMPTY_COOKLANG: CooklangRecipe = {
  frontmatter: { tags: [] },
  body: "",
  diagnostics: [],
};

type SaveStatus = "idle" | "saving" | "saved" | "error";

function ExtractionContextPanel({
  extraction,
}: Readonly<{
  extraction: ExtractionRecipe;
}>) {
  const cuisineText = extraction.cuisine?.join(", ");

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">
        Extraction Input (Context)
      </div>

      <h3 className="text-lg font-bold mb-1">{extraction.title}</h3>
      {extraction.description && (
        <p className="text-sm text-gray-600 mb-3">{extraction.description}</p>
      )}

      <div className="flex flex-wrap gap-3 text-xs text-gray-500 mb-4">
        {cuisineText && (
          <span className="px-2 py-0.5 rounded bg-gray-100 font-medium">
            {cuisineText}
          </span>
        )}
        {extraction.servings && <span>Servings: {extraction.servings}</span>}
        {extraction.prepTime && <span>Prep: {extraction.prepTime}</span>}
        {extraction.cookTime && <span>Cook: {extraction.cookTime}</span>}
      </div>

      <div className="mb-4">
        <h4 className="font-semibold text-sm mb-2">Ingredients</h4>
        {extraction.ingredientGroups.map((group, gi) => (
          <div key={gi} className="mb-2">
            {group.name && (
              <div className="text-sm font-medium text-gray-700 mb-1">
                {group.name}
              </div>
            )}
            <ul className="space-y-0.5">
              {(group.lines ?? []).map((line, li) => (
                <li
                  key={`${gi}-${li}`}
                  className="text-sm flex items-start gap-1.5"
                >
                  <span className="text-gray-300 mt-1.5 h-1 w-1 rounded-full bg-current shrink-0" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div>
        <h4 className="font-semibold text-sm mb-2">Instructions</h4>
        <ol className="space-y-1.5 list-decimal list-inside">
          {extraction.instructions.map((step, i) => (
            <li key={i} className="text-sm leading-relaxed pl-1">
              {step}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
export function NormalizationDetailView({
  entryIndex,
  onBack,
  onNavigate,
}: Readonly<NormalizationDetailViewProps>) {
  const [groundTruth, setGroundTruth] = useState<GroundTruthDataset | null>(null);
  const [predictions, setPredictions] = useState<PredictionsDataset | null>(null);
  const [extractions, setExtractions] = useState<ExtractionPredictionsDataset | null>(null);
  const [cooklangPredictions, setCooklangPredictions] = useState<CooklangPredictionsDataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edited, setEdited] = useState<CooklangRecipe | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const resetEntryKeyRef = useRef<string | null>(null);

  useEffect(() => {
    loadGroundTruth().then(setGroundTruth).catch((e) => setError(String(e)));
    loadPredictions().then(setPredictions).catch(() => {});
    loadExtractionPredictions().then(setExtractions).catch(() => {});
    loadCooklangPredictions().then(setCooklangPredictions).catch(() => {});
  }, []);

  const gtEntry = groundTruth?.entries[entryIndex];
  const predictionKey = gtEntry?.images.join("\0");
  const predictedNormalizationFallback =
    predictionKey == null
      ? null
      : predictions?.entries.find((e) => e.images.join("\0") === predictionKey)
          ?.predicted ?? null;
  const predictedExtraction =
    predictionKey == null
      ? null
      : extractions?.entries.find((e) => e.images.join("\0") === predictionKey)
          ?.extracted ?? null;
  const predictedCooklang =
    predictionKey == null
      ? null
      : cooklangPredictions?.entries.find((e) => e.images.join("\0") === predictionKey)
          ?.cooklang ?? null;

  const predictedNormalization = useMemo(() => {
    if (predictedCooklang) {
      return deriveNormalizedRecipe(predictedCooklang).recipe;
    }
    return predictedNormalizationFallback;
  }, [predictedCooklang, predictedNormalizationFallback]);

  // Initialize editor when navigating to a new entry
  useEffect(() => {
    if (!gtEntry || !predictionKey || resetEntryKeyRef.current === predictionKey) {
      return;
    }
    resetEntryKeyRef.current = predictionKey;
    setEdited(gtEntry.expectedNormalization ?? null);
    setDirty(false);
    setSaveStatus("idle");
    setSaveMessage(null);
  }, [gtEntry, predictionKey]);

  const handleSave = useCallback(async () => {
    if (!groundTruth) return;
    setSaveStatus("saving");
    setSaveMessage(null);
    try {
      const updated = structuredClone(groundTruth);
      if (edited) {
        const { derived: _derived, ...cleanEdited } = edited;
        updated.entries[entryIndex].expectedNormalization = {
          ...cleanEdited,
          diagnostics: [],
        };
      } else {
        delete updated.entries[entryIndex].expectedNormalization;
      }
      const result = await saveGroundTruth(updated);
      setGroundTruth(updated);
      setDirty(false);
      setSaveStatus("saved");
      setSaveMessage(result.message ?? null);
    } catch (e) {
      console.error("Save failed:", e);
      setSaveStatus("error");
    }
  }, [edited, entryIndex, groundTruth]);

  useEffect(() => {
    const totalEntries = groundTruth?.entries.length ?? 0;
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
    function onKeyDown(e: KeyboardEvent) {
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
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dirty, entryIndex, groundTruth, handleSave, onBack, onNavigate]);

  const livePreview = useMemo(() => {
    if (!edited) return null;
    return deriveNormalizedRecipe(edited);
  }, [edited]);

  const expectedNormalized = useMemo(() => {
    if (!edited) return gtEntry?.expectedNormalization?.derived ?? null;
    return livePreview?.recipe ?? null;
  }, [edited, gtEntry?.expectedNormalization?.derived, livePreview?.recipe]);

  const previewDiagnostics = useMemo(() => {
    if (!edited) return [];
    return livePreview?.diagnostics ?? [];
  }, [edited, livePreview?.diagnostics]);

  const scoreBreakdown = useMemo(() => {
    if (!expectedNormalized || !predictedNormalization) return null;
    return computeNormalizationDetailScores(predictedNormalization, expectedNormalized);
  }, [expectedNormalized, predictedNormalization]);

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
  const middleContent = (() => {
    if (edited) {
      return (
        <CooklangEditor
          value={edited}
          diagnostics={previewDiagnostics}
          onChange={(next) => {
            setEdited(next);
            setDirty(true);
            setSaveStatus("idle");
            setSaveMessage(null);
          }}
        />
      );
    }
    if (predictedNormalization) {
      return (
        <RecipePanel
          recipe={predictedNormalization}
          label="Predicted Normalization"
        />
      );
    }
    return (
      <div className="bg-white rounded-lg border border-dashed border-gray-300 p-8 text-center text-gray-500">
        No normalization prediction available.
      </div>
    );
  })();
  const diffContent = (() => {
    if (edited && expectedNormalized && predictedNormalization) {
      return (
        <ParsedRecipeDiff
          expected={expectedNormalized}
          predicted={predictedNormalization}
          expectedCookware={edited.body ? extractCookwareFromBody(edited.body) : []}
          predictedCookware={predictedCooklang?.body ? extractCookwareFromBody(predictedCooklang.body) : []}
          scalarFields={["title", "cuisine", "servings", "prepTime", "cookTime"]}
        />
      );
    }
    if (edited) {
      const message = expectedNormalized
        ? "No normalization prediction to diff against."
        : "Cooklang cannot be derived yet — check for diagnostics.";
      return (
        <div className="bg-white rounded-lg border border-gray-200 p-5 text-sm text-gray-500">
          {message}
        </div>
      );
    }
    return (
      <div className="bg-white rounded-lg border border-dashed border-gray-300 p-8 text-center text-gray-500">
        Click "Copy Prediction" or "Init Empty" to start annotating ground truth.
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
          <h2 className="font-semibold">{gtEntry.expected.title}</h2>
          <p className="text-xs text-gray-400">
            Entry {entryIndex + 1} of {totalEntries}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {predictedCooklang && (
            <button
              type="button"
              onClick={() => {
                setEdited(structuredClone(predictedCooklang));
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
              setEdited(structuredClone(EMPTY_COOKLANG));
              setDirty(true);
              setSaveStatus("idle");
              setSaveMessage(null);
            }}
            className="px-3 py-1.5 text-sm bg-white border border-gray-200 rounded hover:bg-gray-50"
          >
            Init Empty
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
          <div className="flex items-center gap-1">
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
        {/* Left: predicted extraction context */}
        <div className="sticky top-4 self-start space-y-4">
          {predictedExtraction ? (
            <ExtractionContextPanel extraction={predictedExtraction} />
          ) : (
            <div className="bg-white rounded-lg border border-dashed border-gray-300 p-8 text-center text-gray-500">
              No extraction prediction available.
            </div>
          )}
        </div>

        {/* Middle: CooklangEditor (editing) or predicted normalization (read-only) */}
        <div>
          {middleContent}
        </div>

        {/* Right: diff (when editing) or empty prompt */}
        <div className="space-y-4">
          {scoreBreakdown && <ScoresPanel scores={scoreBreakdown} />}
          {diffContent}
          {previewDiagnostics.length > 0 && (
            <div className="rounded border border-amber-200 bg-amber-50 p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-amber-700 mb-2">
                Preview Diagnostics
              </div>
              <ul className="space-y-1 text-sm text-amber-900">
                {previewDiagnostics.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
