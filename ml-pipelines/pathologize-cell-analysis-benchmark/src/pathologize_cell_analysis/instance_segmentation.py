from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from numpy.typing import NDArray
from skimage.draw import polygon

from .contracts import InstanceSegmentationMetrics
from .data import Annotation
from .methods import PredictedNucleus


@dataclass
class InstanceSegmentationRecords:
    eligible_count: int = 0
    localized_count: int = 0
    instance_ious: list[float] = field(default_factory=list)
    instance_dices: list[float] = field(default_factory=list)


def _polygon_pixels(annotation: Annotation, shape: tuple[int, int]) -> NDArray[np.int64]:
    rows, columns = polygon(annotation.coordinates_y, annotation.coordinates_x, shape=shape)
    return np.asarray(rows * shape[1] + columns, dtype=np.int64)


def _overlap(
    annotation: Annotation, prediction: PredictedNucleus, shape: tuple[int, int]
) -> tuple[float, float]:
    truth_pixels = _polygon_pixels(annotation, shape)
    intersection = np.intersect1d(truth_pixels, prediction.flat_pixels, assume_unique=False).size
    union = np.union1d(truth_pixels, prediction.flat_pixels).size
    iou = intersection / union if union else 0.0
    total = truth_pixels.size + prediction.flat_pixels.size
    dice = 2 * intersection / total if total else 0.0
    return float(iou), float(dice)


def update_segmentation_records(
    records: InstanceSegmentationRecords,
    truth: list[Annotation],
    predictions: list[PredictedNucleus],
    matches: list[tuple[int, int]],
    image_shape: tuple[int, int],
) -> None:
    records.eligible_count += sum(annotation.annotation_type == "polyline" for annotation in truth)
    for truth_index, predicted_index in matches:
        annotation = truth[truth_index]
        if annotation.annotation_type != "polyline":
            continue
        iou, dice = _overlap(annotation, predictions[predicted_index], image_shape)
        records.localized_count += 1
        records.instance_ious.append(iou)
        records.instance_dices.append(dice)


def segmentation_metrics(
    records: InstanceSegmentationRecords,
) -> InstanceSegmentationMetrics:
    return InstanceSegmentationMetrics(
        eligible_polygon_instances=records.eligible_count,
        localized_polygon_instances=records.localized_count,
        localization_coverage=(
            records.localized_count / records.eligible_count if records.eligible_count else 0.0
        ),
        mean_instance_iou=(float(np.mean(records.instance_ious)) if records.instance_ious else 0.0),
        mean_instance_dice=(
            float(np.mean(records.instance_dices)) if records.instance_dices else 0.0
        ),
        success_at_iou_0_5=(
            float(np.mean(np.asarray(records.instance_ious) >= 0.5))
            if records.instance_ious
            else 0.0
        ),
    )
