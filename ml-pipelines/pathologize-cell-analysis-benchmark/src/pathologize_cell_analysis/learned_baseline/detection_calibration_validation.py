from __future__ import annotations

from pathlib import Path
from typing import Any

from data_artifacts.files import read_json, sha256_file, write_json

from .config import data_root, load_config, ontology_labels
from .detection_calibration_contracts import (
    CALIBRATION_PARAMS_FILE,
    CALIBRATION_VALIDATION_REPORT_FILE,
    EVIDENCE_FILENAME,
    INFERENCE_FILENAME,
    REJECTIONS_FILENAME,
    VALIDATION_ROOT,
    CalibrationPredictionRecord,
    DetectionCalibrationConfig,
    filter_records,
    load_calibration_config,
    localization,
    prediction_path,
    prediction_records,
    resource_summary,
    slice_localization,
    split_items,
    value_token,
)
from .detection_calibration_statistics import (
    evaluate_detection_records,
    paired_slide_bootstrap,
)


def _selection_key(  # pragma: no cover
    row: dict[str, Any], baseline_nms: float
) -> tuple[float, ...]:
    metrics = row["localization"]
    return (
        float(metrics["f1"]),
        float(metrics["precision"]),
        float(metrics["recall"]),
        float(row["worst_site_f1_delta"]),
        float(row["worst_supported_class_f1_delta"]),
        -float(row["confidence_threshold"]),
        -abs(float(row["nms_iou_threshold"]) - baseline_nms),
    )


def _candidate_row(
    confidence: float,
    nms_iou: float,
    evaluation: dict[str, Any],
    baseline: dict[str, Any],
    supported_classes: list[str],
    calibration: DetectionCalibrationConfig,
) -> dict[str, Any]:  # pragma: no cover
    metrics = localization(evaluation["localization"])
    baseline_metrics = localization(baseline["localization"])
    site_deltas = {
        site: values["localization"]["f1"]
        - baseline["held_out_site_slices"][site]["localization"]["f1"]
        for site, values in evaluation["held_out_site_slices"].items()
    }
    class_deltas = {
        label: evaluation["per_class"][label]["localization"]["f1"]
        - baseline["per_class"][label]["localization"]["f1"]
        for label in supported_classes
    }
    precision_gain = float(metrics["precision"]) - float(baseline_metrics["precision"])
    recall_loss = float(baseline_metrics["recall"]) - float(metrics["recall"])
    safeguards = {
        "precision_gain": precision_gain >= calibration.minimum_precision_gain,
        "recall_loss": recall_loss <= calibration.maximum_recall_loss,
        "sites": min(site_deltas.values(), default=0.0) >= -calibration.maximum_site_f1_regression,
        "supported_classes": min(class_deltas.values(), default=0.0)
        >= -calibration.maximum_class_f1_regression,
    }
    is_baseline = (
        confidence == calibration.baseline_confidence_threshold
        and nms_iou == calibration.baseline_nms_iou_threshold
    )
    return {
        "confidence_threshold": confidence,
        "nms_iou_threshold": nms_iou,
        "localization": metrics,
        "f1_delta": float(metrics["f1"]) - float(baseline_metrics["f1"]),
        "precision_gain": precision_gain,
        "recall_loss": recall_loss,
        "worst_site_f1_delta": min(site_deltas.values(), default=0.0),
        "worst_supported_class_f1_delta": min(class_deltas.values(), default=0.0),
        "safeguards": safeguards,
        "eligible": not is_baseline and all(safeguards.values()),
    }


def _validation_metric_summary(  # pragma: no cover
    evidence: dict[str, Any],
) -> dict[str, object]:
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
    evidence_path = VALIDATION_ROOT / EVIDENCE_FILENAME
    if evidence_path.exists() or CALIBRATION_VALIDATION_REPORT_FILE.exists():
        raise FileExistsError("validation calibration evidence already exists")
    items = split_items("validation")
    labels = ontology_labels()
    source_root = data_root()
    raw_records = {
        nms_iou: prediction_records(prediction_path(VALIDATION_ROOT, nms_iou))
        for nms_iou in calibration.nms_iou_thresholds
    }
    baseline_confidence = calibration.baseline_confidence_threshold
    baseline_nms = calibration.baseline_nms_iou_threshold
    baseline_records = filter_records(raw_records[baseline_nms], baseline_confidence)
    baseline_evaluation = evaluate_detection_records(
        baseline_records, items, source_root, labels, config.localization_tolerance_pixels
    )
    baseline_localization = localization(baseline_evaluation["localization"])
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
            records = filter_records(raw_records[nms_iou], confidence)
            evaluation = evaluate_detection_records(
                records, items, source_root, labels, config.localization_tolerance_pixels
            )
            evaluations[(confidence, nms_iou)] = records, evaluation
            grid.append(
                _candidate_row(
                    confidence,
                    nms_iou,
                    evaluation,
                    baseline_evaluation,
                    supported_classes,
                    calibration,
                )
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
    operating_point = {
        "confidence_threshold": float(selected_row["confidence_threshold"]),
        "nms_iou_threshold": float(selected_row["nms_iou_threshold"]),
    }
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
    selected_localization = localization(selected_evaluation["localization"])
    f1_gain = float(selected_localization["f1"]) - float(baseline_localization["f1"])
    precision_gain = float(selected_localization["precision"]) - float(
        baseline_localization["precision"]
    )
    recall_loss = float(baseline_localization["recall"]) - float(selected_localization["recall"])
    selected_sites = slice_localization(selected_evaluation, "held_out_site_slices")
    baseline_sites = slice_localization(baseline_evaluation, "held_out_site_slices")
    selected_classes = slice_localization(selected_evaluation, "per_class")
    baseline_classes = slice_localization(baseline_evaluation, "per_class")
    worst_site_delta = min(
        selected_sites[site]["f1"] - baseline_sites[site]["f1"] for site in selected_sites
    )
    worst_class_delta = min(
        selected_classes[label]["f1"] - baseline_classes[label]["f1"] for label in supported_classes
    )
    rejection_count = len(read_json(VALIDATION_ROOT / REJECTIONS_FILENAME))
    inference = read_json(VALIDATION_ROOT / INFERENCE_FILENAME)
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
        "resources": {"validation_inference": resource_summary(inference["resources"])},
        "artifacts": {
            "checkpoint_sha256": inference["checkpoint_sha256"],
            "predictions": {
                value_token(nms_iou): sha256_file(prediction_path(VALIDATION_ROOT, nms_iou))
                for nms_iou in calibration.nms_iou_thresholds
            },
        },
        "parameters_sha256": sha256_file(params_path),
        "test_fold_used_for_selection": False,
    }
    write_json(evidence_path, evidence)
    write_json(CALIBRATION_VALIDATION_REPORT_FILE, _validation_metric_summary(evidence))
    return evidence
