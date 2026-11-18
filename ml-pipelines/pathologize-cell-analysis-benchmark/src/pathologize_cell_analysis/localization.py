from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

import numpy as np
from scipy.optimize import linear_sum_assignment

from .contracts import LocalizationMetrics
from .data import Annotation
from .methods import PredictedNucleus


@dataclass
class LocalizationRecords:
    truth_count: int = 0
    prediction_count: int = 0
    match_count: int = 0
    truth_by_annotation_type: Counter[str] = field(default_factory=Counter)


def match_localizations(
    truth: list[Annotation], predictions: list[PredictedNucleus], tolerance_pixels: float
) -> list[tuple[int, int]]:
    if not truth or not predictions:
        return []
    truth_centers = np.asarray([annotation.center for annotation in truth], dtype=np.float64)
    predicted_centers = np.asarray(
        [(prediction.center_x, prediction.center_y) for prediction in predictions], dtype=np.float64
    )
    distances = np.linalg.norm(truth_centers[:, None, :] - predicted_centers[None, :, :], axis=2)
    # Minimize invalid assignments before distance so a short out-of-tolerance
    # edge cannot displace two valid matches.
    assignment_cost = distances.copy()
    invalid_penalty = (min(distances.shape) + 1) * (tolerance_pixels + 1)
    assignment_cost[distances > tolerance_pixels] = invalid_penalty
    truth_indices, predicted_indices = linear_sum_assignment(assignment_cost)
    return [
        (int(truth_index), int(predicted_index))
        for truth_index, predicted_index in zip(truth_indices, predicted_indices, strict=True)
        if distances[truth_index, predicted_index] <= tolerance_pixels
    ]


def update_localization_records(
    records: LocalizationRecords,
    truth: list[Annotation],
    predictions: list[PredictedNucleus],
    matches: list[tuple[int, int]],
) -> None:
    records.truth_count += len(truth)
    records.prediction_count += len(predictions)
    records.match_count += len(matches)
    records.truth_by_annotation_type.update(annotation.annotation_type for annotation in truth)


def localization_metrics(
    records: LocalizationRecords, tolerance_pixels: float
) -> LocalizationMetrics:
    precision = records.match_count / records.prediction_count if records.prediction_count else 0.0
    recall = records.match_count / records.truth_count if records.truth_count else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return LocalizationMetrics(
        match_tolerance_pixels=tolerance_pixels,
        precision=precision,
        recall=recall,
        f1=f1,
        truth_points=records.truth_count,
        predicted_points=records.prediction_count,
        matched_points=records.match_count,
        truth_by_annotation_type=dict(sorted(records.truth_by_annotation_type.items())),
    )
