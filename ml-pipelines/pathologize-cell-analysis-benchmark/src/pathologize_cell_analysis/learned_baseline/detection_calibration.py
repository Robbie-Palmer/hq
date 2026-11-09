from __future__ import annotations

import os
import time
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Self, cast

import fire
import numpy as np
from data_artifacts.files import (
    read_json,
    read_jsonl,
    read_yaml,
    sha256_file,
    write_json,
    write_jsonl,
)
from pydantic import Field, model_validator
from ultralytics_extensions.results import normalize_result

from ..contracts import AcceleratorResourceEvidence, SpatialPrediction, StrictModel
from ..data import SplitItem, load_annotations
from ..localization import match_localizations
from .config import (
    LAYOUT_DIRECTORY,
    PARAMS_FILE,
    PROJECT_ROOT,
    cohort,
    data_root,
    load_config,
    ontology_labels,
)
from .evaluation import as_predicted_nucleus, evaluate_records
from .prediction import (
    _clear_runtime_files,
    _peak_rss_bytes,
    prediction_arguments,
)

EvaluationSplit = Literal["validation", "test"]
CALIBRATION_PARAMS_FILE = PROJECT_ROOT / "params/nucls-detection-calibration.yaml"
CALIBRATION_ROOT = PROJECT_ROOT / "outputs/learned-baseline/detection-calibration"
VALIDATION_ROOT = CALIBRATION_ROOT / "validation"
TEST_ROOT = CALIBRATION_ROOT / "test"
LOCK_PATH = CALIBRATION_ROOT / "locked-operating-point.json"
BASELINE_TEST_PREDICTIONS = Path("outputs/learned-baseline/evaluation/detect/predictions.jsonl")
CALIBRATION_VALIDATION_REPORT_FILE = (
    PROJECT_ROOT / "reports/nucls-detection-calibration-validation.json"
)
CALIBRATION_JSON_REPORT_FILE = PROJECT_ROOT / "reports/nucls-detection-calibration.json"
CALIBRATION_MARKDOWN_REPORT_FILE = PROJECT_ROOT / "reports/nucls-detection-calibration.md"


class DetectionCalibrationConfig(StrictModel):
    schema_version: Literal["1.0.0"]
    selection_split: Literal["validation"]
    baseline_confidence_threshold: float = Field(ge=0, le=1)
    baseline_nms_iou_threshold: float = Field(ge=0, le=1)
    confidence_thresholds: tuple[float, ...] = Field(min_length=2)
    nms_iou_thresholds: tuple[float, ...] = Field(min_length=2)
    inference_batch_size: int = Field(gt=0, le=64)
    objective: Literal["maximize_aggregate_localization_f1"]
    tie_break: tuple[
        Literal[
            "higher_precision",
            "higher_recall",
            "higher_worst_site_f1_delta",
            "higher_worst_supported_class_f1_delta",
            "lower_confidence_threshold",
            "nms_iou_closest_to_baseline",
        ],
        ...,
    ]
    minimum_f1_gain: float = Field(gt=0, le=1)
    minimum_precision_gain: float = Field(gt=0, le=1)
    maximum_recall_loss: float = Field(gt=0, le=1)
    maximum_site_f1_regression: float = Field(ge=0, le=1)
    maximum_class_f1_regression: float = Field(ge=0, le=1)
    supported_class_minimum_truth: int = Field(gt=0)
    bootstrap_resamples: int = Field(ge=1000, le=100000)
    bootstrap_seed: int = Field(ge=0)
    confidence_level: float = Field(ge=0.95, le=0.95)
    maximum_test_evaluations: Literal[1]
    stop_rules: tuple[str, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def require_ordered_grid_and_tie_break(self) -> Self:
        for name, values in (
            ("confidence_thresholds", self.confidence_thresholds),
            ("nms_iou_thresholds", self.nms_iou_thresholds),
        ):
            if any(value < 0 or value > 1 for value in values):
                raise ValueError(f"{name} must stay within [0, 1]")
            if tuple(sorted(set(values))) != values:
                raise ValueError(f"{name} must be strictly increasing and unique")
        expected_tie_break = (
            "higher_precision",
            "higher_recall",
            "higher_worst_site_f1_delta",
            "higher_worst_supported_class_f1_delta",
            "lower_confidence_threshold",
            "nms_iou_closest_to_baseline",
        )
        if self.tie_break != expected_tie_break:
            raise ValueError("detection calibration tie-break order must remain fully declared")
        if self.baseline_confidence_threshold not in self.confidence_thresholds:
            raise ValueError("baseline confidence threshold must be in the candidate grid")
        if self.baseline_nms_iou_threshold not in self.nms_iou_thresholds:
            raise ValueError("baseline NMS IoU threshold must be in the candidate grid")
        return self


class CalibrationPredictionRecord(StrictModel):
    schema_version: Literal["1.0.0"]
    task: Literal["detect"]
    item_id: str
    slide_id: str
    patient_id: str
    site_id: str
    split: EvaluationSplit
    image_width: int = Field(gt=0)
    image_height: int = Field(gt=0)
    predictions: list[SpatialPrediction]


def load_calibration_config(
    path: Path = CALIBRATION_PARAMS_FILE,
) -> DetectionCalibrationConfig:
    document = read_yaml(path)
    if not isinstance(document, dict):
        raise TypeError("detection-calibration parameters must be a YAML object")
    calibration = DetectionCalibrationConfig.model_validate(document)
    baseline = load_config()
    if calibration.baseline_confidence_threshold != baseline.inference.confidence_threshold:
        raise ValueError("calibration baseline confidence differs from the merged baseline")
    if calibration.baseline_nms_iou_threshold != baseline.inference.iou_threshold:
        raise ValueError("calibration baseline NMS IoU differs from the merged baseline")
    return calibration


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


def _value_token(value: float) -> str:
    return f"{value:.2f}".replace(".", "p")


def prediction_path(root: Path, nms_iou_threshold: float) -> Path:
    return root / "predictions" / f"nms-iou-{_value_token(nms_iou_threshold)}.jsonl"


def _prediction_records(path: Path) -> list[CalibrationPredictionRecord]:
    return [CalibrationPredictionRecord.model_validate(row) for row in read_jsonl(path)]


def _split_items(split: EvaluationSplit) -> dict[str, SplitItem]:
    return {item.item_id: item for item in cohort().items if item.split == split}


def _require_complete_records(
    records: list[CalibrationPredictionRecord],
    items: dict[str, SplitItem],
    split: EvaluationSplit,
) -> None:
    if {record.item_id for record in records} != set(items):
        raise ValueError(f"detection predictions do not cover every frozen {split} item")
    if any(record.split != split for record in records):
        raise ValueError(f"detection predictions contain a record outside the {split} split")


def _require_item(item_id: str, items: dict[str, SplitItem], split: EvaluationSplit) -> SplitItem:
    if item_id not in items:
        raise ValueError(f"prediction source is not in the frozen {split} split: {item_id}")
    return items[item_id]


def _run_detection_inference(
    split: EvaluationSplit,
    confidence_threshold: float,
    nms_iou_thresholds: tuple[float, ...],
    destination: Path,
    params_path: Path = CALIBRATION_PARAMS_FILE,
) -> dict[str, object]:  # pragma: no cover
    config = load_config()
    root = PROJECT_ROOT
    run_root = root / "outputs/learned-baseline"
    if destination.exists():
        if any(destination.iterdir()):
            raise FileExistsError(f"calibration inference output already exists: {destination}")
        destination.rmdir()
    os.environ["YOLO_CONFIG_DIR"] = str(destination / "ultralytics-config")
    from torch import cuda
    from ultralytics import YOLO

    items = _split_items(split)
    labels = ontology_labels()
    checkpoint = run_root / "training/detect/weights/best.pt"
    model = YOLO(str(checkpoint), task="detect")
    image_root = root / LAYOUT_DIRECTORY / "detect/images" / split
    source_paths = [str(image_root / f"{item_id}.png") for item_id in sorted(items)]
    resources: dict[str, object] = {}
    rejections: list[dict[str, object]] = []
    written: list[Path] = []
    try:
        for nms_iou_threshold in nms_iou_thresholds:
            arguments = prediction_arguments(PARAMS_FILE, "detect")
            arguments["conf"] = confidence_threshold
            arguments["iou"] = nms_iou_threshold
            wall_start = time.monotonic()
            cpu_start = time.process_time()
            cuda.reset_peak_memory_stats()
            start_event = cuda.Event(enable_timing=True)
            end_event = cuda.Event(enable_timing=True)
            start_event.record()
            records: list[CalibrationPredictionRecord] = []
            calibration = load_calibration_config(params_path)
            for offset in range(0, len(source_paths), calibration.inference_batch_size):
                batch_paths = source_paths[offset : offset + calibration.inference_batch_size]
                results = model.predict(source=batch_paths, stream=True, **arguments)
                for result in results:
                    result_value: Any = result
                    item_id = Path(result_value.path).stem
                    item = _require_item(item_id, items, split)
                    width, height, instances, rejected = normalize_result(
                        result_value, "detect", labels
                    )
                    record = CalibrationPredictionRecord(
                        schema_version="1.0.0",
                        task="detect",
                        item_id=item.item_id,
                        slide_id=item.slide_id,
                        patient_id=item.patient_id,
                        site_id=item.site_id,
                        split=split,
                        image_width=width,
                        image_height=height,
                        predictions=[
                            SpatialPrediction(
                                instance_id=instance.instance_id,
                                class_name=instance.class_name,
                                confidence=instance.confidence,
                                bbox_xyxy_pixels=instance.bbox_xyxy_pixels,
                                polygon_xy_pixels=None,
                            )
                            for instance in instances
                        ],
                    )
                    records.append(record)
                    rejections.extend(
                        {
                            "split": split,
                            "nms_iou_threshold": nms_iou_threshold,
                            **entry,
                        }
                        for entry in rejected
                    )
            end_event.record()
            cuda.synchronize()
            _require_complete_records(records, items, split)
            path = prediction_path(destination, nms_iou_threshold)
            write_jsonl(path, records)
            written.append(path)
            resources[_value_token(nms_iou_threshold)] = AcceleratorResourceEvidence(
                wall_seconds=time.monotonic() - wall_start,
                cpu_seconds=time.process_time() - cpu_start,
                gpu_seconds=start_event.elapsed_time(end_event) / 1000,
                peak_rss_bytes=_peak_rss_bytes(),
                peak_vram_bytes=int(cuda.max_memory_allocated()),
                accelerator="cuda:0",
                measurement="CUDA event elapsed time and PyTorch peak allocated memory",
                wall_ceiling_seconds=config.limits.per_task_wall_seconds,
                aggregate_gpu_ceiling_seconds=config.limits.aggregate_gpu_seconds,
            ).model_dump(mode="json")
        inference = {
            "schema_version": "1.0.0",
            "split": split,
            "confidence_threshold": confidence_threshold,
            "nms_iou_thresholds": list(nms_iou_thresholds),
            "checkpoint_sha256": sha256_file(checkpoint),
            "parameters_sha256": sha256_file(params_path),
            "resources": resources,
        }
        write_json(destination / "rejections.json", rejections)
        write_json(destination / "inference.json", inference)
        written.extend((destination / "rejections.json", destination / "inference.json"))
    except BaseException:
        for path in written:
            path.unlink(missing_ok=True)
        raise
    finally:
        _clear_runtime_files(root / LAYOUT_DIRECTORY, destination)
    return inference


def predict_detection_validation(
    params_path: Path = CALIBRATION_PARAMS_FILE,
) -> dict[str, object]:
    calibration = load_calibration_config(params_path)
    return _run_detection_inference(
        "validation",
        min(calibration.confidence_thresholds),
        calibration.nms_iou_thresholds,
        VALIDATION_ROOT,
        params_path,
    )


def _filter_records(
    records: list[CalibrationPredictionRecord], confidence_threshold: float
) -> list[CalibrationPredictionRecord]:
    return [
        record.model_copy(
            update={
                "predictions": [
                    prediction
                    for prediction in record.predictions
                    if prediction.confidence >= confidence_threshold
                ]
            }
        )
        for record in records
    ]


def _localization(values: dict[str, Any]) -> dict[str, float | int]:
    keys = ("precision", "recall", "f1", "truth_points", "predicted_points", "matched_points")
    return {key: values[key] for key in keys}


def _slice_localization(evidence: dict[str, Any], key: str) -> dict[str, dict[str, Any]]:
    return {label: _localization(values["localization"]) for label, values in evidence[key].items()}


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


def _operating_point(row: dict[str, Any]) -> dict[str, float]:
    return {
        "confidence_threshold": float(row["confidence_threshold"]),
        "nms_iou_threshold": float(row["nms_iou_threshold"]),
    }


def _selection_key(row: dict[str, Any], baseline_nms: float) -> tuple[float, ...]:
    localization = row["localization"]
    return (
        float(localization["f1"]),
        float(localization["precision"]),
        float(localization["recall"]),
        float(row["worst_site_f1_delta"]),
        float(row["worst_supported_class_f1_delta"]),
        -float(row["confidence_threshold"]),
        -abs(float(row["nms_iou_threshold"]) - baseline_nms),
    )


def _validation_metric_summary(evidence: dict[str, Any]) -> dict[str, object]:
    selected = evidence["selected"]
    baseline = evidence["baseline"]
    return {
        "passed": evidence["passed"],
        "operating_point": selected["operating_point"],
        "baseline": baseline["localization"],
        "selected": selected["localization"],
        "delta": selected["delta"],
        "uncertainty": evidence["uncertainty"],
        "gates": evidence["gates"],
        "resources": evidence["resources"],
        "normalization_rejection_count": evidence["normalization_rejection_count"],
    }


def calibrate_detection_validation(
    params_path: Path = CALIBRATION_PARAMS_FILE,
) -> dict[str, object]:  # pragma: no cover
    config = load_config()
    calibration = load_calibration_config(params_path)
    validation_root = VALIDATION_ROOT
    evidence_path = validation_root / "evidence.json"
    if evidence_path.exists() or CALIBRATION_VALIDATION_REPORT_FILE.exists():
        raise FileExistsError("validation calibration evidence already exists")
    items = _split_items("validation")
    labels = ontology_labels()
    source_root = data_root()
    raw_records = {
        nms_iou: _prediction_records(prediction_path(validation_root, nms_iou))
        for nms_iou in calibration.nms_iou_thresholds
    }
    baseline_confidence = calibration.baseline_confidence_threshold
    baseline_nms = calibration.baseline_nms_iou_threshold
    baseline_records = _filter_records(raw_records[baseline_nms], baseline_confidence)
    baseline_evaluation = cast(
        dict[str, Any],
        evaluate_records(
            "detect",
            cast(Any, baseline_records),
            items,
            source_root,
            labels,
            config.localization_tolerance_pixels,
        ),
    )
    baseline_localization = _localization(baseline_evaluation["localization"])
    supported_classes = [
        label
        for label, values in baseline_evaluation["per_class"].items()
        if values["localization"]["truth_points"] >= calibration.supported_class_minimum_truth
    ]
    if not supported_classes:
        raise ValueError("validation fold has no class with enough truth for the safeguard")
    grid: list[dict[str, Any]] = []
    evaluations: dict[
        tuple[float, float], tuple[list[CalibrationPredictionRecord], dict[str, Any]]
    ] = {}
    for nms_iou in calibration.nms_iou_thresholds:
        for confidence in calibration.confidence_thresholds:
            records = _filter_records(raw_records[nms_iou], confidence)
            evaluation = cast(
                dict[str, Any],
                evaluate_records(
                    "detect",
                    cast(Any, records),
                    items,
                    source_root,
                    labels,
                    config.localization_tolerance_pixels,
                ),
            )
            evaluations[(confidence, nms_iou)] = records, evaluation
            localization = _localization(evaluation["localization"])
            site_deltas = {
                site: values["localization"]["f1"]
                - baseline_evaluation["held_out_site_slices"][site]["localization"]["f1"]
                for site, values in evaluation["held_out_site_slices"].items()
            }
            class_deltas = {
                label: evaluation["per_class"][label]["localization"]["f1"]
                - baseline_evaluation["per_class"][label]["localization"]["f1"]
                for label in supported_classes
            }
            precision_gain = float(localization["precision"]) - float(
                baseline_localization["precision"]
            )
            recall_loss = float(baseline_localization["recall"]) - float(localization["recall"])
            safeguards = {
                "precision_gain": precision_gain >= calibration.minimum_precision_gain,
                "recall_loss": recall_loss <= calibration.maximum_recall_loss,
                "sites": min(site_deltas.values(), default=0.0)
                >= -calibration.maximum_site_f1_regression,
                "supported_classes": min(class_deltas.values(), default=0.0)
                >= -calibration.maximum_class_f1_regression,
            }
            is_baseline = confidence == baseline_confidence and nms_iou == baseline_nms
            grid.append(
                {
                    "confidence_threshold": confidence,
                    "nms_iou_threshold": nms_iou,
                    "localization": localization,
                    "f1_delta": float(localization["f1"]) - float(baseline_localization["f1"]),
                    "precision_gain": precision_gain,
                    "recall_loss": recall_loss,
                    "worst_site_f1_delta": min(site_deltas.values(), default=0.0),
                    "worst_supported_class_f1_delta": min(class_deltas.values(), default=0.0),
                    "safeguards": safeguards,
                    "eligible": not is_baseline and all(safeguards.values()),
                }
            )
    candidates = [row for row in grid if row["eligible"]]
    non_baseline = [
        row
        for row in grid
        if not (
            row["confidence_threshold"] == baseline_confidence
            and row["nms_iou_threshold"] == baseline_nms
        )
    ]
    selected_row = max(
        candidates or non_baseline,
        key=lambda row: _selection_key(row, baseline_nms),
    )
    operating_point = _operating_point(selected_row)
    selected_records, selected_evaluation = evaluations[
        (operating_point["confidence_threshold"], operating_point["nms_iou_threshold"])
    ]
    uncertainty = paired_slide_bootstrap(
        baseline_records,
        selected_records,
        items,
        source_root,
        calibration.bootstrap_resamples,
        calibration.bootstrap_seed,
        config.localization_tolerance_pixels,
    )
    selected_localization = _localization(selected_evaluation["localization"])
    f1_gain = float(selected_localization["f1"]) - float(baseline_localization["f1"])
    precision_gain = float(selected_localization["precision"]) - float(
        baseline_localization["precision"]
    )
    recall_loss = float(baseline_localization["recall"]) - float(selected_localization["recall"])
    selected_sites = _slice_localization(selected_evaluation, "held_out_site_slices")
    baseline_sites = _slice_localization(baseline_evaluation, "held_out_site_slices")
    selected_classes = _slice_localization(selected_evaluation, "per_class")
    baseline_classes = _slice_localization(baseline_evaluation, "per_class")
    worst_site_delta = min(
        selected_sites[site]["f1"] - baseline_sites[site]["f1"] for site in selected_sites
    )
    worst_class_delta = min(
        selected_classes[label]["f1"] - baseline_classes[label]["f1"] for label in supported_classes
    )
    rejection_count = len(read_json(validation_root / "rejections.json"))
    inference = read_json(validation_root / "inference.json")
    gates = [
        {"gate": "eligible_candidate_exists", "passed": bool(candidates)},
        {
            "gate": "material_localization_f1_gain",
            "passed": f1_gain >= calibration.minimum_f1_gain,
            "observed": f1_gain,
            "threshold": calibration.minimum_f1_gain,
        },
        {
            "gate": "precision_gain",
            "passed": precision_gain >= calibration.minimum_precision_gain,
            "observed": precision_gain,
            "threshold": calibration.minimum_precision_gain,
        },
        {
            "gate": "recall_loss",
            "passed": recall_loss <= calibration.maximum_recall_loss,
            "observed": recall_loss,
            "threshold": calibration.maximum_recall_loss,
        },
        {
            "gate": "held_out_validation_site_f1_regression",
            "passed": worst_site_delta >= -calibration.maximum_site_f1_regression,
            "observed": worst_site_delta,
            "threshold": -calibration.maximum_site_f1_regression,
        },
        {
            "gate": "supported_class_f1_regression",
            "passed": worst_class_delta >= -calibration.maximum_class_f1_regression,
            "observed": worst_class_delta,
            "threshold": -calibration.maximum_class_f1_regression,
        },
        {
            "gate": "paired_slide_bootstrap_f1_delta",
            "passed": uncertainty["delta_intervals"]["f1"]["lower"] > 0,
            "observed": uncertainty["delta_intervals"]["f1"]["lower"],
            "threshold": 0.0,
        },
        {
            "gate": "normalization_rejections",
            "passed": rejection_count == 0,
            "observed": rejection_count,
            "threshold": 0,
        },
    ]
    evidence: dict[str, object] = {
        "schema_version": "1.0.0",
        "selection_split": "validation",
        "objective": calibration.objective,
        "tie_break": list(calibration.tie_break),
        "candidate_grid": grid,
        "supported_classes": supported_classes,
        "baseline": {
            "operating_point": {
                "confidence_threshold": baseline_confidence,
                "nms_iou_threshold": baseline_nms,
            },
            "localization": baseline_localization,
            "per_class": baseline_classes,
            "held_out_sites": baseline_sites,
        },
        "selected": {
            "operating_point": operating_point,
            "localization": selected_localization,
            "delta": {
                "f1": f1_gain,
                "precision": precision_gain,
                "recall": -recall_loss,
                "worst_site_f1": worst_site_delta,
                "worst_supported_class_f1": worst_class_delta,
            },
            "per_class": selected_classes,
            "held_out_sites": selected_sites,
        },
        "uncertainty": uncertainty,
        "gates": gates,
        "passed": all(gate["passed"] for gate in gates),
        "normalization_rejection_count": rejection_count,
        "resources": {"validation_inference": _resource_summary(inference["resources"])},
        "artifacts": {
            "checkpoint_sha256": inference["checkpoint_sha256"],
            "predictions": {
                _value_token(nms_iou): sha256_file(prediction_path(validation_root, nms_iou))
                for nms_iou in calibration.nms_iou_thresholds
            },
        },
        "parameters_sha256": sha256_file(params_path),
        "test_fold_used_for_selection": False,
    }
    write_json(evidence_path, evidence)
    write_json(CALIBRATION_VALIDATION_REPORT_FILE, _validation_metric_summary(evidence))
    return evidence


def lock_detection_calibration(
    params_path: Path = CALIBRATION_PARAMS_FILE,
) -> dict[str, object]:  # pragma: no cover
    validation_evidence_path = VALIDATION_ROOT / "evidence.json"
    evidence = read_json(validation_evidence_path)
    if not evidence["passed"]:
        raise RuntimeError("validation gate failed; refusing to lock a test operating point")
    if LOCK_PATH.exists():
        raise FileExistsError(f"calibration lock already exists: {LOCK_PATH}")
    lock: dict[str, object] = {
        "schema_version": "1.0.0",
        "selection_split": "validation",
        "operating_point": evidence["selected"]["operating_point"],
        "validation_evidence_sha256": sha256_file(validation_evidence_path),
        "parameters_sha256": sha256_file(params_path),
        "maximum_test_evaluations": 1,
    }
    write_json(LOCK_PATH, lock)
    return lock


def _load_lock(params_path: Path) -> dict[str, Any]:  # pragma: no cover
    lock = read_json(LOCK_PATH)
    if lock["parameters_sha256"] != sha256_file(params_path):
        raise ValueError("calibration parameters changed after the operating point was locked")
    return lock


def predict_detection_test(  # pragma: no cover
    params_path: Path = CALIBRATION_PARAMS_FILE,
) -> dict[str, object]:
    lock = _load_lock(params_path)
    operating_point = lock["operating_point"]
    return _run_detection_inference(
        "test",
        float(operating_point["confidence_threshold"]),
        (float(operating_point["nms_iou_threshold"]),),
        TEST_ROOT,
        params_path,
    )


def _resource_summary(  # pragma: no cover
    resources: dict[str, Any],
) -> dict[str, float | int]:
    records = list(resources.values())
    return {
        "wall_seconds": sum(float(record["wall_seconds"]) for record in records),
        "cpu_seconds": sum(float(record["cpu_seconds"]) for record in records),
        "gpu_seconds": sum(float(record["gpu_seconds"]) for record in records),
        "peak_rss_bytes": max(int(record["peak_rss_bytes"]) for record in records),
        "peak_vram_bytes": max(int(record["peak_vram_bytes"]) for record in records),
    }


def evaluate_detection_test(
    params_path: Path = CALIBRATION_PARAMS_FILE,
) -> dict[str, object]:  # pragma: no cover
    config = load_config()
    calibration = load_calibration_config(params_path)
    lock = _load_lock(params_path)
    evidence_path = TEST_ROOT / "evidence.json"
    if evidence_path.exists():
        raise FileExistsError(f"test evidence already exists: {evidence_path}")
    operating_point = lock["operating_point"]
    nms_iou = float(operating_point["nms_iou_threshold"])
    candidate_records = _prediction_records(prediction_path(TEST_ROOT, nms_iou))
    baseline_records = _prediction_records(PROJECT_ROOT / BASELINE_TEST_PREDICTIONS)
    items = _split_items("test")
    labels = ontology_labels()
    source_root = data_root()
    baseline = cast(
        dict[str, Any],
        evaluate_records(
            "detect",
            cast(Any, baseline_records),
            items,
            source_root,
            labels,
            config.localization_tolerance_pixels,
        ),
    )
    candidate = cast(
        dict[str, Any],
        evaluate_records(
            "detect",
            cast(Any, candidate_records),
            items,
            source_root,
            labels,
            config.localization_tolerance_pixels,
        ),
    )
    uncertainty = paired_slide_bootstrap(
        baseline_records,
        candidate_records,
        items,
        source_root,
        calibration.bootstrap_resamples,
        calibration.bootstrap_seed,
        config.localization_tolerance_pixels,
    )
    baseline_localization = _localization(baseline["localization"])
    candidate_localization = _localization(candidate["localization"])
    validation_inference = read_json(VALIDATION_ROOT / "inference.json")
    test_inference = read_json(TEST_ROOT / "inference.json")
    validation_resources = _resource_summary(validation_inference["resources"])
    test_resources = _resource_summary(test_inference["resources"])
    failures = read_json(TEST_ROOT / "rejections.json")
    evidence: dict[str, object] = {
        "schema_version": "1.0.0",
        "split": "test",
        "operating_point": operating_point,
        "baseline": {
            "localization": baseline_localization,
            "per_class": _slice_localization(baseline, "per_class"),
            "held_out_sites": _slice_localization(baseline, "held_out_site_slices"),
        },
        "calibrated": {
            "localization": candidate_localization,
            "per_class": _slice_localization(candidate, "per_class"),
            "held_out_sites": _slice_localization(candidate, "held_out_site_slices"),
        },
        "delta": {
            key: float(candidate_localization[key]) - float(baseline_localization[key])
            for key in ("precision", "recall", "f1")
        },
        "uncertainty": uncertainty,
        "failures": failures,
        "resources": {
            "validation_inference": validation_resources,
            "test_inference": test_resources,
            "calibration_total": {
                "wall_seconds": validation_resources["wall_seconds"]
                + test_resources["wall_seconds"],
                "gpu_seconds": validation_resources["gpu_seconds"] + test_resources["gpu_seconds"],
                "peak_vram_bytes": max(
                    validation_resources["peak_vram_bytes"], test_resources["peak_vram_bytes"]
                ),
            },
        },
        "apparent_false_positive_interpretation": (
            "Unmatched predictions remain unmatched annotations. They are not called artifacts "
            "unless blinded review distinguishes true artifacts from biologically present but "
            "unlabelled nuclei."
        ),
        "test_evaluations_performed": 1,
        "clinical_validity": False,
    }
    write_json(evidence_path, evidence)
    return evidence


def _number(value: float | int) -> str:
    return f"{value:.4f}" if isinstance(value, float) else f"{value:,}"


def _report_markdown(  # pragma: no cover
    validation: dict[str, Any], test: dict[str, Any]
) -> str:
    selected = validation["selected"]
    baseline = test["baseline"]
    calibrated = test["calibrated"]
    class_rows = "\n".join(
        f"| `{label}` | {_number(baseline['per_class'][label]['f1'])} | {_number(values['f1'])} |"
        for label, values in calibrated["per_class"].items()
    )
    site_rows = "\n".join(
        f"| `{site}` | {_number(baseline['held_out_sites'][site]['f1'])} | "
        f"{_number(values['f1'])} |"
        for site, values in calibrated["held_out_sites"].items()
    )
    uncertainty = test["uncertainty"]["delta_intervals"]
    resources = test["resources"]
    return "\n".join(
        [
            "# NuCLS detection operating-point calibration",
            "",
            "This non-clinical experiment selected one confidence and NMS operating point on the "
            "frozen validation fold, then evaluated it once on the frozen test fold. Model "
            "weights, "
            "training parameters, folds, ontology, empty-image handling, ignored regions, and "
            "coordinate semantics did not change.",
            "",
            "## Locked operating point",
            "",
            "Validation passed with confidence "
            f"`{selected['operating_point']['confidence_threshold']:.2f}` "
            f"and NMS IoU `{selected['operating_point']['nms_iou_threshold']:.2f}`.",
            "",
            "## Frozen-test localization",
            "",
            "| Metric | Baseline | Calibrated | Delta |",
            "| --- | ---: | ---: | ---: |",
            *[
                f"| {key.capitalize()} | {_number(baseline['localization'][key])} | "
                f"{_number(calibrated['localization'][key])} | {_number(test['delta'][key])} |"
                for key in ("precision", "recall", "f1")
            ],
            "",
            "Paired slide-bootstrap 95% intervals for calibrated minus baseline were "
            f"precision [{uncertainty['precision']['lower']:.4f}, "
            f"{uncertainty['precision']['upper']:.4f}], recall "
            f"[{uncertainty['recall']['lower']:.4f}, {uncertainty['recall']['upper']:.4f}], "
            f"and F1 [{uncertainty['f1']['lower']:.4f}, {uncertainty['f1']['upper']:.4f}].",
            "",
            "## Per-class localization F1",
            "",
            "| Source class | Baseline | Calibrated |",
            "| --- | ---: | ---: |",
            class_rows,
            "",
            "## Held-out-site localization F1",
            "",
            "| Site | Baseline | Calibrated |",
            "| --- | ---: | ---: |",
            site_rows,
            "",
            "## Resources and failures",
            "",
            "Validation inference used "
            f"{resources['validation_inference']['wall_seconds']:.2f} wall "
            f"seconds and {resources['validation_inference']['gpu_seconds']:.2f} GPU seconds. "
            "The single test inference used "
            f"{resources['test_inference']['wall_seconds']:.2f} wall seconds and "
            f"{resources['test_inference']['gpu_seconds']:.2f} GPU seconds. Peak allocated VRAM "
            "across calibration inference was "
            f"{resources['calibration_total']['peak_vram_bytes']:,} bytes.",
            "",
            f"Prediction normalization rejected {len(test['failures']):,} test instances.",
            "",
            test["apparent_false_positive_interpretation"],
            "",
            "This experiment does not establish clinical validity.",
            "",
        ]
    )


def report_detection_calibration() -> dict[str, object]:  # pragma: no cover
    validation = read_json(VALIDATION_ROOT / "evidence.json")
    test = read_json(TEST_ROOT / "evidence.json")
    metrics: dict[str, object] = {
        "validation_passed": validation["passed"],
        "operating_point": validation["selected"]["operating_point"],
        "validation": {
            "baseline": validation["baseline"]["localization"],
            "selected": validation["selected"]["localization"],
            "delta": validation["selected"]["delta"],
            "uncertainty": validation["uncertainty"],
        },
        "test": {
            "baseline": test["baseline"],
            "calibrated": test["calibrated"],
            "delta": test["delta"],
            "uncertainty": test["uncertainty"],
        },
        "failure_count": len(test["failures"]),
        "resources": test["resources"],
    }
    write_json(CALIBRATION_JSON_REPORT_FILE, metrics)
    CALIBRATION_MARKDOWN_REPORT_FILE.write_text(
        _report_markdown(validation, test), encoding="utf-8"
    )
    return metrics


class CalibrationCommands:  # pragma: no cover
    def predict_validation(self) -> dict[str, object]:
        return predict_detection_validation()

    def evaluate_validation(self) -> dict[str, object]:
        return calibrate_detection_validation()

    def lock(self) -> dict[str, object]:
        return lock_detection_calibration()

    def predict_test(self) -> dict[str, object]:
        return predict_detection_test()

    def evaluate_test(self) -> dict[str, object]:
        return evaluate_detection_test()

    def report(self) -> dict[str, object]:
        return report_detection_calibration()


def main() -> None:  # pragma: no cover
    fire.Fire(CalibrationCommands)


if __name__ == "__main__":
    main()
