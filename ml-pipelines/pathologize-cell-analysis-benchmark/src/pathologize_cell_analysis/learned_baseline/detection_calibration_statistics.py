from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import numpy as np

from ..data import SplitItem, load_annotations
from ..localization import match_localizations
from .detection_calibration_contracts import CalibrationPredictionRecord
from .evaluation import as_predicted_nucleus, evaluate_records


@dataclass(frozen=True)
class LocalizationCounts:
    truth: int = 0
    predicted: int = 0
    matched: int = 0

    def __add__(self, other: LocalizationCounts) -> LocalizationCounts:
        return LocalizationCounts(
            truth=self.truth + other.truth,
            predicted=self.predicted + other.predicted,
            matched=self.matched + other.matched,
        )


def _counts_metrics(counts: LocalizationCounts) -> dict[str, float]:
    precision = counts.matched / counts.predicted if counts.predicted else 0.0
    recall = counts.matched / counts.truth if counts.truth else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {"precision": precision, "recall": recall, "f1": f1}


def _slide_counts(
    records: list[CalibrationPredictionRecord],
    items: dict[str, SplitItem],
    source_root: Path,
    tolerance_pixels: float,
) -> dict[str, LocalizationCounts]:
    counts: dict[str, LocalizationCounts] = defaultdict(LocalizationCounts)
    for record in records:
        item = items[record.item_id]
        truth = load_annotations(source_root / item.annotation_path)
        predictions = [
            as_predicted_nucleus(prediction, (record.image_height, record.image_width))
            for prediction in record.predictions
        ]
        matches = match_localizations(truth, predictions, tolerance_pixels)
        counts[item.slide_id] = counts[item.slide_id] + LocalizationCounts(
            truth=len(truth), predicted=len(predictions), matched=len(matches)
        )
    return dict(counts)


def paired_slide_bootstrap(
    baseline_records: list[CalibrationPredictionRecord],
    candidate_records: list[CalibrationPredictionRecord],
    items: dict[str, SplitItem],
    source_root: Path,
    resamples: int,
    seed: int,
    tolerance_pixels: float,
) -> dict[str, Any]:
    baseline = _slide_counts(baseline_records, items, source_root, tolerance_pixels)
    candidate = _slide_counts(candidate_records, items, source_root, tolerance_pixels)
    if set(baseline) != set(candidate):
        raise ValueError("paired bootstrap requires identical slide coverage")
    slides = sorted(baseline)
    baseline_values = [baseline[slide] for slide in slides]
    candidate_values = [candidate[slide] for slide in slides]
    rng = np.random.default_rng(seed)
    deltas: dict[str, list[float]] = {key: [] for key in ("precision", "recall", "f1")}
    for _ in range(resamples):
        indices = rng.integers(0, len(slides), size=len(slides))
        baseline_total = LocalizationCounts()
        candidate_total = LocalizationCounts()
        for index in indices:
            baseline_total += baseline_values[int(index)]
            candidate_total += candidate_values[int(index)]
        baseline_metrics = _counts_metrics(baseline_total)
        candidate_metrics = _counts_metrics(candidate_total)
        for key in deltas:
            deltas[key].append(candidate_metrics[key] - baseline_metrics[key])
    return {
        "unit": "slide_id",
        "method": "paired_percentile_bootstrap",
        "resamples": resamples,
        "seed": seed,
        "confidence_level": 0.95,
        "delta_intervals": {
            key: {
                "lower": float(np.quantile(values, 0.025)),
                "upper": float(np.quantile(values, 0.975)),
            }
            for key, values in deltas.items()
        },
    }


def evaluate_detection_records(
    records: list[CalibrationPredictionRecord],
    items: dict[str, SplitItem],
    source_root: Path,
    labels: list[str],
    tolerance_pixels: float,
) -> dict[str, Any]:  # pragma: no cover
    return cast(
        dict[str, Any],
        evaluate_records(
            "detect",
            cast(Any, records),
            items,
            source_root,
            labels,
            tolerance_pixels,
        ),
    )
