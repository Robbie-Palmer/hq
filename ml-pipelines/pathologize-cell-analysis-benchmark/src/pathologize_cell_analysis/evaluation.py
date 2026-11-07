from __future__ import annotations

import json
import math
import resource
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from numpy.typing import NDArray
from scipy.optimize import linear_sum_assignment
from skimage.draw import polygon
from sklearn.metrics import precision_recall_fscore_support

from .contracts import Experiment, ResourceEvidence, RunEvidence, SplitItem
from .data import Annotation, load_annotations
from .methods import Classifier, PredictedNucleus, load_rgb, segment_nuclei

FloatArray = NDArray[np.float64]


@dataclass
class SliceRecords:
    truth_count: int = 0
    prediction_count: int = 0
    match_count: int = 0
    boundary_count: int = 0
    boundary_matched_count: int = 0
    segment_ious: list[float] = field(default_factory=list)
    segment_dices: list[float] = field(default_factory=list)
    class_truth: list[int] = field(default_factory=list)
    class_probabilities: list[FloatArray] = field(default_factory=list)


def _detection_matches(
    truth: list[Annotation], predictions: list[PredictedNucleus], radius: float
) -> list[tuple[int, int]]:
    if not truth or not predictions:
        return []
    truth_centers = np.asarray([annotation.center for annotation in truth], dtype=np.float64)
    predicted_centers = np.asarray(
        [(prediction.center_x, prediction.center_y) for prediction in predictions], dtype=np.float64
    )
    distances = np.linalg.norm(truth_centers[:, None, :] - predicted_centers[None, :, :], axis=2)
    truth_indices, predicted_indices = linear_sum_assignment(distances)
    return [
        (int(truth_index), int(predicted_index))
        for truth_index, predicted_index in zip(truth_indices, predicted_indices, strict=True)
        if distances[truth_index, predicted_index] <= radius
    ]


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


def _ratio(numerator: int, denominator: int) -> float:
    return numerator / denominator if denominator else 0.0


def _detection_metrics(records: SliceRecords) -> dict[str, float | int]:
    precision = _ratio(records.match_count, records.prediction_count)
    recall = _ratio(records.match_count, records.truth_count)
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {
        "detection_precision": precision,
        "detection_recall": recall,
        "detection_f1": f1,
        "detection_truth_instances": records.truth_count,
        "detection_predicted_instances": records.prediction_count,
        "detection_matched_instances": records.match_count,
    }


def _calibration(truth: NDArray[np.int64], probabilities: FloatArray) -> tuple[float, float, float]:
    targets = np.eye(probabilities.shape[1], dtype=np.float64)[truth]
    brier = float(np.mean(np.sum((probabilities - targets) ** 2, axis=1)))
    confidence = probabilities.max(axis=1)
    predicted = probabilities.argmax(axis=1)
    correct = predicted == truth
    ece = 0.0
    for lower in np.linspace(0.0, 0.9, 10):
        upper = lower + 0.1
        selected = (confidence > lower) & (confidence <= upper)
        if selected.any():
            ece += float(selected.mean()) * abs(
                float(correct[selected].mean()) - float(confidence[selected].mean())
            )
    selected_probability = probabilities[np.arange(len(truth)), truth]
    negative_log_likelihood = float(-np.log(np.clip(selected_probability, 1e-12, 1)).mean())
    return brier, ece, negative_log_likelihood


def _classification_metrics(
    records: SliceRecords, classes: tuple[str, ...]
) -> tuple[dict[str, float | int], dict[str, dict[str, float | int]]]:
    if not records.class_truth:
        empty = {
            label: {"precision": 0.0, "recall": 0.0, "f1": 0.0, "support": 0, "brier": 0.0}
            for label in classes
        }
        return {
            "classification_evaluated_instances": 0,
            "classification_macro_f1": 0.0,
            "classification_brier": 0.0,
            "classification_ece_10_bin": 0.0,
            "classification_negative_log_likelihood": 0.0,
        }, empty
    truth = np.asarray(records.class_truth, dtype=np.int64)
    probabilities = np.vstack(records.class_probabilities)
    predicted = probabilities.argmax(axis=1)
    precision, recall, f1, support = precision_recall_fscore_support(
        truth,
        predicted,
        labels=np.arange(len(classes)),
        zero_division=0,
    )
    brier, ece, negative_log_likelihood = _calibration(truth, probabilities)
    per_class = {
        label: {
            "precision": float(precision[index]),
            "recall": float(recall[index]),
            "f1": float(f1[index]),
            "support": int(support[index]),
            "brier": float(np.mean((probabilities[:, index] - (truth == index)) ** 2)),
        }
        for index, label in enumerate(classes)
    }
    return {
        "classification_evaluated_instances": len(truth),
        "classification_macro_f1": float(np.mean(f1)),
        "classification_brier": brier,
        "classification_ece_10_bin": ece,
        "classification_negative_log_likelihood": negative_log_likelihood,
    }, per_class


def _segmentation_metrics(records: SliceRecords) -> dict[str, float | int]:
    return {
        "segmentation_boundary_instances": records.boundary_count,
        "segmentation_matched_boundary_instances": records.boundary_matched_count,
        "segmentation_detection_coverage": _ratio(
            records.boundary_matched_count, records.boundary_count
        ),
        "segmentation_mean_instance_iou": (
            float(np.mean(records.segment_ious)) if records.segment_ious else 0.0
        ),
        "segmentation_mean_instance_dice": (
            float(np.mean(records.segment_dices)) if records.segment_dices else 0.0
        ),
        "segmentation_success_at_iou_0_5": (
            float(np.mean(np.asarray(records.segment_ious) >= 0.5)) if records.segment_ious else 0.0
        ),
    }


def _slice_metrics(
    records: SliceRecords, classes: tuple[str, ...]
) -> tuple[dict[str, float | int], dict[str, dict[str, float | int]]]:
    classification, per_class = _classification_metrics(records, classes)
    return {
        **_detection_metrics(records),
        **_segmentation_metrics(records),
        **classification,
    }, per_class


def _prediction_record(
    item: SplitItem,
    prediction: PredictedNucleus,
    probabilities: FloatArray,
    classes: tuple[str, ...],
) -> dict[str, object]:
    return {
        "item_id": item.item_id,
        "slide_id": item.slide_id,
        "patient_id": item.patient_id,
        "site_id": item.site_id,
        "instance_id": prediction.instance_id,
        "center": [prediction.center_x, prediction.center_y],
        "bbox": list(prediction.bbox),
        "class_probabilities": {
            label: float(probabilities[index]) for index, label in enumerate(classes)
        },
    }


def _validate_probabilities(
    probabilities: FloatArray, prediction_count: int, class_count: int
) -> None:
    if probabilities.shape != (prediction_count, class_count):
        raise ValueError("classifier probability matrix has the wrong shape")
    if not np.allclose(probabilities.sum(axis=1), 1.0):
        raise ValueError("classification probabilities do not sum to one")


def _update_records(
    records: SliceRecords,
    truth: list[Annotation],
    predictions: list[PredictedNucleus],
    probabilities: FloatArray,
    matches: list[tuple[int, int]],
    classes: tuple[str, ...],
    image_shape: tuple[int, int],
    exclusions: Counter[str],
) -> None:
    class_index = {label: index for index, label in enumerate(classes)}
    records.truth_count += len(truth)
    records.prediction_count += len(predictions)
    records.match_count += len(matches)
    records.boundary_count += sum(annotation.annotation_type == "polyline" for annotation in truth)
    for truth_index, predicted_index in matches:
        annotation = truth[truth_index]
        if annotation.annotation_type == "polyline":
            iou, dice = _overlap(annotation, predictions[predicted_index], image_shape)
            records.boundary_matched_count += 1
            records.segment_ious.append(iou)
            records.segment_dices.append(dice)
        if annotation.class_name in class_index:
            records.class_truth.append(class_index[annotation.class_name])
            records.class_probabilities.append(probabilities[predicted_index])
        else:
            exclusions[annotation.class_name] += 1


def _peak_rss_bytes() -> int:
    usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return int(usage * 1024)


def evaluate_adapter(
    experiment: Experiment,
    data_root: Path,
    output_root: Path,
    classifier: Classifier,
    train_items: list[SplitItem],
    test_items: list[SplitItem],
) -> RunEvidence:
    start_wall = time.monotonic()
    start_cpu = time.process_time()
    deadline = start_wall + experiment.per_run_wall_seconds
    classifier.fit(data_root, train_items)
    aggregate = SliceRecords()
    sites: dict[str, SliceRecords] = defaultdict(SliceRecords)
    exclusions: Counter[str] = Counter()
    failures: list[dict[str, str]] = []
    prediction_path = output_root / classifier.adapter_id / "predictions.jsonl"
    prediction_path.parent.mkdir(parents=True, exist_ok=True)
    with prediction_path.open("w", encoding="utf-8") as prediction_output:
        for item in test_items:
            if time.monotonic() > deadline:
                failures.append(
                    {
                        "item_id": item.item_id,
                        "error_type": "WallTimeCeilingExceeded",
                        "message": f"run exceeded {experiment.per_run_wall_seconds} seconds",
                    }
                )
                break
            try:
                image = load_rgb(data_root / item.image_path)
                truth = load_annotations(data_root / item.annotation_path)
                predictions = segment_nuclei(
                    image,
                    experiment.minimum_nucleus_pixels,
                    experiment.watershed_minimum_distance_pixels,
                )
                probabilities = classifier.probabilities(image, predictions)
                _validate_probabilities(probabilities, len(predictions), len(classifier.classes))
                matches = _detection_matches(truth, predictions, experiment.detection_radius_pixels)
                _update_records(
                    aggregate,
                    truth,
                    predictions,
                    probabilities,
                    matches,
                    classifier.classes,
                    image.shape[:2],
                    exclusions,
                )
                _update_records(
                    sites[item.site_id],
                    truth,
                    predictions,
                    probabilities,
                    matches,
                    classifier.classes,
                    image.shape[:2],
                    Counter(),
                )
                for prediction, probability in zip(predictions, probabilities, strict=True):
                    prediction_output.write(
                        json.dumps(
                            _prediction_record(
                                item,
                                prediction,
                                np.asarray(probability, dtype=np.float64),
                                classifier.classes,
                            ),
                            sort_keys=True,
                        )
                        + "\n"
                    )
            except Exception as error:
                failures.append(
                    {
                        "item_id": item.item_id,
                        "error_type": type(error).__name__,
                        "message": str(error),
                    }
                )
    metrics, per_class = _slice_metrics(aggregate, classifier.classes)
    site_slices = {
        site: _slice_metrics(records, classifier.classes)[0]
        for site, records in sorted(sites.items())
    }
    wall_seconds = time.monotonic() - start_wall
    resources = ResourceEvidence(
        wall_seconds=wall_seconds,
        cpu_seconds=time.process_time() - start_cpu,
        gpu_seconds=0,
        peak_rss_bytes=_peak_rss_bytes(),
        peak_vram_bytes=0,
        accelerator="none",
        per_run_wall_ceiling_seconds=experiment.per_run_wall_seconds,
        aggregate_gpu_ceiling_seconds=experiment.aggregate_accelerator_seconds,
    )
    result = RunEvidence(
        adapter_id=classifier.adapter_id,
        metrics=metrics,
        per_class=per_class,
        site_slices=site_slices,
        exclusions=dict(sorted(exclusions.items())),
        failures=failures,
        resources=resources,
    )
    (prediction_path.parent / "run.json").write_text(
        result.model_dump_json(indent=2) + "\n", encoding="utf-8"
    )
    if not math.isfinite(float(metrics["classification_brier"])):
        raise ValueError("run produced a non-finite calibration metric")
    return result
