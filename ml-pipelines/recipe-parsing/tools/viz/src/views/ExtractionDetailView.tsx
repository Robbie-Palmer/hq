import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Copy } from "lucide-react";
import {
  imageUrl,
  loadExtractionPredictions,
  loadGroundTruth,
  saveGroundTruth,
} from "../lib/data";
import {
  computeCharErrorRate,
  computeRougeL,
  computeWordErrorRate,
} from "../../../../src/evaluation/metrics.js";
import { flattenExtractionText } from "../../../../src/lib/extraction-text.js";
import { ScoresPanel } from "../components/ScoresPanel";
import { computeExtractionDetailScores } from "../lib/detailScores";
import type {
  ExtractionPredictionsDataset,
  ExtractionRecipe,
  GroundTruthDataset,
} from "../types/extraction";
import { ImagePanel } from "../components/ImagePanel";
import { ImageViewer } from "../components/ImageViewer";
import { ExtractionDiff } from "../components/ExtractionDiff";

interface ExtractionDetailViewProps {
  entryIndex: number;
  onBack: () => void;
  onNavigate: (index: number) => void;
}

function TextFidelityCard({
  rougeLF1,
  wordErrorRate,
  charErrorRate,
}: Readonly<{
  rougeLF1: number;
  wordErrorRate: number;
  charErrorRate: number;
}>) {
  function formatPrecisePercent(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
  }

  const items = [
    { label: "ROUGE-L", value: formatPrecisePercent(rougeLF1), note: "text overlap, higher is better" },
    { label: "WER", value: formatPrecisePercent(wordErrorRate), note: "word edit rate, lower is better" },
    { label: "CER", value: formatPrecisePercent(charErrorRate), note: "char edit rate, lower is better" },
  ];

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-gray-900">Text Fidelity</h3>
        <p className="mt-1 text-xs text-gray-500">
          Text-similarity diagnostics for this recipe. These do not equal the
          structured extraction score.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {items.map((item) => (
          <div key={item.label} className="rounded-lg border border-gray-200 p-3">
            <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-gray-500">
              {item.label}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-gray-950">
              {item.value}
            </div>
            <div className="mt-1 text-xs text-gray-500">{item.note}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExtractionPanel({
  extraction,
  label,
}: Readonly<{
  extraction: ExtractionRecipe;
  label: string;
}>) {
  const cuisineText = extraction.cuisine?.join(", ");

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">
        {label}
      </div>

      <h3 className="text-xl font-bold mb-1">{extraction.title}</h3>
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
        <ul className="space-y-1.5">
          {extraction.instructions.map((step, i) => (
            <li key={i} className="text-sm leading-relaxed">
              {step}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing function predates the complexity limit; new violations remain prohibited.
export function ExtractionDetailView({
  entryIndex,
  onBack,
  onNavigate,
}: Readonly<ExtractionDetailViewProps>) {
  const [groundTruth, setGroundTruth] = useState<GroundTruthDataset | null>(null);
  const [extractions, setExtractions] = useState<ExtractionPredictionsDataset | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  useEffect(() => {
    loadGroundTruth().then(setGroundTruth).catch((e) => setError(String(e)));
    loadExtractionPredictions().then(setExtractions).catch(() => {});
  }, []);

  const gtEntry = groundTruth?.entries[entryIndex];
  const predictionKey = gtEntry?.images.join("\0");
  const predictedExtraction =
    predictionKey == null
      ? null
      : extractions?.entries.find((entry) => entry.images.join("\0") === predictionKey)
          ?.extracted ?? null;

  const handleCopyPrediction = useCallback(async () => {
    if (!groundTruth || !predictedExtraction) return;
    setSaving(true);
    try {
      const updated: GroundTruthDataset = {
        ...groundTruth,
        entries: groundTruth.entries.map((entry, i) =>
          i === entryIndex
            ? { ...entry, expectedExtraction: predictedExtraction }
            : entry,
        ),
      };
      await saveGroundTruth(updated);
      setGroundTruth(updated);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [groundTruth, predictedExtraction, entryIndex]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const totalEntries = groundTruth?.entries.length ?? 0;
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
    [entryIndex, groundTruth, onBack, onNavigate],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const textFidelity = useMemo(() => {
    if (!predictedExtraction || !gtEntry?.expectedExtraction) return null;
    const predictedText = flattenExtractionText(predictedExtraction);
    const expectedText = flattenExtractionText(gtEntry.expectedExtraction);
    return {
      wordErrorRate: computeWordErrorRate(predictedText, expectedText),
      charErrorRate: computeCharErrorRate(predictedText, expectedText),
      rougeLF1: computeRougeL(predictedText, expectedText).f1,
    };
  }, [gtEntry?.expectedExtraction, predictedExtraction]);

  const scoreBreakdown = useMemo(() => {
    if (!predictedExtraction || !gtEntry?.expectedExtraction) return null;
    return computeExtractionDetailScores(predictedExtraction, gtEntry.expectedExtraction);
  }, [gtEntry?.expectedExtraction, predictedExtraction]);

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

  const title =
    predictedExtraction?.title ?? gtEntry.expected.title;
  const totalEntries = groundTruth.entries.length;

  const hasBothSides = predictedExtraction && gtEntry.expectedExtraction;

  return (
    <div className="space-y-4">
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
          <h2 className="font-semibold">{title}</h2>
          <p className="text-xs text-gray-400">
            Entry {entryIndex + 1} of {totalEntries}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {predictedExtraction && (
            <button
              type="button"
              onClick={handleCopyPrediction}
              disabled={saving}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50"
            >
              <Copy className="h-3 w-3" />
              {saving ? "Saving..." : "Use as Expected"}
            </button>
          )}
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

      {viewerIndex != null && (
        <ImageViewer
          sources={gtEntry.images.map((img) => imageUrl(`data/recipe-images/${img}`))}
          initialIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      )}

      <div className="grid grid-cols-[auto_1fr] gap-4 items-start">
        {/* Left: source images */}
        <div className="sticky top-4 self-start w-64">
          <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
            Input Images
          </div>
          <ImagePanel
            imagePaths={gtEntry.images.map((img) => `data/recipe-images/${img}`)}
            onClickImage={setViewerIndex}
          />
        </div>

        {/* Right: diff or individual panels */}
        <div>
          {scoreBreakdown && (
            <div className="mb-4">
              <ScoresPanel scores={scoreBreakdown} />
            </div>
          )}
          {textFidelity && (
            <div className="mb-4">
              <TextFidelityCard
                rougeLF1={textFidelity.rougeLF1}
                wordErrorRate={textFidelity.wordErrorRate}
                charErrorRate={textFidelity.charErrorRate}
              />
            </div>
          )}
          {hasBothSides ? (
            <ExtractionDiff
              expected={gtEntry.expectedExtraction!}
              predicted={predictedExtraction!}
            />
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {predictedExtraction ? (
                <ExtractionPanel
                  extraction={predictedExtraction}
                  label="OCR Extraction (Predicted)"
                />
              ) : (
                <div className="bg-white rounded-lg border border-dashed border-gray-300 p-8 text-center text-gray-500">
                  No extraction prediction available.
                </div>
              )}
              {gtEntry.expectedExtraction ? (
                <ExtractionPanel
                  extraction={gtEntry.expectedExtraction}
                  label="Expected Extraction (Ground Truth)"
                />
              ) : (
                <div className="bg-white rounded-lg border border-dashed border-gray-300 p-8 text-center text-gray-500">
                  No expected extraction annotated.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
