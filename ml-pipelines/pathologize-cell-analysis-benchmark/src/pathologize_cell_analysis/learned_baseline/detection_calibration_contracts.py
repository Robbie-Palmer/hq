from __future__ import annotations

from pathlib import Path
from typing import Any, Literal, Self

from data_artifacts.files import read_jsonl, read_yaml
from pydantic import Field, model_validator

from ..contracts import SpatialPrediction, StrictModel
from ..data import SplitItem
from .config import PROJECT_ROOT, cohort, load_config

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
EVIDENCE_FILENAME = "evidence.json"
INFERENCE_FILENAME = "inference.json"
REJECTIONS_FILENAME = "rejections.json"


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


def value_token(value: float) -> str:
    return f"{value:.2f}".replace(".", "p")


def prediction_path(root: Path, nms_iou_threshold: float) -> Path:
    return root / "predictions" / f"nms-iou-{value_token(nms_iou_threshold)}.jsonl"


def prediction_records(path: Path) -> list[CalibrationPredictionRecord]:
    return [CalibrationPredictionRecord.model_validate(row) for row in read_jsonl(path)]


def split_items(split: EvaluationSplit) -> dict[str, SplitItem]:
    return {item.item_id: item for item in cohort().items if item.split == split}


def require_complete_records(
    records: list[CalibrationPredictionRecord],
    items: dict[str, SplitItem],
    split: EvaluationSplit,
) -> None:
    if {record.item_id for record in records} != set(items):
        raise ValueError(f"detection predictions do not cover every frozen {split} item")
    if any(record.split != split for record in records):
        raise ValueError(f"detection predictions contain a record outside the {split} split")


def require_item(item_id: str, items: dict[str, SplitItem], split: EvaluationSplit) -> SplitItem:
    if item_id not in items:
        raise ValueError(f"prediction source is not in the frozen {split} split: {item_id}")
    return items[item_id]


def filter_records(
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


def localization(values: dict[str, Any]) -> dict[str, float | int]:
    keys = ("precision", "recall", "f1", "truth_points", "predicted_points", "matched_points")
    return {key: values[key] for key in keys}


def slice_localization(evidence: dict[str, Any], key: str) -> dict[str, dict[str, Any]]:
    return {label: localization(values["localization"]) for label, values in evidence[key].items()}


def resource_summary(resources: dict[str, Any]) -> dict[str, float | int]:
    records = list(resources.values())
    return {
        "wall_seconds": sum(float(record["wall_seconds"]) for record in records),
        "cpu_seconds": sum(float(record["cpu_seconds"]) for record in records),
        "gpu_seconds": sum(float(record["gpu_seconds"]) for record in records),
        "peak_rss_bytes": max(int(record["peak_rss_bytes"]) for record in records),
        "peak_vram_bytes": max(int(record["peak_vram_bytes"]) for record in records),
    }
