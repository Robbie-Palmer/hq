from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import numpy as np
from data_artifacts.files import read_json, read_jsonl, sha256_file, write_json
from skimage.draw import polygon
from ultralytics_extensions.checkpoints import load_safe_checkpoint, training_rows

from ..contracts import SpatialPrediction, SpatialPredictionRecord
from ..data import Annotation, SplitItem, load_annotations
from ..instance_segmentation import (
    InstanceSegmentationRecords,
    segmentation_metrics,
    update_segmentation_records,
)
from ..localization import (
    LocalizationRecords,
    localization_metrics,
    match_localizations,
    update_localization_records,
)
from ..methods import PredictedNucleus
from .config import (
    LAYOUT_DIRECTORY,
    PARAMS_FILE,
    TRANSPARENT_BASELINE_REPORT,
    cohort,
    data_root,
    load_config,
    ontology_labels,
    output_root,
    parameters_sha256,
    project_root,
)

Task = Literal["detect", "segment"]


@dataclass
class SpatialSlice:
    localization: LocalizationRecords = field(default_factory=LocalizationRecords)
    segmentation: InstanceSegmentationRecords = field(default_factory=InstanceSegmentationRecords)


def as_predicted_nucleus(
    prediction: SpatialPrediction, image_shape: tuple[int, int]
) -> PredictedNucleus:
    xmin, ymin, xmax, ymax = prediction.bbox_xyxy_pixels
    flat_pixels = np.asarray([], dtype=np.int64)
    if prediction.polygon_xy_pixels is not None:
        columns = [point[0] for point in prediction.polygon_xy_pixels]
        rows = [point[1] for point in prediction.polygon_xy_pixels]
        polygon_rows, polygon_columns = polygon(rows, columns, shape=image_shape)
        flat_pixels = np.asarray(
            polygon_rows * image_shape[1] + polygon_columns,
            dtype=np.int64,
        )
    return PredictedNucleus(
        instance_id=prediction.instance_id,
        center_x=(xmin + xmax) / 2,
        center_y=(ymin + ymax) / 2,
        xmin=round(xmin),
        ymin=round(ymin),
        xmax=round(xmax),
        ymax=round(ymax),
        flat_pixels=flat_pixels,
    )


def _update_slice(
    records: SpatialSlice,
    truth: list[Annotation],
    predictions: list[PredictedNucleus],
    tolerance: float,
    image_shape: tuple[int, int],
    include_segmentation: bool,
) -> None:
    matches = match_localizations(truth, predictions, tolerance)
    update_localization_records(records.localization, truth, predictions, matches)
    if include_segmentation:
        update_segmentation_records(records.segmentation, truth, predictions, matches, image_shape)


def _slice_result(
    records: SpatialSlice, tolerance: float, include_segmentation: bool
) -> dict[str, object]:
    result: dict[str, object] = {
        "localization": localization_metrics(records.localization, tolerance).model_dump(
            mode="json"
        )
    }
    if include_segmentation:
        result["instance_segmentation"] = segmentation_metrics(records.segmentation).model_dump(
            mode="json"
        )
    return result


def evaluate_records(
    task: Task,
    records: list[SpatialPredictionRecord],
    items: dict[str, SplitItem],
    data_root: Path,
    ontology: list[str],
    tolerance: float,
) -> dict[str, object]:
    aggregate = SpatialSlice()
    sites: dict[str, SpatialSlice] = defaultdict(SpatialSlice)
    classes: dict[str, SpatialSlice] = {label: SpatialSlice() for label in ontology}
    include_segmentation = task == "segment"
    for record in records:
        item = items[record.item_id]
        truth = load_annotations(data_root / item.annotation_path)
        predictions = [
            as_predicted_nucleus(prediction, (record.image_height, record.image_width))
            for prediction in record.predictions
        ]
        image_shape = record.image_height, record.image_width
        _update_slice(aggregate, truth, predictions, tolerance, image_shape, include_segmentation)
        _update_slice(
            sites[item.site_id], truth, predictions, tolerance, image_shape, include_segmentation
        )
        for label in ontology:
            class_truth = [annotation for annotation in truth if annotation.class_name == label]
            class_predictions = [
                as_predicted_nucleus(prediction, image_shape)
                for prediction in record.predictions
                if prediction.class_name == label
            ]
            _update_slice(
                classes[label],
                class_truth,
                class_predictions,
                tolerance,
                image_shape,
                include_segmentation,
            )
    return {
        **_slice_result(aggregate, tolerance, include_segmentation),
        "per_class": {
            label: _slice_result(values, tolerance, include_segmentation)
            for label, values in classes.items()
        },
        "held_out_site_slices": {
            site: _slice_result(values, tolerance, include_segmentation)
            for site, values in sorted(sites.items())
        },
    }


def _aggregate_loss(rows: list[dict[str, float]], prefix: str) -> list[float]:
    return [sum(value for key, value in row.items() if key.startswith(prefix)) for row in rows]


def _series_summary(rows: list[dict[str, float]], key: str) -> dict[str, float | int]:
    values = [row[key] for row in rows]
    best_index = max(range(len(values)), key=values.__getitem__)
    return {
        "first": values[0],
        "best": values[best_index],
        "best_epoch": int(rows[best_index]["epoch"]),
        "final": values[-1],
    }


def training_curve_summary(
    rows: list[dict[str, float]],
    best_checkpoint_metrics: dict[str, float],
    maximum_epochs: int,
    *,
    stop_reason: str | None = None,
    stopped_for_wall_time: bool = False,
) -> dict[str, object]:
    if not rows:
        raise ValueError("training results are empty")
    training_loss = _aggregate_loss(rows, "train/")
    validation_loss = _aggregate_loss(rows, "val/")
    metric_keys = [
        key
        for key in (
            "metrics/mAP50(B)",
            "metrics/mAP50-95(B)",
            "metrics/mAP50(M)",
            "metrics/mAP50-95(M)",
        )
        if key in rows[0]
    ]
    matching_row = min(
        rows,
        key=lambda row: sum(
            abs(row[key] - best_checkpoint_metrics[key])
            for key in metric_keys
            if key in best_checkpoint_metrics
        ),
    )
    completed_epochs = int(rows[-1]["epoch"])
    if stopped_for_wall_time:
        stopped_by = "wall_time_guard"
        convergence = "stopped_by_guard"
    elif stop_reason is not None:
        stopped_by = stop_reason
        convergence = "stopped_by_guard"
    elif completed_epochs >= maximum_epochs:
        stopped_by = "epoch_ceiling"
        convergence = "not_established_before_epoch_ceiling"
    else:
        stopped_by = "validation_patience"
        convergence = "validation_plateau_supports_convergence"
    return {
        "completed_epochs": completed_epochs,
        "stopped_by": stopped_by,
        "convergence_assessment": convergence,
        "training_loss": {
            "first": training_loss[0],
            "final": training_loss[-1],
            "minimum": min(training_loss),
        },
        "validation_loss": {
            "first": validation_loss[0],
            "final": validation_loss[-1],
            "minimum": min(validation_loss),
        },
        "metrics": {key: _series_summary(rows, key) for key in metric_keys},
        "best_checkpoint": {
            "epoch": int(matching_row["epoch"]),
            "metrics": best_checkpoint_metrics,
        },
    }


def _prediction_records(path: Path) -> list[SpatialPredictionRecord]:
    return [SpatialPredictionRecord.model_validate(row) for row in read_jsonl(path)]


def evaluate_learned_baseline(
    params_path: Path = PARAMS_FILE,
) -> dict[str, object]:  # pragma: no cover
    config = load_config(params_path)
    root = project_root(params_path)
    run_root = output_root(root, config)
    evaluation_root = run_root / "evaluation"
    evidence_path = evaluation_root / "evidence.json"
    if evidence_path.exists():
        raise FileExistsError(f"evaluation evidence already exists: {evidence_path}")
    training_manifest_path = run_root / "training" / "manifest.json"
    inference_path = evaluation_root / "inference.json"
    rejections_path = evaluation_root / "rejections.json"
    for required in (training_manifest_path, inference_path, rejections_path):
        if not required.is_file():
            raise FileNotFoundError(f"required evaluation input is missing: {required}")

    source_root = data_root()
    product_cohort = cohort()
    labels = ontology_labels()
    test_items = {item.item_id: item for item in product_cohort.items if item.split == "test"}
    prediction_paths = {
        task: evaluation_root / task / "predictions.jsonl" for task in ("detect", "segment")
    }
    task_evidence: dict[str, dict[str, Any]] = {
        task: evaluate_records(
            task,
            _prediction_records(prediction_paths[task]),
            test_items,
            source_root,
            labels,
            config.localization_tolerance_pixels,
        )
        for task in ("detect", "segment")
    }

    import torch

    training_manifest = read_json(training_manifest_path)
    training_curves: dict[str, object] = {}
    for task in ("detect", "segment"):
        task_training_root = run_root / "training" / task
        checkpoint_record = training_manifest["checkpoints"][task]
        checkpoint = load_safe_checkpoint(torch, task_training_root / "weights" / "best.pt")
        checkpoint_metrics = {
            str(key): float(value) for key, value in checkpoint["train_metrics"].items()
        }
        training_curves[task] = training_curve_summary(
            training_rows(task_training_root),
            checkpoint_metrics,
            config.training.epochs,
            stop_reason=checkpoint_record["stop_reason"],
            stopped_for_wall_time=bool(checkpoint_record["stopped_for_wall_time"]),
        )

    inference = read_json(inference_path)
    inference_resources = inference["resources"]
    total_gpu_seconds = float(training_manifest["aggregate_gpu_seconds"]) + sum(
        float(resource_record["gpu_seconds"]) for resource_record in inference_resources.values()
    )
    if total_gpu_seconds > config.limits.aggregate_gpu_seconds:
        raise RuntimeError("training and inference exceeded the aggregate GPU-time ceiling")
    transparent = read_json(root / TRANSPARENT_BASELINE_REPORT)
    comparison = {
        "transparent_baseline": {
            "localization_f1": transparent["localization"]["f1"],
            "conditional_instance_mean_iou": transparent["instance_segmentation"][
                "mean_instance_iou"
            ],
        },
        "learned_baseline": {
            "detection_localization_f1": task_evidence["detect"]["localization"]["f1"],
            "segmentation_localization_f1": task_evidence["segment"]["localization"]["f1"],
            "conditional_instance_mean_iou": task_evidence["segment"]["instance_segmentation"][
                "mean_instance_iou"
            ],
        },
    }
    layout_manifest_path = root / LAYOUT_DIRECTORY / "manifest.json"
    layout_manifest = read_json(layout_manifest_path)
    evidence: dict[str, object] = {
        "schema_version": "1.0.0",
        "parameters": {
            "path": params_path.relative_to(root).as_posix(),
            "sha256": parameters_sha256(params_path),
        },
        "split": {
            "product_id": product_cohort.product_id,
            "item_counts": product_cohort.item_counts,
            "patient_counts": product_cohort.patient_counts,
            "slide_counts": product_cohort.slide_counts,
            "patient_intersections": product_cohort.patient_intersections,
            "slide_intersections": product_cohort.slide_intersections,
            "held_out_test_sites": product_cohort.held_out_test_sites,
        },
        "tasks": task_evidence,
        "training_curves": training_curves,
        "conversion": {
            "exclusion_counts": layout_manifest["exclusion_counts"],
            "adjustment_counts": layout_manifest["adjustment_counts"],
            "ignored_regions": layout_manifest["ignored_regions"],
        },
        "comparison": comparison,
        "failures": read_json(rejections_path),
        "resources": {
            "training": training_manifest["resources"],
            "inference": inference_resources,
            "aggregate_gpu_seconds": total_gpu_seconds,
            "aggregate_gpu_ceiling_seconds": config.limits.aggregate_gpu_seconds,
        },
        "artifacts": {
            "split_manifest": {
                "path": layout_manifest_path.relative_to(root).as_posix(),
                "sha256": sha256_file(layout_manifest_path),
            },
            "package_lock": {"path": "uv.lock", "sha256": sha256_file(root / "uv.lock")},
            "training_manifest": {
                "path": training_manifest_path.relative_to(root).as_posix(),
                "sha256": sha256_file(training_manifest_path),
            },
            "inference_manifest": {
                "path": inference_path.relative_to(root).as_posix(),
                "sha256": sha256_file(inference_path),
            },
            "predictions": {
                task: {
                    "path": prediction_paths[task].relative_to(root).as_posix(),
                    "sha256": sha256_file(prediction_paths[task]),
                }
                for task in ("detect", "segment")
            },
            "training_curves": {
                task: {
                    "path": (run_root / "training" / task / "results.csv")
                    .relative_to(root)
                    .as_posix(),
                    "sha256": sha256_file(run_root / "training" / task / "results.csv"),
                }
                for task in ("detect", "segment")
            },
        },
        "clinical_validity": False,
    }
    write_json(evidence_path, evidence)
    return evidence
